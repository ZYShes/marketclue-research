from datetime import datetime, timedelta, timezone

import pytest

from app import intake, store
from helpers import BRIEF, body, lambda_client, ready_conversation, request, signed_in


@pytest.fixture
def clock(monkeypatch):
    times = {"now": datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)}

    def tick(minutes=1):
        times["now"] += timedelta(minutes=minutes)

    monkeypatch.setattr(store, "_now", lambda: times["now"])
    return tick


def test_conversation_list_requires_session(aws):
    assert request("/api/conversations")["statusCode"] == 401


def test_conversation_list_is_newest_first_with_titles(aws, monkeypatch, clock):
    session = signed_in()
    replies = iter([
        {"reply": "What do you sell?", "ready": False, "brief": None},
        {"reply": "Press Start research.", "ready": True, "brief": dict(BRIEF)},
    ])
    monkeypatch.setattr(intake, "chat", lambda conv, message: next(replies))
    long_message = "I am  opening a small bakery\nthat sells sourdough bread and pastries to families in my neighbourhood every day"
    first = body(request("/api/chat", "POST", {"message": long_message, "feature": "market_check"}, session))
    clock()
    second = body(request("/api/chat", "POST", {"message": "Mugs", "feature": "competitor_scan"}, session))
    listed = body(request("/api/conversations", session=session))["conversations"]
    assert [item["conv_id"] for item in listed] == [second["conv_id"], first["conv_id"]]
    assert listed[0] == {
        "conv_id": second["conv_id"], "feature": "competitor_scan", "template": "general", "project_id": None, "title": BRIEF["business"], "ready": True,
        "run_id": None, "run_status": None, "updated_at": "2026-11-03T12:01:00Z",
    }
    title = listed[1]["title"]
    assert len(title) == 80 and title.endswith("…")
    assert title.startswith("I am opening a small bakery that sells")
    assert listed[1]["feature"] == "market_check" and listed[1]["ready"] is False


def test_conversation_list_limit_and_privacy(aws, clock):
    session = signed_in()
    for index in range(3):
        ready_conversation(conv_id=f"conv-{index}")
        clock()
    ready_conversation(sub="other", conv_id="private")
    listed = body(request("/api/conversations", session=session, rawQueryString="limit=2"))["conversations"]
    assert [item["conv_id"] for item in listed] == ["conv-2", "conv-1"]
    assert len(body(request("/api/conversations", session=session))["conversations"]) == 3
    for bad in ("0", "-3", "many"):
        response = request("/api/conversations", session=session, rawQueryString=f"limit={bad}")
        assert response["statusCode"] == 400


def test_starting_a_run_links_the_conversation_and_mirrors_status(aws, monkeypatch, clock):
    session = signed_in()
    conv_id = ready_conversation()
    lambda_client(monkeypatch)
    clock()
    run = body(request("/api/runs", "POST", {"conv_id": conv_id}, session))["run"]
    conv = body(request(f"/api/conversations/{conv_id}", session=session))
    assert conv["run_id"] == run["run_id"]
    assert conv["run_status"] == "queued"
    assert conv["feature"] == "competitor_scan"
    assert conv["title"] == BRIEF["business"]
    assert conv["brief"] == BRIEF and conv["messages"][0]["text"] == "I make mugs"
    assert conv["updated_at"] == "2026-11-03T12:01:00Z"
    store.update_run(run["run_id"], status="running", stage="researching")
    assert store.get_conversation("founder", conv_id)["run_status"] == "running"
    store.update_run(run["run_id"], stage="writing")
    assert store.get_conversation("founder", conv_id)["run_status"] == "running"
    store.update_run(run["run_id"], status="done", stage="done")
    listed = body(request("/api/conversations", session=session))["conversations"][0]
    assert (listed["run_id"], listed["run_status"]) == (run["run_id"], "done")


def test_conversation_points_at_its_latest_run(aws):
    ready_conversation()
    first = store.create_run("founder", "conversation", "First", BRIEF)
    second = store.create_run("founder", "conversation", "Second", BRIEF)
    store.update_run(first["run_id"], status="failed")
    conv = store.get_conversation("founder", "conversation")
    assert (conv["run_id"], conv["run_status"]) == (second["run_id"], "queued")


def test_runs_without_a_stored_conversation_create_no_conversation(aws):
    run = store.create_run("founder", "missing-conv", "Research", {})
    store.update_run(run["run_id"], status="done")
    assert store.get_conversation("founder", "missing-conv") is None
    assert store.count_conversations("founder") == 0
    assert store.list_conversations("founder") == []


def test_chat_keeps_the_run_link_and_returns_it(aws, monkeypatch):
    session = signed_in()
    conv_id = ready_conversation()
    run = store.create_run("founder", conv_id, "Research", BRIEF)
    monkeypatch.setattr(intake, "chat", lambda conv, message: {"reply": "Noted.", "ready": True, "brief": dict(BRIEF)})
    reply = body(request("/api/chat", "POST", {"conv_id": conv_id, "message": "One more thing"}, session))
    assert reply["run_id"] == run["run_id"] and reply["run_status"] == "queued"
    assert store.get_conversation("founder", conv_id)["run_id"] == run["run_id"]


def test_conversation_titles_fall_back_and_collapse_whitespace():
    assert store.conversation_title({"brief": {"business": "  Mugs   for  gifts "}}) == "Mugs for gifts"
    assert store.conversation_title({"messages": [{"role": "assistant", "text": "Hi"}, {"role": "user", "text": "Tea"}]}) == "Tea"
    assert store.conversation_title({"messages": []}) == "Untitled research"
    assert len(store.conversation_title({"brief": {"business": "x" * 200}})) == 80


# ---------- Deleting a conversation ----------

def test_owner_deletes_a_draft_conversation(aws, monkeypatch):
    session = signed_in()
    monkeypatch.setattr(intake, "chat", lambda conv, message: {"reply": "What do you sell?", "ready": False, "brief": None})
    conv_id = body(request("/api/chat", "POST", {"message": "Mugs", "feature": "market_check"}, session))["conv_id"]
    other = signed_in(sub="someone", email="someone@example.com", name="Someone")
    assert request(f"/api/conversations/{conv_id}", "DELETE", session=other)["statusCode"] == 404
    response = request(f"/api/conversations/{conv_id}", "DELETE", session=session)
    assert response["statusCode"] == 200 and body(response) == {"deleted": True, "conv_id": conv_id}
    assert request(f"/api/conversations/{conv_id}", session=session)["statusCode"] == 404
    assert body(request("/api/conversations", session=session))["conversations"] == []
    assert request(f"/api/conversations/{conv_id}", "DELETE", session=session)["statusCode"] == 404


def test_a_running_report_blocks_delete_and_a_finished_report_stays(aws, monkeypatch, clock):
    session = signed_in()
    conv_id = ready_conversation()
    lambda_client(monkeypatch)
    run = body(request("/api/runs", "POST", {"conv_id": conv_id}, session))["run"]
    blocked = request(f"/api/conversations/{conv_id}", "DELETE", session=session)
    assert blocked["statusCode"] == 409 and body(blocked)["error"]["code"] == "run_in_progress"
    store.update_run(run["run_id"], status="done", stage="done")
    assert request(f"/api/conversations/{conv_id}", "DELETE", session=session)["statusCode"] == 200
    assert request(f"/api/runs/{run['run_id']}", session=session)["statusCode"] == 200
    assert [r["run_id"] for r in body(request("/api/runs", session=session))["runs"]] == [run["run_id"]]
    store.update_run(run["run_id"], status="failed")  # a status change after the delete does not bring the chat back
    assert request(f"/api/conversations/{conv_id}", session=session)["statusCode"] == 404


def test_limit_counts_only_conversations_without_a_report(aws, monkeypatch):
    session = signed_in()
    monkeypatch.setattr(intake, "chat", lambda conv, message: {"reply": "What do you sell?", "ready": False, "brief": None})
    for n in range(19):
        store.save_conversation("founder", {"conv_id": f"draft{n}", "messages": [], "brief": None, "ready": False})
    ready_conversation(conv_id="with-report")
    store.create_run("founder", "with-report", "Mug prices", dict(BRIEF))
    assert body(request("/api/chat", "POST", {"message": "Mugs", "feature": "market_check"}, session))["conv_id"]
    full = request("/api/chat", "POST", {"message": "Cups", "feature": "market_check"}, session)
    assert full["statusCode"] == 429 and body(full)["error"]["code"] == "conversation_limit"
    assert "Delete one you no longer need" in body(full)["error"]["message"]
    assert request("/api/conversations/draft0", "DELETE", session=session)["statusCode"] == 200
    assert request("/api/chat", "POST", {"message": "Cups", "feature": "market_check"}, session)["statusCode"] == 200
