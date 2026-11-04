import copy

import pytest

from app import intake, projects, store
from helpers import BRIEF, body, done_run, lambda_client, ready_conversation, request, signed_in


def make_team(owner_session, member_session, member_email, name="Clay Collective"):
    team = body(request("/api/teams", "POST", {"name": name}, owner_session))["team"]
    token = body(request(f"/api/teams/{team['team_id']}/invites", "POST", {"email": member_email}, owner_session))["token"]
    assert request("/api/team/join", "POST", {"token": token}, member_session)["statusCode"] == 200
    return team["team_id"]


@pytest.fixture
def people(aws):
    return {
        "owner": signed_in("owner-sub", "lead@example.com", "Lena Lead"),
        "member": signed_in("member-sub", "member@example.com", "Max Member"),
        "outsider": signed_in("out-sub", "out@example.com", "Olga Out"),
    }


def create(session, **fields):
    response = request("/api/projects", "POST", {"name": "Ceramic planters", **fields}, session)
    assert response["statusCode"] == 201, body(response)
    return body(response)


def test_project_routes_require_session(aws):
    for path, method in [("/api/projects", "GET"), ("/api/projects", "POST"), ("/api/projects/x", "GET"),
                         ("/api/projects/x", "PATCH"), ("/api/projects/x/cards", "GET"), ("/api/teams", "GET"),
                         ("/api/conversations/x", "PATCH"), ("/api/runs/x", "PATCH")]:
        assert request(path, method, {})["statusCode"] == 401


def test_create_list_update_and_archive_a_personal_project(people):
    owner = people["owner"]
    detail = create(owner, name="  Ceramic \n planters ", brief={"business": "Planters", "budget_usd": 200})
    project = detail["project"]
    assert project["name"] == "Ceramic planters" and project["team"] is None and project["role"] == "owner"
    assert project["can_manage"] is True and project["default_template"] == "general" and project["archived"] is False
    assert project["brief"] == {"business": "Planters", "customer": None, "location": None, "stage": None, "budget_usd": 200}
    assert detail["stages"] == {f: {"count": 0, "latest": None} for f in projects.FEATURES}
    assert detail["runs"] == [] and detail["conversations"] == []
    listed = body(request("/api/projects", session=owner))
    assert [(p["project_id"], p["name"], p["team"], p["role"]) for p in listed] == [(project["project_id"], "Ceramic planters", None, "owner")]
    assert listed[0]["stages"] == {f: 0 for f in projects.FEATURES} and listed[0]["last_run_at"] is None
    pid = project["project_id"]
    patched = body(request(f"/api/projects/{pid}", "PATCH", {"name": "Planters", "brief": {"customer": "Gardeners"},
                                                              "default_template": "ebay"}, owner))["project"]
    assert patched["name"] == "Planters" and patched["default_template"] == "ebay"
    assert patched["brief"]["business"] == "Planters" and patched["brief"]["customer"] == "Gardeners"
    assert body(request(f"/api/projects/{pid}", "PATCH", {"archived": True}, owner))["project"]["archived"] is True
    assert body(request("/api/projects", session=owner)) == []
    assert [p["project_id"] for p in body(request("/api/projects", session=owner, rawQueryString="archived=1"))] == [pid]
    assert request(f"/api/projects/{pid}", session=people["outsider"])["statusCode"] == 404


@pytest.mark.parametrize("data", [
    {"name": ""}, {"name": "x" * 81}, {"name": "Ok", "brief": "text"}, {"name": "Ok", "brief": {"color": "red"}},
    {"name": "Ok", "brief": {"budget_usd": -5}}, {"name": "Ok", "brief": {"budget_usd": True}},
    {"name": "Ok", "brief": {"stage": 7}}, {"name": "Ok", "default_template": "shopify"},
])
def test_invalid_project_fields(people, data):
    assert request("/api/projects", "POST", data, people["owner"])["statusCode"] == 400


def test_live_project_limit_counts_unarchived_projects_the_person_owns(people, monkeypatch):
    owner, member = people["owner"], people["member"]
    monkeypatch.setattr(projects, "MAX_LIVE_PROJECTS", 2)
    team_id = make_team(owner, member, "member@example.com")
    first = create(owner)["project"]["project_id"]
    create(owner, name="Team one", team_id=team_id)
    create(member, name="Member's own", team_id=team_id)
    response = request("/api/projects", "POST", {"name": "Third"}, owner)
    assert response["statusCode"] == 429 and body(response)["error"]["code"] == "project_limit"
    assert "2 live projects" in body(response)["error"]["message"]
    request(f"/api/projects/{first}", "PATCH", {"archived": True}, owner)
    third = create(owner, name="Third")["project"]["project_id"]
    unarchive = request(f"/api/projects/{first}", "PATCH", {"archived": False}, owner)
    assert unarchive["statusCode"] == 429 and body(unarchive)["error"]["code"] == "project_limit"
    assert store.get_project(first)["archived"] is True
    request(f"/api/projects/{third}", "PATCH", {"archived": True}, owner)
    assert body(request(f"/api/projects/{first}", "PATCH", {"archived": False}, owner))["project"]["archived"] is False
    assert projects.live_owned("owner-sub") == 2 and projects.live_owned("member-sub") == 1


def test_project_runs_route_lists_what_the_viewer_sees(people):
    owner, member = people["owner"], people["member"]
    team_id = make_team(owner, member, "member@example.com")
    pid = create(owner, team_id=team_id)["project"]["project_id"]
    done = done_run("owner-sub", project_id=pid)
    mine = store.create_run("member-sub", "c", "Running", BRIEF, project_id=pid)
    runs = body(request(f"/api/projects/{pid}/runs", session=member))["runs"]
    assert [r["run_id"] for r in runs] == [mine["run_id"], done["run_id"]]
    assert runs == body(request(f"/api/projects/{pid}", session=member))["runs"]
    assert [r["run_id"] for r in body(request(f"/api/projects/{pid}/runs", session=owner))["runs"]] == [done["run_id"]]
    assert request(f"/api/projects/{pid}/runs", session=people["outsider"])["statusCode"] == 404


def test_team_project_visibility_for_owner_member_and_outsider(people, monkeypatch):
    owner, member, outsider = people["owner"], people["member"], people["outsider"]
    team_id = make_team(owner, member, "member@example.com")
    project = create(member, team_id=team_id)["project"]
    pid = project["project_id"]
    assert project["team"] == {"team_id": team_id, "name": "Clay Collective"} and project["role"] == "owner"
    owner_view = body(request(f"/api/projects/{pid}", session=owner))["project"]
    assert owner_view["role"] == "team_owner" and owner_view["can_manage"] is True
    mine = done_run("member-sub", "Member report", project_id=pid)
    running = store.create_run("member-sub", "conversation", "Member running", BRIEF, project_id=pid)
    owner_run = done_run("owner-sub", "Owner report", project_id=pid)
    detail = body(request(f"/api/projects/{pid}", session=owner))
    assert {r["run_id"] for r in detail["runs"]} == {mine["run_id"], owner_run["run_id"]}
    assert detail["stages"]["competitor_scan"]["count"] == 2
    assert detail["stages"]["competitor_scan"]["latest"]["run_id"] == owner_run["run_id"]
    member_detail = body(request(f"/api/projects/{pid}", session=member))
    assert {r["run_id"] for r in member_detail["runs"]} == {mine["run_id"], owner_run["run_id"], running["run_id"]}
    assert next(r for r in member_detail["runs"] if r["run_id"] == mine["run_id"])["mine"] is True
    assert body(request(f"/api/runs/{mine['run_id']}", session=owner))["access"] == "project"
    assert request(f"/api/runs/{running['run_id']}", session=owner)["statusCode"] == 404
    for path in (f"/api/projects/{pid}", f"/api/projects/{pid}/cards", f"/api/runs/{mine['run_id']}"):
        assert request(path, session=outsider)["statusCode"] == 404
    assert body(request(f"/api/projects/{pid}", session=outsider))["error"]["code"] == "project_not_found"
    listed = body(request("/api/projects", session=owner))[0]
    assert listed["stages"]["competitor_scan"] == 2 and listed["last_run_at"] == owner_run["created_at"]
    rename = request(f"/api/projects/{pid}", "PATCH", {"name": "Not mine"}, outsider)
    assert rename["statusCode"] == 404


def test_only_the_project_owner_or_team_owner_manages(people):
    owner, member = people["owner"], people["member"]
    team_id = make_team(owner, member, "member@example.com")
    pid = create(owner, team_id=team_id)["project"]["project_id"]
    response = request(f"/api/projects/{pid}", "PATCH", {"name": "Member rename"}, member)
    assert response["statusCode"] == 403 and body(response)["error"]["code"] == "project_owner_only"
    member_pid = create(member, team_id=team_id)["project"]["project_id"]
    assert request(f"/api/projects/{member_pid}", "PATCH", {"archived": True}, owner)["statusCode"] == 200


def test_moving_a_project_moves_the_visibility_of_its_reports(people):
    owner, member, outsider = people["owner"], people["member"], people["outsider"]
    first = make_team(owner, member, "member@example.com")
    second = make_team(owner, outsider, "out@example.com", name="Second team")
    pid = create(owner, team_id=first)["project"]["project_id"]
    run = done_run("owner-sub", project_id=pid)
    assert request(f"/api/runs/{run['run_id']}", session=member)["statusCode"] == 200
    assert request(f"/api/runs/{run['run_id']}", session=outsider)["statusCode"] == 404
    moved = body(request(f"/api/projects/{pid}", "PATCH", {"team_id": second}, owner))
    assert moved["project"]["team"]["team_id"] == second
    assert request(f"/api/runs/{run['run_id']}", session=member)["statusCode"] == 404
    assert request(f"/api/runs/{run['run_id']}", session=outsider)["statusCode"] == 200
    assert [p["project_id"] for p in body(request(f"/api/teams/{second}", session=outsider))["projects"]] == [pid]
    assert body(request(f"/api/teams/{first}", session=member))["projects"] == []
    assert body(request(f"/api/projects/{pid}", "PATCH", {"team_id": None}, owner))["project"]["team"] is None
    assert request(f"/api/runs/{run['run_id']}", session=outsider)["statusCode"] == 404
    nope = request(f"/api/projects/{pid}", "PATCH", {"team_id": "not-my-team"}, owner)
    assert nope["statusCode"] == 404 and body(nope)["error"]["code"] == "no_team"
    team_owned = create(member, team_id=first)["project"]["project_id"]
    assert body(request(f"/api/projects/{team_owned}", "PATCH", {"team_id": None}, owner))["project"] == {
        "project_id": team_owned, "moved": True}
    assert body(request(f"/api/projects/{team_owned}", session=member))["project"]["team"] is None


def test_a_person_in_several_teams_sees_each_teams_projects(people):
    owner, member, outsider = people["owner"], people["member"], people["outsider"]
    first = make_team(owner, member, "member@example.com")
    second = make_team(outsider, member, "member@example.com", name="Other studio")
    create(owner, name="First team project", team_id=first)
    create(outsider, name="Second team project", team_id=second)
    create(member, name="Personal")
    names = sorted(p["name"] for p in body(request("/api/projects", session=member)))
    assert names == ["First team project", "Personal", "Second team project"]
    assert [t["name"] for t in body(request("/api/teams", session=member))] == ["Clay Collective", "Other studio"]
    assert sorted(p["name"] for p in body(request("/api/projects", session=owner))) == ["First team project"]


def test_filing_conversations_and_runs(people, monkeypatch):
    owner, member = people["owner"], people["member"]
    pid = create(owner)["project"]["project_id"]
    conv_id = ready_conversation("owner-sub")
    filed = body(request(f"/api/conversations/{conv_id}", "PATCH", {"project_id": pid}, owner))
    assert filed["project_id"] == pid
    assert body(request("/api/conversations", session=owner))["conversations"][0]["project_id"] == pid
    assert body(request(f"/api/projects/{pid}", session=owner))["conversations"][0]["conv_id"] == conv_id
    lambda_client(monkeypatch)
    run = body(request("/api/runs", "POST", {"conv_id": conv_id}, owner))["run"]
    assert run["project_id"] == pid and body(request("/api/runs", session=owner))["runs"][0]["project_id"] == pid
    assert [r["run_id"] for r in store.project_runs(pid)] == [run["run_id"]]
    store.update_run(run["run_id"], status="done", stage="done", takeaway="Planters are listed at $30 to $60.")
    row = store.project_runs(pid)[0]
    assert (row["status"], row["takeaway"]) == ("done", "Planters are listed at $30 to $60.")
    other = create(owner, name="Other")["project"]["project_id"]
    moved = body(request(f"/api/runs/{run['run_id']}", "PATCH", {"project_id": other}, owner))["run"]
    assert moved["project_id"] == other and store.project_runs(pid) == []
    assert store.project_runs(other)[0]["takeaway"] == "Planters are listed at $30 to $60."
    assert body(request(f"/api/runs/{run['run_id']}", "PATCH", {"project_id": None}, owner))["run"]["project_id"] is None
    assert store.project_runs(other) == [] and store.get_run(run["run_id"])["project_id"] is None
    assert request(f"/api/runs/{run['run_id']}", "PATCH", {"project_id": pid}, member)["statusCode"] == 404
    hidden = create(member, name="Member only")["project"]["project_id"]
    response = request(f"/api/runs/{run['run_id']}", "PATCH", {"project_id": hidden}, owner)
    assert response["statusCode"] == 404 and body(response)["error"]["code"] == "project_not_found"
    assert request(f"/api/conversations/{conv_id}", "PATCH", {}, owner)["statusCode"] == 400
    assert body(request(f"/api/conversations/{conv_id}", "PATCH", {"project_id": None}, owner))["project_id"] is None


def test_new_chat_in_a_project_uses_its_template_context_and_fills_its_brief(people, monkeypatch, aws):
    owner = people["owner"]
    pid = create(owner, brief={"business": "Ceramic planters", "location": "Portland"})["project"]["project_id"]
    calls = []

    def chat(conv, message):
        calls.append(copy.deepcopy(conv))
        return {"reply": "Ready.", "ready": True, "brief": {**BRIEF, "business": "Other words", "customer": "Plant lovers",
                                                            "location": "Seattle", "budget_usd": 150}}

    monkeypatch.setattr(intake, "chat", chat)
    missing = request("/api/chat", "POST", {"message": "Hi", "project_id": "nope"}, owner)
    assert missing["statusCode"] == 404 and body(missing)["error"]["code"] == "project_not_found"
    reply = body(request("/api/chat", "POST", {"message": "Planters again", "feature": "marketing_plan", "project_id": pid}, owner))
    assert reply["project_id"] == pid and reply["template"] == "general"
    assert "Project: Ceramic planters" in calls[0]["project_context"] and "business: Ceramic planters" in calls[0]["project_context"]
    assert "project_context" not in store.get_conversation("owner-sub", reply["conv_id"])
    brief = store.get_project(pid)["brief"]
    assert brief == {"business": "Ceramic planters", "customer": "Plant lovers", "location": "Portland",
                     "stage": BRIEF["stage"], "budget_usd": 150}
    plain = body(request("/api/chat", "POST", {"message": "No project"}, owner))
    assert plain["project_id"] is None and "project_context" not in calls[-1]


def test_project_default_template_is_used_when_no_template_is_sent(people, monkeypatch):
    from ebay_fake import ebay_keys  # noqa: F401
    pid = create(people["owner"], default_template="ebay")["project"]["project_id"]
    monkeypatch.setattr(intake, "chat", lambda conv, message: {"reply": "Hi", "ready": False, "brief": None})
    response = request("/api/chat", "POST", {"message": "Hi", "project_id": pid}, people["owner"])
    assert response["statusCode"] == 409 and body(response)["error"]["code"] == "template_unavailable"
    explicit = body(request("/api/chat", "POST", {"message": "Hi", "project_id": pid, "template": "general"}, people["owner"]))
    assert explicit["template"] == "general"


def test_project_cards_are_the_knowledge_base_of_done_runs(people):
    owner, member = people["owner"], people["member"]
    team_id = make_team(owner, member, "member@example.com")
    pid = create(owner, team_id=team_id)["project"]["project_id"]
    r1 = done_run("owner-sub", project_id=pid)["run_id"]
    r2 = done_run("member-sub", project_id=pid)["run_id"]
    running = store.create_run("member-sub", "c", "Running", BRIEF, project_id=pid)["run_id"]
    private = done_run("member-sub")["run_id"]

    def card(url, quote="Planters are $40.", **fields):
        return {"claim": "Planters are $40", "quote": quote, "url": url, "source_title": "Shop",
                "captured_at": "2026-11-01T00:00:00Z", "type": "sourced", "direction": "Prices", "tags": [], **fields}

    store.put_cards("owner-sub", [card("https://a.example/1"), card("https://a.example/2", type="unverified")], r1)
    store.put_cards("member-sub", [card("https://a.example/1/"), card("https://b.example/3")], r2)
    store.put_cards("member-sub", [card("https://draft.example/4")], running)
    store.put_cards("member-sub", [card("https://private.example/5")], private)
    cards = body(request(f"/api/projects/{pid}/cards", session=member))["cards"]
    assert sorted(c["url"] for c in cards) == ["https://a.example/1/", "https://a.example/2", "https://b.example/3"]
    assert next(c for c in cards if c["url"] == "https://a.example/1/")["added_by"] == "Max Member"
    sourced = body(request(f"/api/projects/{pid}/cards", session=owner, rawQueryString="type=sourced&q=SHOP"))["cards"]
    assert sorted(c["url"] for c in sourced) == ["https://a.example/1", "https://b.example/3"]
    assert next(c for c in sourced if c["url"] == "https://a.example/1")["added_by"] == "Lena Lead"
    assert [c["url"] for c in body(request(f"/api/projects/{pid}/cards", session=owner, rawQueryString="type=unverified"))["cards"]] == [
        "https://a.example/2"]
