import json
import re
from types import SimpleNamespace

import pytest

from app import claude, pipeline, store
from helpers import BRIEF, body, lambda_client, ready_conversation, request, signed_in


QUOTE = "Our large stoneware mug costs $54 and ships within a week."


def test_runs_default_to_quick_and_store_the_mode(aws, monkeypatch):
    session = signed_in()
    client = lambda_client(monkeypatch)
    run = body(request("/api/runs", "POST", {"conv_id": ready_conversation()}, session))["run"]
    assert run["mode"] == "quick"
    assert store.get_run(run["run_id"])["mode"] == "quick"
    listed = body(request("/api/runs", session=session))["runs"][0]
    assert (listed["mode"], listed["feature"]) == ("quick", "competitor_scan")
    client.invoke.assert_called_once()


def test_owner_can_start_smarter_runs(aws, monkeypatch):
    session = signed_in("owner", "Owner@Example.com")
    lambda_client(monkeypatch)
    conv_id = ready_conversation("owner")
    response = request("/api/runs", "POST", {"conv_id": conv_id, "mode": "smarter"}, session)
    assert response["statusCode"] == 201
    assert body(response)["run"]["mode"] == "smarter"


def test_any_user_can_start_balanced_or_smarter_runs(aws, monkeypatch):
    for mode in ("balanced", "smarter"):
        sub = f"founder-{mode}"
        session = signed_in(sub, f"{sub}@example.com")
        lambda_client(monkeypatch)
        response = request("/api/runs", "POST", {"conv_id": ready_conversation(sub), "mode": mode}, session)
        assert response["statusCode"] == 201
        assert body(response)["run"]["mode"] == mode
        assert store.get_user(sub)["runs_started"] == 1


def test_smarter_daily_limit_offers_quick_and_costs_nothing(aws, monkeypatch):
    monkeypatch.setenv("MAX_SMARTER_PER_DAY", "1")
    monkeypatch.setenv("FREE_RUNS_PER_USER", "3")
    from app.settings import get_settings
    get_settings.cache_clear()
    try:
        first = signed_in("first", "first@example.com")
        lambda_client(monkeypatch)
        assert request("/api/runs", "POST", {"conv_id": ready_conversation("first"), "mode": "smarter"}, first)["statusCode"] == 201
        session = signed_in()
        client = lambda_client(monkeypatch)
        response = request("/api/runs", "POST", {"conv_id": ready_conversation(), "mode": "smarter"}, session)
        assert response["statusCode"] == 429
        assert body(response)["error"]["code"] == "smarter_daily_limit"
        assert store.get_user("founder")["runs_started"] == 0
        client.invoke.assert_not_called()
        assert request("/api/runs", "POST", {"conv_id": "conversation", "mode": "balanced"}, session)["statusCode"] == 201
    finally:
        get_settings.cache_clear()


@pytest.mark.parametrize("mode", ["fast", "SMARTER", 3, ["quick"]])
def test_unknown_modes_are_rejected(aws, monkeypatch, mode):
    session = signed_in("owner", "owner@example.com")
    client = lambda_client(monkeypatch)
    response = request("/api/runs", "POST", {"conv_id": ready_conversation("owner"), "mode": mode}, session)
    assert response["statusCode"] == 400
    assert body(response)["error"]["code"] == "invalid_mode"
    client.invoke.assert_not_called()


def test_old_runs_without_mode_run_as_quick():
    assert pipeline.mode_of({}) == "quick"
    assert pipeline.mode_of({"mode": "unknown"}) == "quick"
    assert pipeline.mode_of({"mode": "smarter"}) == "smarter"
    assert pipeline.mode_of({"mode": "balanced"}) == "balanced"


class FakeClaude:
    """Stands in for every Claude call of one run; never touches the network."""

    def __init__(self):
        self.research_calls = []
        self.json_calls = []

    def research_call(self, usage, *, system, prompt, model=None, max_fetches=3, **kwargs):
        name = re.search(r"Your research direction: (.+)", prompt).group(1)
        url = f"https://shop.example/{name.lower().replace(' ', '-')}"
        self.research_calls.append({"model": model, "max_fetches": max_fetches, "effort": kwargs.get("effort")})
        document = SimpleNamespace(title=f"{name} shop", source=SimpleNamespace(type="text", data=f"Welcome. {QUOTE} Thanks."))
        fetched = SimpleNamespace(type="web_fetch_result", url=url, retrieved_at="2026-11-03T12:00:00Z", content=document)
        return [
            SimpleNamespace(type="web_fetch_tool_result", content=fetched),
            SimpleNamespace(type="text", text=f'FINDING | Large mugs cost $54 | "{QUOTE}" | {url}'),
        ]

    def json_call(self, usage, *, system, prompt, schema, effort="low", **kwargs):
        self.json_calls.append({"prompt": prompt, "effort": effort, "schema": schema})
        props = schema["properties"]
        if "directions" in props:
            directions = [{"name": f"Direction {i}", "question": "Who sells mugs?", "search_hints": ["mugs"]} for i in range(5)]
            return {"title": "Mug prices", "directions": directions}
        if "takeaway" in props:
            return self.report(prompt)
        if "findings" in props:
            line = prompt.splitlines()[-1].split(" | ")
            return {"findings": [{"claim": line[1], "quote": line[2].strip('"'), "url": line[3]}]}
        if "unsupported" in props:
            return {"unsupported": []}
        return {"cards": []}

    def report(self, prompt):
        cards = json.loads(prompt.split("Checked fact cards (JSON):\n", 1)[1].split("\n\n", 1)[0])
        ids = [card["id"] for card in cards]
        item = {"kind": "sourced", "card_ids": ids[:1], "method": ""}
        return {
            "takeaway": {"text": "Large handmade mugs sell for about fifty dollars, so there is room at that price.", **item},
            "findings": [{"title": f"Finding number {i}", "text": "A large mug costs $54.", **item} for i in range(3)],
            "next_steps": [{"text": "List two mugs", "how": "Count sales after two weeks"}] * 3,
            "missing_evidence": ["Shipping costs were not shown"],
            "table": {"title": "Prices", "columns": ["Seller", "Product", "Price", "Notes"], "rows": [
                {"cells": ["Direction 0 shop", "Large mug", "$54", ""], "kind": "sourced", "card_ids": ids[:1],
                 "price_usd": 54, "price_high_usd": None},
            ]},
            "price_band": {"low_usd": 48, "high_usd": 58, "method": "Close to the quoted price."},
        }


@pytest.mark.parametrize(("mode", "model", "directions", "fetches", "effort"), [
    ("quick", "claude-haiku-5-5", 3, 3, "medium"),
    ("balanced", "claude-sonnet-5-5", 4, 3, "high"),
    ("smarter", "claude-opus-5-5", 4, 4, "medium"),  # Opus at medium effort throughout
])
def test_pipeline_uses_the_run_mode(aws, monkeypatch, mode, model, directions, fetches, effort):
    fake = FakeClaude()
    monkeypatch.setattr(claude, "research_call", fake.research_call)
    monkeypatch.setattr(claude, "json_call", fake.json_call)
    ready_conversation()
    run = store.create_run("founder", "conversation", "Mugs", dict(BRIEF), mode=mode)
    pipeline.run(run["run_id"])
    meta = store.get_run(run["run_id"])
    assert meta["status"] == "done", meta["error"]
    assert fake.research_calls == [{"model": model, "max_fetches": fetches, "effort": "medium"}] * directions
    # FINDING lines in the expected format are parsed in code: no model call converts them.
    assert not [call for call in fake.json_calls if call["schema"] is pipeline.FINDINGS_SCHEMA]
    plan, writer = fake.json_calls[0], next(call for call in fake.json_calls if "takeaway" in call["schema"]["properties"])
    assert f"2 to {directions} research directions" in plan["prompt"]
    assert writer["effort"] == effort
    result = store.load_result(run["run_id"])
    assert (result["version"], result["mode"], result["feature"]) == (3, mode, "competitor_scan")
    assert result["coverage"]["directions"] == directions
    assert [chart["id"] for chart in result["charts"]] == ["prices", "price_band", "coverage"]
    prices = result["charts"][0]
    assert prices["type"] == "bar" and prices["kind"] == "sourced"
    assert prices["series"][0]["value"] == 54 and prices["series"][0]["card_ids"] == result["table"]["rows"][0]["card_ids"]
    assert result["charts"][-1]["series"][2] == {"label": "Quotes found on the page", "value": directions, "card_ids": []}
    assert store.get_conversation("founder", "conversation")["run_status"] == "done"
    json.dumps(result, allow_nan=False)
