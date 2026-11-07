import base64
import binascii
import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from functools import lru_cache
from urllib.parse import parse_qs
from uuid import uuid4

import boto3

from . import auth, intake, invites, mockups, pipeline, projects, quota, store, templates
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
    """The run and how the user may read it: "owner", or "project" for a done run in a project they can see."""
    run = store.get_run(run_id)
    if run and run["user_sub"] == user["sub"]:
        return run, "owner"
    if run and run.get("status") == "done" and run.get("project_id"):
        if projects.role(user["sub"], store.get_project(run["project_id"]), _teams(user)):
            author = store.get_user(run["user_sub"]) or {}
            view = {key: value for key, value in run.items() if key not in {"conv_id", "share_token"}}
            view["owner_name"] = author.get("name") or author.get("email", "")
            return view, "project"
    raise HTTPError(404, "not_found", "Run not found")


def _usable_project(user: dict, project_id: str | None) -> dict | None:
    """The project a conversation is filed in, if the user can still see it (else research runs unfiled)."""
    project = store.get_project(project_id)
    return project if projects.role(user["sub"], project, _teams(user)) else None


def _project_ref(project_id: str | None) -> dict | None:
    project = store.get_project(project_id)
    return {"project_id": project["project_id"], "name": project["name"], "team_id": project.get("team_id")} if project else None


def _conversation(sub: str, conv_id: str) -> dict:
    conv = store.get_conversation(sub, conv_id)
    if conv is None:
        raise HTTPError(404, "not_found", "Conversation not found")
    return conv


def _conversation_view(conv: dict) -> dict:
    return {
        **conv, "feature": conv.get("feature") or "marketing_plan", "title": store.conversation_title(conv),
        "run_id": conv.get("run_id"), "run_status": conv.get("run_status"),
        "template": conv.get("template") or templates.DEFAULT, "project_id": conv.get("project_id"),
    }


def _chat(user: dict, data: dict) -> dict:
    message = _text(data, "message")
    conv_id = data.get("conv_id")
    is_new = conv_id is None
    if is_new:
        feature = data.get("feature") or "marketing_plan"
        if not isinstance(feature, str) or feature not in intake.FEATURES:
            raise HTTPError(400, "invalid_feature", "Choose one of the four research tools")
        project = _visible_project(user, data["project_id"])[0] if data.get("project_id") is not None else None
        template = data.get("template") or (project or {}).get("default_template") or templates.DEFAULT
        conv = {"conv_id": uuid4().hex[:12], "messages": [], "brief": None, "ready": False, "feature": feature,
                "template": _usable_template(template, feature)["id"], "project_id": (project or {}).get("project_id")}
    else:
        conv = _conversation(user["sub"], _text(data, "conv_id"))
    template_id = conv.get("template") or templates.DEFAULT
    quota.check_chat_limits(user["sub"], conv, is_new)
    messages = list(conv.get("messages", []))
    project = _usable_project(user, conv.get("project_id"))
    result = intake.chat({**conv, "project_context": projects.intake_context(project)} if project else conv, message)
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
    brief = result.get("brief")
    if brief is not None and template_id != templates.DEFAULT:
        brief = {**brief, "template": template_id}
    if brief is not None and result["ready"] and project:
        store.fill_project_brief(project["project_id"], brief)
    conv.update(messages=messages, ready=result["ready"], brief=brief)
    store.save_conversation(user["sub"], conv)
    return {
        "conv_id": conv["conv_id"],
        "feature": conv.get("feature") or "marketing_plan",
        "template": template_id,
        "project_id": conv.get("project_id"),
        "reply": result["reply"],
        "ready": result["ready"],
        "brief": brief,
        "messages": messages,
        "run_id": conv.get("run_id"),
        "run_status": conv.get("run_status"),
    }


def _usable_template(template_id, feature=None) -> dict:
    template = templates.get(template_id)
    if template is None or (feature and feature not in template["tools"]):
        raise HTTPError(400, "invalid_template", "Choose General or one of the listed templates for this tool")
    available, reason = templates.availability(template)
    if not available:
        raise HTTPError(409, "template_unavailable", reason or "This template is not available right now")
    return template


def _start_run(user: dict, data: dict) -> dict:
    mode = data.get("mode") or "quick"
    if not isinstance(mode, str) or mode not in pipeline.MODES:
        raise HTTPError(400, "invalid_mode", "mode must be quick, balanced or smarter")
    conv = _conversation(user["sub"], _text(data, "conv_id"))
    if conv.get("ready") is not True or not isinstance(conv.get("brief"), dict):
        raise HTTPError(400, "conversation_not_ready", "Complete the conversation before starting research")
    template_id = conv.get("template") or conv["brief"].get("template") or templates.DEFAULT
    _usable_template(template_id)
    brief = conv["brief"] if template_id == templates.DEFAULT else {**conv["brief"], "template": template_id}
    function_name = get_settings().self_function_name
    if not function_name:
        raise RuntimeError("SELF_FUNCTION_NAME is required")
    reservation = quota.reserve_run(user, smarter=mode == "smarter")
    run = None
    try:
        title = brief.get("business") or "Market research"
        project = _usable_project(user, conv.get("project_id"))
        run = store.create_run(user["sub"], conv["conv_id"], title, brief, mode=mode,
                               project_id=project["project_id"] if project else None)
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
    if not isinstance(kind, str) or kind not in mockups.KINDS:
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


def _teams(user: dict) -> dict:
    """{team_id: role} for the signed-in user, read once per request."""
    if "_teams" not in user:
        user["_teams"] = projects.memberships(user["sub"])
    return user["_teams"]


def _first_team_id(user: dict) -> str | None:
    return next(iter(_teams(user)), None)


def _team_projects(user: dict, team_id: str) -> list[dict]:
    team = store.get_team(team_id)
    rows = [row for row in store.list_project_rows(f"TEAM#{team_id}") if not row.get("archived")]
    return [projects.summary(row, projects.role(user["sub"], row, _teams(user)), {team_id: team}, user["sub"]) for row in rows]


def _team_state(user: dict, team_id: str | None) -> dict:
    team = store.get_team(team_id) if team_id else None
    if team is None or team_id not in _teams(user):
        return {"team": None, "role": None, "members": [], "invites": [], "projects": []}
    members = store.list_members(team_id)
    role = next((member["role"] for member in members if member["sub"] == user["sub"]), None)
    invites = []
    if role == "owner":
        invites = [
            _invite_view(invite) for invite in store.list_invites(team_id)
            if invite["status"] == "pending" and not store.invite_expired(invite)
        ]
    return {"team": team, "role": role, "members": members, "invites": invites, "projects": _team_projects(user, team_id),
            "leaving": _leaving(user, team_id, role)}


def _team_member(user: dict, team_id: str | None, owner: bool = False) -> dict:
    member = store.get_member(team_id, user["sub"]) if team_id else None
    if member is None:
        raise HTTPError(404, "no_team", "You are not in this team")
    if owner and member["role"] != "owner":
        raise HTTPError(403, "team_owner_only", "Only the team owner can do this")
    return member


def _list_teams(user: dict) -> list[dict]:
    teams = []
    for team_id, role in _teams(user).items():
        team = store.get_team(team_id)
        if team:
            joined = next(row["joined_at"] for row in store.list_memberships(user["sub"]) if row["team_id"] == team_id)
            teams.append({"team_id": team_id, "name": team["name"], "role": role, "owner_sub": team["owner_sub"],
                          "joined_at": joined, "member_count": len(store.list_members(team_id))})
    return teams


def _check_team_limit(user: dict) -> None:
    if len(_teams(user)) >= projects.MAX_TEAMS:
        raise HTTPError(429, "team_limit", f"You can be in at most {projects.MAX_TEAMS} teams")


def _create_team(user: dict, data: dict) -> dict:
    name = " ".join(_text(data, "name").split())[:80]
    _check_team_limit(user)
    team = store.create_team(user, name)
    user.pop("_teams", None)
    return _team_state(user, team["team_id"])


def _invite(user: dict, team_id: str | None, data: dict) -> dict:
    member = _team_member(user, team_id, owner=True)
    email = _text(data, "email")
    if len(email) > 254 or not EMAIL.match(email):
        raise HTTPError(400, "invalid_email", "Enter a valid email address")
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


def _email_hint(email: str) -> str:
    local, _, domain = email.partition("@")
    return f"{local[:1]}\u2022\u2022\u2022@{domain}" if domain else "\u2022\u2022\u2022"


def _invite_preview(token: str) -> dict:
    """Public (no sign-in) summary of an invite, so a new user knows who invited them before signing in."""
    invite = store.get_invite(token)
    if invite is None:
        raise HTTPError(404, "invite_not_found", "This invite link is not valid")
    team = store.get_team(invite["team_id"]) or {}
    inviter = store.get_user(invite.get("invited_by") or "") or {}
    status = invite["status"]
    if status == "pending" and store.invite_expired(invite):
        status = "expired"
    return {
        "team_name": team.get("name") or "a MarketClue team",
        "inviter_name": inviter.get("name") or "A MarketClue user",
        "email_hint": _email_hint(invite["email"]),
        "status": status,
        "expires_at": invite["expires_at"],
    }


EBAY_DELETION_PATH = "/api/ebay/account-deletion"


def _ebay_challenge(event: dict) -> dict:
    """eBay Marketplace Account Deletion endpoint check: SHA-256 hex of challengeCode + token + endpoint URL."""
    code = str(_query(event).get("challenge_code") or "")
    token = get_settings().ebay_verification_token
    if not code or not token:
        raise HTTPError(400 if token else 503, "ebay_challenge_unavailable", "Challenge code or verification token is missing")
    endpoint = f"{get_settings().site_origin}{EBAY_DELETION_PATH}"
    return {"challengeResponse": hashlib.sha256((code + token + endpoint).encode("utf-8")).hexdigest()}


def _ebay_deletion_notice(event: dict) -> dict:
    """Acknowledges an account deletion notice. We keep no eBay user data (seller ids are stripped before
    anything is stored), so there is nothing to delete; the notice id is logged for the record."""
    try:
        notice = json.loads(event.get("body") or "{}")
    except (TypeError, ValueError):
        notice = {}
    if not isinstance(notice, dict):
        notice = {}
    print(json.dumps({"ebay_account_deletion": ((notice.get("notification") or {}).get("notificationId")),
                      "topic": (notice.get("metadata") or {}).get("topic")}))
    return {"statusCode": 204, "headers": {"cache-control": "no-store"}, "body": "", "isBase64Encoded": False}


def _revoke_invite(user: dict, team_id: str | None, token: str) -> dict:
    _team_member(user, team_id, owner=True)
    invite = store.get_invite(token)
    if invite is None or invite["team_id"] != team_id:
        raise HTTPError(404, "not_found", "Invite not found")
    if not store.revoke_invite(team_id, token):
        raise HTTPError(409, "invite_unavailable", "This invite was already used or revoked")
    return {"ok": True}


def _join_team(user: dict, data: dict) -> dict:
    invite = store.get_invite(_text(data, "token"))
    if invite is None:
        raise HTTPError(404, "invite_not_found", "This invite link is not valid")
    if invite["team_id"] in _teams(user):
        return _team_state(user, invite["team_id"])
    if invite["status"] != "pending":
        raise HTTPError(410, "invite_unavailable", "This invite was already used or revoked")
    if store.invite_expired(invite):
        raise HTTPError(410, "invite_expired", "This invite has expired; ask the team owner for a new one")
    if invite["email"].strip().casefold() != user["email"].strip().casefold():
        raise HTTPError(403, "invite_email_mismatch", "This invite was sent to a different Google account")
    _check_team_limit(user)
    if not store.join_team(user, invite):
        raise HTTPError(409, "invite_unavailable", "This invite could not be used; please try again")
    user.pop("_teams", None)
    return _team_state(user, invite["team_id"])


def _remove_member(user: dict, team_id: str | None, sub: str) -> dict:
    """The team owner removes a member; that member's projects in the team pass to the team owner, and any
    that would take the team owner over the live-project limit are archived on the way."""
    _team_member(user, team_id, owner=True)
    if sub == user["sub"]:
        raise HTTPError(400, "cannot_remove_owner", "The team owner cannot remove themself")
    if store.get_member(team_id, sub) is None:
        raise HTTPError(404, "not_found", "Member not found")
    moving = sorted(projects.owned_in_team(sub, team_id), key=lambda row: row.get("updated_at") or "", reverse=True)
    room = projects.MAX_LIVE_PROJECTS - projects.live_owned(user["sub"], _teams(user))
    for row in moving:
        archive = not row.get("archived") and room <= 0
        room -= 0 if row.get("archived") or archive else 1
        store.update_project(row["project_id"], owner_sub=user["sub"], **({"archived": True} if archive else {}))
    if not store.remove_member(team_id, sub):
        raise HTTPError(404, "not_found", "Member not found")
    return {"ok": True}


def _leaving(user: dict, team_id: str, role: str | None) -> dict:
    mine = projects.owned_in_team(user["sub"], team_id)
    return {"needs_new_owner": role == "owner" or bool(mine),
            "projects": [{"project_id": row["project_id"], "name": row["name"], "archived": bool(row.get("archived"))}
                         for row in mine]}


def _leave_team(user: dict, team_id: str | None, data: dict) -> dict:
    """Leaves a team. The team owner, or a member who owns projects in it, names who takes over."""
    member = _team_member(user, team_id)
    members = store.list_members(team_id)
    if member["role"] == "owner" and len(members) == 1:
        raise HTTPError(403, "owner_cannot_leave", "You are the only member; invite someone to take over first")
    leaving = _leaving(user, team_id, member["role"])
    if leaving["needs_new_owner"]:
        new_owner = data.get("new_owner_sub")
        if new_owner is None:
            raise HTTPError(400, "new_owner_required", "Choose the member who takes over before you leave")
        heir = next((item for item in members if item["sub"] == new_owner and new_owner != user["sub"]), None)
        if heir is None:
            raise HTTPError(400, "invalid_new_owner", "Choose another member of this team")
        live = sum(1 for project in leaving["projects"] if not project["archived"])
        if live:
            _check_live_limit(new_owner, live, name=heir.get("name") or heir["email"])
        for project in leaving["projects"]:
            store.update_project(project["project_id"], owner_sub=new_owner)
        if member["role"] == "owner":
            if not store.hand_over_team(team_id, user["sub"], new_owner):
                raise HTTPError(409, "leave_failed", "Leaving the team failed; please try again")
            return {"ok": True}
    if not store.remove_member(team_id, user["sub"]):
        raise HTTPError(409, "leave_failed", "Leaving the team failed; please try again")
    return {"ok": True}


def _check_live_limit(owner_sub: str, adding: int, teams: dict | None = None, name: str | None = None) -> None:
    """429 project_limit when the owner would have more than 10 live (not archived) projects."""
    if projects.live_owned(owner_sub, teams) + adding > projects.MAX_LIVE_PROJECTS:
        who = f"{name} already has" if name else "You already have"
        raise HTTPError(429, "project_limit", f"{who} {projects.MAX_LIVE_PROJECTS} live projects. Archive one first.")


def _visible_project(user: dict, project_id) -> tuple[dict, str]:
    project = store.get_project(project_id) if isinstance(project_id, str) and project_id else None
    role = projects.role(user["sub"], project, _teams(user))
    if role is None:
        raise HTTPError(404, "project_not_found", "Project not found")
    return project, role


def _project_name(data: dict) -> str:
    name = " ".join(_text(data, "name").split())
    if len(name) > 80:
        raise HTTPError(400, "invalid_request", "name must be at most 80 characters")
    return name


def _project_brief(value, current=None) -> dict:
    if not isinstance(value, dict):
        raise HTTPError(400, "invalid_request", "brief must be an object")
    brief = dict(current or {field: None for field in store.PROJECT_BRIEF_FIELDS})
    for field, item in value.items():
        if field not in store.PROJECT_BRIEF_FIELDS:
            raise HTTPError(400, "invalid_request", f"Unknown brief field {field}")
        if field == "budget_usd":
            if item is not None and (isinstance(item, bool) or not isinstance(item, (int, float)) or item < 0 or item != item):
                raise HTTPError(400, "invalid_request", "budget_usd must be a positive number or null")
        elif item is not None and (not isinstance(item, str) or len(item) > 300):
            raise HTTPError(400, "invalid_request", f"{field} must be text up to 300 characters or null")
        brief[field] = " ".join(item.split()) or None if isinstance(item, str) else item
    return brief


def _project_team(user: dict, data: dict) -> str | None:
    team_id = data.get("team_id")
    if team_id is None:
        return None
    if not isinstance(team_id, str) or team_id not in _teams(user):
        raise HTTPError(404, "no_team", "You are not in this team")
    return team_id


def _default_template(data: dict, current: str = "general") -> str:
    value = data.get("default_template", current)
    if templates.get(value) is None:
        raise HTTPError(400, "invalid_template", "Choose General or one of the listed templates")
    return value


def _list_projects(user: dict, archived: bool) -> list[dict]:
    teams = _teams(user)
    rows = [row for row in store.list_project_rows(f"USER#{user['sub']}") if not row.get("team_id")]
    for team_id in teams:
        rows += store.list_project_rows(f"TEAM#{team_id}")
    teams_by_id = {team_id: store.get_team(team_id) for team_id in teams}
    listed = []
    for row in rows:
        role = projects.role(user["sub"], row, teams)
        if role and (archived or not row.get("archived")):
            listed.append(projects.summary(row, role, teams_by_id, user["sub"]))
    return sorted(listed, key=lambda item: item["last_run_at"] or item["updated_at"] or "", reverse=True)


def _project_detail(user: dict, project: dict, role: str) -> dict:
    team = store.get_team(project["team_id"]) if project.get("team_id") else None
    return projects.detail(project, role, user["sub"], team)


def _create_project(user: dict, data: dict) -> dict:
    name = _project_name(data)
    team_id = _project_team(user, data)
    brief = _project_brief(data.get("brief") or {})
    default_template = _default_template(data)
    _check_live_limit(user["sub"], 1, _teams(user))
    project = store.create_project(user["sub"], name, team_id, brief, default_template)
    return _project_detail(user, project, projects.role(user["sub"], project, _teams(user)))


def _update_project(user: dict, project_id: str, data: dict) -> dict:
    project, role = _visible_project(user, project_id)
    if not projects.can_manage(role):
        raise HTTPError(403, "project_owner_only", "Only the project owner or the team owner can change this project")
    fields = {}
    if "name" in data:
        fields["name"] = _project_name(data)
    if "brief" in data:
        fields["brief"] = _project_brief(data["brief"], project.get("brief"))
    if "default_template" in data:
        fields["default_template"] = _default_template(data)
    if "archived" in data:
        if not isinstance(data["archived"], bool):
            raise HTTPError(400, "invalid_request", "archived must be true or false")
        if project.get("archived") and data["archived"] is False:
            _check_live_limit(project["owner_sub"], 1)
        fields["archived"] = data["archived"]
    if "team_id" in data:
        fields["team_id"] = _project_team(user, data)
    project = store.update_project(project_id, **fields) if fields else project
    role = projects.role(user["sub"], project, _teams(user))
    if role is None:
        return {"project": {"project_id": project_id, "moved": True}, "stages": {}, "runs": [], "conversations": []}
    return _project_detail(user, project, role)


def _file_conversation(user: dict, conv_id: str, data: dict) -> dict:
    conv = _conversation(user["sub"], conv_id)
    if "project_id" not in data:
        raise HTTPError(400, "invalid_request", "project_id is required (null to remove)")
    conv["project_id"] = _visible_project(user, data["project_id"])[0]["project_id"] if data["project_id"] is not None else None
    store.save_conversation(user["sub"], conv)
    return _conversation_view(store.get_conversation(user["sub"], conv_id))


def _delete_conversation(user: dict, conv_id: str) -> dict:
    """DELETE /api/conversations/{id}: removes the owner's chat. A report it started stays readable."""
    conv = _conversation(user["sub"], conv_id)
    if conv.get("run_id") and conv.get("run_status") in ("queued", "running"):
        raise HTTPError(409, "run_in_progress",
                        "This research is still running. You can delete the conversation when the report is ready.")
    store.delete_conversation(user["sub"], conv_id)
    return {"deleted": True, "conv_id": conv_id}


def _file_run(user: dict, run_id: str, data: dict) -> dict:
    run = _owned_run(user["sub"], run_id)
    if "project_id" not in data:
        raise HTTPError(400, "invalid_request", "project_id is required (null to remove)")
    project_id = _visible_project(user, data["project_id"])[0]["project_id"] if data["project_id"] is not None else None
    return {"run": store.file_run(run["run_id"], project_id)}


def _team_route(user: dict, method: str, team_id: str | None, rest: list[str], event: dict) -> dict | None:
    """Routes under /api/teams/{id}/... and the legacy /api/team/... (the user's first team)."""
    if method == "GET" and rest == []:
        _team_member(user, team_id)
        return _response(_team_state(user, team_id))
    if method == "POST" and rest == ["invites"]:
        return _response(_invite(user, team_id, _body(event)), 201)
    if method == "DELETE" and len(rest) == 2 and rest[0] == "invites":
        return _response(_revoke_invite(user, team_id, rest[1]))
    if method == "DELETE" and len(rest) == 2 and rest[0] == "members":
        return _response(_remove_member(user, team_id, rest[1]))
    if method == "POST" and rest == ["leave"]:
        return _response(_leave_team(user, team_id, _body(event)))
    if method == "GET" and rest == ["runs"]:
        _team_member(user, team_id)
        return _response({"runs": store.list_team_runs(team_id, _limit(_query(event)))})
    if method == "GET" and rest == ["cards"]:
        _team_member(user, team_id)
        query = _query(event)
        return _response({"cards": store.list_team_cards(team_id, user["sub"], q=query.get("q"), type=query.get("type"),
                                                         direction=query.get("direction"))})
    return None


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
    if path == EBAY_DELETION_PATH and method == "GET":
        return _response(_ebay_challenge(event))
    if path == EBAY_DELETION_PATH and method == "POST":
        return _ebay_deletion_notice(event)
    if method == "GET" and len(parts) == 3 and parts[:2] == ["api", "invites"]:
        return _response(_invite_preview(parts[2]))
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
    if method == "GET" and path == "/api/templates":
        return _response(templates.listing())
    if method == "GET" and path == "/api/conversations":
        return _response({"conversations": store.list_conversations(sub, _limit(_query(event)))})
    if len(parts) == 3 and parts[:2] == ["api", "conversations"]:
        if method == "GET":
            return _response(_conversation_view(_conversation(sub, parts[2])))
        if method == "PATCH":
            return _response(_file_conversation(user, parts[2], _body(event)))
        if method == "DELETE":
            return _response(_delete_conversation(user, parts[2]))
    if path == "/api/runs":
        if method == "POST":
            return _response({"run": _start_run(user, _body(event))}, 201)
        if method == "GET":
            return _response({"runs": store.list_runs(sub)})
    if len(parts) in {3, 4, 5} and parts[:2] == ["api", "runs"]:
        if method == "GET" and len(parts) == 3:
            run, access = _readable_run(user, parts[2])
            return _response({"run": run, "result": store.load_result(run["run_id"]), "access": access,
                              "project": _project_ref(run.get("project_id"))})
        if method == "PATCH" and len(parts) == 3:
            return _response(_file_run(user, parts[2], _body(event)))
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
    if path == "/api/projects":
        if method == "GET":
            return _response(_list_projects(user, _query(event).get("archived") in {"1", "true"}))
        if method == "POST":
            return _response(_create_project(user, _body(event)), 201)
    if len(parts) in {3, 4} and parts[:2] == ["api", "projects"]:
        if method == "GET" and len(parts) == 3:
            return _response(_project_detail(user, *_visible_project(user, parts[2])))
        if method == "PATCH" and len(parts) == 3:
            return _response(_update_project(user, parts[2], _body(event)))
        if method == "GET" and parts[3:] == ["runs"]:
            project, _ = _visible_project(user, parts[2])
            return _response({"runs": projects.run_rows(project["project_id"], sub)})
        if method == "GET" and parts[3:] == ["cards"]:
            project, _ = _visible_project(user, parts[2])
            query = _query(event)
            cards = store.project_cards(project["project_id"], sub, q=query.get("q"), type=query.get("type"),
                                        direction=query.get("direction"))
            return _response({"cards": cards})
    if path == "/api/teams":
        if method == "GET":
            return _response(_list_teams(user))
        if method == "POST":
            return _response(_create_team(user, _body(event)), 201)
    if method == "POST" and path == "/api/team/join":
        return _response(_join_team(user, _body(event)))
    if path == "/api/team" and method == "POST":
        return _response(_create_team(user, _body(event)), 201)
    if len(parts) >= 3 and parts[:2] == ["api", "teams"]:
        _team_member(user, parts[2])
        handled = _team_route(user, method, parts[2], parts[3:], event)
        if handled is not None:
            return handled
    if len(parts) >= 2 and parts[:2] == ["api", "team"]:
        team_id = _first_team_id(user)
        if team_id is None and method == "GET" and parts[2:] in ([], ["runs"], ["cards"]):
            return _response(_team_state(user, None) if not parts[2:] else {parts[2]: []})
        handled = _team_route(user, method, team_id, parts[2:], event)
        if handled is not None:
            return handled
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
