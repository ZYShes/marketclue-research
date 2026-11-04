import json

import pytest

from app import charts, ebay_report


FEES = "https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822"


def card(card_id, quote, url=FEES, type="sourced", **fields):
    return {"card_id": card_id, "quote": quote, "url": url, "type": type, **fields}


CARDS = [
    card("fvf", "For most categories the final value fee is 13.6% of the total amount of the sale."),
    card("order", "A per-order fee of $0.40 applies to orders over $10."),
    card("cents", "plus 30 cents per order on orders of $10 or less"),
    card("ads", "You choose an ad rate between 2% and 100%."),
    card("uk", "The final value fee is 13.6% for most categories.", url="https://www.ebay.co.uk/help/fees"),
    card("blog", "eBay charges 13.6% on most sales.", url="https://sellerblog.example/ebay-fees"),
    card("api", "Mug — $13.60", url="https://www.ebay.com/itm/1", source_kind="ebay_api"),
    card("unverified", "The final value fee is 13.6%.", type="unverified"),
]


def inputs(**fields):
    return {
        "final_value_fee_pct": 13.6, "final_value_fee_card_ids": ["fvf"], "per_order_fee_usd": 0.4,
        "per_order_fee_card_ids": ["order"], "target_price_usd": None, "shipping_cost_usd": None,
        "buyer_pays_shipping": None, "shipping_method": "", "ad_rates_pct": [10, 2, 5, 5],
        "ad_rate_min_pct": 2, "ad_rate_max_pct": 100, "ad_rate_card_ids": ["ads"],
        "priority": {"text": "Priority is charged per click.", "kind": "sourced", "card_ids": ["ads"], "method": ""}, **fields,
    }


def brief(**answers):
    return {"ebay": {"target_price_usd": 45, "buyer_pays_shipping": True, "shipping_cost_usd": 8, **answers}}


def test_full_breakdown_scenarios_and_budget():
    fees, budget, missing = ebay_report.fee_breakdown(inputs(), CARDS, brief(), [])
    assert missing == []
    assert fees["sale_total"] == 53.0 and fees["price"] == 45 and fees["shipping_cost"] == 8 and fees["complete"] is True
    assert fees["lines"] == [
        {"item": "Final value fee", "rate_pct": 13.6, "amount": 7.21, "kind": "estimate", "card_ids": ["fvf"],
         "method": "13.6% × $53.00 sale total = $7.21"},
        {"item": "Per-order fee", "rate_pct": None, "amount": 0.4, "kind": "estimate", "card_ids": ["order"],
         "method": "$0.40 per order"},
        {"item": "Shipping label", "rate_pct": None, "amount": 8.0, "kind": "estimate", "card_ids": [],
         "method": "The buyer pays $8.00 shipping (your estimate); you spend it on the label"},
    ]
    assert fees["left_before_ads"] == 37.39
    assert fees["method"].startswith("Sale total = $45.00 price + $8.00 shipping paid by the buyer. What is left = $53.00 sale total"
                                     " − $7.21 final value fee − $0.40 per-order fee − $8.00 shipping label = $37.39")
    assert [(s["label"], s["ad_rate_pct"], s["ad_fee"], s["left"]) for s in fees["scenarios"]] == [
        ("Low", 2, 1.06, 36.33), ("Typical", 5, 2.65, 34.74), ("High", 10, 5.3, 32.09)]
    assert fees["scenarios"][1]["method"] == "5% × $53.00 = $2.65 ad fee; $37.39 − $2.65 = $34.74 left"
    assert budget["break_even_rate_pct"] == 70.5 and budget["suggested_max_rate_pct"] == 35.2
    assert budget["suggestion"].startswith("Suggestion: keep the Promoted Listings General ad rate at or below 35.2%")
    assert budget["method"].startswith("Break-even ad rate = $37.39 left before ads ÷ $53.00 sale total = 70.5%")
    assert (budget["min_rate_pct"], budget["max_rate_pct"], budget["rate_card_ids"]) == (2, 100, ["ads"])
    assert budget["priority"]["text"] == "Priority is charged per click." and budget["kind"] == "estimate"
    json.dumps([fees, budget], allow_nan=False)


@pytest.mark.parametrize("ids", [["uk"], ["blog"], ["api"], ["unverified"], ["missing"], []])
def test_rates_count_only_from_ebay_com_help_pages_that_state_them(ids):
    fees, budget, missing = ebay_report.fee_breakdown(inputs(final_value_fee_card_ids=ids), CARDS, brief(), [])
    assert [line["item"] for line in fees["lines"]] == ["Per-order fee", "Shipping label"]
    assert fees["complete"] is False and budget is None
    assert missing == ["eBay's final value fee rate for this category was not found on an ebay.com page in this run, "
                       "so it is left out of the cost breakdown."]
    assert charts.ebay_costs_chart(fees) is None


def test_a_rate_the_cited_quote_does_not_state_is_left_out():
    fees, budget, missing = ebay_report.fee_breakdown(inputs(final_value_fee_pct=12.9, per_order_fee_usd=0.3), CARDS, brief(), [])
    assert fees["lines"] == [line for line in fees["lines"] if line["item"] == "Shipping label"]
    assert len(missing) == 2 and budget is None


def test_per_order_fee_in_cents_is_accepted():
    value, ids = ebay_report.checked(0.3, ["cents"], {c["card_id"]: c for c in CARDS})
    assert (value, ids) == (0.3, ["cents"])


def test_zero_margin_means_no_ads():
    answers = brief(target_price_usd=10, buyer_pays_shipping=False, shipping_cost_usd=8.24)
    fees, budget, _ = ebay_report.fee_breakdown(inputs(), CARDS, answers, [])
    assert fees["sale_total"] == 10 and [line["amount"] for line in fees["lines"]] == [1.36, 0.4, 8.24]
    assert fees["lines"][2]["method"].startswith("Free shipping for the buyer: you pay about $8.24")
    assert fees["left_before_ads"] == 0
    assert (budget["break_even_rate_pct"], budget["suggested_max_rate_pct"]) == (0, 0)
    assert budget["suggestion"] == "Suggestion: do not use Promoted Listings General at this price; nothing is left before ads."
    assert [s["left"] for s in fees["scenarios"]] == [-0.2, -0.5, -1.0]
    chart = charts.ebay_costs_chart(fees)
    assert chart["series"][0]["label"] == "Ad rate 2% (loss of $0.20)"
    assert chart["series"][0]["segments"][-1] == {"label": "What is left", "value": 0}
    assert chart["caption"] == "At a 5% ad rate, a loss of $0.50 of the $10.00 sale total is left before your own cost of the item."


def test_price_and_shipping_fall_back_to_listings_then_the_writer():
    listings = [{"price": 20.0, "currency": "USD", "shipping": 5.0}, {"price": 30.0, "currency": "USD", "shipping": 0},
                {"price": 90.0, "currency": "GBP", "shipping": 7.0}]
    fees, _, _ = ebay_report.fee_breakdown(inputs(), CARDS, {"ebay": {}}, listings)
    assert fees["price"] == 25.0 and fees["price_basis"] == "Middle asking price of 2 comparable active eBay listings (estimate)"
    assert fees["shipping_cost"] == 6.0 and fees["sale_total"] == 31.0
    assert "(middle shipping cost of 2 comparable listings)" in fees["lines"][2]["method"]
    assert fees["lines"][2]["method"].endswith("; assumes the buyer pays shipping")
    fees, _, _ = ebay_report.fee_breakdown(inputs(target_price_usd=40, shipping_cost_usd=7, shipping_method="USPS Ground"), CARDS, {}, [])
    assert fees["price_basis"] == "Estimated price; no target price was given" and fees["lines"][2]["method"].startswith(
        "The buyer pays $7.00 shipping (estimate: USPS Ground)")
    fees, _, _ = ebay_report.fee_breakdown(inputs(), CARDS, brief(shipping_cost_usd=None), [])
    assert fees["shipping_cost"] is None and fees["method"].endswith("Shipping is not included. " + ebay_report.AD_BASE_NOTE)
    assert ebay_report.fee_breakdown(inputs(), CARDS, {}, []) == (
        None, None, ["No target price was given and no comparable listing price was found, so eBay fees were not estimated."])


def test_ad_rates_are_clamped_to_ebays_range_and_deduped():
    fees, budget, _ = ebay_report.fee_breakdown(inputs(ad_rates_pct=[1, 2, 150, -3]), CARDS, brief(), [])
    assert [(s["label"], s["ad_rate_pct"]) for s in fees["scenarios"]] == [("Typical", 2)]
    fees, _, _ = ebay_report.fee_breakdown(inputs(ad_rates_pct=[1, 30], ad_rate_max_pct=20, ad_rate_card_ids=["ads"]), CARDS, brief(), [])
    assert [s["ad_rate_pct"] for s in fees["scenarios"]] == [2, 30]
    fees, _, _ = ebay_report.fee_breakdown(inputs(ad_rates_pct=[], ad_rate_card_ids=[]), CARDS, brief(), [])
    assert fees["scenarios"] == [] and charts.ebay_costs_chart(fees) is None


def test_ceiling_below_ebays_minimum_is_named():
    answers = brief(target_price_usd=12, shipping_cost_usd=None)
    fees, budget, _ = ebay_report.fee_breakdown(inputs(), CARDS, answers, [])
    assert budget["break_even_rate_pct"] == round((12 - 1.63 - 0.4) / 12 * 100, 1)
    many = brief(target_price_usd=11, buyer_pays_shipping=False, shipping_cost_usd=8.7)
    _, budget, _ = ebay_report.fee_breakdown(inputs(), CARDS, many, [])
    assert budget["suggested_max_rate_pct"] < 2 and budget["suggestion"].endswith("eBay's lowest ad rate is 2%, above this ceiling.")
    no_priority = inputs(priority={"text": " ", "kind": "assumption", "card_ids": [], "method": ""})
    _, budget, _ = ebay_report.fee_breakdown(no_priority, CARDS, brief(), [])
    assert budget["priority"] == {"text": ebay_report.PRIORITY_DEFAULT, "kind": "assumption", "card_ids": [], "method": ""}


def test_cited_listings_keep_sourced_api_cards_cheapest_first():
    evidence = {f"https://www.ebay.com/itm/{n}": {"item": {
        "title": f"Mug {n}", "price": price, "currency": currency, "shipping": None, "condition": "New",
        "url": f"https://www.ebay.com/itm/{n}", "image_url": "", "seller_feedback": 5, "buying_options": [],
        "retrieved_at": "2026-11-04T10:00:00Z", "quote_text": "q"}} for n, price, currency in [(1, 30, "USD"), (2, 12, "USD"), (3, 5, "GBP")]}
    cards = [card(f"c{n}", "q", url=f"https://www.ebay.com/itm/{n}", source_kind="ebay_api") for n in (1, 2, 3)]
    cards += [card("dupe", "q", url="https://www.ebay.com/itm/1", source_kind="ebay_api"),
              card("bad", "q", url="https://www.ebay.com/itm/2", source_kind="ebay_api", type="unverified")]
    listings = ebay_report.cited_listings(cards, evidence)
    assert [(item["title"], item["card_id"]) for item in listings] == [("Mug 2", "c2"), ("Mug 1", "c1"), ("Mug 3", "c3")]
    assert "quote_text" not in listings[0]
    chart = charts.asking_prices_chart(listings)
    assert chart["caption"] == ("Asking prices of active listings on Nov 4, 2026, not sold prices: 2 comparable eBay "
                                "listings ask $12 to $30; the middle asking price is $21.")
    assert [item["card_ids"] for item in chart["series"]] == [["c2"], ["c1"]]
    assert charts.asking_prices_chart([]) is None


def test_asking_wording_replaces_sold_price_phrases():
    doc = {"text": "Mugs sell for $30. One sold for $28 and it sells for less now. Selling for $40 works.",
           "card_ids": ["sell for"], "kind": "sourced", "items": [{"title": "Sells for $5"}]}
    fixed = ebay_report.asking_wording(doc)
    assert fixed["text"] == "Mugs are listed at $30. One was listed at $28 and it is listed at less now. Listed at $40 works."
    assert fixed["items"][0]["title"] == "Is listed at $5" and fixed["card_ids"] == ["sell for"]
