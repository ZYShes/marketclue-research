import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import boto3
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError

from .settings import get_settings


def _table():
    settings = get_settings()
    return boto3.resource("dynamodb", region_name=settings.region).Table(settings.table_name)


def _s3():
    return boto3.client("s3", region_name=get_settings().region)


def _now():
    return datetime.now(timezone.utc)


def _timestamp():
    return _now().isoformat().replace("+00:00", "Z")


def _to_dynamo(value):
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {key: _to_dynamo(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_dynamo(item) for item in value]
    return value


def _from_dynamo(value):
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {key: _from_dynamo(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_from_dynamo(item) for item in value]
    return value


def _public(item):
    if item is None:
        return None
    return _from_dynamo({key: value for key, value in item.items() if key not in {"PK", "SK"}})


def _get(pk, sk):
    return _table().get_item(Key={"PK": pk, "SK": sk}, ConsistentRead=True).get("Item")


def _query(sub, prefix, **kwargs):
    yield from _query_pk(f"USER#{sub}", prefix, **kwargs)


def _query_pk(pk, prefix, **kwargs):
    request = {
        "KeyConditionExpression": Key("PK").eq(pk) & Key("SK").begins_with(prefix),
        "ConsistentRead": True,
        **kwargs,
    }
    while True:
        response = _table().query(**request)
        yield from response.get("Items", [])
        if "LastEvaluatedKey" not in response:
            break
        request["ExclusiveStartKey"] = response["LastEvaluatedKey"]


def _condition_failed(exc):
    return exc.response["Error"]["Code"] in {"ConditionalCheckFailedException", "TransactionCanceledException"}


def _transaction(actions):
    serializer = TypeSerializer()
    for action in actions:
        operation = next(iter(action.values()))
        operation["TableName"] = get_settings().table_name
        for field in ("Key", "Item", "ExpressionAttributeValues"):
            if field in operation:
                operation[field] = {
                    key: serializer.serialize(_to_dynamo(value))
                    for key, value in operation[field].items()
                }
    boto3.client("dynamodb", region_name=get_settings().region).transact_write_items(TransactItems=actions)


def upsert_user(sub, email, name, picture) -> dict:
    response = _table().update_item(
        Key={"PK": f"USER#{sub}", "SK": "PROFILE"},
        UpdateExpression=(
            "SET #sub = :sub, email = :email, #name = :name, picture = :picture, "
            "is_owner = :owner, created_at = if_not_exists(created_at, :now), "
            "runs_started = if_not_exists(runs_started, :zero)"
        ),
        ExpressionAttributeNames={"#sub": "sub", "#name": "name"},
        ExpressionAttributeValues={
            ":sub": sub, ":email": email, ":name": name, ":picture": picture,
            ":owner": email.lower() in get_settings().owner_emails, ":now": _timestamp(), ":zero": 0,
        },
        ReturnValues="ALL_NEW",
    )
    return _public(response["Attributes"])


def get_user(sub) -> dict | None:
    return _public(_get(f"USER#{sub}", "PROFILE"))


def get_conversation(sub, conv_id) -> dict | None:
    return _public(_get(f"USER#{sub}", f"CONV#{conv_id}"))


def save_conversation(sub, conv: dict) -> None:
    now = _timestamp()
    _table().update_item(
        Key={"PK": f"USER#{sub}", "SK": f"CONV#{conv['conv_id']}"},
        UpdateExpression=(
            "SET conv_id = :id, messages = :messages, brief = :brief, ready = :ready, feature = :feature, "
            "template = :template, project_id = :project, created_at = if_not_exists(created_at, :created), updated_at = :now"
        ),
        ExpressionAttributeValues=_to_dynamo({
            ":id": conv["conv_id"], ":messages": conv["messages"], ":brief": conv.get("brief"),
            ":ready": conv.get("ready", False), ":feature": conv.get("feature") or "marketing_plan",
            ":template": conv.get("template") or "general", ":project": conv.get("project_id"),
            ":created": conv.get("created_at", now), ":now": now,
        }),
    )


def count_conversations(sub) -> int:
    return sum(1 for _ in _query(sub, "CONV#", ProjectionExpression="PK"))


def conversation_title(conv) -> str:
    text = ((conv.get("brief") or {}).get("business") or "").strip()
    if not text:
        first = next((m for m in conv.get("messages") or [] if m.get("role") == "user" and (m.get("text") or "").strip()), None)
        text = first["text"] if first else "Untitled research"
    text = " ".join(text.split())
    return text if len(text) <= 80 else text[:79].rstrip() + "…"


def list_conversations(sub, limit=50) -> list[dict]:
    rows = []
    for item in _query(sub, "CONV#"):
        conv = _public(item)
        rows.append({
            "conv_id": conv["conv_id"], "feature": conv.get("feature") or "marketing_plan",
            "template": conv.get("template") or "general", "project_id": conv.get("project_id"),
            "title": conversation_title(conv), "ready": bool(conv.get("ready")),
            "run_id": conv.get("run_id"), "run_status": conv.get("run_status"),
            "updated_at": conv.get("updated_at") or conv.get("created_at"),
        })
    rows.sort(key=lambda row: row["updated_at"] or "", reverse=True)
    return rows[:max(limit, 0)]


def _set_conversation_run(sub, conv_id, run_id, status, link=False):
    """Links a run to its conversation, or mirrors the status of the run it already links."""
    update = "SET run_status = :status"
    values = {":status": status, ":run": run_id}
    condition = "attribute_exists(PK) AND run_id = :run"
    if link:
        update = "SET run_id = :run, run_status = :status, updated_at = :now"
        values[":now"] = _timestamp()
        condition = "attribute_exists(PK)"
    try:
        _table().update_item(
            Key={"PK": f"USER#{sub}", "SK": f"CONV#{conv_id}"}, UpdateExpression=update,
            ConditionExpression=condition, ExpressionAttributeValues=values,
        )
    except ClientError as exc:
        if not _condition_failed(exc):
            raise


def create_run(sub, conv_id, title, brief, mode="quick", project_id=None) -> dict:
    run_id, now = uuid4().hex[:12], _timestamp()
    run = {
        "run_id": run_id, "user_sub": sub, "conv_id": conv_id, "title": title,
        "brief": brief, "mode": mode, "template": (brief or {}).get("template") or "general", "status": "queued", "stage": "planning", "agents": {},
        "cost_usd": 0, "error": None, "share_token": None, "created_at": now,
        "updated_at": now, "result_key": None, "project_id": project_id,
    }
    index = {key: run[key] for key in ("run_id", "title", "status", "created_at", "cost_usd", "mode", "template", "project_id")}
    index["feature"] = (brief or {}).get("feature") or "marketing_plan"
    actions = [
        {"Put": {"Item": {"PK": f"RUN#{run_id}", "SK": "META", **run},
                 "ConditionExpression": "attribute_not_exists(PK)"}},
        {"Put": {"Item": {"PK": f"USER#{sub}", "SK": f"RUN#{now}#{run_id}", **index},
                 "ConditionExpression": "attribute_not_exists(PK)"}},
    ]
    if project_id:
        actions.append({"Put": {"Item": project_run_item(project_id, run)}})
    _transaction(actions)
    if conv_id:
        _set_conversation_run(sub, conv_id, run_id, "queued", link=True)
    return _public(run)


def get_run(run_id) -> dict | None:
    return _public(_get(f"RUN#{run_id}", "META"))


def claim_run(run_id) -> bool:
    """Marks a queued run as running; False when another worker delivery already took it."""
    try:
        _table().update_item(
            Key={"PK": f"RUN#{run_id}", "SK": "META"},
            UpdateExpression="SET #s = :running, updated_at = :now",
            ConditionExpression="#s = :queued",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":running": "running", ":queued": "queued", ":now": _timestamp()},
        )
        return True
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise


def update_run(run_id, **fields) -> None:
    immutable = {"PK", "SK", "run_id", "user_sub", "conv_id", "created_at", "project_id"}
    if immutable.intersection(fields):
        raise ValueError("Run identity fields cannot be changed.")
    run = get_run(run_id)
    if run is None:
        raise KeyError(run_id)
    fields["updated_at"] = _timestamp()
    names = {f"#f{i}": field for i, field in enumerate(fields)}
    values = {f":v{i}": value for i, value in enumerate(fields.values())}
    assignments = ", ".join(f"#f{i} = :v{i}" for i in range(len(fields)))
    actions = [{"Update": {
        "Key": {"PK": f"RUN#{run_id}", "SK": "META"},
        "UpdateExpression": f"SET {assignments}",
        "ExpressionAttributeNames": names, "ExpressionAttributeValues": values,
        "ConditionExpression": "attribute_exists(PK)",
    }}]
    mirrored = {key: value for key, value in fields.items() if key in {"status", "title", "cost_usd"}}
    if mirrored:
        actions.append({"Update": {
            "Key": {"PK": f"USER#{run['user_sub']}", "SK": f"RUN#{run['created_at']}#{run_id}"},
            "UpdateExpression": "SET " + ", ".join(f"#f{i} = :v{i}" for i in range(len(mirrored))),
            "ExpressionAttributeNames": {f"#f{i}": key for i, key in enumerate(mirrored)},
            "ExpressionAttributeValues": {f":v{i}": value for i, value in enumerate(mirrored.values())},
            "ConditionExpression": "attribute_exists(PK)",
        }})
    project_fields = {key: value for key, value in fields.items() if key in PROJECT_RUN_MIRRORED}
    if project_fields and run.get("project_id"):
        actions.append({"Update": {
            "Key": {"PK": f"PROJECT#{run['project_id']}", "SK": f"RUN#{run['created_at']}#{run_id}"},
            "UpdateExpression": "SET " + ", ".join(f"#p{i} = :p{i}" for i in range(len(project_fields))),
            "ExpressionAttributeNames": {f"#p{i}": key for i, key in enumerate(project_fields)},
            "ExpressionAttributeValues": {f":p{i}": value for i, value in enumerate(project_fields.values())},
            "ConditionExpression": "attribute_exists(PK)",
        }})
    _transaction(actions)
    if "status" in fields and run.get("conv_id"):
        _set_conversation_run(run["user_sub"], run["conv_id"], run_id, fields["status"])


def list_runs(sub, limit=50) -> list[dict]:
    if limit <= 0:
        return []
    items = []
    for item in _query(sub, "RUN#", ScanIndexForward=False, Limit=limit):
        items.append(_public(item))
        if len(items) >= limit:
            break
    return items


def save_result(run_id, result: dict) -> str:
    if get_run(run_id) is None:
        raise KeyError(run_id)
    key = f"runs/{run_id}.json"
    _s3().put_object(
        Bucket=get_settings().data_bucket, Key=key,
        Body=json.dumps(result, ensure_ascii=False, allow_nan=False).encode("utf-8"),
        ContentType="application/json",
    )
    update_run(run_id, result_key=key)
    return key


def load_result(run_id) -> dict | None:
    run = get_run(run_id)
    if run is None or not run.get("result_key"):
        return None
    try:
        response = _s3().get_object(Bucket=get_settings().data_bucket, Key=run["result_key"])
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "NoSuchKey":
            return None
        raise
    return json.loads(response["Body"].read())


def save_snapshot(url, text) -> str:
    key = f"snapshots/{hashlib.sha1(url.encode('utf-8')).hexdigest()}.txt"
    _s3().put_object(
        Bucket=get_settings().data_bucket, Key=key, Body=text.encode("utf-8"),
        ContentType="text/plain; charset=utf-8",
    )
    return key


def _dedupe_key(url, quote):
    normalized_url = " ".join(url.lower().split()).split("#", 1)[0].rstrip("/")
    normalized_quote = " ".join(quote.lower().split())
    return hashlib.sha1(f"{normalized_url}\n{normalized_quote}".encode("utf-8")).hexdigest()


def _append_run(sub, card_id, run_id, refresh=None):
    """Adds run_id to a card; `refresh` fields (a re-checked eBay listing's date) are updated with it."""
    key = {"PK": f"USER#{sub}", "SK": f"CARD#{card_id}"}
    refresh = refresh or {}
    try:
        response = _table().update_item(
            Key=key,
            UpdateExpression="SET run_ids = list_append(run_ids, :run)" + "".join(f", #r{i} = :r{i}" for i in range(len(refresh))),
            ConditionExpression="attribute_exists(PK) AND NOT contains(run_ids, :id)",
            ExpressionAttributeValues={":run": [run_id], ":id": run_id, **{f":r{i}": v for i, v in enumerate(refresh.values())}},
            **({"ExpressionAttributeNames": {f"#r{i}": k for i, k in enumerate(refresh)}} if refresh else {}),
            ReturnValues="ALL_NEW",
        )
        return _public(response["Attributes"])
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        item = _get(key["PK"], key["SK"])
        if item is None:
            raise KeyError(card_id) from exc
        return _public(item)


# Optional card fields: listing cards from the eBay Browse API carry where and when they were checked.
CARD_EXTRA_FIELDS = ("source_kind", "retrieved_at", "label", "snapshot_key")


def put_cards(sub, cards: list[dict], run_id) -> list[dict]:
    existing = {item["dedupe_key"]: _public(item) for item in _query(sub, "CARD#")}
    stored = []
    for source in cards:
        dedupe = _dedupe_key(source["url"], source["quote"])
        extra = {field: source[field] for field in CARD_EXTRA_FIELDS if source.get(field) is not None}
        if dedupe in existing:
            refresh = {"captured_at": source["captured_at"], **extra} if extra.get("source_kind") == "ebay_api" else None
            card = _append_run(sub, existing[dedupe]["card_id"], run_id, refresh)
        else:
            card = {
                "card_id": uuid4().hex[:12], "claim": source["claim"], "quote": source["quote"],
                "url": source["url"], "source_title": source.get("source_title", ""),
                "captured_at": source.get("captured_at", _timestamp()),
                "type": source.get("type", "unverified"), "direction": source.get("direction", ""),
                "tags": source.get("tags", []), "run_ids": [run_id], "dedupe_key": dedupe, **extra,
            }
            _table().put_item(
                Item=_to_dynamo({"PK": f"USER#{sub}", "SK": f"CARD#{card['card_id']}", **card}),
                ConditionExpression="attribute_not_exists(PK)",
            )
        existing[dedupe] = card
        stored.append(card)
    return stored


def _capture_time(card):
    captured = datetime.fromisoformat(card["captured_at"].replace("Z", "+00:00"))
    return captured.replace(tzinfo=timezone.utc) if captured.tzinfo is None else captured.astimezone(timezone.utc)


def list_cards(sub, q=None, type=None, direction=None) -> list[dict]:
    cards = []
    threshold = _now() - timedelta(days=get_settings().stale_days)
    for item in _query(sub, "CARD#"):
        card = _public(item)
        if type and card["type"] != type:
            continue
        if direction and card["direction"] != direction:
            continue
        if q and not any(q.casefold() in card[field].casefold() for field in ("claim", "quote", "source_title")):
            continue
        card["stale"] = _capture_time(card) < threshold
        cards.append(card)
    return sorted(cards, key=_capture_time, reverse=True)


def get_cards(sub, card_ids: list[str]) -> list[dict]:
    cards = [_public(_get(f"USER#{sub}", f"CARD#{card_id}")) for card_id in card_ids]
    return [card for card in cards if card is not None]


def create_share(run_id) -> str:
    run = get_run(run_id)
    if run is None:
        raise KeyError(run_id)
    if run.get("share_token"):
        return run["share_token"]
    token, now = secrets.token_urlsafe(16), _timestamp()
    try:
        _transaction([
            {"Update": {
                "Key": {"PK": f"RUN#{run_id}", "SK": "META"},
                "UpdateExpression": "SET share_token = :token, updated_at = :now",
                "ConditionExpression": "attribute_exists(PK) AND (attribute_not_exists(share_token) OR share_token = :empty)",
                "ExpressionAttributeValues": {":token": token, ":now": now, ":empty": None},
            }},
            {"Put": {
                "Item": {"PK": f"SHARE#{token}", "SK": "META", "run_id": run_id, "created_at": now},
                "ConditionExpression": "attribute_not_exists(PK)",
            }},
        ])
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "TransactionCanceledException":
            raise
        current = get_run(run_id)
        if current and current.get("share_token"):
            return current["share_token"]
        raise
    return token


def resolve_share(token) -> dict | None:
    share = _get(f"SHARE#{token}", "META")
    return get_run(share["run_id"]) if share else None


def incr_day_counter() -> int:
    now = _now()
    response = _table().update_item(
        Key={"PK": f"DAY#{now.date().isoformat()}", "SK": "COUNTER"},
        UpdateExpression="SET #ttl = if_not_exists(#ttl, :ttl) ADD runs :one",
        ExpressionAttributeNames={"#ttl": "ttl"},
        ExpressionAttributeValues={":ttl": int((now + timedelta(days=2)).timestamp()), ":one": 1},
        ReturnValues="UPDATED_NEW",
    )
    return int(response["Attributes"]["runs"])


# ---------- Teams ----------

INVITE_DAYS = 7


def create_team(user, name) -> dict:
    """Creates a team owned by the user (the router checks the team limit first)."""
    team_id, now = uuid4().hex[:12], _timestamp()
    team = {"team_id": team_id, "name": name, "owner_sub": user["sub"], "created_at": now}
    _transaction([
        {"Put": {"Item": {"PK": f"TEAM#{team_id}", "SK": "META", **team},
                 "ConditionExpression": "attribute_not_exists(PK)"}},
        {"Put": {"Item": _member_item(team_id, user, "owner", now),
                 "ConditionExpression": "attribute_not_exists(PK)"}},
        {"Put": {"Item": membership_item(team_id, user["sub"], "owner", now),
                 "ConditionExpression": "attribute_not_exists(PK)"}},
    ])
    return team


def _member_item(team_id, user, role, now):
    return {
        "PK": f"TEAM#{team_id}", "SK": f"MEMBER#{user['sub']}", "sub": user["sub"],
        "email": user["email"], "name": user.get("name") or "", "role": role, "joined_at": now,
    }


def membership_item(team_id, sub, role, joined_at):
    """USER#<sub>/TEAMMEMBER#<team_id>: lists a person's teams in one query (replaces PROFILE.team_id)."""
    return {"PK": f"USER#{sub}", "SK": f"TEAMMEMBER#{team_id}", "team_id": team_id, "role": role, "joined_at": joined_at}


def list_memberships(sub) -> list[dict]:
    """The person's teams ({team_id, role, joined_at}), first joined first."""
    return sorted((_public(item) for item in _query(sub, "TEAMMEMBER#")), key=lambda m: (m["joined_at"], m["team_id"]))


def get_team(team_id) -> dict | None:
    return _public(_get(f"TEAM#{team_id}", "META"))


def get_member(team_id, sub) -> dict | None:
    return _public(_get(f"TEAM#{team_id}", f"MEMBER#{sub}"))


def list_members(team_id) -> list[dict]:
    members = [_public(item) for item in _query_pk(f"TEAM#{team_id}", "MEMBER#")]
    return sorted(members, key=lambda member: (member["role"] != "owner", member["joined_at"]))


def create_invite(team_id, email, invited_by) -> dict:
    token, now = secrets.token_urlsafe(16), _now()
    invite = {
        "token": token, "team_id": team_id, "email": email, "invited_by": invited_by, "status": "pending",
        "created_at": _timestamp(), "expires_at": (now + timedelta(days=INVITE_DAYS)).isoformat().replace("+00:00", "Z"),
    }
    _transaction([
        {"Put": {"Item": {"PK": f"TEAM#{team_id}", "SK": f"INVITE#{token}", **invite},
                 "ConditionExpression": "attribute_not_exists(PK)"}},
        {"Put": {"Item": {"PK": f"INVITE#{token}", "SK": "META", "team_id": team_id, "created_at": invite["created_at"]},
                 "ConditionExpression": "attribute_not_exists(PK)"}},
    ])
    return invite


def get_invite(token) -> dict | None:
    lookup = _get(f"INVITE#{token}", "META")
    return _public(_get(f"TEAM#{lookup['team_id']}", f"INVITE#{token}")) if lookup else None


def list_invites(team_id) -> list[dict]:
    invites = [_public(item) for item in _query_pk(f"TEAM#{team_id}", "INVITE#")]
    return sorted(invites, key=lambda invite: invite["created_at"], reverse=True)


def invite_expired(invite) -> bool:
    return datetime.fromisoformat(invite["expires_at"].replace("Z", "+00:00")) <= _now()


def revoke_invite(team_id, token) -> bool:
    try:
        _table().update_item(
            Key={"PK": f"TEAM#{team_id}", "SK": f"INVITE#{token}"},
            UpdateExpression="SET #s = :revoked",
            ConditionExpression="attribute_exists(PK) AND #s = :pending",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":revoked": "revoked", ":pending": "pending"},
        )
    except ClientError as exc:
        if _condition_failed(exc):
            return False
        raise
    return True


def join_team(user, invite) -> bool:
    """Accepts a pending invite; False when the invite or the user changed meanwhile."""
    team_id, now = invite["team_id"], _timestamp()
    try:
        _transaction([
            {"Update": {
                "Key": {"PK": f"TEAM#{team_id}", "SK": f"INVITE#{invite['token']}"},
                "UpdateExpression": "SET #s = :accepted, accepted_by = :sub, accepted_at = :now",
                "ConditionExpression": "#s = :pending AND expires_at > :now",
                "ExpressionAttributeNames": {"#s": "status"},
                "ExpressionAttributeValues": {":accepted": "accepted", ":pending": "pending", ":sub": user["sub"], ":now": now},
            }},
            {"Put": {"Item": _member_item(team_id, user, "member", now),
                     "ConditionExpression": "attribute_not_exists(PK)"}},
            {"Put": {"Item": membership_item(team_id, user["sub"], "member", now),
                     "ConditionExpression": "attribute_not_exists(PK)"}},
        ])
    except ClientError as exc:
        if _condition_failed(exc):
            return False
        raise
    return True


def remove_member(team_id, sub) -> bool:
    """Removes a member (never the owner) and their membership row in one step."""
    try:
        _transaction([
            {"Delete": {
                "Key": {"PK": f"TEAM#{team_id}", "SK": f"MEMBER#{sub}"},
                "ConditionExpression": "attribute_exists(PK) AND #role = :member",
                "ExpressionAttributeNames": {"#role": "role"},
                "ExpressionAttributeValues": {":member": "member"},
            }},
            {"Delete": {
                "Key": {"PK": f"USER#{sub}", "SK": f"TEAMMEMBER#{team_id}"},
                "ConditionExpression": "attribute_exists(PK)",
            }},
        ])
    except ClientError as exc:
        if _condition_failed(exc):
            return False
        raise
    return True


def _member_name(member):
    return member.get("name") or member.get("email") or ""


def _author_names(subs):
    names = {}
    for sub in subs:
        user = get_user(sub) or {}
        names[sub] = _member_name(user)
    return names


def list_team_runs(team_id, limit=50) -> list[dict]:
    """Done runs of the team's projects (unfiled runs are private), newest first, with owner_name."""
    runs = [{**row, "owner_sub": row["user_sub"]} for project in list_project_rows(f"TEAM#{team_id}")
            for row in project_runs(project["project_id"]) if row.get("status") == "done"]
    names = _author_names({run["user_sub"] for run in runs})
    runs = [{**run, "owner_name": names[run["user_sub"]]} for run in runs]
    runs.sort(key=lambda run: run["created_at"], reverse=True)
    return runs[:max(limit, 0)]


def list_team_cards(team_id, viewer_sub=None, q=None, type=None, direction=None) -> list[dict]:
    """Fact cards of the team's projects, deduped on dedupe_key (the viewer's own copy wins)."""
    cards = {}
    for project in list_project_rows(f"TEAM#{team_id}"):
        for card in project_cards(project["project_id"], viewer_sub, q=q, type=type, direction=direction):
            cards.setdefault(card["dedupe_key"], card)
    return sorted(cards.values(), key=_capture_time, reverse=True)


# ---------- Projects ----------

PROJECT_BRIEF_FIELDS = ("business", "customer", "location", "stage", "budget_usd")
PROJECT_RUN_MIRRORED = {"status", "title", "takeaway"}


def project_run_item(project_id, run):
    """PROJECT#<id>/RUN#<created_at>#<run_id>: one query lists a project's runs across all its authors."""
    return {
        "PK": f"PROJECT#{project_id}", "SK": f"RUN#{run['created_at']}#{run['run_id']}", "run_id": run["run_id"],
        "user_sub": run["user_sub"], "title": run.get("title") or "", "status": run.get("status") or "queued",
        "feature": (run.get("brief") or {}).get("feature") or "marketing_plan", "mode": run.get("mode") or "quick",
        "template": run.get("template") or "general", "created_at": run["created_at"], "takeaway": run.get("takeaway"),
    }


def _project_list_item(project):
    owner = f"TEAM#{project['team_id']}" if project.get("team_id") else f"USER#{project['owner_sub']}"
    return {"PK": owner, "SK": f"PROJECT#{project['project_id']}", **{key: project.get(key) for key in (
        "project_id", "name", "owner_sub", "team_id", "archived", "created_at", "updated_at")}}


def create_project(owner_sub, name, team_id=None, brief=None, default_template="general", limit=None, project_id=None) -> dict | None:
    """Creates a project and its list row; with `limit`, counts it on the owner's profile (None at the limit)."""
    now = _timestamp()
    project = {
        "project_id": project_id or uuid4().hex[:12], "name": name, "owner_sub": owner_sub, "team_id": team_id,
        "brief": {field: (brief or {}).get(field) for field in PROJECT_BRIEF_FIELDS},
        "default_template": default_template or "general", "created_at": now, "updated_at": now, "archived": False,
    }
    actions = [
        {"Put": {"Item": {"PK": f"PROJECT#{project['project_id']}", "SK": "META", **project},
                 "ConditionExpression": "attribute_not_exists(PK)"}},
        {"Put": {"Item": _project_list_item(project), "ConditionExpression": "attribute_not_exists(PK)"}},
    ]
    if limit is not None:
        actions.append({"Update": {
            "Key": {"PK": f"USER#{owner_sub}", "SK": "PROFILE"},
            "UpdateExpression": "SET projects_created = if_not_exists(projects_created, :zero) + :one",
            "ConditionExpression": "attribute_exists(PK) AND (attribute_not_exists(projects_created) OR projects_created < :limit)",
            "ExpressionAttributeValues": {":zero": 0, ":one": 1, ":limit": limit},
        }})
    try:
        _transaction(actions)
    except ClientError as exc:
        if _condition_failed(exc):
            return None
        raise
    return project


def get_project(project_id) -> dict | None:
    return _public(_get(f"PROJECT#{project_id}", "META")) if project_id else None


def update_project(project_id, **fields) -> dict:
    """Changes name, brief, default_template, archived or team_id; a move re-files the list row."""
    project = get_project(project_id)
    if project is None:
        raise KeyError(project_id)
    updated = {**project, **fields, "updated_at": _timestamp()}
    old_row, new_row = _project_list_item(project), _project_list_item(updated)
    actions = [{"Put": {"Item": {"PK": f"PROJECT#{project_id}", "SK": "META", **updated},
                        "ConditionExpression": "attribute_exists(PK)"}},
               {"Put": {"Item": new_row}}]
    if old_row["PK"] != new_row["PK"]:
        actions.append({"Delete": {"Key": {"PK": old_row["PK"], "SK": old_row["SK"]}}})
    _transaction(actions)
    return updated


def fill_project_brief(project_id, brief) -> dict | None:
    """Copies facts from a ready conversation brief into the project brief's empty fields only."""
    project = get_project(project_id)
    if project is None or not isinstance(brief, dict):
        return project
    current = project.get("brief") or {}
    filled = {field: current.get(field) if current.get(field) not in (None, "") else brief.get(field)
              for field in PROJECT_BRIEF_FIELDS}
    return update_project(project_id, brief=filled) if filled != {f: current.get(f) for f in PROJECT_BRIEF_FIELDS} else project


def list_project_rows(owner_key) -> list[dict]:
    """Project list rows under USER#<sub> (personal) or TEAM#<id> (team)."""
    return [_public(item) for item in _query_pk(owner_key, "PROJECT#")]


def project_runs(project_id) -> list[dict]:
    """All runs filed in the project (any author, any status), newest first."""
    return [_public(item) for item in _query_pk(f"PROJECT#{project_id}", "RUN#", ScanIndexForward=False)]


def file_run(run_id, project_id) -> dict:
    """Moves a run into a project (or out with None): META, the author's index row and the project run rows."""
    run = get_run(run_id)
    if run is None:
        raise KeyError(run_id)
    old = run.get("project_id")
    if old == project_id:
        return run
    sk = f"RUN#{run['created_at']}#{run_id}"
    now = _timestamp()
    actions = [
        {"Update": {"Key": {"PK": f"RUN#{run_id}", "SK": "META"}, "UpdateExpression": "SET project_id = :p, updated_at = :now",
                    "ConditionExpression": "attribute_exists(PK)", "ExpressionAttributeValues": {":p": project_id, ":now": now}}},
        {"Update": {"Key": {"PK": f"USER#{run['user_sub']}", "SK": sk}, "UpdateExpression": "SET project_id = :p",
                    "ConditionExpression": "attribute_exists(PK)", "ExpressionAttributeValues": {":p": project_id}}},
    ]
    if old:
        actions.append({"Delete": {"Key": {"PK": f"PROJECT#{old}", "SK": sk}}})
    if project_id:
        actions.append({"Put": {"Item": project_run_item(project_id, run)}})
    _transaction(actions)
    return {**run, "project_id": project_id, "updated_at": now}


def project_cards(project_id, viewer_sub=None, q=None, type=None, direction=None) -> list[dict]:
    """The project's knowledge base: fact cards of its done runs, deduped on dedupe_key, newest first.
    Cards belong to their authors; the viewer's own copy wins a duplicate."""
    done = [row for row in project_runs(project_id) if row.get("status") == "done"]
    run_ids = {row["run_id"] for row in done}
    authors = sorted({row["user_sub"] for row in done}, key=lambda sub: sub != viewer_sub)
    names = _author_names(authors)
    cards = {}
    for author in authors:
        for card in list_cards(author, q=q, type=type, direction=direction):
            if run_ids.intersection(card.get("run_ids") or []):
                cards.setdefault(card["dedupe_key"], {**card, "added_by": names[author], "added_by_sub": author})
    return sorted(cards.values(), key=_capture_time, reverse=True)


# ---------- Mock-up pictures ----------

def reserve_mockup(run_id, limit) -> bool:
    try:
        _table().update_item(
            Key={"PK": f"RUN#{run_id}", "SK": "META"},
            UpdateExpression="SET mockup_count = if_not_exists(mockup_count, :zero) + :one",
            ConditionExpression="attribute_exists(PK) AND (attribute_not_exists(mockup_count) OR mockup_count < :limit)",
            ExpressionAttributeValues={":zero": 0, ":one": 1, ":limit": limit},
        )
    except ClientError as exc:
        if _condition_failed(exc):
            return False
        raise
    return True


def release_mockup(run_id) -> None:
    _table().update_item(
        Key={"PK": f"RUN#{run_id}", "SK": "META"},
        UpdateExpression="SET mockup_count = mockup_count - :one",
        ConditionExpression="mockup_count >= :one",
        ExpressionAttributeValues={":one": 1},
    )


def save_mockup(run_id, image: bytes, content_type, prompt_kind, prompt) -> dict:
    mockup_id = uuid4().hex[:12]
    extension = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}.get(content_type, "img")
    key = f"mockups/{run_id}/{mockup_id}.{extension}"
    _s3().put_object(Bucket=get_settings().data_bucket, Key=key, Body=image, ContentType=content_type)
    mockup = {
        "mockup_id": mockup_id, "run_id": run_id, "prompt_kind": prompt_kind, "prompt": prompt,
        "key": key, "content_type": content_type, "created_at": _timestamp(),
    }
    _table().put_item(Item={"PK": f"RUN#{run_id}", "SK": f"MOCKUP#{mockup_id}", **mockup})
    return mockup


def get_mockup(run_id, mockup_id) -> dict | None:
    return _public(_get(f"RUN#{run_id}", f"MOCKUP#{mockup_id}"))


def list_mockups(run_id) -> list[dict]:
    mockups = [_public(item) for item in _query_pk(f"RUN#{run_id}", "MOCKUP#")]
    return sorted(mockups, key=lambda mockup: mockup["created_at"])


def load_mockup_image(mockup) -> bytes:
    response = _s3().get_object(Bucket=get_settings().data_bucket, Key=mockup["key"])
    return response["Body"].read()


# ---------- eBay Browse API cache, daily cap and evidence snapshots ----------

EBAY_CACHE_SECONDS = 24 * 60 * 60


def get_ebay_cache(key) -> dict | None:
    """A cached search answer younger than 24 hours ({raw, retrieved_at}), else None."""
    item = _public(_get(f"EBAY#{key}", "SEARCH"))
    if not item:
        return None
    retrieved = datetime.fromisoformat(item["retrieved_at"].replace("Z", "+00:00"))
    return item if (_now() - retrieved).total_seconds() < EBAY_CACHE_SECONDS else None


def put_ebay_cache(key, raw, retrieved_at) -> None:
    if len(raw.encode("utf-8")) > 350_000:
        return
    _table().put_item(Item={
        "PK": f"EBAY#{key}", "SK": "SEARCH", "raw": raw, "retrieved_at": retrieved_at,
        "ttl": int((_now() + timedelta(seconds=EBAY_CACHE_SECONDS + 3600)).timestamp()),
    })


def reserve_ebay_call(limit) -> bool:
    """Counts one Browse API call against the site-wide daily cap; False when today's calls are used up."""
    if limit < 1:
        return False
    now = _now()
    try:
        _table().update_item(
            Key={"PK": f"DAY#{now.date().isoformat()}", "SK": "EBAY_CALLS"},
            UpdateExpression="SET #ttl = if_not_exists(#ttl, :ttl) ADD calls :one",
            ConditionExpression="attribute_not_exists(calls) OR calls < :limit",
            ExpressionAttributeNames={"#ttl": "ttl"},
            ExpressionAttributeValues={":ttl": int((now + timedelta(days=2)).timestamp()), ":one": 1, ":limit": limit},
        )
    except ClientError as exc:
        if _condition_failed(exc):
            return False
        raise
    return True


def save_ebay_snapshot(run_id, number, raw, retrieved_at) -> str:
    key = f"runs/{run_id}/ebay/{number}.json"
    _s3().put_object(
        Bucket=get_settings().data_bucket, Key=key, Body=raw.encode("utf-8"),
        ContentType="application/json", Metadata={"retrieved-at": retrieved_at},
    )
    return key
