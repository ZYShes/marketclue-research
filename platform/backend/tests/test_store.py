import hashlib
import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from botocore.exceptions import ClientError

from app import settings, store


@pytest.fixture(autouse=True)
def storage(aws):
    pass


@pytest.fixture
def now(monkeypatch):
    value = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(store, "_now", lambda: value)
    return value


def conversation(conv_id="conv-1", **fields):
    return {"conv_id": conv_id, "messages": [], "brief": None, "ready": False, **fields}


def card(**fields):
    return {
        "claim": "A useful claim", "quote": "An Exact Quote", "url": "https://example.com/page/",
        "source_title": "Example Report", "captured_at": "2026-11-02T00:00:00Z",
        "type": "sourced", "direction": "Prices", "tags": ["pricing"], **fields,
    }


def test_user_upsert_preserves_creation_and_usage(monkeypatch, now):
    user = store.upsert_user("alice", "Alice@example.com", "Alice", "photo")
    assert user == {
        "sub": "alice", "email": "Alice@example.com", "name": "Alice", "picture": "photo",
        "is_owner": False, "created_at": "2026-11-03T12:00:00Z", "runs_started": 0,
    }
    store._table().update_item(
        Key={"PK": "USER#alice", "SK": "PROFILE"},
        UpdateExpression="SET runs_started = :n", ExpressionAttributeValues={":n": 3},
    )
    monkeypatch.setattr(store, "_now", lambda: now + timedelta(hours=1))
    updated = store.upsert_user("alice", "new@example.com", "New name", None)
    assert updated["created_at"] == user["created_at"]
    assert updated["runs_started"] == 3
    assert updated["name"] == "New name"
    assert updated["email"] == "new@example.com"
    assert store.get_user("alice") == updated
    assert store.get_user("missing") is None


def test_owner_status_recomputed_from_email(monkeypatch):
    monkeypatch.setenv("OWNER_EMAILS", "owner@example.com")
    settings.get_settings.cache_clear()
    assert store.upsert_user("owner", "OWNER@example.com", "Owner", "")["is_owner"] is True
    assert store.upsert_user("owner", "other@example.com", "Owner", "")["is_owner"] is False


def test_conversations_preserve_created_at_and_isolate_users(now, monkeypatch):
    conv = conversation(brief={"budget_usd": 100.5})
    store.save_conversation("alice", conv)
    first = store.get_conversation("alice", "conv-1")
    assert first["brief"]["budget_usd"] == 100.5
    assert first["created_at"] == "2026-11-03T12:00:00Z"
    monkeypatch.setattr(store, "_now", lambda: now + timedelta(minutes=1))
    store.save_conversation("alice", conversation(messages=[{"role": "user", "text": "Hello", "at": "now"}], ready=True))
    updated = store.get_conversation("alice", "conv-1")
    assert updated["created_at"] == first["created_at"]
    assert updated["updated_at"] == "2026-11-03T12:01:00Z"
    assert updated["ready"] is True
    assert len(updated["messages"]) == 1
    assert store.get_conversation("bob", "conv-1") is None
    assert store.count_conversations("alice") == 1
    assert store.count_conversations("bob") == 0


def test_create_and_update_run_mirror_index_without_consuming_quota():
    store.upsert_user("alice", "alice@example.com", "Alice", "")
    run = store.create_run("alice", "conv", "Research", {"budget_usd": 80.5})
    assert len(run["run_id"]) == 12
    assert run["status"] == "queued"
    assert run["stage"] == "planning"
    assert run["agents"] == {}
    assert store.get_user("alice")["runs_started"] == 0
    assert store.get_run(run["run_id"]) == run
    assert store.get_run("missing") is None
    store.update_run(run["run_id"], status="done", title="Finished", cost_usd=0.42, agents={"Prices": {"status": "done", "note": "Ready"}})
    current = store.get_run(run["run_id"])
    assert current["conv_id"] == "conv"
    assert current["brief"] == {"budget_usd": 80.5}
    assert current["cost_usd"] == 0.42
    assert store.list_runs("alice")[0] == {
        "run_id": run["run_id"], "title": "Finished", "status": "done",
        "cost_usd": 0.42, "created_at": run["created_at"],
    }
    assert store.list_runs("bob") == []
    json.dumps(current)


def test_update_run_rejects_missing_and_immutable_fields():
    with pytest.raises(KeyError):
        store.update_run("missing", status="done")
    run = store.create_run("alice", "conv", "Research", {})
    for field in ("user_sub", "conv_id", "created_at", "PK", "SK"):
        with pytest.raises(ValueError):
            store.update_run(run["run_id"], **{field: "changed"})
    with pytest.raises(TypeError):
        store.update_run(run["run_id"], **{"run_id": "changed"})


def test_run_list_is_newest_first_and_limited(now, monkeypatch):
    runs = []
    for index in range(4):
        monkeypatch.setattr(store, "_now", lambda index=index: now + timedelta(seconds=index))
        runs.append(store.create_run("alice", "conv", f"Run {index}", {}))
    assert [run["run_id"] for run in store.list_runs("alice")] == [run["run_id"] for run in reversed(runs)]
    assert len(store.list_runs("alice", limit=2)) == 2
    assert store.list_runs("alice", limit=0) == []


def test_result_and_snapshot_round_trip():
    run = store.create_run("alice", "conv", "Research", {})
    assert store.load_result(run["run_id"]) is None
    assert store.load_result("missing") is None
    document = {"title": "Report", "cost": {"usd": 0.42}, "summary": ["A useful result"]}
    key = store.save_result(run["run_id"], document)
    assert key == f"runs/{run['run_id']}.json"
    assert store.get_run(run["run_id"])["result_key"] == key
    assert store.load_result(run["run_id"]) == document
    response = store._s3().get_object(Bucket=settings.get_settings().data_bucket, Key=key)
    assert response["ContentType"] == "application/json"
    snapshot_url = "https://example.com/page#section"
    snapshot = store.save_snapshot(snapshot_url, "A page\nwith text")
    assert snapshot == f"snapshots/{hashlib.sha1(snapshot_url.encode()).hexdigest()}.txt"
    response = store._s3().get_object(Bucket=settings.get_settings().data_bucket, Key=snapshot)
    assert response["Body"].read().decode() == "A page\nwith text"
    with pytest.raises(KeyError):
        store.save_result("missing", document)


def test_missing_result_object_returns_none():
    run = store.create_run("alice", "conv", "Research", {})
    store.update_run(run["run_id"], result_key="runs/missing.json")
    assert store.load_result(run["run_id"]) is None


def test_load_result_does_not_hide_s3_permission_errors(monkeypatch):
    run = store.create_run("alice", "conv", "Research", {})
    store.update_run(run["run_id"], result_key="runs/denied.json")

    class Denied:
        def get_object(self, **kwargs):
            raise ClientError({"Error": {"Code": "AccessDenied", "Message": "Denied"}}, "GetObject")

    monkeypatch.setattr(store, "_s3", Denied)
    with pytest.raises(ClientError):
        store.load_result(run["run_id"])


def test_cards_dedupe_normalizes_url_quote_and_unique_run_ids():
    original = card(url="HTTPS://EXAMPLE.COM/page///#Section", quote="  An   EXACT\nQuote  ")
    first = store.put_cards("alice", [original], "run-one")[0]
    duplicate = card(url="https://example.com/page", quote="an exact quote", claim="Replacement")
    second = store.put_cards("alice", [duplicate, duplicate], "run-two")
    expected_key = hashlib.sha1(b"https://example.com/page\nan exact quote").hexdigest()
    assert first["dedupe_key"] == expected_key
    assert all(item["card_id"] == first["card_id"] for item in second)
    assert second[0]["run_ids"] == ["run-one", "run-two"]
    assert second[1]["run_ids"] == ["run-one", "run-two"]
    assert second[0]["claim"] == original["claim"]
    assert len(store.list_cards("alice")) == 1
    assert len(store.put_cards("bob", [duplicate], "run-three")) == 1
    assert store.list_cards("bob")[0]["card_id"] != first["card_id"]


def test_duplicate_cards_in_one_batch_share_id():
    cards = store.put_cards("alice", [card(), card()], "run")
    assert cards[0]["card_id"] == cards[1]["card_id"]
    assert cards[1]["run_ids"] == ["run"]
    assert len(store.list_cards("alice")) == 1


def test_card_list_filters_search_fields_and_staleness(now):
    old = card(captured_at=(now - timedelta(days=91)).isoformat(), claim="Old pricing evidence")
    fresh = card(url="https://example.org/fresh", quote="A new QUOTE", source_title="Fresh REPORT", direction="Customers", type="unverified", captured_at=(now - timedelta(days=1)).isoformat())
    boundary = card(url="https://example.org/boundary", quote="Boundary", captured_at=(now - timedelta(days=90)).isoformat())
    stored = store.put_cards("alice", [old, fresh, boundary], "run")
    cards = store.list_cards("alice")
    assert [item["card_id"] for item in cards] == [stored[1]["card_id"], stored[2]["card_id"], stored[0]["card_id"]]
    assert [item["stale"] for item in cards] == [False, False, True]
    assert len(store.list_cards("alice", q="PRICING")) == 1
    assert len(store.list_cards("alice", q="new quote")) == 1
    assert len(store.list_cards("alice", q="fresh report")) == 1
    assert len(store.list_cards("alice", type="sourced")) == 2
    assert len(store.list_cards("alice", direction="Customers")) == 1
    assert len(store.list_cards("alice", q="report", type="unverified", direction="Customers")) == 1
    assert store.list_cards("alice", type="sourced", direction="Customers") == []
    assert store.list_cards("bob") == []


def test_get_cards_is_scoped_and_preserves_requested_order():
    first, second = store.put_cards("alice", [card(), card(url="https://example.org/second")], "run")
    result = store.get_cards("alice", [second["card_id"], "missing", first["card_id"]])
    assert result == [second, first]
    assert store.get_cards("bob", [first["card_id"]]) == []
    assert store.get_cards("alice", []) == []


def test_share_links_resolve_and_are_stable():
    run = store.create_run("alice", "conv", "Research", {})
    token = store.create_share(run["run_id"])
    assert len(token) >= 20
    assert store.create_share(run["run_id"]) == token
    assert store.resolve_share(token) == store.get_run(run["run_id"])
    assert store.get_run(run["run_id"])["share_token"] == token
    assert store.resolve_share("missing") is None
    with pytest.raises(KeyError):
        store.create_share("missing")


def test_daily_counter_uses_utc_date_and_ttl(now, monkeypatch):
    assert store.incr_day_counter() == 1
    assert store.incr_day_counter() == 2
    item = store._table().get_item(Key={"PK": "DAY#2026-11-03", "SK": "COUNTER"})["Item"]
    assert int(item["ttl"]) > int(now.timestamp())
    monkeypatch.setattr(store, "_now", lambda: now + timedelta(days=1))
    assert store.incr_day_counter() == 1


def test_queries_paginate_for_lists_dedupe_and_conversation_count(monkeypatch, now):
    for index in range(3):
        store.save_conversation("alice", conversation(f"conv-{index}"))
        store.create_run("alice", "conv", f"Run {index}", {})
    cards = store.put_cards("alice", [card(url=f"https://example.org/{index}") for index in range(3)], "run-one")
    table = store._table()
    query = table.query

    def small_page(**kwargs):
        kwargs["Limit"] = 1
        return query(**kwargs)

    monkeypatch.setattr(table, "query", small_page)
    monkeypatch.setattr(store, "_table", lambda: table)
    assert store.count_conversations("alice") == 3
    assert len(store.list_runs("alice", limit=3)) == 3
    assert len(store.list_cards("alice")) == 3
    reused = store.put_cards("alice", [card(url=cards[-1]["url"])], "run-two")[0]
    assert reused["card_id"] == cards[-1]["card_id"]
    assert reused["run_ids"] == ["run-one", "run-two"]


def test_recursive_dynamo_conversion():
    value = {"cost": 1.25, "items": [0.5, {"count": 2}], "ready": True, "empty": None}
    native = store._to_dynamo(value)
    assert isinstance(native["cost"], Decimal)
    assert store._from_dynamo(native) == value
