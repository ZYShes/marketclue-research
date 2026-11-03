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
    request = {
        "KeyConditionExpression": Key("PK").eq(f"USER#{sub}") & Key("SK").begins_with(prefix),
        "ConsistentRead": True,
        **kwargs,
    }
    while True:
        response = _table().query(**request)
        yield from response.get("Items", [])
        if "LastEvaluatedKey" not in response:
            break
        request["ExclusiveStartKey"] = response["LastEvaluatedKey"]


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
            "SET conv_id = :id, messages = :messages, brief = :brief, ready = :ready, "
            "created_at = if_not_exists(created_at, :created), updated_at = :now"
        ),
        ExpressionAttributeValues=_to_dynamo({
            ":id": conv["conv_id"], ":messages": conv["messages"], ":brief": conv.get("brief"),
            ":ready": conv.get("ready", False), ":created": conv.get("created_at", now), ":now": now,
        }),
    )


def count_conversations(sub) -> int:
    return sum(1 for _ in _query(sub, "CONV#", ProjectionExpression="PK"))


def create_run(sub, conv_id, title, brief) -> dict:
    run_id, now = uuid4().hex[:12], _timestamp()
    run = {
        "run_id": run_id, "user_sub": sub, "conv_id": conv_id, "title": title,
        "brief": brief, "status": "queued", "stage": "planning", "agents": {},
        "cost_usd": 0, "error": None, "share_token": None, "created_at": now,
        "updated_at": now, "result_key": None,
    }
    index = {key: run[key] for key in ("run_id", "title", "status", "created_at", "cost_usd")}
    _transaction([
        {"Put": {"Item": {"PK": f"RUN#{run_id}", "SK": "META", **run},
                 "ConditionExpression": "attribute_not_exists(PK)"}},
        {"Put": {"Item": {"PK": f"USER#{sub}", "SK": f"RUN#{now}#{run_id}", **index},
                 "ConditionExpression": "attribute_not_exists(PK)"}},
    ])
    return _public(run)


def get_run(run_id) -> dict | None:
    return _public(_get(f"RUN#{run_id}", "META"))


def update_run(run_id, **fields) -> None:
    immutable = {"PK", "SK", "run_id", "user_sub", "conv_id", "created_at"}
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
    _transaction(actions)


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


def _append_run(sub, card_id, run_id):
    key = {"PK": f"USER#{sub}", "SK": f"CARD#{card_id}"}
    try:
        response = _table().update_item(
            Key=key,
            UpdateExpression="SET run_ids = list_append(run_ids, :run)",
            ConditionExpression="attribute_exists(PK) AND NOT contains(run_ids, :id)",
            ExpressionAttributeValues={":run": [run_id], ":id": run_id},
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


def put_cards(sub, cards: list[dict], run_id) -> list[dict]:
    existing = {item["dedupe_key"]: _public(item) for item in _query(sub, "CARD#")}
    stored = []
    for source in cards:
        dedupe = _dedupe_key(source["url"], source["quote"])
        if dedupe in existing:
            card = _append_run(sub, existing[dedupe]["card_id"], run_id)
        else:
            card = {
                "card_id": uuid4().hex[:12], "claim": source["claim"], "quote": source["quote"],
                "url": source["url"], "source_title": source.get("source_title", ""),
                "captured_at": source.get("captured_at", _timestamp()),
                "type": source.get("type", "unverified"), "direction": source.get("direction", ""),
                "tags": source.get("tags", []), "run_ids": [run_id], "dedupe_key": dedupe,
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
