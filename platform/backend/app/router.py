import base64
import binascii
import json
import logging
import re
from datetime import datetime, timezone
from functools import lru_cache
from urllib.parse import parse_qs
from uuid import uuid4

import boto3

from . import auth, intake, invites, mockups, pipeline, quota, store
from .settings import get_settings


logger = logging.getLogger(__name__)

EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_PENDING_INVITES = 20


class HTTPError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status = status
        self.code = code
        self.message = message
        super().__init__(message)


@lru_cache(maxsize=1)
def _lambda_client():
    return boto3.client("lambda", region_name=get_settings().region)


def _response(data: dict, status: int = 200, cookies: list[str] | None = None) -> dict:
    response = {
        "statusCode": status,
        "headers": {"content-type": "application/json", "cache-control": "no-store"},
        "body": json.dumps(data, allow_nan=False),
        "isBase64Encoded": False,
    }
    if cookies:
        response["cookies"] = cookies
    return response


def _body(event: dict) -> dict:
    raw = event.get("body") or "{}"
    try:
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw, validate=True).decode("utf-8")
        data = json.loads(raw)
    except (ValueError, TypeError, UnicodeError, binascii.Error) as exc:
        raise HTTPError(400, "invalid_json", "A valid JSON object is required") from exc
    if not isinstance(data, dict):
        raise HTTPError(400, "invalid_json", "A valid JSON object is required")
    return data


def _image_response(image: bytes, content_type: str) -> dict:
    return {
        "statusCode": 200,
        "headers": {"content-type": content_type, "cache-control": "private, max-age=86400"},
        "body": base64.b64encode(image).decode("ascii"),
        "isBase64Encoded": True,
    }


def _query(event: dict) -> dict:
    query = event.get("queryStringParameters")
    if query is None:
        query = {key: values[-1] for key, values in parse_qs(event.get("rawQueryString", "")).items()}
    return query


def _limit(query: dict, default: int = 50, maximum: int = 100) -> int:
    raw = query.get("limit")
    if raw in (None, ""):
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise HTTPError(400, "invalid_request", "limit must be a whole number") from exc
    if value < 1:
        raise HTTPError(400, "invalid_request", "limit must be at least 1")
    return min(value, maximum)


def _text(data: dict, key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise HTTPError(400, "invalid_request", f"{key} must be a nonempty string")
    return value.strip()


def _public_user(user: dict) -> dict:
    return {
        "sub": user["sub"],
        "email": user["email"],
        "name": user.get("name", ""),
        "picture": user.get("picture", ""),
        "is_owner": user["email"].lower() in get_settings().owner_emails,
        "free_runs_left": quota.free_runs_left(user),
    }


def _site_owner(user: dict) -> bool:
    return user["email"].lower() in get_settings().owner_emails


def _require_user(event: dict) -> dict:
    session = auth.get_session(event)
    if session:
        user = store.get_user(session["sub"])
        if user and user["email"] == session["email"]:
            return user
    raise HTTPError(401, "auth_required", "Sign in to continue")


def _owned_run(sub: str, run_id: str) -> dict:
    run = store.get_run(run_id)
    if not run or run["user_sub"] != sub:
        raise HTTPError(404, "not_found", "Run not found")
    return run


def _readable_run(user: dict, run_id: str) -> tuple[dict, str]:
    """The run and how the user may read it: "owner", or "team" for a finished run of a teammate."""
    run = store.get_run(run_id)
    if run and run["user_sub"] == user["sub"]:
        return run, "owner"
    if run and run.get("status") == "done" and user.get("team_id"):
        author = store.get_user(run["user_sub"])
        if author and author.get("team_id") == user["team_id"]:
            view = {key: value for key, value in run.items() if key != "conv_id"}
            view["owner_name"] = author.get("name") or author.get("email", "")
            return view, "team"
    raise HTTPError(404, "not_found", "Run not found")


def _conversation(sub: str, conv_id: str) -> dict:
    conv = store.get_conversation(sub, conv_id)
    if conv is None:
        raise HTTPError(404, "not_found", "Conversation not found")
    return conv


def _conversation_view(conv: dict) -> dict:
    return {
        **conv, "feature": conv.get("feature") or "marketing_plan", "title": store.conversation_title(conv),
        "run_id": conv.get("run_id"), "run_status": conv.get("run_status"),
    }


def _chat(user: dict, data: dict) -> dict:
    message = _text(data, "message")
    conv_id = data.get("conv_id")
    is_new = conv_id is None
    if is_new:
        feature = data.get("feature") or "marketing_plan"
        if feature not in intake.FEATURES:
            raise HTTPError(400, "invalid_feature", "Choose one of the four research tools")
        conv = {"conv_id": uuid4().hex[:12], "messages": [], "brief": None, "ready": False, "feature": feature}
    else:
        conv = _conversation(user["sub"], _text(data, "conv_id"))
    quota.check_chat_limits(user["sub"], conv, is_new)
    messages = list(conv.get("messages", []))
    result = intake.chat(conv, message)
    if (
        not isinstance(result, dict)
        or not isinstance(result.get("reply"), str)
        or not isinstance(result.get("ready"), bool)
        or (result.get("brief") is not None and not isinstance(result["brief"], dict))
    ):
        raise HTTPError(502, "intake_failed", "The conversation service returned an invalid reply")
    now = datetime.now(timezone.utc).isoformat()
    messages.extend(
        [{"role": "user", "text": message, "at": now},
         {"role": "assistant", "text": result["reply"], "at": now}]
    )
    conv.update(messages=messages, ready=result["ready"], brief=result.get("brief"))
    store.save_conversation(user["sub"], conv)
    return {
        "conv_id": conv["conv_id"],
        "feature": conv.get("feature") or "marketing_plan",
        "reply": result["reply"],
        "ready": result["ready"],
        "brief": result.get("brief"),
        "messages": messages,
        "run_id": conv.get("run_id"),
        "run_status": conv.get("run_status"),
    }


def _start_run(user: dict, data: dict) -> dict:
    mode = data.get("mode") or "quick"
    if mode not in pipeline.MODES:
        raise HTTPError(400, "invalid_mode", "mode must be quick or smarter")
    conv = _conversation(user["sub"], _text(data, "conv_id"))
    if conv.get("ready") is not True or not isinstance(conv.get("brief"), dict):
        raise HTTPError(400, "conversation_not_ready", "Complete the conversation before starting research")
    if mode == "smarter" and not _site_owner(user):
        raise HTTPError(403, "smarter_owner_only", "Smarter research is only available to the site owner for now")
    function_name = get_settings().self_function_name
    if not function_name:
        raise RuntimeError("SELF_FUNCTION_NAME is required")
    reservation = quota.reserve_run(user)
    run = None
    try:
        title = conv["brief"].get("business") or "Market research"
        run = store.create_run(user["sub"], conv["conv_id"], title, conv["brief"], mode=mode)
        result = _lambda_client().invoke(
            FunctionName=function_name,
            InvocationType="Event",
            Payload=json.dumps({"worker": "run", "run_id": run["run_id"]}).encode("utf-8"),
        )
        if result.get("StatusCode") != 202 or result.get("FunctionError"):
            raise RuntimeError("Worker invocation was not accepted")
    except Exception as exc:
        try:
            if run is not None:
                store.update_run(run["run_id"], status="failed", error="Research could not be scheduled")
        finally:
            quota.release_run(reservation)
        raise HTTPError(502, "run_start_failed", "Research could not be scheduled; please try again") from exc
    return run


def _mockup_view(mockup: dict) -> dict:
    return {
        "mockup_id": mockup["mockup_id"], "prompt_kind": mockup["prompt_kind"], "prompt": mockup["prompt"],
        "created_at": mockup["created_at"], "label": mockups.LABEL,
        "url": f"/api/runs/{mockup['run_id']}/mockups/{mockup['mockup_id']}",
    }


def _create_mockup(user: dict, run_id: str, data: dict) -> dict:
    run = _owned_run(user["sub"], run_id)
    api_key = get_settings().openai_api_key
    if not api_key:
        raise HTTPError(503, "mockups_disabled", "Mock-up pictures are not set up")
    if not _site_owner(user):
        raise HTTPError(403, "mockups_owner_only", "Mock-up pictures are only available to the site owner for now")
    kind = data.get("prompt_kind")
    if kind not in mockups.KINDS:
        raise HTTPError(400, "invalid_prompt_kind", "prompt_kind must be product, listing or ad")
    if run.get("status") != "done":
        raise HTTPError(409, "run_not_done", "Mock-ups can be made once the report is finished")
    prompt = mockups.build_prompt(kind, run, store.load_result(run_id))
    if not store.reserve_mockup(run_id, mockups.MAX_PER_RUN):
        raise HTTPError(429, "mockup_limit", f"A report can have at most {mockups.MAX_PER_RUN} mock-ups")
    try:
        image, content_type = mockups.generate(api_key, prompt)
        mockup = store.save_mockup(run_id, image, content_type, kind, prompt)
    except Exception as exc:
        store.release_mockup(run_id)
        logger.error("Mock-up failed: %s", type(exc).__name__)
        raise HTTPError(502, "mockup_failed", "The picture could not be made; please try again") from exc
    return _mockup_view(mockup)


def _list_mockups(user: dict, run_id: str) -> dict:
    run, access = _readable_run(user, run_id)
    items = [_mockup_view(mockup) for mockup in store.list_mockups(run["run_id"])]
    enabled = access == "owner" and _site_owner(user) and bool(get_settings().openai_api_key)
    return {
        "mockups": items, "enabled": enabled, "limit": mockups.MAX_PER_RUN,
        "remaining": max(0, mockups.MAX_PER_RUN - len(items)),
    }


def _mockup_image(user: dict, run_id: str, mockup_id: str) -> dict:
    run, _ = _readable_run(user, run_id)
    mockup = store.get_mockup(run["run_id"], mockup_id)
    if mockup is None:
        raise HTTPError(404, "not_found", "Mock-up not found")
    return _image_response(store.load_mockup_image(mockup), mockup["content_type"])


def _invite_url(token: str) -> str:
    return f"{get_settings().site_origin}/#/join/{token}"


def _invite_view(invite: dict) -> dict:
    return {
        "token": invite["token"], "email": invite["email"], "status": invite["status"],
        "created_at": invite["created_at"], "expires_at": invite["expires_at"], "invite_url": _invite_url(invite["token"]),
    }


def _team_state(user: dict) -> dict:
    team = store.get_team(user["team_id"]) if user.get("team_id") else None
    if team is None:
        return {"team": None, "role": None, "members": [], "invites": []}
    members = store.list_members(team["team_id"])
    role = next((member["role"] for member in members if member["sub"] == user["sub"]), None)
    invites = []
    if role == "owner":
        invites = [
            _invite_view(invite) for invite in store.list_invites(team["team_id"])
            if invite["status"] == "pending" and not store.invite_expired(invite)
        ]
    return {"team": team, "role": role, "members": members, "invites": invites}


def _team_member(user: dict, owner: bool = False) -> dict:
    member = store.get_member(user["team_id"], user["sub"]) if user.get("team_id") else None
    if member is None:
        raise HTTPError(404, "no_team", "You are not in a team")
    if owner and member["role"] != "owner":
        raise HTTPError(403, "team_owner_only", "Only the team owner can do this")
    return member


def _team_members_first(user: dict) -> list[dict]:
    if not user.get("team_id"):
        return []
    members = store.list_members(user["team_id"])
    return sorted(members, key=lambda member: member["sub"] != user["sub"])


def _create_team(user: dict, data: dict) -> dict:
    name = " ".join(_text(data, "name").split())[:80]
    if store.create_team(user, name) is None:
        raise HTTPError(403, "already_in_team", "You are already in a team")
    return _team_state(store.get_user(user["sub"]))


def _invite(user: dict, data: dict) -> dict:
    member = _team_member(user, owner=True)
    email = _text(data, "email")
    if len(email) > 254 or not EMAIL.match(email):
        raise HTTPError(400, "invalid_email", "Enter a valid email address")
    team_id = user["team_id"]
    if any(item["email"].casefold() == email.casefold() for item in store.list_members(team_id)):
        raise HTTPError(409, "already_member", "This person is already in the team")
    pending = [
        invite for invite in store.list_invites(team_id)
        if invite["status"] == "pending" and not store.invite_expired(invite)
    ]
    invite = next((item for item in pending if item["email"].casefold() == email.casefold()), None)
    if invite is None:
        if len(pending) >= MAX_PENDING_INVITES:
            raise HTTPError(429, "invite_limit", f"A team can have at most {MAX_PENDING_INVITES} open invites")
        invite = store.create_invite(team_id, email, user["sub"])
    team = store.get_team(team_id)
    url = _invite_url(invite["token"])
    emailed = invites.send_invite(invite["email"], team["name"], member.get("name") or user["email"], url)
    return {
        "token": invite["token"], "invite_url": url, "emailed": emailed,
        "email": invite["email"], "expires_at": invite["expires_at"],
    }


def _revoke_invite(user: dict, token: str) -> dict:
    _team_member(user, owner=True)
    invite = store.get_invite(token)
    if invite is None or invite["team_id"] != user["team_id"]:
        raise HTTPError(404, "not_found", "Invite not found")
    if not store.revoke_invite(user["team_id"], token):
        raise HTTPError(409, "invite_unavailable", "This invite was already used or revoked")
    return {"ok": True}


def _join_team(user: dict, data: dict) -> dict:
    invite = store.get_invite(_text(data, "token"))
    if invite is None:
        raise HTTPError(404, "invite_not_found", "This invite link is not valid")
    if user.get("team_id") == invite["team_id"] and store.get_member(invite["team_id"], user["sub"]):
        return _team_state(user)
    if invite["status"] != "pending":
        raise HTTPError(410, "invite_unavailable", "This invite was already used or revoked")
    if store.invite_expired(invite):
        raise HTTPError(410, "invite_expired", "This invite has expired; ask the team owner for a new one")
    if invite["email"].strip().casefold() != user["email"].strip().casefold():
        raise HTTPError(403, "invite_email_mismatch", "This invite was sent to a different Google account")
    if user.get("team_id"):
        raise HTTPError(403, "already_in_team", "You are already in a team")
    if not store.join_team(user, invite):
        raise HTTPError(409, "invite_unavailable", "This invite could not be used; please try again")
    return _team_state(store.get_user(user["sub"]))


def _remove_member(user: dict, sub: str) -> dict:
    _team_member(user, owner=True)
    if sub == user["sub"]:
        raise HTTPError(400, "cannot_remove_owner", "The team owner cannot remove themself")
    if store.get_member(user["team_id"], sub) is None or not store.remove_member(user["team_id"], sub):
        raise HTTPError(404, "not_found", "Member not found")
    return {"ok": True}


def _leave_team(user: dict) -> dict:
    member = _team_member(user)
    if member["role"] == "owner":
        raise HTTPError(403, "owner_cannot_leave", "The team owner cannot leave the team")
    if not store.remove_member(user["team_id"], user["sub"]):
        raise HTTPError(409, "leave_failed", "Leaving the team failed; please try again")
    return {"ok": True}


def _dispatch(event: dict) -> dict:
    method = event.get("requestContext", {}).get("http", {}).get("method", "").upper()
    path = (event.get("rawPath") or "").rstrip("/")
    parts = path.strip("/").split("/")
    if method == "GET" and path == "/api/health":
        return _response({"ok": True})
    if method == "POST" and path == "/api/auth/google":
        claims = auth.verify_google_token(_text(_body(event), "credential"))
        user = store.upsert_user(
            claims["sub"], claims["email"], claims.get("name", ""), claims.get("picture", "")
        )
        return _response({"user": _public_user(user)}, cookies=[auth.session_cookie(user)])
    if method == "GET" and len(parts) == 3 and parts[:2] == ["api", "shared"]:
        run = store.resolve_share(parts[2])
        if run is None:
            raise HTTPError(404, "not_found", "Shared report not found")
        public_run = {key: value for key, value in run.items() if key != "user_sub"}
        return _response({"run": public_run, "result": store.load_result(run["run_id"])})

    user = _require_user(event)
    sub = user["sub"]
    if method == "GET" and path == "/api/me":
        return _response({"user": _public_user(user)})
    if method == "POST" and path == "/api/auth/logout":
        return _response({"ok": True}, cookies=[auth.clear_session_cookie()])
    if method == "POST" and path == "/api/chat":
        return _response(_chat(user, _body(event)))
    if method == "GET" and path == "/api/conversations":
        return _response({"conversations": store.list_conversations(sub, _limit(_query(event)))})
    if method == "GET" and len(parts) == 3 and parts[:2] == ["api", "conversations"]:
        return _response(_conversation_view(_conversation(sub, parts[2])))
    if path == "/api/runs":
        if method == "POST":
            return _response({"run": _start_run(user, _body(event))}, 201)
        if method == "GET":
            return _response({"runs": store.list_runs(sub)})
    if len(parts) in {3, 4, 5} and parts[:2] == ["api", "runs"]:
        if method == "GET" and len(parts) == 3:
            run, access = _readable_run(user, parts[2])
            return _response({"run": run, "result": store.load_result(run["run_id"]), "access": access})
        if method == "POST" and len(parts) == 4 and parts[3] == "share":
            run = _owned_run(sub, parts[2])
            token = store.create_share(run["run_id"])
            url = f"{get_settings().site_origin}/#/shared/{token}"
            return _response({"token": token, "url": url})
        if method == "POST" and len(parts) == 4 and parts[3] == "mockup":
            return _response(_create_mockup(user, parts[2], _body(event)), 201)
        if method == "GET" and len(parts) == 4 and parts[3] == "mockups":
            return _response(_list_mockups(user, parts[2]))
        if method == "GET" and len(parts) == 5 and parts[3] == "mockups":
            return _mockup_image(user, parts[2], parts[4])
    if method == "GET" and path == "/api/cards":
        query = _query(event)
        cards = store.list_cards(
            sub, q=query.get("q"), type=query.get("type"), direction=query.get("direction")
        )
        return _response({"cards": cards})
    if path == "/api/team":
        if method == "GET":
            return _response(_team_state(user))
        if method == "POST":
            return _response(_create_team(user, _body(event)), 201)
    if method == "POST" and path == "/api/team/invites":
        return _response(_invite(user, _body(event)), 201)
    if method == "DELETE" and len(parts) == 4 and parts[:3] == ["api", "team", "invites"]:
        return _response(_revoke_invite(user, parts[3]))
    if method == "POST" and path == "/api/team/join":
        return _response(_join_team(user, _body(event)))
    if method == "DELETE" and len(parts) == 4 and parts[:3] == ["api", "team", "members"]:
        return _response(_remove_member(user, parts[3]))
    if method == "POST" and path == "/api/team/leave":
        return _response(_leave_team(user))
    if method == "GET" and path == "/api/team/runs":
        runs = store.list_team_runs(_team_members_first(user), _limit(_query(event)))
        return _response({"runs": runs})
    if method == "GET" and path == "/api/team/cards":
        query = _query(event)
        cards = store.list_team_cards(
            _team_members_first(user), q=query.get("q"), type=query.get("type"), direction=query.get("direction")
        )
        return _response({"cards": cards})
    raise HTTPError(404, "not_found", "Route not found")


def route(event: dict) -> dict:
    try:
        return _dispatch(event)
    except auth.AuthError:
        return _response({"error": {"code": "invalid_credential", "message": "Invalid Google credential"}}, 401)
    except (HTTPError, quota.QuotaError) as exc:
        return _response({"error": {"code": exc.code, "message": exc.message}}, exc.status)
    except Exception as exc:
        logger.error("HTTP request failed: %s", type(exc).__name__)
        return _response({"error": {"code": "internal_error", "message": "The request could not be completed"}}, 500)
