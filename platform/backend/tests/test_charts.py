import json

from app import charts


def card(card_id, quote, type="sourced"):
    return {"card_id": card_id, "quote": quote, "type": type}


CARDS = [
    card("a", "The large mug costs $54."),
    card("b", "Mugs from $28 to $40, depending on size."),
    card("c", "Prices start at $1,200 for a full set."),
    card("u", "A mug is $19.", type="unverified"),
]


def row(seller, price, high=None, ids=("a",), kind="sourced"):
    return {"cells": [seller, "Mug", "", ""], "kind": kind, "card_ids": list(ids), "price_usd": price, "price_high_usd": high}


def test_price_chart_is_a_bar_of_quoted_prices():
    doc = {"table": {"rows": [
        row("Clay Co", 54, ids=["a"]),
        row("Set Shop", 1200, ids=["c"]),
        row("Made up", 60, ids=["a"]),
        row("Assumed", 54, ids=["a"], kind="assumption"),
        row("Unverified", 19, ids=["u"]),
        row("No price", None, ids=["a"]),
    ]}, "price_band": None}
    [chart] = charts.price_charts(doc, CARDS)
    assert chart["id"] == "prices" and chart["type"] == "bar" and chart["unit"] == "USD" and chart["kind"] == "sourced"
    assert chart["series"] == [
        {"label": "Clay Co · Mug", "value": 54, "card_ids": ["a"]},
        {"label": "Set Shop · Mug", "value": 1200, "card_ids": ["c"]},
    ]
    assert chart["caption"] == "Quoted prices run from $54 to $1,200; the middle price is $627."


def test_price_chart_becomes_a_range_for_from_to_prices_and_adds_the_band():
    doc = {
        "table": {"rows": [row("Range Co", 28, 40, ids=["b"]), row("Clay Co", 54, ids=["a"]), row("Wrong high", 28, 99, ids=["b"])]},
        "price_band": {"low_usd": 50, "high_usd": 42, "method": "Between the two shops."},
    }
    prices, band = charts.price_charts(doc, CARDS)
    assert prices["type"] == "range"
    assert [(item["label"], item["low"], item["high"]) for item in prices["series"]] == [
        ("Range Co · Mug", 28, 40), ("Wrong high · Mug", 28, 28), ("Clay Co · Mug", 54, 54),
    ]
    assert band["id"] == "price_band" and band["kind"] == "estimate" and band["type"] == "range"
    assert band["series"] == [
        {"label": "Competitor prices", "value": 28, "low": 28, "high": 54, "card_ids": ["b", "a"]},
        {"label": "Your suggested price", "value": 42, "low": 42, "high": 50, "card_ids": []},
    ]
    assert band["caption"] == "A suggested price of $42 to $50, against quoted prices of $28 to $54."
    assert band["method"] == "Between the two shops."


def test_price_band_alone_and_no_charts_without_prices():
    [band] = charts.price_charts({"table": {"rows": []}, "price_band": {"low_usd": 30, "high_usd": 35, "method": ""}}, CARDS)
    assert len(band["series"]) == 1 and band["caption"] == "A suggested price of $30 to $35."
    assert charts.price_charts({"table": None, "price_band": None}, CARDS) == []


def budget_doc(projection):
    return {
        "budget": [
            {"item": "Instagram ads", "amount": 60, "kind": "estimate", "card_ids": ["a", "u"]},
            {"item": "Market stall fee", "amount": 40, "kind": "sourced", "card_ids": ["b"]},
            {"item": "Free samples", "amount": 0, "kind": "assumption", "card_ids": []},
        ],
        "projection": projection,
    }


def test_budget_chart_and_projection_method():
    projection = {
        "ad_spend_usd": 60, "cost_per_click_usd": 0.8, "conversion_low_pct": 4, "conversion_high_pct": 2,
        "average_order_usd": 30, "basis": "Click cost from the ads guide.", "card_ids": ["b", "missing"],
    }
    budget, forecast = charts.budget_charts(budget_doc(projection), CARDS)
    assert budget["id"] == "budget" and budget["kind"] == "estimate" and budget["unit"] == "USD"
    assert budget["series"] == [
        {"label": "Instagram ads", "value": 60, "card_ids": ["a"]},
        {"label": "Market stall fee", "value": 40, "card_ids": ["b"]},
    ]
    assert budget["caption"] == "Instagram ads is the largest line: $60 of $100."
    assert forecast["id"] == "projection" and forecast["kind"] == "estimate" and forecast["unit"] == "count"
    assert forecast["method"] == (
        "$60 ads ÷ $0.80 per click = 75 visits; × 2–4% conversion = 1.5–3 sales; "
        "× $30 average order = $45–$90 in sales. Click cost from the ads guide."
    )
    assert forecast["series"][0] == {"label": "Visits from ads", "value": 75, "low": 75, "high": 75, "card_ids": ["b"]}
    assert forecast["series"][1] == {"label": "Sales", "value": 2.2, "low": 1.5, "high": 3.0, "card_ids": ["b"]}
    assert forecast["caption"] == "With $60 of ads, expect about 75 visits and 1.5–3 sales in the first month."


def test_projection_caps_spend_at_the_budget_and_skips_bad_inputs():
    capped = charts.projection_chart(
        {"ad_spend_usd": 500, "cost_per_click_usd": 1, "conversion_low_pct": 1, "conversion_high_pct": 300,
         "average_order_usd": None, "basis": "", "card_ids": []},
        100, {},
    )
    assert capped["method"] == "$100 ads ÷ $1 per click = 100 visits; × 1–100% conversion = 1–100 sales."
    for bad in (None, {"ad_spend_usd": 60, "cost_per_click_usd": 0, "conversion_low_pct": 1, "conversion_high_pct": 2},
                {"ad_spend_usd": 60, "cost_per_click_usd": 1, "conversion_low_pct": None, "conversion_high_pct": 2},
                {"ad_spend_usd": -5, "cost_per_click_usd": 1, "conversion_low_pct": 1, "conversion_high_pct": 2}):
        assert charts.projection_chart(bad, 100, {}) is None
    assert [chart["id"] for chart in charts.budget_charts(budget_doc(None), CARDS)] == ["budget"]


def test_theme_counts_use_unique_sourced_cards():
    doc = {"themes": [
        {"label": "Buy as gifts", "card_ids": ["a", "b", "a", "u"]},
        {"label": "Complain about shipping", "card_ids": ["c", "a", "b"]},
        {"label": "Only unverified", "card_ids": ["u"]},
    ]}
    [chart] = charts.theme_charts(doc, CARDS)
    assert chart["kind"] == "sourced" and chart["unit"] == "count"
    assert [(item["label"], item["value"]) for item in chart["series"]] == [("Complain about shipping", 3), ("Buy as gifts", 2)]
    assert chart["caption"] == "“Complain about shipping” comes up most often: in 3 of 3 checked quotes."
    assert charts.theme_charts({"themes": []}, CARDS) == []


def test_checklist_steps_by_kind_is_a_stacked_bar():
    doc = {"checklist": [
        {"step": "Register", "kind": "sourced", "official": True, "card_ids": ["a"]},
        {"step": "Licence", "kind": "sourced", "official": True, "card_ids": ["a", "b"]},
        {"step": "Etsy rules", "kind": "sourced", "official": False, "card_ids": ["c"]},
        {"step": "Insurance", "kind": "assumption", "official": False, "card_ids": []},
    ]}
    [chart] = charts.checklist_charts(doc, CARDS)
    assert chart["type"] == "stacked_bar"
    assert chart["series"] == [
        {"label": "Official source", "value": 2, "card_ids": ["a", "b"]},
        {"label": "Other source", "value": 1, "card_ids": ["c"]},
        {"label": "Assumption", "value": 1, "card_ids": []},
    ]
    assert chart["caption"].startswith("2 of 4 steps cite an official source")


def test_build_charts_adds_coverage_last_and_skips_failures(monkeypatch):
    coverage = {"directions": 3, "pages_read": 7, "quotes_found": 9, "quotes_total": 12}
    result = charts.build_charts("market_check", {"themes": [{"label": "Gifts", "card_ids": ["a"]}]}, CARDS, coverage)
    assert [chart["id"] for chart in result] == ["themes", "coverage"]
    assert result[-1]["caption"] == "9 of 12 quotes were found word for word on the 7 pages read."
    assert [item["value"] for item in result[-1]["series"]] == [7, 12, 9]

    def broken(doc, cards):
        raise KeyError("missing")

    monkeypatch.setitem(charts.FEATURE_CHARTS, "competitor_scan", [broken])
    assert [chart["id"] for chart in charts.build_charts("competitor_scan", {}, CARDS, coverage)] == ["coverage"]
    for feature in ("marketing_plan", "launch_checklist", "unknown"):
        assert charts.build_charts(feature, {}, CARDS, coverage)[-1]["id"] == "coverage"


def test_every_chart_has_the_spec_fields_and_is_strict_json():
    doc = {**budget_doc({"ad_spend_usd": 60, "cost_per_click_usd": 0.8, "conversion_low_pct": 2, "conversion_high_pct": 4,
                         "average_order_usd": None, "basis": "", "card_ids": []}),
           "price_band": {"low_usd": float("nan"), "high_usd": 40, "method": ""}, "table": {"rows": [row("X", float("inf"))]}}
    built = charts.budget_charts(doc, CARDS) + charts.price_charts(doc, CARDS)
    for chart in built:
        assert set(chart) == {"id", "type", "title", "caption", "unit", "kind", "series", "method"}
        assert chart["type"] in {"bar", "stacked_bar", "range"} and chart["unit"] in {"USD", "count", "%"}
        assert chart["kind"] in {"sourced", "estimate"}
    json.dumps(built, allow_nan=False)
