import copy
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app import capabilities, claude, pipeline, store
from app.capabilities import ebay
from ebay_fake import ebay_keys, fake_ebay  # noqa: F401  (fixtures)
from helpers import BRIEF
from test_modes import FakeClaude


FEES_URL = "https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822"
ADS_URL = "https://www.ebay.com/help/selling/ebay-advertising/promoted-listings-overview?id=5295"
FEES_TEXT = ("Selling fees. For most categories the final value fee is 13.6% of the total amount of the sale. "
             "A per-order fee of $0.40 applies to orders over $10.")
ADS_TEXT = "With Promoted Listings General you choose an ad rate between 2% and 100% of the sale."


def usage_of():
    return SimpleNamespace(input_tokens=100, output_tokens=20, cache_read_input_tokens=0, cache_creation_input_tokens=0,
                           server_tool_use=SimpleNamespace(web_search_requests=1, web_fetch_requests=0))


def answer(stop_reason, *content):
    return SimpleNamespace(content=list(content), stop_reason=stop_reason, model="served", stop_details=None, usage=usage_of())


def text(value):
    return SimpleNamespace(type="text", text=value)


class FakeMessages:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def create(self, **kwargs):
        self.requests.append({**kwargs, "messages": copy.copy(kwargs["messages"])})
        return self.responses.pop(0)


def fake_client(monkeypatch, responses):
    messages = FakeMessages(responses)
    monkeypatch.setattr(claude, "client", lambda: SimpleNamespace(beta=SimpleNamespace(messages=messages)))
    return messages


def test_research_call_runs_client_tools_until_end_turn(ebay_keys, fake_ebay, monkeypatch):
    toolbox = capabilities.Toolbox(["ebay_listings", "ebay_fees"], "run-1")
    server = SimpleNamespace(type="server_tool_use", id="srv_1", name="web_search", input={"query": "mugs"})
    call = SimpleNamespace(type="tool_use", id="toolu_1", name="ebay_search_listings", input={"query": "stoneware mug"})
    messages = fake_client(monkeypatch, [
        answer("pause_turn", server),
        answer("tool_use", text("Searching eBay."), call),
        answer("end_turn", text('FINDING | A mug | "x" | https://www.ebay.com/itm/100001')),
    ])
    usage = claude.Usage()
    blocks = claude.research_call(usage, system="S", prompt="P", model="claude-haiku-5-5", toolbox=toolbox)
    assert [block.type for block in blocks] == ["server_tool_use", "text", "tool_use", "text"]
    first, second, third = messages.requests
    assert [(tool.get("type"), tool["name"]) for tool in first["tools"]] == [
        ("web_search_20250305", "web_search"), ("web_fetch_20250910", "web_fetch"), (None, "ebay_search_listings")]
    assert "betas" not in first and first["output_config"] == {"effort": "medium"}
    assert second["messages"] == [{"role": "user", "content": "P"}, {"role": "assistant", "content": [server]}]
    assistant, results = third["messages"][-2:]
    assert assistant == {"role": "assistant", "content": [blocks[1], call]}
    [result] = results["content"]
    assert results["role"] == "user" and result["tool_use_id"] == "toolu_1" and result["is_error"] is False
    assert json.loads(result["content"])["items"][0]["url"] == "https://www.ebay.com/itm/100001"
    assert len(fake_ebay.search_calls) == 1 and usage.input_tokens == 300


def test_research_call_with_opus_uses_dynamic_web_tools_and_fallbacks(ebay_keys, fake_ebay, monkeypatch):
    messages = fake_client(monkeypatch, [answer("end_turn", text("done"))])
    claude.research_call(None, system="S", prompt="P", model="claude-opus-5-5", toolbox=capabilities.Toolbox(["ebay_listings"], "r"))
    request = messages.requests[0]
    assert request["tools"][0]["type"] == "web_search_20260209" and request["fallbacks"] == "default"
    assert request["tools"][2]["name"] == "ebay_search_listings"


def test_research_call_without_tools_keeps_the_old_loop(monkeypatch):
    messages = fake_client(monkeypatch, [answer("pause_turn", text(str(n))) for n in range(6)])
    blocks = claude.research_call(None, system="S", prompt="P", model="claude-haiku-5-5")
    assert len(messages.requests) == 4 and len(blocks) == 4
    assert [tool["name"] for tool in messages.requests[0]["tools"]] == ["web_search", "web_fetch"]


def test_research_call_stops_after_the_turn_limit(ebay_keys, fake_ebay, monkeypatch):
    call = SimpleNamespace(type="tool_use", id="toolu_1", name="ebay_search_listings", input={"query": "mug"})
    messages = fake_client(monkeypatch, [answer("tool_use", call) for _ in range(5)])
    claude.research_call(None, system="S", prompt="P", model="claude-haiku-5-5",
                         toolbox=capabilities.Toolbox(["ebay_listings"], "r"), max_turns=3)
    assert len(messages.requests) == 3


def fetched(url, title, page_text):
    document = SimpleNamespace(title=title, source=SimpleNamespace(type="text", data=page_text))
    return SimpleNamespace(type="web_fetch_tool_result", content=SimpleNamespace(
        type="web_fetch_result", url=url, retrieved_at="2026-11-04T09:00:00Z", content=document))


class EbayAgents(FakeClaude):
    """Research agents that call the real eBay capability (over the fake Browse API) and cite listings."""

    def research_call(self, usage, *, system, prompt, model=None, max_fetches=3, toolbox=None, **kwargs):
        self.research_calls.append({"model": model, "system": system, "prompt": prompt, "toolbox": toolbox})
        items = toolbox.run_tool("ebay_search_listings", {"query": "stoneware mug"})["items"]
        lines = [f'FINDING | Listed mug | "{item["quote_text"]}" | {item["url"]}?hash=item:tracking' for item in items[:3]]
        lines.append('FINDING | Wrong price | "Handmade stoneware mug no. 4, 12 oz — $99.00" | https://www.ebay.com/itm/100004')
        lines.append(f'FINDING | Fee rate | "the final value fee is 13.6% of the total amount of the sale" | {FEES_URL}')
        lines.append(f'FINDING | Order fee | "A per-order fee of $0.40 applies to orders over $10." | {FEES_URL}')
        lines.append(f'FINDING | Ad rates | "you choose an ad rate between 2% and 100% of the sale" | {ADS_URL}')
        return [fetched(FEES_URL, "Selling fees | eBay", FEES_TEXT), fetched(ADS_URL, "Promoted Listings | eBay", ADS_TEXT),
                text("\n".join(lines))]

    def json_call(self, usage, *, system, prompt, schema, effort="low", **kwargs):
        if "findings" in schema["properties"] and "takeaway" not in schema["properties"]:
            self.json_calls.append({"prompt": prompt, "effort": effort, "schema": schema})
            rows = [line.split(" | ") for line in prompt.splitlines() if line.startswith("FINDING")]
            return {"findings": [{"claim": row[1], "quote": row[2].strip('"'), "url": row[3]} for row in rows]}
        return super().json_call(usage, system=system, prompt=prompt, schema=schema, effort=effort, **kwargs)

    def report(self, prompt):
        cards = json.loads(prompt.split("Checked fact cards (JSON):\n", 1)[1].split("\n\n", 1)[0])
        by_quote = lambda part: [card["id"] for card in cards if part in card["quote"]]  # noqa: E731
        listing = [card["id"] for card in cards if "/itm/" in card["url"]]
        item = {"kind": "sourced", "card_ids": listing[:1], "method": ""}
        doc = {
            "takeaway": {"text": "Similar mugs are listed on eBay at about forty dollars, so your price can sit nearby.", **item},
            "findings": [{"title": f"Listing finding {i}", "text": "Mugs like this sell for about $38 on eBay.", **item} for i in range(3)],
            "next_steps": [{"text": "List one mug", "how": "Watch views for a week"}] * 3,
            "missing_evidence": ["Sold prices are not available"],
        }
        if '"id"' in prompt and "Get your first customers" in prompt:
            doc.update(
                plan=[{"section": section, "items": [{"text": "Post weekly", "kind": "assumption", "card_ids": [], "method": ""}]}
                      for section in ("Customers", "Channels", "Pricing")],
                budget=[{"item": "Promoted Listings", "amount": 20, "kind": "estimate", "card_ids": [], "method": "Test"},
                        {"item": "Photos", "amount": 30, "kind": "estimate", "card_ids": [], "method": "Test"}],
                projection=None,
                ebay_fees={
                    "numbers": [
                        {"fee": "final_value_fee_pct", "value": 13.6, "label": "", "card_ids": by_quote("13.6%")},
                        {"fee": "per_order_fee_usd", "value": 0.4, "label": "", "card_ids": by_quote("$0.40")},
                        *({"fee": "ad_rate_pct", "value": rate, "label": "", "card_ids": []} for rate in (5, 2, 10)),
                        {"fee": "ad_rate_min_pct", "value": 2, "label": "", "card_ids": by_quote("ad rate")},
                        {"fee": "ad_rate_max_pct", "value": 100, "label": "", "card_ids": by_quote("ad rate")},
                    ],
                    "shipping_paid_by": "unknown", "shipping_method": "",
                    "priority": {"text": "Priority ads are charged per click.", "kind": "assumption", "card_ids": [], "method": ""},
                },
            )
        else:
            doc.update(
                table={"title": "Asking prices", "columns": ["Seller", "Product", "Price", "Notes"], "rows": [
                    {"cells": ["seller1", "Mug", "$38.00", ""], "kind": "sourced", "card_ids": listing[:1],
                     "price_usd": 38, "price_high_usd": None}]},
                price_band={"low_usd": 30, "high_usd": 40, "method": "Near the middle asking price."},
            )
        return doc


@pytest.fixture
def ebay_run(aws, ebay_keys, fake_ebay, monkeypatch):
    agents = EbayAgents()
    monkeypatch.setattr(claude, "research_call", agents.research_call)
    monkeypatch.setattr(claude, "json_call", agents.json_call)
    fallback = Mock(return_value=None)
    monkeypatch.setattr(pipeline, "fetch_page", fallback)

    def start(feature, **answers):
        brief = {**copy.deepcopy(BRIEF), "feature": feature, "template": "ebay", "ebay": {
            "category": "Mugs", "example_listing": None, "condition": "new", "target_price_usd": None,
            "buyer_pays_shipping": None, "shipping_cost_usd": None, "sells_on_ebay": False, **answers}}
        run = store.create_run("founder", "conversation", "Mugs", brief)
        pipeline.run(run["run_id"])
        meta = store.get_run(run["run_id"])
        assert meta["status"] == "done", meta["error"]
        return meta, store.load_result(run["run_id"])

    start.agents, start.fallback = agents, fallback
    return start


def test_ebay_competitor_scan_cites_listings_checked_against_the_api_snapshot(ebay_run, fake_ebay, aws):
    meta, result = ebay_run("competitor_scan")
    assert (result["version"], result["template"], meta["template"]) == (4, "ebay", "ebay")
    listing_cards = list({card["card_id"]: card for card in result["cards"] if card.get("source_kind") == "ebay_api"}.values())
    assert len(listing_cards) == 3 and all(card["type"] == "sourced" for card in listing_cards)
    card = next(card for card in listing_cards if card["url"] == "https://www.ebay.com/itm/100001")
    day = ebay.day_text(card["retrieved_at"])
    assert card["claim"] == f'An active eBay listing asks $38.00 for "Handmade stoneware mug no. 1, 12 oz" (asking price on {day}).'
    assert card["label"] == f"eBay listing (asking price, {day})"
    assert card["snapshot_key"] in {f"runs/{meta['run_id']}/ebay/{n}.json" for n in (1, 2, 3)}
    assert card["source_title"] == "Handmade stoneware mug no. 1, 12 oz" and card["retrieved_at"] == card["captured_at"]
    wrong = next(card for card in result["cards"] if card["quote"].endswith("$99.00"))
    assert wrong["type"] == "unverified" and "source_kind" not in wrong
    assert all("/itm/" not in call.args[0] for call in ebay_run.fallback.call_args_list)
    assert [(item["price"], item["shipping"]) for item in result["listings"]] == [(24.5, 0.0), (38.0, 6.5), (52.0, None)]
    assert {item["card_id"] for item in result["listings"]} == {card["card_id"] for card in listing_cards}
    assert [chart["id"] for chart in result["charts"]] == ["asking_prices", "price_band", "coverage"]
    asking = result["charts"][0]
    assert "Asking prices of active listings on " in asking["caption"] and ", not sold prices" in asking["caption"]
    assert [item["value"] for item in asking["series"]] == [24.5, 38.0, 52.0]
    assert "asking prices of active eBay listings" in result["charts"][1]["caption"]
    assert result["fees"] is None and result["ad_budget"] is None
    assert result["coverage"]["ebay_searches"] == 3 and len(fake_ebay.search_calls) == 1
    assert "sell for" not in json.dumps(result["findings"]) and "are listed at about $38" in result["findings"][0]["text"]
    raw = aws["s3"].get_object(Bucket=aws["bucket"], Key=card["snapshot_key"])["Body"].read()
    assert "Handmade stoneware mug no. 1, 12 oz" in raw.decode()


def test_ebay_prompts_carry_the_template_rules(ebay_run):
    ebay_run("competitor_scan")
    agents = ebay_run.agents
    research = agents.research_calls[0]
    assert research["system"] == pipeline.RESEARCH_SYSTEM + pipeline.LISTING_SYSTEM
    assert "Template: eBay seller" in research["prompt"] and "ebay_search_listings" in research["prompt"]
    assert "About selling on eBay:" in research["prompt"] and "- category: Mugs" in research["prompt"]
    assert "Template: eBay seller" in agents.json_calls[0]["prompt"]
    writer = next(call for call in agents.json_calls if "takeaway" in call["schema"]["properties"])
    assert "never sold prices" in writer["prompt"] and "ebay_fees" not in writer["schema"]["properties"]
    assert "eBay listing (asking price, " in writer["prompt"]


def test_ebay_marketing_plan_adds_fees_ad_scenarios_and_budget(ebay_run):
    meta, result = ebay_run("marketing_plan", target_price_usd=45, buyer_pays_shipping=True, shipping_cost_usd=8)
    fees, budget = result["fees"], result["ad_budget"]
    assert fees["complete"] is True and fees["sale_total"] == 53.0 and fees["price_basis"] == "Your target price"
    assert [(line["item"], line["amount"]) for line in fees["lines"]] == [
        ("Final value fee", 7.21), ("Per-order fee", 0.4), ("Shipping label", 8.0)]
    official = {card["card_id"] for card in result["cards"] if card["url"] == FEES_URL}
    assert set(fees["lines"][0]["card_ids"]) <= official and fees["lines"][0]["card_ids"]
    assert fees["left_before_ads"] == 37.39
    assert [(s["label"], s["ad_rate_pct"], s["ad_fee"], s["left"]) for s in fees["scenarios"]] == [
        ("Low", 2, 1.06, 36.33), ("Typical", 5, 2.65, 34.74), ("High", 10, 5.3, 32.09)]
    assert (budget["break_even_rate_pct"], budget["suggested_max_rate_pct"]) == (70.5, 35.2)
    assert (budget["min_rate_pct"], budget["max_rate_pct"]) == (2, 100) and budget["rate_card_ids"]
    assert budget["priority"]["text"] == "Priority ads are charged per click."
    assert result["listings"] == []
    assert [chart["id"] for chart in result["charts"]] == ["budget", "ebay_costs", "coverage"]
    costs = result["charts"][1]
    assert [segment["label"] for segment in costs["series"][0]["segments"]] == [
        "Final value fee", "Per-order fee", "Shipping", "Ad fee", "What is left"]
    assert costs["caption"] == "At a 5% ad rate, $34.74 of the $53.00 sale total is left before your own cost of the item."


def test_ebay_run_without_credentials_falls_back_to_web_research(aws, fake_ebay, monkeypatch):
    agents = FakeClaude()
    calls = []
    monkeypatch.setattr(claude, "research_call", lambda usage, **kwargs: calls.append(kwargs) or agents.research_call(usage, **kwargs))
    monkeypatch.setattr(claude, "json_call", agents.json_call)
    run = store.create_run("founder", "conversation", "Mugs", {**copy.deepcopy(BRIEF), "template": "ebay"})
    pipeline.run(run["run_id"])
    result = store.load_result(run["run_id"])
    assert result["template"] == "ebay" and result["version"] == 4
    assert all("toolbox" not in call and call["system"] == pipeline.RESEARCH_SYSTEM for call in calls)
    assert "eBay listings could not be searched for this report (eBay is not connected)." in result["missing_evidence"]
    assert result["listings"] == [] and fake_ebay.calls == []


class RecordingClaude(FakeClaude):
    def research_call(self, usage, **kwargs):
        self.research_kwargs = getattr(self, "research_kwargs", []) + [kwargs]
        return super().research_call(usage, **kwargs)


def test_general_template_runs_exactly_as_before(aws, monkeypatch):
    agents = RecordingClaude()
    monkeypatch.setattr(claude, "research_call", agents.research_call)
    monkeypatch.setattr(claude, "json_call", agents.json_call)
    run = store.create_run("founder", "conversation", "Mugs", copy.deepcopy(BRIEF))
    pipeline.run(run["run_id"])
    result = store.load_result(run["run_id"])
    assert store.get_run(run["run_id"])["template"] == "general"
    assert (result["version"], result["template"]) == (3, "general")
    assert not {"listings", "fees", "ad_budget"} & set(result)
    assert "ebay_searches" not in result["coverage"]
    for kwargs in agents.research_kwargs:
        assert "toolbox" not in kwargs and kwargs["system"] == pipeline.RESEARCH_SYSTEM
        assert "Template:" not in kwargs["prompt"] and "eBay" not in kwargs["prompt"]
    for call in agents.json_calls:
        assert "Template:" not in (call["prompt"] or "")
        assert "ebay_fees" not in call["schema"]["properties"]
    assert [chart["id"] for chart in result["charts"]] == ["prices", "price_band", "coverage"]
    assert pipeline.report_schema("marketing_plan") == pipeline.report_schema("marketing_plan", "general")
    assert pipeline.normalize_url("https://Shop.example/a/?q=1#x") == "https://shop.example/a?q=1"
    assert pipeline.normalize_url("https://www.ebay.com/itm/123?hash=x") == "https://www.ebay.com/itm/123"
