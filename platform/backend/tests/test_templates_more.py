"""v4.1: Food truck, Restaurant / café, Daycare / childcare and Etsy seller templates (no network)."""

import copy
import hashlib
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app import capabilities, charts, claude, etsy_report, intake, local_report, pipeline, store, templates
from app.capabilities.local import is_official
from ebay_fake import ebay_keys  # noqa: F401  (fixture)
from helpers import BRIEF, body, lambda_client, request, signed_in
from test_modes import FakeClaude

NEW = ["food_truck", "restaurant", "daycare", "etsy"]
GENERAL_BRIEF = {key: value for key, value in BRIEF.items() if key != "feature"}


# ---------- Registry, GET /api/templates and chat ----------

def test_registry_has_the_four_building_blocks_without_keys():
    labels = {cid: capabilities.get(cid).label for cid in
              ("official_requirements", "local_benchmarks", "startup_costs", "etsy_fees")}
    assert labels == {"official_requirements": "Checks permits from official pages",
                      "local_benchmarks": "Compares nearby businesses",
                      "startup_costs": "Estimates startup costs",
                      "etsy_fees": "Estimates Etsy fees and ad costs"}
    for cid in labels:
        capability = capabilities.get(cid)
        assert capability.available() == (True, None) and capability.tool_definitions == [] and capability.run is None
    # No client tools: research agents of these templates use web search and fetch only.
    for template_id in NEW:
        assert not capabilities.Toolbox(templates.TEMPLATES[template_id]["capabilities"], "run")


def test_templates_api_lists_six_all_available(ebay_keys):
    listed = body(request("/api/templates", session=signed_in()))
    assert [t["id"] for t in listed] == ["general", "ebay", *NEW]
    assert [t["name"] for t in listed] == ["General", "eBay seller", "Food truck", "Restaurant / café",
                                           "Daycare / childcare", "Etsy seller"]
    assert all(t["available"] and t["unavailable_reason"] is None for t in listed)
    assert all(t["tools"] == templates.FEATURE_IDS and t["description"] for t in listed)
    caps = {t["id"]: [c["label"] for c in t["capabilities"]] for t in listed}
    assert caps["food_truck"] == caps["restaurant"] == caps["daycare"] == [
        "Checks permits from official pages", "Compares nearby businesses", "Estimates startup costs"]
    assert caps["etsy"] == ["Estimates Etsy fees and ad costs"]


def test_new_templates_work_without_any_keys(aws, monkeypatch):
    session = signed_in()
    seen = []
    monkeypatch.setattr(intake, "chat", lambda conv, message: seen.append(conv) or {
        "reply": "Ready.", "ready": True, "brief": copy.deepcopy(GENERAL_BRIEF)})
    reply = body(request("/api/chat", "POST", {"message": "A taco truck", "feature": "launch_checklist",
                                               "template": "food_truck"}, session))
    assert reply["template"] == "food_truck" and reply["brief"]["template"] == "food_truck"
    assert seen[0]["template"] == "food_truck"
    client = lambda_client(monkeypatch)
    run = body(request("/api/runs", "POST", {"conv_id": reply["conv_id"]}, session))["run"]
    assert run["template"] == "food_truck" and store.get_run(run["run_id"])["template"] == "food_truck"
    client.invoke.assert_called_once()


# ---------- Intake ----------

NEEDS = {
    "food_truck": ["the city and state, the cuisine, where they plan to sell", "own the truck"],
    "restaurant": ["the city and neighbourhood, the number of seats", "serve alcohol"],
    "daycare": ["home-based or a center, the age groups", "planned number of children"],
    "etsy": ["the product type, its size and material, the price they want to ask", "who pays shipping"],
}


@pytest.mark.parametrize("template_id", NEW)
def test_intake_prompt_adds_each_templates_needs_within_three_questions(template_id, monkeypatch):
    template = templates.TEMPLATES[template_id]
    prompt = intake.system_prompt(intake.FEATURES["marketing_plan"], template)
    assert f'template "{template["name"]}"' in prompt and "same limit of three questions in total" in prompt
    assert all(need in prompt for need in NEEDS[template_id])
    field = next(iter(template["brief_fields"]))
    assert f"brief's {field} fields" in prompt
    if template_id != "etsy":
        assert "known_costs" in prompt and "do not ask for costs just to fill it" in prompt
    if template_id == "daycare":
        assert "Never ask for or record anything about specific children or families" in prompt
    # The project brief is still reused, so a project needs fewer questions.
    assert "do not ask for it again" in intake.system_prompt(intake.FEATURES["marketing_plan"], template, "Brief: tacos")

    seen = {}
    answers = {key: None for key in template["brief_fields"][field]["properties"]}
    if "known_costs" in answers:
        answers["known_costs"] = [{"item": "Truck quote", "amount_usd": 45000}]

    def json_call(usage, *, system, prompt, schema, effort, messages, cache):
        seen.update(schema=schema)
        return {"reply": "Ready.", "ready": True, "brief": {**GENERAL_BRIEF, field: answers}}

    monkeypatch.setattr(claude, "json_call", json_call)
    out = intake.chat({"feature": "marketing_plan", "template": template_id, "messages": []}, "Hello")
    assert out["brief"]["template"] == template_id and out["brief"][field] == answers
    brief_schema = seen["schema"]["properties"]["brief"]["anyOf"][0]
    assert field in brief_schema["required"]
    assert set(brief_schema["properties"][field]["required"]) == set(answers)


# ---------- General and eBay unchanged ----------

EBAY_ANSWERS = {"category": "Mugs", "example_listing": None, "condition": "new", "target_price_usd": 45,
                "buyer_pays_shipping": True, "shipping_cost_usd": 8, "sells_on_ebay": False}
FINGERPRINT_BRIEF = {"business": "Mugs", "customer": "Gift buyers", "location": "Portland, Oregon", "stage": "markets",
                     "budget_usd": 200, "goal": "Price", "questions": ["What do mugs cost?"]}
# Digests of every General and eBay prompt, schema and template field taken before v4.1 was added. Update them only
# when General or eBay is meant to change.
FINGERPRINTS = {"general": "4fef6eedf8c35218de5c92185ff8246303473d4127b1b1b88f8065c30ee3aeb3",
                "ebay": "4937edf0250c5848e858f6dd45e58b45ae004cacbbb3be3cb341046ffde7b421"}


def fingerprint(template_id):
    t = templates.TEMPLATES[template_id]
    parts = {"template": {k: t[k] for k in ("id", "name", "description", "tools", "capabilities", "intake_needs",
                                              "source_rules", "brief_fields", "research", "writer")},
             "reply_schema": intake.reply_schema(t)}
    for feature, spec in intake.FEATURES.items():
        brief = {**FINGERPRINT_BRIEF, "feature": feature}
        if template_id == "ebay":
            brief = {**brief, "template": "ebay", "ebay": EBAY_ANSWERS}
        parts[feature] = {
            "intake": intake.system_prompt(spec, t),
            "intake_project": intake.system_prompt(spec, t, "Project context"),
            "schema": pipeline.report_schema(feature, template_id),
            "brief_text": pipeline.brief_text(brief),
            "notes_research": pipeline.template_notes(brief, "research"),
            "notes_writer": pipeline.template_notes(brief, "writer"),
        }
    return hashlib.sha256(json.dumps(parts, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


@pytest.mark.parametrize("template_id", ["general", "ebay"])
def test_general_and_ebay_prompts_and_schemas_are_unchanged(template_id):
    assert fingerprint(template_id) == FINGERPRINTS[template_id]
    for feature in templates.FEATURE_IDS:
        props = pipeline.report_schema(feature, template_id)["properties"]
        assert not {"requirements", "startup_costs", "etsy_fees"} & set(props)
        assert "price_unit" not in json.dumps(props)


# ---------- official_requirements ----------

def card(card_id, quote, url, type="sourced", **fields):
    return {"card_id": card_id, "quote": quote, "url": url, "type": type, "source_title": card_id,
            "captured_at": "2026-11-04T10:00:00Z", **fields}


@pytest.mark.parametrize(("url", "official"), [
    ("https://kingcounty.gov/en/dept/dph/food", True),
    ("https://www.seattle.gov/business-licenses", True),
    ("https://dcyf.wa.gov/services/child-dev-support-providers/licensing", True),
    ("https://www.ci.minneapolis.mn.us/licensing", True),
    ("https://www.co.marin.ca.us/health", True),
    ("https://dshs.state.tx.us/food", True),
    ("https://www.myflorida.com/licensing", True),
    ("https://sunbiz.org/register", True),
    ("https://foodtruckblog.example/permits", False),
    ("https://permits.us/food-truck", False),
    ("https://seattle.gov.evil.example/permit", False),
    ("https://www.etsy.com/legal/fees/", False),
    ("", False),
])
def test_official_pages_are_government_or_listed_state_run_domains(url, official):
    assert is_official(url) is official


RUN_CARDS = [
    card("permit", "Mobile food units need a mobile food unit permit. The annual permit fee is $802.50.",
         "https://kingcounty.gov/food/mobile"),
    card("blog", "Every truck needs a street use permit for each location.", "https://foodtruckblog.example/permits"),
    card("license", "You need a business license to operate a food truck in the city.", "https://www.seattle.gov/licenses"),
    card("gov-unverified", "Food trucks need a fire inspection.", "https://www.seattle.gov/fire", type="unverified"),
]


def requirement(name, ids, kind="sourced", **fields):
    return {"requirement": name, "agency": fields.pop("agency", "King County"), "text": f"Get the {name}.",
            "kind": kind, "card_ids": ids, "method": "", "fee_usd": None, "fee_card_ids": [], **fields}


def test_a_requirement_from_a_non_government_page_becomes_an_assumption():
    items = [
        requirement("Mobile food unit permit", ["permit"], fee_usd=802.5, fee_card_ids=["permit"]),
        requirement("Street use permit", ["blog"], agency="Seattle Department of Transportation"),
        requirement("Business licence", ["license"], fee_usd=55, fee_card_ids=["license"]),
        requirement("Fire inspection", ["gov-unverified"], agency=""),
        requirement("Event vendor fees", [], kind="assumption", agency="Event organisers"),
        requirement("Earlier report's permit", ["earlier"]),
    ]
    section, missing = local_report.requirements(items, RUN_CARDS)
    assert section["title"] == "Requirements to check"
    assert section["note"] == "A checklist built from official pages. Confirm each item with the agency; this is not legal advice."
    by_name = {item["requirement"]: item for item in section["items"]}
    permit = by_name["Mobile food unit permit"]
    assert (permit["kind"], permit["official"], permit["card_ids"]) == ("sourced", True, ["permit"])
    assert (permit["fee_usd"], permit["fee_card_ids"]) == (802.5, ["permit"])
    assert permit["url"] == "https://kingcounty.gov/food/mobile" and permit["captured_at"] == "2026-11-04T10:00:00Z"
    street = by_name["Street use permit"]
    assert (street["kind"], street["official"]) == ("assumption", False)
    assert street["method"] == "Not confirmed on an official page in this run. Check with Seattle Department of Transportation."
    assert street["url"] == "https://foodtruckblog.example/permits"  # the page it was read on, not marked official
    licence = by_name["Business licence"]
    assert licence["kind"] == "sourced" and licence["fee_usd"] is None  # the quote states no $55 fee
    fire = by_name["Fire inspection"]
    assert fire["kind"] == "assumption" and fire["url"] is None and fire["method"].endswith(
        "Check with the city, county or state office.")
    assert by_name["Earlier report's permit"]["kind"] == "assumption"  # not fetched in this run
    assert section["official_count"] == 2
    assert missing == ["4 of 6 requirements could not be confirmed on an official government page in this run; check "
                       "them with the agency named.",
                       'The fee for "Business licence" was not stated on a page checked in this run, so it is left out.']
    chart = charts.requirements_chart(section)
    assert [(s["label"], s["value"]) for s in chart["series"]] == [("Confirmed on an official page", 2),
                                                                  ("Check with the agency", 4)]
    assert local_report.requirements([], RUN_CARDS) == (None, [])


# ---------- local_benchmarks ----------

MENU_CARDS = {c["card_id"]: c for c in [
    card("taco", "Carne asada taco $4.50. Burrito $12.", "https://taco-uno.example/menu",
         captured_at="2026-11-03T18:00:00Z"),
    card("bowl", "Rice bowls from $11 to $14. Rated 4.7 stars on our site.", "https://bowl-truck.example/menu"),
    card("drink", "Agua fresca $4.", "https://taco-uno.example/drinks"),
]}


def row(seller, product, price, ids, high=None, unit="per item", kind="sourced", notes=""):
    return {"cells": [seller, product, f"${price}", notes], "kind": kind, "card_ids": ids, "price_usd": price,
            "price_high_usd": high, "price_unit": unit}


BENCH = {"title": "Prices nearby", "what": "menu prices", "source": "nearby food trucks' own menus"}


def test_benchmark_chart_comes_only_from_sourced_cards_that_state_the_price():
    doc = {"table": {"rows": [
        row("Taco Uno", "Burrito", 12, ["taco"], notes="Busy at lunch; 4.9 stars, 300 reviews"),
        row("Bowl Truck", "Rice bowl", 11, ["bowl"], high=14, notes="Rated 4.7 stars"),
        row("Taco Uno", "Taco", 4.5, ["taco"]),
        row("Taco Uno", "Agua fresca", 4, ["drink"], unit="per drink"),
        row("Made up", "Taco", 3, ["taco"]),                    # $3 is not in the quote
        row("Guess", "Taco", 5, ["taco"], kind="assumption"),   # not sourced
        row("Unknown card", "Taco", 5, ["nope"]),               # not a sourced card
        row("No price", "Taco", None, ["taco"]),
    ]}}
    section, missing = local_report.benchmarks(doc, MENU_CARDS, BENCH)
    assert [(i["business"], i["item"], i["price"], i["price_high"]) for i in section["items"]] == [
        ("Taco Uno", "Agua fresca", 4, None), ("Taco Uno", "Taco", 4.5, None), ("Bowl Truck", "Rice bowl", 11, 14),
        ("Taco Uno", "Burrito", 12, None)]
    burrito = section["items"][-1]
    assert burrito["notes"] == "" and burrito["url"] == "https://taco-uno.example/menu"  # unstated rating dropped
    assert burrito["retrieved_at"] == "2026-11-03T18:00:00Z" and burrito["card_ids"] == ["taco"]
    assert section["items"][2]["notes"] == "Rated 4.7 stars"  # the quote states it
    assert missing == ["3 prices in the table could not be checked against a quote on the cited page, so they are "
                       "left out of Prices nearby."]
    chart = charts.price_benchmarks_chart(section)
    assert chart["id"] == "price_benchmarks" and chart["kind"] == "sourced" and chart["type"] == "range"
    assert [(s["label"], s["low"], s["high"]) for s in chart["series"]] == [
        ("Taco Uno · Taco", 4.5, 4.5), ("Bowl Truck · Rice bowl", 11, 14), ("Taco Uno · Burrito", 12, 12)]
    assert all(set(s["card_ids"]) <= set(MENU_CARDS) for s in chart["series"])
    assert chart["caption"] == ("Menu prices per item from nearby food trucks' own menus, retrieved Nov 3, 2026 and "
                                "Nov 4, 2026: 3 prices from $4.50 to $14; the middle is $11. 1 price for another unit "
                                "is in the table only.")
    assert local_report.benchmarks({"table": {"rows": [row("Guess", "Taco", 5, ["taco"], kind="assumption")]}},
                                   MENU_CARDS, BENCH)[0] is None


def test_daycare_benchmarks_never_carry_notes():
    tuition = {"t": card("t", "Infant care: $1,650 per month. Parents say Maya loves it here.", "https://sunny.example/tuition")}
    doc = {"table": {"rows": [row("Sunny Days", "Infant, full time", 1650, ["t"], unit="per month", notes="Maya's parents love it")]}}
    section, _ = local_report.benchmarks(doc, tuition, {"title": "Prices nearby", "what": "tuition"}, privacy=True)
    assert section["items"][0]["notes"] == "" and section["items"][0]["price"] == 1650
    assert charts.price_benchmarks_chart(section)["title"] == "Tuition nearby"


# ---------- startup_costs ----------

COST_LINES = ["Truck (buy or lease)", "Kitchen equipment", "Permits and licences", "Insurance", "First inventory"]
COST_CARDS = {c["card_id"]: c for c in [
    card("truck", "Used food trucks are listed from $45,000 to $90,000.", "https://trucks.example/used"),
    card("fryer", "Commercial fryer: $1,299.", "https://kitchen.example/fryer"),
    card("permit", "The annual mobile food unit permit fee is $802.50.", "https://kingcounty.gov/food/mobile"),
]}


def cost(category, item, low, high=None, basis="source", ids=(), method=""):
    return {"category": category, "item": item, "low_usd": low, "high_usd": high, "basis": basis, "card_ids": list(ids),
            "method": method}


def test_startup_costs_are_ranges_from_sources_and_founder_figures_and_name_missing_lines():
    lines = [
        cost("Truck (buy or lease)", "Used truck", 45000, 90000, ids=["truck"], method="Used truck listings."),
        cost("Kitchen equipment", "Fryer", 1299, ids=["fryer"]),
        cost("Kitchen equipment", "Generator", 2500, basis="founder"),
        cost("Permits and licences", "Health permit", 802.5, ids=["permit"]),
        cost("Insurance", "Liability insurance", 2000, 4000, ids=["permit"]),      # not stated anywhere
        cost("Other", "Wrap and signs", 3000, basis="founder"),                     # no such founder figure
        cost("Kitchen equipment", "Flat-top grill", 2200, 9999, ids=["fryer"]),     # not stated
    ]
    answers = {"known_costs": [{"item": "Generator quote", "amount_usd": 2500}]}
    section, missing = local_report.startup_costs(lines, COST_LINES, COST_CARDS, answers)
    assert [(l["item"], l["low"], l["high"], l["basis"]) for l in section["lines"]] == [
        ("Used truck", 45000, 90000, "source"), ("Generator", 2500, 2500, "founder"), ("Fryer", 1299, 1299, "source"),
        ("Health permit", 802.5, 802.5, "source")]
    assert all(l["kind"] == "estimate" for l in section["lines"])
    assert section["lines"][1]["method"] == "Your own figure from the brief: $2,500.00." and section["lines"][1]["card_ids"] == []
    assert section["lines"][0]["method"] == "Used truck listings. Checked quote: $45,000.00 to $90,000.00."
    assert (section["sum_low"], section["sum_high"]) == (49601.5, 94601.5)
    assert (section["total_low"], section["total_high"]) == (49000, 95000)  # rounded outward, never one number
    assert section["missing_lines"] == ["Insurance", "First inventory"]
    assert section["method"].startswith("Total = $49,601.50 (the low ends added up) to $94,601.50 (the high ends added "
                                        "up), rounded outward to the nearest $1,000: about $49,000 to $95,000.")
    assert section["method"].endswith("Not included: insurance, first inventory.")
    assert missing == [
        "No checked source or figure of yours gave a cost for insurance, so it is left out of the startup costs.",
        "No checked source or figure of yours gave a cost for first inventory, so it is left out of the startup costs.",
        "The cost of wrap and signs could not be checked against a quote or your own figures, so it is left out of the startup costs.",
        "The cost of flat-top grill could not be checked against a quote or your own figures, so it is left out of the startup costs.",
    ]
    chart = charts.startup_costs_chart(section)
    assert chart["id"] == "startup_costs" and chart["kind"] == "estimate" and chart["type"] == "range"
    assert [s["label"] for s in chart["series"]] == ["Used truck", "Generator", "Fryer", "Health permit"]  # ranked
    assert chart["caption"] == ("The checked lines add up to about $49,000 to $95,000; the largest is used truck ($45,000 "
                                "to $90,000). Not included: insurance, first inventory.")


def test_startup_total_is_a_range_even_when_every_line_is_one_number():
    section, _ = local_report.startup_costs([cost("Permits and licences", "Permit", 800, ids=["permit"]) | {"low_usd": 802.5}],
                                            COST_LINES, COST_CARDS, {})
    assert (section["total_low"], section["total_high"]) == (800, 810)
    exact = {"p": card("p", "The permit costs $500.", "https://kingcounty.gov/p")}
    section, _ = local_report.startup_costs([cost("Permits and licences", "Permit", 500, ids=["p"])], COST_LINES, exact, {})
    assert (section["total_low"], section["total_high"]) == (500, 510)
    assert charts.startup_costs_chart(section)["type"] == "bar"
    assert local_report.startup_costs([cost("Insurance", "Insurance", 900)], COST_LINES, COST_CARDS, {})[0] is None


# ---------- etsy_fees ----------

ETSY_FEES = "https://www.etsy.com/legal/fees/"
OFFSITE = "https://help.etsy.com/hc/en-us/articles/offsite-ads"
ETSY_CARDS = [
    card("listing", "The listing fee is $0.20 for each listing.", ETSY_FEES),
    card("transaction", "Transaction fees are 6.5% of the price you display plus delivery and gift wrapping.", ETSY_FEES),
    card("processing", "Payment processing fees in the United States are 3% + $0.25.", ETSY_FEES),
    card("offsite", "If your shop made less than $10,000 in the past 365 days the Offsite Ads fee is 15%; at $10,000 or "
                    "more it is 12%. You will never pay more than $100 in Offsite Ads fees for a single order.", OFFSITE),
    card("blog", "Etsy takes 6.5% of every sale.", "https://sellerblog.example/etsy-fees"),
    card("listing-page", "Ceramic mug 6.5 oz — $34.00", "https://www.etsy.com/listing/123/mug"),
    card("uk", "Transaction fees are 6.5%.", "https://www.etsy.co.uk/legal/fees"),
    card("unverified", "Transaction fees are 6.5%.", ETSY_FEES, type="unverified"),
]


def etsy_inputs(**fields):
    return {
        "listing_fee_usd": 0.2, "listing_fee_card_ids": ["listing"],
        "transaction_fee_pct": 6.5, "transaction_fee_card_ids": ["transaction"],
        "processing_fee_pct": 3, "processing_fee_fixed_usd": 0.25, "processing_fee_card_ids": ["processing"],
        "offsite_ads": [{"label": "Shops under $10,000 a year", "rate_pct": 15, "card_ids": ["offsite"]},
                        {"label": "Shops at $10,000 or more", "rate_pct": 12, "card_ids": ["offsite"]}],
        "offsite_ads_cap_usd": 100, "offsite_ads_cap_card_ids": ["offsite"],
        "target_price_usd": None, "shipping_cost_usd": None, "buyer_pays_shipping": None, "shipping_method": "",
        "etsy_ads": {"text": "Etsy Ads are charged per click.", "kind": "assumption", "card_ids": [], "method": ""},
        **fields,
    }


def etsy_brief(**answers):
    return {"etsy": {"product_type": "Mug", "size_material": "12 oz stoneware", "target_price_usd": 30,
                     "buyer_pays_shipping": True, "shipping_cost_usd": 6, **answers}}


def test_etsy_fee_breakdown_and_offsite_ads_scenarios():
    fees, missing = etsy_report.fee_breakdown(etsy_inputs(), ETSY_CARDS, etsy_brief())
    assert missing == [] and fees["complete"] is True
    assert (fees["price"], fees["sale_total"], fees["price_basis"]) == (30, 36, "Your target price")
    assert [(l["item"], l["rate_pct"], l["amount"], l["card_ids"]) for l in fees["lines"]] == [
        ("Listing fee", None, 0.2, ["listing"]), ("Transaction fee", 6.5, 2.34, ["transaction"]),
        ("Payment processing fee", 3, 1.33, ["processing"]), ("Shipping label", None, 6.0, [])]
    assert fees["lines"][2]["method"] == "3% × $36.00 + $0.25 = $1.33"
    assert fees["left_before_ads"] == 26.13
    assert fees["method"].startswith("Sale total = $30.00 price + $6.00 shipping paid by the buyer. What is left = $36.00 "
                                     "sale total − $0.20 listing fee − $2.34 transaction fee − $1.33 payment processing "
                                     "fee − $6.00 shipping label = $26.13")
    assert [(s["label"], s["ad_rate_pct"], s["ad_fee"], s["left"]) for s in fees["scenarios"]] == [
        ("Order not from an Offsite Ad", 0, 0, 26.13), ("Shops under $10,000 a year", 15, 5.4, 20.73),
        ("Shops at $10,000 or more", 12, 4.32, 21.81)]
    assert fees["scenarios"][1]["method"] == "15% × $36.00 = $5.40 Offsite Ads fee; $26.13 − $5.40 = $20.73 left"
    assert fees["summary"]["text"] == ("At $30.00, about $26.13 of the $36.00 sale total is left before your own cost of "
                                       "the item; an order from an Offsite Ad at 15% leaves $20.73.")
    assert fees["etsy_ads"]["text"] == "Etsy Ads are charged per click." and fees["offsite_ads_cap"] == 100
    chart = charts.etsy_costs_chart(fees)
    assert chart["id"] == "etsy_costs" and chart["type"] == "stacked_bar" and chart["kind"] == "estimate"
    assert [segment["label"] for segment in chart["series"][1]["segments"]] == [
        "Listing fee", "Transaction fee", "Processing fee", "Shipping", "Offsite Ads fee", "What is left"]
    assert chart["caption"] == ("Of the $36.00 sale total, $26.13 is left before your own cost of the item; an order from "
                                "an Offsite Ad at 15% leaves $20.73.")
    json.dumps([fees, chart], allow_nan=False)


def test_etsy_zero_margin_and_the_offsite_ads_cap():
    fees, _ = etsy_report.fee_breakdown(etsy_inputs(), ETSY_CARDS,
                                        etsy_brief(target_price_usd=10, buyer_pays_shipping=False, shipping_cost_usd=8.6))
    assert fees["sale_total"] == 10 and [l["amount"] for l in fees["lines"]] == [0.2, 0.65, 0.55, 8.6]
    assert fees["left_before_ads"] == 0
    assert [s["left"] for s in fees["scenarios"]] == [0, -1.5, -1.2]
    assert fees["summary"]["text"] == ("At $10.00, nothing is left before your own cost of the item: fees and shipping take "
                                       "the whole sale total, and an order that comes through an Offsite Ad would lose money.")
    chart = charts.etsy_costs_chart(fees)
    assert chart["series"][1]["label"] == "Shops under $10,000 a year (loss of $1.50)"
    assert chart["series"][1]["segments"][-1] == {"label": "What is left", "value": 0}
    assert chart["caption"] == ("Of the $10.00 sale total, $0.00 is left before your own cost of the item; an order from "
                                "an Offsite Ad at 15% leaves a loss of $1.50.")
    big, _ = etsy_report.fee_breakdown(etsy_inputs(), ETSY_CARDS, etsy_brief(target_price_usd=1000, shipping_cost_usd=None))
    assert big["scenarios"][1]["ad_fee"] == 100 and "capped at $100.00" in big["scenarios"][1]["method"]
    assert "offsite" in big["scenarios"][1]["card_ids"]


@pytest.mark.parametrize("ids", [["blog"], ["listing-page"], ["uk"], ["unverified"], ["missing"], []])
def test_etsy_rates_count_only_from_etsy_com_help_pages_that_state_them(ids):
    fees, missing = etsy_report.fee_breakdown(etsy_inputs(transaction_fee_card_ids=ids), ETSY_CARDS, etsy_brief())
    assert "Transaction fee" not in [line["item"] for line in fees["lines"]]
    assert fees["complete"] is False and charts.etsy_costs_chart(fees) is None
    assert missing == ["Etsy's transaction fee rate was not found on an etsy.com page in this run, so it is left out of "
                       "the cost breakdown."]
    assert fees["summary"]["text"].endswith("Some Etsy fees could not be checked, so the real amount left is lower.")


def test_etsy_unchecked_numbers_are_left_out_and_named():
    fees, missing = etsy_report.fee_breakdown(
        etsy_inputs(processing_fee_fixed_usd=0.3, offsite_ads=[{"label": "Tier", "rate_pct": 20, "card_ids": ["offsite"]}],
                    etsy_ads={"text": " ", "kind": "sourced", "card_ids": [], "method": ""}),
        ETSY_CARDS, etsy_brief())
    assert fees["lines"][2]["amount"] == 1.08 and fees["scenarios"] == []
    assert missing == ["Etsy's fixed payment processing fee per order was not found on an etsy.com page in this run, so "
                       "only the percentage is included.",
                       "An Offsite Ads fee rate was not found on an etsy.com page in this run, so that scenario is left out."]
    assert fees["etsy_ads"] == {"text": etsy_report.ETSY_ADS_DEFAULT, "kind": "assumption", "card_ids": [], "method": ""}
    assert etsy_report.fee_breakdown(etsy_inputs(), ETSY_CARDS, {"etsy": {}}) == (None, [etsy_report.NO_PRICE])
    fees, _ = etsy_report.fee_breakdown(etsy_inputs(), ETSY_CARDS, {"etsy": {}}, [{"price": 20}, {"price": 30}])
    assert fees["price"] == 25 and fees["price_basis"] == "Middle asking price of 2 comparable Etsy listings (estimate)"


# ---------- Full runs with fake agents ----------

def fetched(url, title, page_text):
    document = SimpleNamespace(title=title, source=SimpleNamespace(type="text", data=page_text))
    return SimpleNamespace(type="web_fetch_tool_result", content=SimpleNamespace(
        type="web_fetch_result", url=url, retrieved_at="2026-11-04T09:00:00Z", content=document))


class TemplateAgents(FakeClaude):
    """The first research direction reads the given pages and reports the given FINDINGs; the writer answers with
    `doc(card_id_for)`, where card_id_for(part) is the id of the card whose quote contains that text."""

    def __init__(self, pages, findings, doc):
        super().__init__()
        self.pages, self.findings, self.doc = pages, findings, doc
        self.prompts = []

    def research_call(self, usage, *, system, prompt, model=None, max_fetches=3, **kwargs):
        self.research_calls.append({"system": system, "prompt": prompt, "kwargs": kwargs})
        if "Your research direction: Direction 0" not in prompt:
            return [SimpleNamespace(type="text", text="Nothing new here.")]
        lines = [f'FINDING | {claim} | "{quote}" | {url}' for claim, quote, url in self.findings]
        return [fetched(url, title, page_text) for url, (title, page_text) in self.pages.items()] + [
            SimpleNamespace(type="text", text="\n".join(lines))]

    def report(self, prompt):
        cards = json.loads(prompt.split("Checked fact cards (JSON):\n", 1)[1].split("\n\n", 1)[0])
        self.prompts.append(prompt)

        def card_id_for(part):
            return next(card["id"] for card in cards if part in card["quote"])
        first = cards[0]["id"]
        item = {"kind": "sourced", "card_ids": [first], "method": ""}
        doc = {
            "takeaway": {"text": "The checked pages give a first picture; confirm the rest with the people named.", **item},
            "findings": [{"title": f"Checked finding {i}", "text": "Similar items sell for about $30.", **item} for i in range(3)],
            "next_steps": [{"text": "Call the agency", "how": "Ask about the permit"}] * 3,
            "missing_evidence": ["No sales numbers"],
        }
        doc.update(self.doc(card_id_for))
        return doc


@pytest.fixture
def template_run(aws, monkeypatch):
    def start(template_id, feature, answers, pages, findings, doc):
        agents = TemplateAgents(pages, findings, doc)
        monkeypatch.setattr(claude, "research_call", agents.research_call)
        monkeypatch.setattr(claude, "json_call", agents.json_call)
        monkeypatch.setattr(pipeline, "fetch_page", Mock(return_value=None))
        field = next(iter(templates.TEMPLATES[template_id]["brief_fields"]))
        brief = {**copy.deepcopy(BRIEF), "feature": feature, "template": template_id, field: answers}
        run = store.create_run("founder", "conversation", "Test", brief)
        pipeline.run(run["run_id"])
        meta = store.get_run(run["run_id"])
        assert meta["status"] == "done", meta.get("error")
        result = store.load_result(run["run_id"])
        json.dumps(result, allow_nan=False)
        return result, agents
    return start


KING = "https://kingcounty.gov/en/dept/dph/food/mobile-food"
SEATTLE = "https://www.seattle.gov/business-licenses"
BLOG = "https://foodtruckblog.example/seattle"
FOOD_TRUCK_PAGES = {
    KING: ("Mobile food units | King County", "Mobile food units need a mobile food unit permit before operating. The annual "
           "permit fee is $802.50. Every mobile food unit must operate from an approved commissary kitchen."),
    SEATTLE: ("Business licenses | Seattle.gov", "You need a Seattle business license to operate a food truck in the city."),
    BLOG: ("Seattle food truck rules", "Street vending in Seattle requires a street use permit for each location."),
}
FOOD_TRUCK_FINDINGS = [
    ("Mobile food unit permit", "Mobile food units need a mobile food unit permit before operating. The annual permit fee is $802.50.", KING),
    ("Commissary", "Every mobile food unit must operate from an approved commissary kitchen.", KING),
    ("Business licence", "You need a Seattle business license to operate a food truck in the city.", SEATTLE),
    ("Street use", "Street vending in Seattle requires a street use permit for each location.", BLOG),
    ("Fire", "Food trucks need an annual fire inspection by the fire marshal.", SEATTLE),
]


def test_food_truck_launch_checklist_gives_requirements_to_check(template_run):
    def doc(cid):
        return {"requirements": [
            requirement("Mobile food unit permit", [cid("mobile food unit permit")], agency="Public Health – Seattle & King County",
                        fee_usd=802.5, fee_card_ids=[cid("mobile food unit permit")]),
            requirement("Commissary kitchen agreement", [cid("commissary")], agency="Public Health – Seattle & King County"),
            requirement("Seattle business licence", [cid("business license")], agency="City of Seattle"),
            requirement("Street use permit", [cid("street use")], agency="Seattle Department of Transportation"),
            requirement("Fire inspection", [], kind="assumption", agency="Seattle Fire Department"),
        ]}
    answers = {"city": "Seattle", "state": "WA", "cuisine": "Tacos", "selling_spots": "Office parks", "truck": "rent",
               "known_costs": [{"item": "Truck rental", "amount_usd": 2500}]}
    result, agents = template_run("food_truck", "launch_checklist", answers, FOOD_TRUCK_PAGES, FOOD_TRUCK_FINDINGS, doc)
    assert (result["version"], result["template"]) == (4, "food_truck")
    assert result["checklist"] == [] and result["benchmarks"] is None and result["startup_costs"] is None
    section = result["requirements"]
    assert section["note"] == templates.NOT_LEGAL_ADVICE
    assert [(i["requirement"], i["kind"], i["official"]) for i in section["items"]] == [
        ("Mobile food unit permit", "sourced", True), ("Commissary kitchen agreement", "sourced", True),
        ("Seattle business licence", "sourced", True), ("Street use permit", "assumption", False),
        ("Fire inspection", "assumption", False)]
    assert section["items"][0]["fee_usd"] == 802.5 and section["items"][0]["captured_at"] == "2026-11-04T09:00:00Z"
    assert section["items"][3]["method"] == "Not confirmed on an official page in this run. Check with Seattle Department of Transportation."
    assert result["missing_evidence"][1] == ("2 of 5 requirements could not be confirmed on an official government page "
                                             "in this run; check them with the agency named.")
    assert [chart["id"] for chart in result["charts"]] == ["requirements", "coverage"]
    research = agents.research_calls[0]
    assert "toolbox" not in research["kwargs"] and research["system"] == pipeline.RESEARCH_SYSTEM
    assert "Template: Food truck" in research["prompt"] and "commissary kitchen rule" in research["prompt"]
    assert "About the food truck:" in research["prompt"] and "- known costs: Truck rental $2,500" in research["prompt"]
    writer = next(call for call in agents.json_calls if "takeaway" in call["schema"]["properties"])
    assert "requirements" in writer["schema"]["properties"] and "checklist" not in writer["schema"]["properties"]
    assert templates.REQUIREMENTS_INSTRUCTION in writer["prompt"] and "Also write a launch checklist" not in writer["prompt"]


RESTAURANT_PAGES = {
    "https://cafe-una.example/menu": ("Café Una menu", "Latte $5.25. Breakfast sandwich $9.50."),
    "https://bistro-dos.example/menu": ("Bistro Dos", "Lunch plates from $14 to $18. Rated 4.8 stars on our site."),
}
RESTAURANT_FINDINGS = [
    ("Café Una prices", "Latte $5.25. Breakfast sandwich $9.50.", "https://cafe-una.example/menu"),
    ("Bistro Dos prices", "Lunch plates from $14 to $18. Rated 4.8 stars on our site.", "https://bistro-dos.example/menu"),
    ("Review site", "Tacos at Casa Tres cost $3.", "https://reviews.example/casa-tres"),
]


def test_restaurant_competitor_scan_gives_prices_nearby(template_run):
    def doc(cid):
        una, dos = cid("Latte"), cid("Lunch plates")
        return {"table": {"title": "Prices nearby", "columns": ["Seller", "Product", "Price", "Notes"], "rows": [
            row("Café Una", "Breakfast sandwich", 9.5, [una]),
            row("Bistro Dos", "Lunch plate", 14, [dos], high=18, notes="Rated 4.8 stars"),
            row("Café Una", "Latte", 5.25, [una], unit="per drink"),
            row("Casa Tres", "Taco", 3, [], kind="assumption", notes="4.9 stars, 812 reviews"),
        ]}, "price_band": {"low_usd": 10, "high_usd": 13, "method": "Between the café and the bistro."}}
    answers = {"city": "Seattle", "neighbourhood": "Ballard", "seats": 30, "cuisine": "Café", "alcohol": False, "known_costs": []}
    result, agents = template_run("restaurant", "competitor_scan", answers, RESTAURANT_PAGES, RESTAURANT_FINDINGS, doc)
    bench = result["benchmarks"]
    assert bench["title"] == "Prices nearby" and bench["what"] == "menu prices" and bench["asking"] is False
    assert [(i["business"], i["price"], i["price_high"], i["unit"]) for i in bench["items"]] == [
        ("Café Una", 5.25, None, "per drink"), ("Café Una", 9.5, None, "per item"), ("Bistro Dos", 14, 18, "per item")]
    assert bench["items"][2]["notes"] == "Rated 4.8 stars" and bench["items"][2]["retrieved_at"] == "2026-11-04T09:00:00Z"
    assert result["requirements"] is None and result["startup_costs"] is None
    assert [chart["id"] for chart in result["charts"]] == ["price_benchmarks", "price_band", "coverage"]
    prices = result["charts"][0]
    assert [s["value"] for s in prices["series"]] == [9.5, 14]
    assert prices["caption"].startswith("Menu prices per item from nearby restaurants' and cafés' own menus, retrieved Nov 4, 2026")
    assert "against menu prices nearby of" in result["charts"][1]["caption"]
    writer = next(call for call in agents.json_calls if "takeaway" in call["schema"]["properties"])
    row_schema = writer["schema"]["properties"]["table"]["properties"]["rows"]["items"]
    assert "price_unit" in row_schema["required"] and "ratings or review counts" in writer["prompt"]


DAYCARE_PAGES = {
    "https://safety.example/childproofing": ("Childproofing", "Childproofing kits cost $150 to $400 depending on the home."),
    "https://insure.example/daycare": ("Daycare insurance", "Home daycare liability insurance runs $500 to $1,500 a year."),
}
DAYCARE_FINDINGS = [
    ("Childproofing", "Childproofing kits cost $150 to $400 depending on the home.", "https://safety.example/childproofing"),
    ("Insurance", "Home daycare liability insurance runs $500 to $1,500 a year.", "https://insure.example/daycare"),
]


def test_daycare_marketing_plan_gives_startup_costs_with_missing_lines(template_run):
    def doc(cid):
        return {
            "plan": [{"section": s, "items": [{"text": "Post on the subsidy provider list", "kind": "assumption",
                                               "card_ids": [], "method": ""}]} for s in ("Customers", "Channels", "Pricing")],
            "budget": [{"item": "Flyers", "amount": 60, "kind": "estimate", "card_ids": [], "method": "Print shop"},
                       {"item": "Open house", "amount": 90, "kind": "estimate", "card_ids": [], "method": "Snacks"}],
            "projection": None,
            "startup_costs": [
                cost("Space changes", "Backyard fence", 2400, basis="founder", method="Your contractor quote."),
                cost("Safety equipment", "Childproofing kit", 150, 400, ids=[cid("Childproofing")]),
                cost("Insurance", "Liability insurance, first year", 500, 1500, ids=[cid("liability")]),
                cost("Other", "Cribs", 600, 900, ids=[cid("Childproofing")]),
            ],
        }
    answers = {"state": "WA", "city": "Tacoma", "setting": "home", "ages_served": "1 to 5 years", "planned_children": 6,
               "known_costs": [{"item": "Fence quote", "amount_usd": 2400}]}
    result, agents = template_run("daycare", "marketing_plan", answers, DAYCARE_PAGES, DAYCARE_FINDINGS, doc)
    costs = result["startup_costs"]
    assert [(l["item"], l["low"], l["high"], l["basis"]) for l in costs["lines"]] == [
        ("Backyard fence", 2400, 2400, "founder"), ("Childproofing kit", 150, 400, "source"),
        ("Liability insurance, first year", 500, 1500, "source")]
    assert (costs["total_low"], costs["total_high"]) == (3000, 4300) and costs["missing_lines"] == ["Licensing fees"]
    assert ("No checked source or figure of yours gave a cost for licensing fees, so it is left out of the startup costs."
            in result["missing_evidence"])
    assert ("The cost of cribs could not be checked against a quote or your own figures, so it is left out of the startup costs."
            in result["missing_evidence"])
    assert result["budget"]["total"] == 150  # the 4-week marketing budget stays separate
    assert [chart["id"] for chart in result["charts"]] == ["budget", "startup_costs", "coverage"]
    research = agents.research_calls[0]["prompt"]
    assert "Never collect, quote or show anything about specific children or families" in research
    assert "- planned children: 6" in research and "Working Connections Child Care" not in research  # marketing tool
    writer = next(call for call in agents.json_calls if "takeaway" in call["schema"]["properties"])
    categories = writer["schema"]["properties"]["startup_costs"]["items"]["properties"]["category"]["enum"]
    assert categories == ["Space changes", "Safety equipment", "Licensing fees", "Insurance", "Other"]
    plan = agents.json_calls[0]["prompt"]
    assert "Template: Daycare / childcare" in plan


ETSY_PAGES = {
    ETSY_FEES: ("Fees & Payments Policy | Etsy", "The listing fee is $0.20 for each listing. Transaction fees are 6.5% of "
                "the price you display plus delivery and gift wrapping. Payment processing fees in the United States are 3% + $0.25."),
    OFFSITE: ("Offsite Ads | Etsy Help", "If your shop made less than $10,000 in the past 365 days the Offsite Ads fee is 15%; "
              "at $10,000 or more it is 12%. You will never pay more than $100 in Offsite Ads fees for a single order."),
    "https://www.etsy.com/listing/123/speckled-mug": ("Speckled mug | Etsy", "Speckled stoneware mug, 12 oz $34.00 Free shipping"),
    "https://www.etsy.com/listing/456/tall-mug": ("Tall mug | Etsy", "Tall handmade mug $42.00"),
    "https://mugblog.example/best-mugs": ("Best mugs", "This handmade mug costs $25 on my shop."),
}
ETSY_FINDINGS = [
    ("Listing fee", "The listing fee is $0.20 for each listing.", ETSY_FEES),
    ("Transaction fee", "Transaction fees are 6.5% of the price you display plus delivery and gift wrapping.", ETSY_FEES),
    ("Processing", "Payment processing fees in the United States are 3% + $0.25.", ETSY_FEES),
    ("Offsite Ads", "If your shop made less than $10,000 in the past 365 days the Offsite Ads fee is 15%; at $10,000 or more "
                    "it is 12%. You will never pay more than $100 in Offsite Ads fees for a single order.", OFFSITE),
    ("Speckled mug", "Speckled stoneware mug, 12 oz $34.00", "https://www.etsy.com/listing/123/speckled-mug"),
    ("Tall mug", "Tall handmade mug $42.00", "https://www.etsy.com/listing/456/tall-mug"),
    ("Blog mug", "This handmade mug costs $25 on my shop.", "https://mugblog.example/best-mugs"),
]
ETSY_ANSWERS = {"product_type": "Mug", "size_material": "12 oz stoneware", "target_price_usd": 30,
                "buyer_pays_shipping": True, "shipping_cost_usd": 6}


def test_etsy_marketing_plan_gives_fees_and_offsite_ads(template_run):
    def doc(cid):
        fees, offsite = cid("listing fee"), cid("Offsite Ads fee")
        return {
            "plan": [{"section": s, "items": [{"text": "Post weekly", "kind": "assumption", "card_ids": [], "method": ""}]}
                     for s in ("Customers", "Channels", "Pricing")],
            "budget": [{"item": "Etsy Ads", "amount": 30, "kind": "estimate", "card_ids": [], "method": "Daily cap"},
                       {"item": "Photos", "amount": 40, "kind": "estimate", "card_ids": [], "method": "Props"}],
            "projection": None,
            "etsy_fees": etsy_inputs(listing_fee_card_ids=[fees], transaction_fee_card_ids=[cid("Transaction fees")],
                                     processing_fee_card_ids=[cid("processing")],
                                     offsite_ads=[{"label": "Shops under $10,000 a year", "rate_pct": 15, "card_ids": [offsite]},
                                                  {"label": "Shops at $10,000 or more", "rate_pct": 12, "card_ids": [offsite]}],
                                     offsite_ads_cap_card_ids=[offsite]),
        }
    result, agents = template_run("etsy", "marketing_plan", ETSY_ANSWERS, ETSY_PAGES, ETSY_FINDINGS, doc)
    fees = result["etsy_fees"]
    assert fees["complete"] is True and fees["left_before_ads"] == 26.13
    assert [s["left"] for s in fees["scenarios"]] == [26.13, 20.73, 21.81]
    assert result["benchmarks"] is None and "requirements" not in result and "startup_costs" not in result
    assert [chart["id"] for chart in result["charts"]] == ["budget", "etsy_costs", "coverage"]
    assert "sell for" not in json.dumps(result["findings"]) and "are listed at about $30" in result["findings"][0]["text"]
    writer = next(call for call in agents.json_calls if "takeaway" in call["schema"]["properties"])
    assert "etsy_fees" in writer["schema"]["properties"] and "Offsite Ads tier" in writer["prompt"]
    assert "About selling on Etsy:" in writer["prompt"] and "- target price usd: 30" in writer["prompt"]


def test_etsy_competitor_scan_compares_only_etsy_listing_pages(template_run):
    def doc(cid):
        return {"table": {"title": "Asking prices of Etsy listings", "columns": ["Seller", "Product", "Price", "Notes"], "rows": [
            {"cells": ["MugShop", "Speckled mug", "$34.00", ""], "kind": "sourced", "card_ids": [cid("Speckled")],
             "price_usd": 34, "price_high_usd": None},
            {"cells": ["TallCo", "Tall mug", "$42.00", ""], "kind": "sourced", "card_ids": [cid("Tall handmade")],
             "price_usd": 42, "price_high_usd": None},
            {"cells": ["Blogger", "Mug", "$25", ""], "kind": "sourced", "card_ids": [cid("my shop")],
             "price_usd": 25, "price_high_usd": None},
        ]}, "price_band": None}
    result, _ = template_run("etsy", "competitor_scan", ETSY_ANSWERS, ETSY_PAGES, ETSY_FINDINGS, doc)
    bench = result["benchmarks"]
    assert bench["title"] == "Comparable Etsy listings" and bench["asking"] is True
    assert [(i["business"], i["price"]) for i in bench["items"]] == [("MugShop", 34), ("TallCo", 42)]
    assert all(i["url"].startswith("https://www.etsy.com/listing/") for i in bench["items"])
    assert result["etsy_fees"] is None
    assert [chart["id"] for chart in result["charts"]] == ["price_benchmarks", "coverage"]
    assert result["charts"][0]["caption"] == ("Asking prices of Etsy listings on Nov 4, 2026, not sold prices: 2 comparable "
                                              "listings ask $34 to $42; the middle asking price is $38.")
    assert ("1 price in the table could not be checked against a quote on an etsy.com listing page fetched in this run, "
            "so it is left out of Comparable Etsy listings." in result["missing_evidence"])


def test_general_results_gain_no_template_fields(aws, monkeypatch):
    agents = FakeClaude()
    monkeypatch.setattr(claude, "research_call", agents.research_call)
    monkeypatch.setattr(claude, "json_call", agents.json_call)
    run = store.create_run("founder", "conversation", "Mugs", copy.deepcopy(BRIEF))
    pipeline.run(run["run_id"])
    result = store.load_result(run["run_id"])
    assert result["version"] == 3
    assert not {"requirements", "benchmarks", "startup_costs", "etsy_fees", "listings", "fees"} & set(result)
    assert [chart["id"] for chart in result["charts"]] == ["prices", "price_band", "coverage"]
