from datetime import datetime, timedelta, timezone
from itertools import count

import boto3
import pytest

from app import settings, store
from helpers import BRIEF, body, done_run, lambda_client, ready_conversation, request, signed_in


@pytest.fixture
def team(aws):
    """An owner with a team and one member who joined through an invite."""
    owner = signed_in("owner-sub", "lead@example.com", "Lena Lead")
    created = request("/api/team", "POST", {"name": "  Clay \n Collective "}, owner)
    assert created["statusCode"] == 201
    member = signed_in("member-sub", "Member@Example.com", "Max Member")
    token = body(request("/api/team/invites", "POST", {"email": "member@example.com"}, owner))["token"]
    assert request("/api/team/join", "POST", {"token": token}, member)["statusCode"] == 200
    return {"owner": owner, "member": member, "team_id": store.get_user("owner-sub")["team_id"], "token": token}


def card(url, quote="Mugs sell for $40.", **fields):
    return {"claim": "Mugs sell for $40", "quote": quote, "url": url, "source_title": "Shop",
            "captured_at": "2026-11-01T00:00:00Z", "type": "sourced", "direction": "Prices", "tags": [], **fields}


@pytest.mark.parametrize(("path", "method"), [
    ("/api/team", "GET"), ("/api/team", "POST"), ("/api/team/invites", "POST"), ("/api/team/invites/x", "DELETE"),
    ("/api/team/join", "POST"), ("/api/team/members/x", "DELETE"), ("/api/team/leave", "POST"),
    ("/api/team/runs", "GET"), ("/api/team/cards", "GET"),
])
def test_team_routes_require_session(aws, path, method):
    assert request(path, method, {})["statusCode"] == 401


def test_create_team_once(aws):
    session = signed_in("owner-sub", "lead@example.com", "Lena Lead")
    assert body(request("/api/team", session=session)) == {"team": None, "role": None, "members": [], "invites": []}
    assert request("/api/team", "POST", {"name": "  "}, session)["statusCode"] == 400
    state = body(request("/api/team", "POST", {"name": "Clay \n Collective"}, session))
    assert state["team"]["name"] == "Clay Collective" and state["team"]["owner_sub"] == "owner-sub"
    assert state["role"] == "owner" and state["invites"] == []
    assert [(m["sub"], m["role"], m["email"], m["name"]) for m in state["members"]] == [
        ("owner-sub", "owner", "lead@example.com", "Lena Lead")]
    assert store.get_user("owner-sub")["team_id"] == state["team"]["team_id"]
    again = request("/api/team", "POST", {"name": "Second"}, session)
    assert again["statusCode"] == 403 and body(again)["error"]["code"] == "already_in_team"
    assert body(request("/api/team", session=session)) == state


def test_invites_are_owner_only_and_listed_for_the_owner(team):
    owner, member = team["owner"], team["member"]
    response = request("/api/team/invites", "POST", {"email": "New@Example.com"}, owner)
    assert response["statusCode"] == 201
    invite = body(response)
    assert invite["invite_url"] == f"https://marketclue.example/#/join/{invite['token']}"
    assert invite["emailed"] is False and invite["email"] == "New@Example.com"
    again = body(request("/api/team/invites", "POST", {"email": "new@example.com"}, owner))
    assert again["token"] == invite["token"]
    state = body(request("/api/team", session=owner))
    assert [(i["token"], i["status"], i["invite_url"]) for i in state["invites"]] == [
        (invite["token"], "pending", invite["invite_url"])]
    member_view = body(request("/api/team", session=member))
    assert member_view["role"] == "member" and member_view["invites"] == []
    assert [m["sub"] for m in member_view["members"]] == ["owner-sub", "member-sub"]
    forbidden = request("/api/team/invites", "POST", {"email": "x@example.com"}, member)
    assert forbidden["statusCode"] == 403 and body(forbidden)["error"]["code"] == "team_owner_only"
    duplicate = request("/api/team/invites", "POST", {"email": "MEMBER@example.com"}, owner)
    assert duplicate["statusCode"] == 409 and body(duplicate)["error"]["code"] == "already_member"
    for bad in ("not-an-email", "a@b", "x" * 250 + "@example.com"):
        assert request("/api/team/invites", "POST", {"email": bad}, owner)["statusCode"] == 400
    loner = signed_in("loner", "loner@example.com")
    assert body(request("/api/team/invites", "POST", {"email": "x@example.com"}, loner))["error"]["code"] == "no_team"


def test_pending_invites_are_capped(team, monkeypatch):
    monkeypatch.setattr("app.router.MAX_PENDING_INVITES", 2)
    for index in range(2):
        assert request("/api/team/invites", "POST", {"email": f"p{index}@example.com"}, team["owner"])["statusCode"] == 201
    response = request("/api/team/invites", "POST", {"email": "p9@example.com"}, team["owner"])
    assert response["statusCode"] == 429 and body(response)["error"]["code"] == "invite_limit"


def test_invite_email_is_sent_through_ses_when_configured(team, monkeypatch):
    monkeypatch.setenv("SES_FROM", "MarketClue <invites@example.com>")
    settings.get_settings.cache_clear()
    ses = boto3.client("sesv2", region_name="us-west-2")
    rejected = body(request("/api/team/invites", "POST", {"email": "first@example.com"}, team["owner"]))
    assert rejected["emailed"] is False and rejected["token"]
    ses.create_email_identity(EmailIdentity="example.com")
    sent = body(request("/api/team/invites", "POST", {"email": "second@example.com"}, team["owner"]))
    assert sent["emailed"] is True
    from moto.ses.models import ses_backends
    message = ses_backends["123456789012"]["us-west-2"].sent_messages[-1]
    assert message.destinations == {"ToAddresses": ["second@example.com"]}
    assert sent["invite_url"] in message.body and "Clay Collective" in message.subject


def test_join_requires_the_invited_google_email(team):
    owner = team["owner"]
    invite = body(request("/api/team/invites", "POST", {"email": "guest@example.com"}, owner))
    stranger = signed_in("stranger", "stranger@example.com")
    response = request("/api/team/join", "POST", {"token": invite["token"]}, stranger)
    assert response["statusCode"] == 403 and body(response)["error"]["code"] == "invite_email_mismatch"
    assert store.get_user("stranger").get("team_id") is None
    guest = signed_in("guest", "GUEST@example.com", "Gita Guest")
    joined = body(request("/api/team/join", "POST", {"token": invite["token"]}, guest))
    assert joined["role"] == "member" and joined["team"]["team_id"] == team["team_id"]
    assert store.get_member(team["team_id"], "guest")["email"] == "GUEST@example.com"
    assert body(request("/api/team/join", "POST", {"token": invite["token"]}, guest))["role"] == "member"
    used = request("/api/team/join", "POST", {"token": invite["token"]}, stranger)
    assert used["statusCode"] == 410 and body(used)["error"]["code"] == "invite_unavailable"
    assert request("/api/team/join", "POST", {"token": "unknown"}, stranger)["statusCode"] == 404
    assert request("/api/team/join", "POST", {}, stranger)["statusCode"] == 400


def test_expired_revoked_and_other_team_invites(team, monkeypatch):
    owner = team["owner"]
    invite = body(request("/api/team/invites", "POST", {"email": "late@example.com"}, owner))
    late = signed_in("late", "late@example.com")
    future = datetime.now(timezone.utc) + timedelta(days=8)
    monkeypatch.setattr(store, "_now", lambda: future)
    expired = request("/api/team/join", "POST", {"token": invite["token"]}, late)
    assert expired["statusCode"] == 410 and body(expired)["error"]["code"] == "invite_expired"
    assert body(request("/api/team", session=owner))["invites"] == []
    monkeypatch.undo()
    assert request(f"/api/team/invites/{invite['token']}", "DELETE", session=team["member"])["statusCode"] == 403
    assert body(request(f"/api/team/invites/{invite['token']}", "DELETE", session=owner)) == {"ok": True}
    assert request(f"/api/team/invites/{invite['token']}", "DELETE", session=owner)["statusCode"] == 409
    revoked = request("/api/team/join", "POST", {"token": invite["token"]}, late)
    assert revoked["statusCode"] == 410 and body(revoked)["error"]["code"] == "invite_unavailable"
    other_owner = signed_in("other-owner", "other@example.com")
    request("/api/team", "POST", {"name": "Other"}, other_owner)
    other = body(request("/api/team/invites", "POST", {"email": "late@example.com"}, other_owner))
    assert request(f"/api/team/invites/{other['token']}", "DELETE", session=owner)["statusCode"] == 404
    assert request("/api/team/join", "POST", {"token": other["token"]}, team["member"])["statusCode"] == 403


def test_removed_member_loses_team_access_at_once(team):
    owner, member = team["owner"], team["member"]
    run = done_run("owner-sub")
    assert request(f"/api/runs/{run['run_id']}", session=member)["statusCode"] == 200
    assert request("/api/team/members/member-sub", "DELETE", session=member)["statusCode"] == 403
    response = request("/api/team/members/owner-sub", "DELETE", session=owner)
    assert response["statusCode"] == 400 and body(response)["error"]["code"] == "cannot_remove_owner"
    assert body(request("/api/team/members/member-sub", "DELETE", session=owner)) == {"ok": True}
    assert request(f"/api/runs/{run['run_id']}", session=member)["statusCode"] == 404
    assert store.get_user("member-sub").get("team_id") is None
    assert body(request("/api/team", session=member))["team"] is None
    assert body(request("/api/team/runs", session=member)) == {"runs": []}
    assert [m["sub"] for m in body(request("/api/team", session=owner))["members"]] == ["owner-sub"]
    assert request("/api/team/members/member-sub", "DELETE", session=owner)["statusCode"] == 404


def test_members_leave_but_owners_cannot(team):
    response = request("/api/team/leave", "POST", session=team["owner"])
    assert response["statusCode"] == 403 and body(response)["error"]["code"] == "owner_cannot_leave"
    assert body(request("/api/team/leave", "POST", session=team["member"])) == {"ok": True}
    assert store.get_member(team["team_id"], "member-sub") is None
    assert request("/api/team/leave", "POST", session=team["member"])["statusCode"] == 404
    assert body(request("/api/team", "POST", {"name": "My own"}, team["member"]))["role"] == "owner"


def test_team_runs_list_finished_runs_of_current_members(team, monkeypatch):
    owner, member = team["owner"], team["member"]
    ticks, start = count(), datetime(2026, 11, 3, 12, tzinfo=timezone.utc)
    monkeypatch.setattr(store, "_now", lambda: start + timedelta(seconds=next(ticks)))
    first = done_run("owner-sub", "Owner report")
    second = done_run("member-sub", "Member report")
    store.create_run("member-sub", "conversation", "Still running", BRIEF)
    outsider = done_run("outsider", "Outsider report")
    monkeypatch.undo()
    runs = body(request("/api/team/runs", session=owner))["runs"]
    assert [(r["run_id"], r["owner_name"], r["owner_sub"]) for r in runs] == [
        (second["run_id"], "Max Member", "member-sub"), (first["run_id"], "Lena Lead", "owner-sub")]
    assert all(r["status"] == "done" for r in runs)
    assert outsider["run_id"] not in {r["run_id"] for r in runs}
    assert len(body(request("/api/team/runs", session=member, rawQueryString="limit=1"))["runs"]) == 1
    loner = signed_in("loner", "loner@example.com")
    assert body(request("/api/team/runs", session=loner)) == {"runs": []}


def test_team_cards_are_deduped_with_added_by(team):
    store.put_cards("owner-sub", [card("https://a.example/1"), card("https://a.example/2", type="unverified")], "r1")
    store.put_cards("member-sub", [card("https://a.example/1/"), card("https://b.example/3", direction="Buyers")], "r2")
    store.put_cards("outsider", [card("https://c.example/4")], "r3")
    owner_view = body(request("/api/team/cards", session=team["owner"]))["cards"]
    assert sorted((c["url"], c["added_by"]) for c in owner_view) == [
        ("https://a.example/1", "Lena Lead"), ("https://a.example/2", "Lena Lead"), ("https://b.example/3", "Max Member")]
    member_view = body(request("/api/team/cards", session=team["member"]))["cards"]
    shared = next(c for c in member_view if c["url"] == "https://a.example/1/")
    assert shared["added_by"] == "Max Member" and shared["added_by_sub"] == "member-sub"
    assert len(member_view) == 3
    filtered = body(request("/api/team/cards", session=team["owner"], rawQueryString="type=sourced&direction=Buyers"))["cards"]
    assert [c["url"] for c in filtered] == ["https://b.example/3"]
    assert all(isinstance(c["stale"], bool) for c in owner_view)
    assert len(body(request("/api/cards", session=team["owner"]))["cards"]) == 2


def test_team_members_read_finished_reports_but_nothing_private(team, monkeypatch):
    owner, member = team["owner"], team["member"]
    conv_id = ready_conversation("owner-sub")
    run = done_run("owner-sub", conv_id=conv_id)
    store.create_share(run["run_id"])
    loaded = body(request(f"/api/runs/{run['run_id']}", session=member))
    assert loaded["access"] == "team" and loaded["run"]["owner_name"] == "Lena Lead"
    assert "conv_id" not in loaded["run"] and "share_token" not in loaded["run"]
    assert loaded["result"]["title"] == "Mug prices"
    assert body(request(f"/api/runs/{run['run_id']}", session=owner))["access"] == "owner"
    assert request(f"/api/runs/{run['run_id']}/mockups", session=member)["statusCode"] == 200
    assert request(f"/api/runs/{run['run_id']}/share", "POST", session=member)["statusCode"] == 404
    assert request(f"/api/runs/{run['run_id']}/mockup", "POST", {"prompt_kind": "ad"}, member)["statusCode"] == 404
    assert request(f"/api/conversations/{conv_id}", session=member)["statusCode"] == 404
    assert body(request("/api/conversations", session=member))["conversations"] == []
    lambda_client(monkeypatch)
    assert request("/api/runs", "POST", {"conv_id": conv_id}, member)["statusCode"] == 404
    running = store.create_run("owner-sub", conv_id, "Running", BRIEF)
    assert request(f"/api/runs/{running['run_id']}", session=member)["statusCode"] == 404
    assert body(request("/api/runs", session=member))["runs"] == []
    stranger = signed_in("stranger", "stranger@example.com")
    assert request(f"/api/runs/{run['run_id']}", session=stranger)["statusCode"] == 404



def test_public_invite_preview_needs_no_sign_in(aws):
    owner = store.upsert_user("owner", "owner@example.com", "Olive Owner", "")
    store.create_team(owner, "Clay Studio")
    invite = store.create_invite(store.get_user("owner")["team_id"], "yuki@gmail.com", "owner")
    response = request(f"/api/invites/{invite['token']}")
    assert response["statusCode"] == 200
    assert body(response) == {"team_name": "Clay Studio", "inviter_name": "Olive Owner", "email_hint": "y\u2022\u2022\u2022@gmail.com",
                              "status": "pending", "expires_at": invite["expires_at"]}
    assert request("/api/invites/nope")["statusCode"] == 404
