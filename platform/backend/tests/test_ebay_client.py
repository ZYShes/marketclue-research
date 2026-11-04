import json
from datetime import datetime, timedelta, timezone

import pytest
import requests

from app import capabilities, settings, store
from app.capabilities import ebay
from ebay_fake import ITEMS, ebay_keys, fake_ebay, listing  # noqa: F401  (fixtures)


def search(toolbox, **tool_input):
    return toolbox.run_tool("ebay_search_listings", {"query": "stoneware mug", **tool_input})


def test_missing_credentials_make_ebay_unavailable(aws, fake_ebay):
    assert ebay.available() == (False, "eBay is not connected yet")
    assert settings.get_settings().ebay_credentials is None
    toolbox = capabilities.Toolbox(["ebay_listings", "ebay_fees"], "run-1")
    assert not toolbox and toolbox.tools == []
    assert capabilities.available(["ebay_listings", "ebay_fees"]) == (False, "eBay is not connected yet")
    assert fake_ebay.calls == []


def test_one_secret_alone_is_not_enough(aws):
    aws["ssm"].put_parameter(Name="/marketclue/ebay_client_id", Value="id-only", Type="SecureString")
    assert settings.get_settings().ebay_credentials is None


def test_search_calls_browse_and_returns_compact_listings(ebay_keys, fake_ebay, aws):
    toolbox = capabilities.Toolbox(["ebay_listings", "ebay_fees"], "run-1")
    assert [tool["name"] for tool in toolbox.tools] == ["ebay_search_listings"]
    result = search(toolbox, category_id="20625 ", condition="NEW", min_price=10, max_price=60.5, limit=500)
    token, browse = fake_ebay.calls
    assert token["method"] == "POST" and token["auth"] == ("test-ebay-client", "test-ebay-secret")
    assert token["data"] == {"grant_type": "client_credentials", "scope": "https://api.ebay.com/oauth/api_scope"}
    assert browse["method"] == "GET" and browse["timeout"] == 30
    assert browse["headers"] == {"Authorization": "Bearer token-1", "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"}
    assert browse["params"] == {
        "q": "stoneware mug", "limit": "50", "category_ids": "20625",
        "filter": "price:[10..60.5],priceCurrency:USD,conditions:{NEW}",
    }
    assert result["total"] == 4 and "not sold prices" in result["note"]
    first = result["items"][0]
    assert first == {
        "title": "Handmade stoneware mug no. 1, 12 oz", "price": 38.0, "currency": "USD", "shipping": 6.5,
        "condition": "New", "url": "https://www.ebay.com/itm/100001", "seller_feedback": 100,
        "image_url": "https://i.ebayimg.com/images/g/1/s-l500.jpg", "buying_options": ["FIXED_PRICE"],
        "retrieved_at": result["retrieved_at"], "quote_text": "Handmade stoneware mug no. 1, 12 oz — $38.00",
    }
    assert [item["shipping"] for item in result["items"]] == [6.5, 0.0, None, 8.25]
    page = toolbox.context.evidence["https://www.ebay.com/itm/100001"]
    assert page["source_kind"] == "ebay_api" and page["snapshot_key"] == "runs/run-1/ebay/1.json"
    assert page["label"].startswith("eBay listing (asking price, ") and first["quote_text"] in page["text"]
    snapshot = aws["s3"].get_object(Bucket=aws["bucket"], Key="runs/run-1/ebay/1.json")
    raw = snapshot["Body"].read().decode()
    assert json.loads(raw)["itemSummaries"] == ITEMS
    assert snapshot["Metadata"]["retrieved-at"] == result["retrieved_at"]


def test_price_filters_and_bad_input(ebay_keys, fake_ebay):
    assert ebay.search_params({"query": "mug", "max_price": 20})["filter"] == "price:[..20],priceCurrency:USD"
    assert ebay.search_params({"query": "mug", "min_price": 5, "condition": "used"})["filter"] == "price:[5..],priceCurrency:USD,conditions:{USED}"
    assert "filter" not in ebay.search_params({"query": "mug", "min_price": -3, "condition": "broken", "category_id": "x"})
    assert ebay.search_params({"query": "mug", "limit": "abc"})["limit"] == "20"
    toolbox = capabilities.Toolbox(["ebay_listings"], "run-1")
    assert toolbox.run_tool("ebay_search_listings", {"query": "  "}) == {"error": "query is required"}
    assert toolbox.run_tool("ebay_search_listings", "not a dict") == {"error": "query is required"}
    assert toolbox.run_tool("unknown_tool", {}) == {"error": "Unknown tool unknown_tool"}
    assert fake_ebay.calls == []


def test_items_without_price_url_or_title_are_dropped():
    broken = [listing(1, 10), {**listing(2, 10), "price": None}, {**listing(3, 10), "itemWebUrl": ""}, {**listing(4, 10), "title": " "}]
    items = [ebay.compact_item(item, "2026-11-04T10:00:00Z") for item in broken]
    assert [item is not None for item in items] == [True, False, False, False]
    auction = {**listing(5, 10), "price": None, "currentBidPrice": {"value": "7.50", "currency": "USD"}}
    assert ebay.compact_item(auction, "2026-11-04T10:00:00Z")["price"] == 7.5


def test_token_is_cached_until_expiry_and_refreshed_after_a_401(ebay_keys, fake_ebay, monkeypatch):
    toolbox = capabilities.Toolbox(["ebay_listings"], "run-1")
    search(toolbox, query="mug one")
    search(toolbox, query="mug two")
    assert len(fake_ebay.token_calls) == 1 and len(fake_ebay.search_calls) == 2
    clock = ebay.time.time() + 7200
    monkeypatch.setattr(ebay.time, "time", lambda: clock)
    search(toolbox, query="mug three")
    assert len(fake_ebay.token_calls) == 2
    fake_ebay.failures = [401]
    assert "items" in search(toolbox, query="mug four")
    assert len(fake_ebay.token_calls) == 3
    assert fake_ebay.search_calls[-1]["headers"]["Authorization"] == "Bearer token-3"


def test_identical_searches_are_cached_for_24_hours(ebay_keys, fake_ebay, monkeypatch, aws):
    first_run = capabilities.Toolbox(["ebay_listings"], "run-1")
    second_run = capabilities.Toolbox(["ebay_listings"], "run-2")
    first = search(first_run)
    again = search(second_run)
    assert len(fake_ebay.search_calls) == 1
    assert again["retrieved_at"] == first["retrieved_at"]
    assert aws["s3"].get_object(Bucket=aws["bucket"], Key="runs/run-2/ebay/1.json")["Body"].read()
    later = datetime.now(timezone.utc) + timedelta(hours=25)
    monkeypatch.setattr(store, "_now", lambda: later)
    search(second_run)
    assert len(fake_ebay.search_calls) == 2
    assert second_run.context.counts["ebay_snapshots"] == 2


def test_at_most_eight_browse_calls_per_run(ebay_keys, fake_ebay):
    toolbox = capabilities.Toolbox(["ebay_listings"], "run-1")
    for n in range(8):
        assert "items" in search(toolbox, query=f"mug {n}")
    refused = search(toolbox, query="mug 9")
    assert "8 eBay searches" in refused["error"]
    assert "items" in search(toolbox, query="mug 0")
    assert len(fake_ebay.search_calls) == 8
    other = capabilities.Toolbox(["ebay_listings"], "run-2")
    assert "items" in search(other, query="mug 9")


def test_site_wide_daily_cap(ebay_keys, fake_ebay, monkeypatch):
    monkeypatch.setenv("MAX_EBAY_CALLS_PER_DAY", "2")
    settings.get_settings.cache_clear()
    assert "items" in search(capabilities.Toolbox(["ebay_listings"], "run-1"), query="a")
    assert "items" in search(capabilities.Toolbox(["ebay_listings"], "run-2"), query="b")
    refused = search(capabilities.Toolbox(["ebay_listings"], "run-3"), query="c")
    assert "used up" in refused["error"] and len(fake_ebay.search_calls) == 2
    monkeypatch.setenv("MAX_EBAY_CALLS_PER_DAY", "0")
    settings.get_settings.cache_clear()
    assert store.reserve_ebay_call(0) is False


def test_timeouts_and_server_errors_are_retried_once(ebay_keys, fake_ebay):
    toolbox = capabilities.Toolbox(["ebay_listings"], "run-1")
    fake_ebay.failures = [requests.Timeout("slow")]
    assert "items" in search(toolbox, query="retry token")
    assert len(fake_ebay.token_calls) == 2
    fake_ebay.failures = [503]
    assert "items" in search(toolbox, query="retry search")
    fake_ebay.failures = [requests.ConnectionError("down"), requests.Timeout("slow")]
    assert search(toolbox, query="gives up") == {"error": "The tool failed; continue with web search."}
    fake_ebay.failures = [500, 500]
    assert search(toolbox, query="still failing") == {"error": "The tool failed; continue with web search."}
    assert all(call["timeout"] == 30 for call in fake_ebay.calls)


def test_tool_result_blocks_mark_errors():
    toolbox = capabilities.Toolbox([], "run-1")
    block = type("Block", (), {"id": "toolu_1", "name": "missing", "input": {}})()
    result = toolbox.result_block(block)
    assert result["type"] == "tool_result" and result["tool_use_id"] == "toolu_1" and result["is_error"] is True
    assert json.loads(result["content"]) == {"error": "Unknown tool missing"}


@pytest.mark.parametrize("value", ["2026-11-04T10:00:00Z", "2026-11-04T23:59:59+00:00"])
def test_listing_label_names_the_retrieval_date(value):
    assert ebay.listing_label(value) == "eBay listing (asking price, Nov 4, 2026)"


def test_concurrent_identical_searches_share_one_browse_call(ebay_keys, fake_ebay):
    from concurrent.futures import ThreadPoolExecutor

    toolbox = capabilities.Toolbox(["ebay_listings"], "run-1")
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: search(toolbox), range(4)))
    assert all("items" in result for result in results)
    assert len(fake_ebay.search_calls) == 1 and toolbox.context.counts["ebay_snapshots"] == 4


def test_a_listing_card_found_again_gets_the_new_check_date(aws):
    def listing_card(day):
        return {"claim": "An active eBay listing asks $38.00", "quote": "Mug — $38.00", "url": "https://www.ebay.com/itm/1",
                "source_title": "Mug", "captured_at": f"2026-11-0{day}T10:00:00Z", "type": "sourced", "direction": "Prices",
                "tags": [], "source_kind": "ebay_api", "retrieved_at": f"2026-11-0{day}T10:00:00Z",
                "label": f"eBay listing (asking price, Nov {day}, 2026)", "snapshot_key": f"runs/r{day}/ebay/1.json"}

    first = store.put_cards("founder", [listing_card(3)], "r3")[0]
    again = store.put_cards("founder", [listing_card(4)], "r4")[0]
    assert again["card_id"] == first["card_id"] and again["run_ids"] == ["r3", "r4"]
    assert (again["captured_at"], again["label"], again["snapshot_key"]) == (
        "2026-11-04T10:00:00Z", "eBay listing (asking price, Nov 4, 2026)", "runs/r4/ebay/1.json")
    web = {**listing_card(3), "url": "https://shop.example/mug"}
    for key in ("source_kind", "retrieved_at", "label", "snapshot_key"):
        web.pop(key)
    stored = store.put_cards("founder", [web], "r3")[0]
    assert not {"source_kind", "label"} & set(stored)
    assert store.put_cards("founder", [{**web, "captured_at": "2026-11-09T00:00:00Z"}], "r9")[0]["captured_at"] == "2026-11-03T10:00:00Z"
