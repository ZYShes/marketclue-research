import base64
import binascii
import json
import logging
from datetime import datetime, timezone
from functools import lru_cache
from urllib.parse import parse_qs
from uuid import uuid4

import boto3

from . import auth, intake, quota, store
from .settings import get_settings


logger = logging.getLogger(__name__)


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


def _conversation(sub: str, conv_id: str) -> dict:
    conv = store.get_conversation(sub, conv_id)
    if conv is None:
        raise HTTPError(404, "not_found", "Conversation not found")
    return conv


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
    }


def _start_run(user: dict, data: dict) -> dict:
    conv = _conversation(user["sub"], _text(data, "conv_id"))
    if conv.get("ready") is not True or not isinstance(conv.get("brief"), dict):
        raise HTTPError(400, "conversation_not_ready", "Complete the conversation before starting research")
    function_name = get_settings().self_function_name
    if not function_name:
        raise RuntimeError("SELF_FUNCTION_NAME is required")
    reservation = quota.reserve_run(user)
    run = None
    try:
        title = conv["brief"].get("business") or "Market research"
        run = store.create_run(user["sub"], conv["conv_id"], title, conv["brief"])
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
    if method == "GET" and len(parts) == 3 and parts[:2] == ["api", "conversations"]:
        return _response(_conversation(sub, parts[2]))
    if path == "/api/runs":
        if method == "POST":
            return _response({"run": _start_run(user, _body(event))}, 201)
        if method == "GET":
            return _response({"runs": store.list_runs(sub)})
    if len(parts) in {3, 4} and parts[:2] == ["api", "runs"]:
        if method == "GET" and len(parts) == 3:
            run = _owned_run(sub, parts[2])
            return _response({"run": run, "result": store.load_result(run["run_id"])})
        if method == "POST" and len(parts) == 4 and parts[3] == "share":
            run = _owned_run(sub, parts[2])
            token = store.create_share(run["run_id"])
            url = f"{get_settings().site_origin}/#/shared/{token}"
            return _response({"token": token, "url": url})
    if method == "GET" and path == "/api/cards":
        query = event.get("queryStringParameters")
        if query is None:
            query = {
                key: values[-1]
                for key, values in parse_qs(event.get("rawQueryString", "")).items()
            }
        cards = store.list_cards(
            sub, q=query.get("q"), type=query.get("type"), direction=query.get("direction")
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
