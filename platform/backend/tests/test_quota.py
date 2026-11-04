from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app import quota, store


def limits(monkeypatch, **overrides):
    current = quota.get_settings()
    values = {
        "table_name": current.table_name,
        "region": current.region,
        "owner_emails": current.owner_emails,
        "free_runs_per_user": current.free_runs_per_user,
        "max_runs_per_day": current.max_runs_per_day,
        "max_smarter_per_day": current.max_smarter_per_day,
    }
    values.update(overrides)
    monkeypatch.setattr(quota, "get_settings", lambda: SimpleNamespace(**values))


def user(sub="founder", email="founder@example.com"):
    return store.upsert_user(sub, email, "Founder", "")


def day_item(key=None):
    key = key or f"DAY#{datetime.now(UTC).date().isoformat()}"
    return store._table().get_item(Key={"PK": key, "SK": "COUNTER"}).get("Item")


def assert_quota(error, status, code):
    assert error.value.status == status
    assert error.value.code == code
    assert error.value.message


def test_free_run_reservation_is_atomic_and_uses_persisted_count(aws):
    founder = user()
    assert quota.free_runs_left(founder) == 1
    reservation = quota.reserve_run(founder)
    assert reservation.user_sub == "founder"
    assert store.get_user("founder")["runs_started"] == 1
    assert quota.free_runs_left(store.get_user("founder")) == 0
    assert day_item()["runs"] == 1
    assert day_item()["ttl"] > datetime.now(UTC).timestamp()

    with pytest.raises(quota.QuotaError) as error:
        quota.reserve_run(founder)
    assert_quota(error, 402, "free_run_used")
    assert store.get_user("founder")["runs_started"] == 1
    assert day_item()["runs"] == 1


def test_owners_have_unlimited_personal_runs(aws):
    founder = user(email="OWNER@example.com")
    assert quota.free_runs_left(founder) is None
    for _ in range(3):
        quota.reserve_run(founder)
    assert store.get_user("founder")["runs_started"] == 3
    assert day_item()["runs"] == 3


def test_owner_membership_uses_configured_email_not_stored_flag(aws):
    founder = user()
    founder["is_owner"] = True
    quota.reserve_run(founder)
    with pytest.raises(quota.QuotaError) as error:
        quota.reserve_run(founder)
    assert_quota(error, 402, "free_run_used")


def test_daily_limit_includes_owners_and_does_not_charge_rejected_user(aws, monkeypatch):
    limits(monkeypatch, max_runs_per_day=1)
    quota.reserve_run(user("owner", "owner@example.com"))
    founder = user()
    with pytest.raises(quota.QuotaError) as error:
        quota.reserve_run(founder)
    assert_quota(error, 429, "daily_limit")
    assert store.get_user("founder")["runs_started"] == 0
    assert day_item()["runs"] == 1

    with pytest.raises(quota.QuotaError) as error:
        quota.reserve_run(store.get_user("owner"))
    assert_quota(error, 429, "daily_limit")
    assert store.get_user("owner")["runs_started"] == 1


def test_configured_free_limit_allows_exactly_that_many_runs(aws, monkeypatch):
    limits(monkeypatch, free_runs_per_user=2)
    founder = user()
    quota.reserve_run(founder)
    quota.reserve_run(founder)
    with pytest.raises(quota.QuotaError) as error:
        quota.reserve_run(founder)
    assert_quota(error, 402, "free_run_used")
    assert day_item()["runs"] == 2


@pytest.mark.parametrize("owner", [False, True])
def test_release_refunds_both_counters_and_is_idempotent(aws, owner):
    founder = user(email="owner@example.com" if owner else "founder@example.com")
    reservation = quota.reserve_run(founder)
    quota.release_run(reservation)
    quota.release_run(reservation)
    assert store.get_user("founder")["runs_started"] == 0
    assert day_item(reservation.day_key)["runs"] == 0
    quota.reserve_run(founder)
    assert store.get_user("founder")["runs_started"] == 1


def test_release_uses_original_day_when_clock_changes(aws, monkeypatch):
    class Tomorrow(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2040, 3, 2, tzinfo=UTC)

    reservation = quota.reserve_run(user())
    monkeypatch.setattr(quota, "datetime", Tomorrow)
    quota.release_run(reservation)
    assert day_item(reservation.day_key)["runs"] == 0
    assert day_item("DAY#2040-03-02") is None


@pytest.mark.parametrize(
    ("overrides", "status", "code"),
    [
        ({"free_runs_per_user": 0}, 402, "free_run_used"),
        ({"max_runs_per_day": 0}, 429, "daily_limit"),
    ],
)
def test_zero_limits_do_not_write_counters(aws, monkeypatch, overrides, status, code):
    limits(monkeypatch, **overrides)
    founder = user()
    with pytest.raises(quota.QuotaError) as error:
        quota.reserve_run(founder)
    assert_quota(error, status, code)
    assert store.get_user("founder")["runs_started"] == 0
    assert day_item() is None


def test_chat_message_limit_counts_user_and_assistant_messages(aws):
    messages = [{"role": role, "text": "x"} for _ in range(14) for role in ("user", "assistant")]
    quota.check_chat_limits("founder", {"messages": messages}, False)
    messages.append({"role": "user", "text": "last question"})
    with pytest.raises(quota.QuotaError) as error:
        quota.check_chat_limits("founder", {"messages": messages}, False)
    assert_quota(error, 429, "message_limit")


def test_conversation_limit_only_blocks_new_conversations(aws):
    for i in range(20):
        store.save_conversation("founder", {
            "conv_id": str(i), "messages": [], "brief": None, "ready": False,
        })
    with pytest.raises(quota.QuotaError) as error:
        quota.check_chat_limits("founder", {"messages": []}, True)
    assert_quota(error, 429, "conversation_limit")
    quota.check_chat_limits("founder", {"messages": []}, False)
    quota.check_chat_limits("other-founder", {"messages": []}, True)


def smarter_item():
    key = f"DAY#{datetime.now(UTC).date().isoformat()}"
    return store._table().get_item(Key={"PK": key, "SK": "SMARTER"}).get("Item")


def test_smarter_limit_is_site_wide_and_released_on_failure(aws, monkeypatch):
    limits(monkeypatch, max_smarter_per_day=1, free_runs_per_user=5)
    owner = user("owner", "owner@example.com")
    founder = user()
    reservation = quota.reserve_run(owner, smarter=True)
    assert smarter_item()["runs"] == 1
    with pytest.raises(quota.QuotaError) as error:
        quota.reserve_run(founder, smarter=True)
    assert_quota(error, 429, "smarter_daily_limit")
    assert store.get_user("founder").get("runs_started", 0) == 0
    assert day_item()["runs"] == 1
    quota.reserve_run(founder)
    quota.release_run(reservation)
    assert smarter_item()["runs"] == 0
    assert day_item()["runs"] == 1
    quota.reserve_run(founder, smarter=True)
    assert smarter_item()["runs"] == 1


def test_zero_smarter_limit_rejects_before_writing(aws, monkeypatch):
    limits(monkeypatch, max_smarter_per_day=0)
    founder = user()
    with pytest.raises(quota.QuotaError) as error:
        quota.reserve_run(founder, smarter=True)
    assert_quota(error, 429, "smarter_daily_limit")
    assert day_item() is None
