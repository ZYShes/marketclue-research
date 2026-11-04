"""One research run: plan, parallel research, quote checks, fact cards, marketing plan, review."""

import html
import json
import re
import threading
import time
import traceback
import unicodedata
import urllib.parse
import urllib.robotparser
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup

from . import capabilities, charts, claude, ebay_report, intake, store, templates
from .capabilities import ebay

MAX_DIRECTIONS = 4
# Effort modes: research agent model and effort, directions, page fetches per direction, writer effort.
# Smarter is Opus at medium effort throughout (the writer ran at high before; it cost too much per run).
MODES = {
    "quick": {"research_model": "claude-haiku-5-5", "research_effort": "medium", "directions": 3, "fetches": 3,
              "writer_effort": "medium"},
    "balanced": {"research_model": "claude-sonnet-5-5", "research_effort": "medium", "directions": 4, "fetches": 3,
                 "writer_effort": "high"},
    "smarter": {"research_model": "claude-opus-5-5", "research_effort": "medium", "directions": 4, "fetches": 4,
                "writer_effort": "medium"},
}
USER_AGENT = "MarketClueBot/0.1 (+https://github.com/ZYShes/marketclue-research)"

PLAN_SECTIONS = ["Customers", "Positioning", "Pricing", "Channels", "Content (4 weeks)", "Measurement", "Brand & compliance"]

# Domains whose pages count as official for the launch checklist.
OFFICIAL_SUFFIXES = (".gov", ".us")
OFFICIAL_HOSTS = {"help.etsy.com", "www.etsy.com", "etsy.com", "sellercentral.amazon.com", "help.shopify.com", "www.sba.gov"}


def feature_of(brief):
    feature = (brief or {}).get("feature") or "marketing_plan"
    return feature if feature in intake.FEATURES else "marketing_plan"


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def brief_text(brief):
    lines = [
        f"Business: {brief.get('business')}",
        f"Customers: {brief.get('customer')}",
        f"Where: {brief.get('location') or 'not specified'}",
        f"Stage: {brief.get('stage')}",
        f"Marketing budget: {('$' + format(brief['budget_usd'], ',.0f')) if brief.get('budget_usd') else 'not specified'}",
        f"Goal: {brief.get('goal')}",
        "Founder's questions:",
    ]
    lines += [f"- {q}" for q in brief.get("questions") or []]
    answers = brief.get("ebay") or {}
    if answers:
        lines.append("About selling on eBay:")
        lines += [f"- {key.replace('_', ' ')}: {value}" for key, value in answers.items() if value is not None]
    return "\n".join(lines)


def template_notes(brief, part):
    """Extra prompt text for the brief's template (source rules and per-tool guidance); empty for general."""
    template = templates.of(brief)
    lines = list(template["source_rules"])
    if template[part].get(feature_of(brief)):
        lines.append(template[part][feature_of(brief)])
    return f"\n\nTemplate: {template['name']}\n" + "\n".join(f"- {line}" for line in lines) if lines else ""


# ---------- 1. The super agent splits the work ----------

DIRECTIONS_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "directions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "question": {"type": "string"},
                    "search_hints": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["name", "question", "search_hints"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["title", "directions"],
    "additionalProperties": False,
}


def mode_of(run):
    mode = (run or {}).get("mode") or "quick"
    return mode if mode in MODES else "quick"


def plan_directions(usage, brief, max_directions=MAX_DIRECTIONS):
    spec = intake.FEATURES[feature_of(brief)]
    out = claude.json_call(
        usage,
        system="You are the research lead at MarketClue. You split a solo founder's research into independent directions that separate research agents can run in parallel.",
        prompt=(
            f"{brief_text(brief)}\n\nTool: {spec['name']} ({spec['question']})\n\n"
            f"Split this into 2 to {max_directions} research directions that public web pages can answer, "
            f"covering {spec['research']}. Give each a short name (2-4 words), one research "
            "question, and 2-3 search hints. Also give the report a short title (max 8 words)."
            + template_notes(brief, "research")
        ),
        schema=DIRECTIONS_SCHEMA,
        effort="medium",
    )
    return out["title"], out["directions"][:max_directions]


# ---------- 2. Research agents, in parallel ----------

RESEARCH_SYSTEM = """You are a MarketClue research agent. You research one question for a solo founder
using web_search and web_fetch. Search first, then fetch the two or three most useful pages (seller
pages, reviews, forums, articles). Only report what you read in the fetched page text.

Finish with a list of 3-6 findings in exactly this format, one per line:
FINDING | <one-sentence claim in plain English> | "<exact quote copied character for character from the fetched page text, 1-2 sentences, under 300 characters>" | <the fetched page URL>

The quote must appear word for word in the page you fetched; do not paraphrase, merge or fix it.
Prefer concrete facts: prices, product details, what customers say, numbers with dates."""

LISTING_SYSTEM = """

You can also call ebay_search_listings to search active eBay listings. Its prices are asking prices of
active listings on the retrieval date, never sold prices. A FINDING may cite a listing: use the listing's url
as the URL and copy its quote_text exactly as the quote. Say a listing "asks" a price; never "sells for"."""

FINDINGS_SCHEMA = {
    "type": "object",
    "properties": {
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "claim": {"type": "string"},
                    "quote": {"type": "string"},
                    "url": {"type": "string"},
                },
                "required": ["claim", "quote", "url"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["findings"],
    "additionalProperties": False,
}


def research(usage, brief, direction, mode="quick", toolbox=None):
    prompt = (
        f"{brief_text(brief)}\n\nYour research direction: {direction['name']}\n"
        f"Question: {direction['question']}\nSearch hints: {', '.join(direction.get('search_hints') or [])}"
    ) + template_notes(brief, "research")
    if feature_of(brief) == "launch_checklist":
        prompt += ("\n\nPrefer official pages: government sites (.gov) for the founder's city and state, "
                   "the U.S. Small Business Administration, and the selling platform's own help pages.")
    settings = MODES[mode]
    blocks = claude.research_call(
        usage, system=RESEARCH_SYSTEM + (LISTING_SYSTEM if toolbox else ""), prompt=prompt,
        model=settings["research_model"], max_fetches=settings["fetches"], effort=settings["research_effort"],
        **({"toolbox": toolbox} if toolbox else {}),
    )
    pages = claude.fetched_pages(blocks)
    report = "\n".join(b.text for b in blocks if b.type == "text")
    rows = [line.strip() for line in report.splitlines() if line.strip().startswith("FINDING")]
    if not rows:
        return [], pages, claude.search_hits(blocks)
    findings = parse_findings(rows)
    if findings is None:
        # A line that does not follow the format: let the model convert them, copying the wording exactly.
        findings = claude.json_call(
            usage,
            system="You convert research notes into JSON without changing any wording.",
            prompt="Convert each FINDING line into an object. Copy claim, quote (without the surrounding quotation marks) and URL exactly.\n\n" + "\n".join(rows),
            schema=FINDINGS_SCHEMA,
            effort="low",
        )["findings"]
    return findings, pages, claude.search_hits(blocks)


# FINDING | <claim> | "<quote>" | <url> - the quote may itself contain quotation marks and pipes.
FINDING_LINE = re.compile(r'^FINDING\s*\|\s*(?P<claim>[^|]+?)\s*\|\s*["“](?P<quote>.+)["”]\s*\|\s*(?P<url>https?://\S+?)\s*$')


def parse_findings(rows):
    """Parses FINDING lines in code (no model call). Returns None if any line does not match the format."""
    findings = []
    for row in rows:
        match = FINDING_LINE.match(row)
        if not match:
            return None
        findings.append({"claim": match["claim"], "quote": match["quote"].strip(), "url": match["url"]})
    return findings


# ---------- 3. Quote checks against captured page text ----------

def normalize_text(value):
    value = unicodedata.normalize("NFKC", html.unescape(value or ""))
    value = value.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    value = value.replace("–", "-").replace("—", "-").replace(" ", " ")
    value = re.sub(r"[*_`#>\[\]]", "", value)
    return re.sub(r"\s+", " ", value).strip().lower()


def is_ebay_item(url):
    parts = urllib.parse.urlsplit((url or "").strip())
    host = parts.netloc.lower()
    return (host == "ebay.com" or host.endswith(".ebay.com")) and parts.path.startswith("/itm/")


def normalize_url(url):
    """Lower-cased scheme and host, no trailing slash or fragment; eBay item links also lose tracking queries."""
    parts = urllib.parse.urlsplit((url or "").strip())
    path = parts.path.rstrip("/") or "/"
    query = "" if is_ebay_item(url) else parts.query
    return urllib.parse.urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, query, ""))


def listing_claim(page):
    item = page["item"]
    price = f"${item['price']:,.2f}" if item["currency"] == "USD" else f"{item['price']:,.2f} {item['currency']}"
    day = ebay.day_text(page["retrieved_at"])
    return f"An active eBay listing asks {price} for \"{item['title']}\" (asking price on {day})."


def quote_found(quote, text):
    q = normalize_text(quote).strip('"\' .')
    return len(q) >= 12 and q in normalize_text(text)


def fetch_page(url):
    """Our own fallback fetch: honours robots.txt, 10 s timeout, 2 MB cap."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https"):
        return None
    robots = urllib.robotparser.RobotFileParser()
    robots.set_url(f"{parts.scheme}://{parts.netloc}/robots.txt")
    try:
        robots.read()
        if not robots.can_fetch(USER_AGENT, url):
            return None
    except Exception:
        pass
    try:
        response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=10, stream=True)
        if response.status_code != 200 or "html" not in response.headers.get("content-type", ""):
            return None
        raw = response.raw.read(2_000_000, decode_content=True)
    except Exception:
        return None
    soup = BeautifulSoup(raw, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    title = soup.title.get_text(strip=True) if soup.title else url
    return {"url": url, "title": title, "text": soup.get_text(" "), "retrieved_at": now()}


def make_cards(direction, findings, pages):
    by_url = {normalize_url(u): p for u, p in pages.items()}
    cards = []
    for f in findings:
        page = by_url.get(normalize_url(f["url"]))
        if (not page or not quote_found(f["quote"], page["text"])) and not is_ebay_item(f["url"]):
            fallback = fetch_page(f["url"])
            if fallback and quote_found(f["quote"], fallback["text"]):
                page = fallback
        sourced = bool(page) and quote_found(f["quote"], page["text"])
        if page and page.get("source_kind") == "ebay_api":
            if sourced:
                cards.append({
                    "claim": listing_claim(page), "quote": f["quote"].strip().strip('"'), "url": page["url"],
                    "source_title": page["title"], "captured_at": page["retrieved_at"], "type": "sourced",
                    "direction": direction["name"], "tags": [direction["name"], "eBay listing"],
                    **{key: page[key] for key in store.CARD_EXTRA_FIELDS},
                })
                continue
            page = None
        if page:
            store.save_snapshot(page["url"], page["text"][:200_000])
        cards.append({
            "claim": f["claim"].strip(),
            "quote": f["quote"].strip().strip('"'),
            "url": f["url"].strip(),
            "source_title": (page or {}).get("title") or urllib.parse.urlsplit(f["url"]).netloc,
            "captured_at": (page or {}).get("retrieved_at") or now(),
            "type": "sourced" if sourced else "unverified",
            "direction": direction["name"],
            "tags": [direction["name"]],
        })
    return cards


CLAIMS_SCHEMA = {
    "type": "object",
    "properties": {
        "cards": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"id": {"type": "integer"}, "claim": {"type": "string"}},
                "required": ["id", "claim"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["cards"],
    "additionalProperties": False,
}


def tighten_claims(usage, cards):
    """Rewrites any card claim that says more than its quote, so a card never overstates its source."""
    items = [{"id": i, "claim": c["claim"], "quote": c["quote"], "source": c["source_title"]} for i, c in enumerate(cards)]
    if not items:
        return 0
    out = claude.json_call(
        usage,
        system="You are MarketClue's checker. A fact card's claim may only say what its quote says.",
        prompt=(
            "For each card whose claim adds anything the quote does not state (numbers, names, extra facts), "
            "return a corrected one-sentence claim that restates only the quote, in plain English. "
            "Return only the cards you changed.\n\n" + json.dumps(items, ensure_ascii=False)
        ),
        schema=CLAIMS_SCHEMA,
        effort="low",
    )
    changed = 0
    for fix in out["cards"]:
        if 0 <= fix["id"] < len(cards) and fix["claim"].strip():
            cards[fix["id"]]["claim"] = fix["claim"].strip()
            changed += 1
    return changed


# ---------- 4. The writer: one report per tool ----------

def _item(extra=None):
    props = {
        "text": {"type": "string"},
        "kind": {"type": "string", "enum": ["sourced", "assumption", "estimate"]},
        "card_ids": {"type": "array", "items": {"type": "string"}},
        "method": {"type": "string"},
    }
    props.update(extra or {})
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


def _array(items):
    return {"type": "array", "items": items}


def _object(props):
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


def _nullable(schema):
    return {"anyOf": [schema, {"type": "null"}]}


NUMBER_OR_NULL = {"type": ["number", "null"]}


EBAY_FEES_SCHEMA = _object({
    "final_value_fee_pct": NUMBER_OR_NULL,
    "final_value_fee_card_ids": _array({"type": "string"}),
    "per_order_fee_usd": NUMBER_OR_NULL,
    "per_order_fee_card_ids": _array({"type": "string"}),
    "target_price_usd": NUMBER_OR_NULL,
    "shipping_cost_usd": NUMBER_OR_NULL,
    "buyer_pays_shipping": {"type": ["boolean", "null"]},
    "shipping_method": {"type": "string"},
    "ad_rates_pct": _array({"type": "number"}),
    "ad_rate_min_pct": NUMBER_OR_NULL,
    "ad_rate_max_pct": NUMBER_OR_NULL,
    "ad_rate_card_ids": _array({"type": "string"}),
    "priority": _item(),
})


def report_schema(feature, template_id="general"):
    props = {
        "takeaway": _item(),
        "findings": _array(_item({"title": {"type": "string"}})),
        "next_steps": _array({
            "type": "object",
            "properties": {"text": {"type": "string"}, "how": {"type": "string"}},
            "required": ["text", "how"],
            "additionalProperties": False,
        }),
        "missing_evidence": _array({"type": "string"}),
    }
    if feature == "competitor_scan":
        props["table"] = {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "columns": _array({"type": "string"}),
                "rows": _array({
                    "type": "object",
                    "properties": {
                        "cells": _array({"type": "string"}),
                        "kind": {"type": "string", "enum": ["sourced", "assumption", "estimate"]},
                        "card_ids": _array({"type": "string"}),
                        "price_usd": NUMBER_OR_NULL,
                        "price_high_usd": NUMBER_OR_NULL,
                    },
                    "required": ["cells", "kind", "card_ids", "price_usd", "price_high_usd"],
                    "additionalProperties": False,
                }),
            },
            "required": ["title", "columns", "rows"],
            "additionalProperties": False,
        }
        props["price_band"] = _nullable(_object({
            "low_usd": {"type": "number"}, "high_usd": {"type": "number"}, "method": {"type": "string"},
        }))
    if feature == "marketing_plan":
        props["plan"] = _array({
            "type": "object",
            "properties": {"section": {"type": "string", "enum": PLAN_SECTIONS}, "items": _array(_item())},
            "required": ["section", "items"],
            "additionalProperties": False,
        })
        budget_line = _item({"item": {"type": "string"}, "amount": {"type": "number"}})
        budget_line["properties"].pop("text")
        budget_line["required"] = list(budget_line["properties"])
        props["budget"] = _array(budget_line)
        props["projection"] = _nullable(_object({
            "ad_spend_usd": {"type": "number"},
            "cost_per_click_usd": {"type": "number"},
            "conversion_low_pct": {"type": "number"},
            "conversion_high_pct": {"type": "number"},
            "average_order_usd": NUMBER_OR_NULL,
            "basis": {"type": "string"},
            "card_ids": _array({"type": "string"}),
        }))
    if feature == "market_check":
        props["themes"] = _array(_object({"label": {"type": "string"}, "card_ids": _array({"type": "string"})}))
    if feature == "launch_checklist":
        props["checklist"] = _array(_item({"step": {"type": "string"}}))
    if template_id == "ebay" and feature == "marketing_plan":
        props["ebay_fees"] = EBAY_FEES_SCHEMA
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


WRITER_SYSTEM = """You are MarketClue's report writer for solo founders. You turn checked research into a short,
practical report. Every statement has a kind:
- sourced: one cited fact card's quote states it directly (the same number, price or fact); cite its id in card_ids;
- assumption: a judgement or common practice, or a conclusion drawn from a quote (card_ids empty);
- estimate: a number you computed; method explains how.
Never write card ids in text, titles or method; card_ids is the only place for them. Plain English, short
sentences; many readers are not native speakers.

Write: a takeaway (the main point in 2-3 sentences); 3-6 findings, each with a short title and 1-3
sentences; 3-5 next steps, each saying exactly what to do and how to check it; and 1-4 items of missing
evidence (what the sources did not show)."""

TOOL_INSTRUCTIONS = {
    "market_check": ("Focus on who buys, what they praise, what they complain about and where they talk. Do not estimate "
                     "market size. Also list 3-6 buyer themes (short labels such as \"Buy as gifts\" or \"Complain about "
                     "shipping\"), each with the ids of every card whose quote shows that theme."),
    "competitor_scan": ("Also write a price comparison table: columns Seller, Product, Price, Notes; one row per "
                        "competitor product that a card supports, with that card's id. Only put a price in a row when "
                        "a quote states it. For each row also give price_usd, the US dollar price the quote states as a "
                        "number (the lower price of a from-to range), and price_high_usd, the upper price of a from-to "
                        "range; use null when the quote states no US dollar price or no range. If the prices support it, "
                        "suggest a price band for the founder in price_band (low_usd, high_usd and a method that says how "
                        "you chose it from the prices); otherwise price_band is null."),
    "marketing_plan": ("Also write the marketing plan (sections: " + ", ".join(PLAN_SECTIONS) + ", 2-4 items each) and a "
                       "4-week budget in US dollars with 3-6 lines. If the founder gave a budget, stay within it. Budget "
                       "lines that use a price from a card are sourced, otherwise estimate or assumption. Also give the "
                       "inputs of a simple first-month projection in projection: ad_spend_usd (the paid ads amount in your "
                       "budget), cost_per_click_usd, conversion_low_pct and conversion_high_pct (the percent of visitors "
                       "who buy), average_order_usd (or null), basis (where these numbers come from, in plain English) and "
                       "the ids of cards that state any of them. Set projection to null when the budget has no paid ads."),
    "launch_checklist": ("Also write a launch checklist of 5-9 steps in the order a founder should do them (register, "
                         "licences, tax, platform rules, product rules). Each step cites the page that requires it. Do not "
                         "give legal advice; say to confirm with the office when a rule depends on details."),
}


def report_problems(feature, doc):
    """Returns what is missing from a writer answer; an empty list means the report is complete."""
    problems = []
    findings = doc.get("findings") or []
    if len(findings) < 3 or any(len((f.get("title") or "").strip()) < 4 for f in findings):
        problems.append("3-6 findings, each with a real title of a few words")
    if len(doc.get("next_steps") or []) < 2:
        problems.append("3-5 next steps")
    if not doc.get("missing_evidence"):
        problems.append("1-4 items of missing evidence")
    if len((doc.get("takeaway") or {}).get("text") or "") < 40:
        problems.append("a 2-3 sentence takeaway")
    if feature == "competitor_scan" and not (doc.get("table") or {}).get("rows"):
        problems.append("the price comparison table with at least one row")
    if feature == "marketing_plan" and (len(doc.get("plan") or []) < 3 or len(doc.get("budget") or []) < 2):
        problems.append("the marketing plan sections and a budget with 3-6 lines")
    if feature == "launch_checklist" and len(doc.get("checklist") or []) < 4:
        problems.append("a launch checklist of 5-9 steps")
    return problems


def write_report(usage, brief, cards, directions, effort="medium"):
    feature = feature_of(brief)
    schema = report_schema(feature, templates.of(brief)["id"])
    card_lines = [
        {"id": c["card_id"], "direction": c["direction"], "claim": c["claim"], "quote": c["quote"],
         "source": f"{c['label']}: {c['source_title']}" if c.get("label") else c["source_title"], "url": c["url"]}
        for c in cards
        if c["type"] == "sourced"
    ]
    spec = intake.FEATURES[feature]
    prompt = (
        f"{brief_text(brief)}\n\nTool: {spec['name']} ({spec['question']})\n"
        f"Research directions: {', '.join(d['name'] for d in directions)}\n\n"
        f"Checked fact cards (JSON):\n{json.dumps(card_lines, ensure_ascii=False)}\n\n"
        f"{TOOL_INSTRUCTIONS[feature]}"
    ) + template_notes(brief, "writer")
    doc = claude.json_call(usage, system=WRITER_SYSTEM, prompt=prompt, schema=schema, effort=effort, max_tokens=32000)
    problems = report_problems(feature, doc)
    if problems:
        print(json.dumps({"writer_retry": problems}))
        doc = claude.json_call(
            usage, system=WRITER_SYSTEM, schema=schema, effort=effort, max_tokens=32000,
            prompt=prompt + "\n\nA previous draft was incomplete. Make sure the report includes: " + "; ".join(problems) + ".",
        )
        problems = report_problems(feature, doc)
        if problems:
            raise RuntimeError("The report came back incomplete (" + "; ".join(problems) + "). Please run it again.")
    return doc


# ---------- 5. The reviewer ----------

CHECK_SCHEMA = {
    "type": "object",
    "properties": {
        "unsupported": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"id": {"type": "string"}, "reason": {"type": "string"}},
                "required": ["id", "reason"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["unsupported"],
    "additionalProperties": False,
}


def _items(doc):
    """Yields (id, item, statement) for every item that can cite cards."""
    yield "t", doc["takeaway"], doc["takeaway"].get("text", "")
    for j, item in enumerate(doc.get("findings") or []):
        yield f"f{j}", item, f"{item.get('title', '')}: {item.get('text', '')}"
    for j, row in enumerate((doc.get("table") or {}).get("rows") or []):
        yield f"r{j}", row, " | ".join(row.get("cells") or [])
    for i, group in enumerate(doc.get("plan") or []):
        for j, item in enumerate(group["items"]):
            yield f"p{i}-{j}", item, item.get("text", "")
    for j, line in enumerate(doc.get("budget") or []):
        yield f"b{j}", line, f"{line.get('item')}: ${line.get('amount')}"
    for j, step in enumerate(doc.get("checklist") or []):
        yield f"c{j}", step, f"{step.get('step', '')}: {step.get('text', '')}"
    priority = (doc.get("ebay_fees") or {}).get("priority")
    if isinstance(priority, dict):
        yield "e-priority", priority, priority.get("text", "")


def check(usage, doc, cards):
    by_id = {c["card_id"]: c for c in cards if c["type"] == "sourced"}
    items = {}
    for item_id, item, statement in _items(doc):
        item["card_ids"] = [cid for cid in item.get("card_ids") or [] if cid in by_id]
        if item.get("kind") == "sourced":
            items[item_id] = (item, statement)
    review = [
        {"id": item_id, "statement": statement, "quotes": [by_id[cid]["quote"] for cid in item["card_ids"]]}
        for item_id, (item, statement) in items.items()
        if item["card_ids"]
    ]
    unsupported = set()
    if review:
        out = claude.json_call(
            usage,
            system="You are MarketClue's reviewer. You judge whether quoted evidence supports each statement. Be strict: the quotes must state it, not just relate to it.",
            prompt="List the ids of statements that the quotes do NOT support.\n\n" + json.dumps(review, ensure_ascii=False),
            schema=CHECK_SCHEMA,
            effort="low",
        )
        unsupported = {u["id"] for u in out["unsupported"]}
    relabelled = 0
    for item_id, (item, _) in items.items():
        if item_id in unsupported or not item["card_ids"]:
            item["kind"] = "assumption"
            item["card_ids"] = []
            if "method" in item and not item.get("method"):
                item["method"] = "Not backed by a checked quote."
            relabelled += 1
    return relabelled


def mark_official(doc, cards):
    by_id = {c["card_id"]: c for c in cards}
    for step in doc.get("checklist") or []:
        step["step"] = re.sub(r"^\s*(step\s*)?\d+\s*[.):-]\s*", "", step.get("step") or "", flags=re.I)
        hosts = [urllib.parse.urlsplit(by_id[cid]["url"]).netloc.lower() for cid in step.get("card_ids") or [] if cid in by_id]
        step["official"] = any(h.endswith(OFFICIAL_SUFFIXES) or h in OFFICIAL_HOSTS for h in hosts)


WRITER_NAMES = {
    "market_check": "Report writer",
    "competitor_scan": "Price analyst",
    "marketing_plan": "Marketing planner",
    "launch_checklist": "Checklist writer",
}


# ---------- The run ----------

def run(run_id):
    meta = store.get_run(run_id)
    if not meta or not store.claim_run(run_id):
        return
    usage = claude.Usage()
    started = time.time()
    agents = {}
    timings = []
    lock = threading.Lock()

    def set_agent(name, status, note="", seconds=None):
        with lock:
            agents[name] = {"status": status, "note": note}
            if seconds is not None:
                timings.append({"name": name, "status": status, "seconds": round(seconds)})
            store.update_run(run_id, agents=dict(agents), cost_usd=usage.cost_usd())

    try:
        brief = meta["brief"]
        feature = feature_of(brief)
        mode = mode_of(meta)
        settings = MODES[mode]
        template = templates.of(brief)
        toolbox = capabilities.Toolbox(template["capabilities"], run_id) if template["capabilities"] else None
        toolbox = toolbox or None
        sub = meta["user_sub"]
        store.update_run(run_id, status="running", stage="planning")
        t0 = time.time()
        set_agent("Research lead", "running", "Splitting the work")
        title, directions = plan_directions(usage, brief, settings["directions"])
        set_agent("Research lead", "done", f"{len(directions)} research directions", time.time() - t0)
        store.update_run(run_id, title=title, stage="researching")

        with lock:
            for d in directions:
                agents[d["name"]] = {"status": "running", "note": d["question"]}
            store.update_run(run_id, agents=dict(agents))

        def work(direction):
            t = time.time()
            try:
                findings, pages, hits = research(usage, brief, direction, mode, toolbox)
                set_agent(direction["name"], "done", f"{len(pages)} pages read, {len(findings)} findings", time.time() - t)
                return direction, findings, pages
            except Exception as exc:
                set_agent(direction["name"], "failed", str(exc)[:200], time.time() - t)
                return direction, [], {}

        with ThreadPoolExecutor(max_workers=len(directions)) as pool:
            results = list(pool.map(work, directions))

        store.update_run(run_id, stage="verifying")
        t0 = time.time()
        raw_cards = []
        evidence = toolbox.context.evidence if toolbox else {}
        for direction, findings, pages in results:
            raw_cards += make_cards(direction, findings, {**pages, **evidence})
        tightened = tighten_claims(usage, [c for c in raw_cards if c.get("source_kind") != "ebay_api"])
        cards = store.put_cards(sub, raw_cards, run_id) if raw_cards else []
        sourced = sum(1 for c in cards if c["type"] == "sourced")
        set_agent("Quote checker", "done",
                  f"{sourced} of {len(cards)} quotes found on the page; {tightened} claims narrowed to their quote",
                  time.time() - t0)
        if not sourced:
            raise RuntimeError("No finding could be checked against its source page. Try a more specific question.")

        writer = WRITER_NAMES[feature]
        store.update_run(run_id, stage="planning_marketing")
        t0 = time.time()
        set_agent(writer, "running", "Writing the report")
        doc = write_report(usage, brief, cards, directions, settings["writer_effort"])
        if template["id"] == "ebay":
            doc = ebay_report.asking_wording(doc)
        set_agent(writer, "done", "Report written", time.time() - t0)

        store.update_run(run_id, stage="checking")
        t0 = time.time()
        set_agent("Reviewer", "running", "Checking every sourced statement")
        relabelled = check(usage, doc, cards)
        mark_official(doc, cards)
        set_agent("Reviewer", "done", f"{relabelled} statements relabelled as assumptions", time.time() - t0)

        store.update_run(run_id, stage="writing")
        budget_lines = doc.get("budget") or []
        coverage = {
            "directions": len(directions),
            "pages_read": sum(len(pages) for _, _, pages in results),
            "quotes_found": sourced,
            "quotes_total": len(cards),
            "claims_narrowed": tightened,
            "relabelled": relabelled,
        }
        extra_charts, template_fields, missing = [], {}, list(doc["missing_evidence"])
        if template["id"] == "ebay":
            listings = ebay_report.cited_listings(cards, evidence)
            fees, ad_budget, notes = (ebay_report.fee_breakdown(doc.get("ebay_fees"), cards, brief, listings)
                                      if feature == "marketing_plan" else (None, None, []))
            if not toolbox:
                notes.append("eBay listings could not be searched for this report (eBay is not connected).")
            missing += [note for note in notes if note not in missing]
            template_fields = {"listings": listings if feature == "competitor_scan" else [], "fees": fees, "ad_budget": ad_budget}
            extra_charts = [charts.asking_prices_chart(listings) if feature == "competitor_scan" else None,
                            charts.ebay_costs_chart(fees)]
            coverage["ebay_searches"] = toolbox.context.counts.get("ebay_snapshots", 0) if toolbox else 0
        result = {
            "version": 4 if template["id"] == "ebay" else 3,
            "template": template["id"],
            "feature": feature,
            "mode": mode,
            "title": title,
            "generated_at": now(),
            "brief": brief,
            "takeaway": doc["takeaway"],
            "findings": doc["findings"],
            "table": doc.get("table"),
            "plan": doc.get("plan") or [],
            "budget": ({"currency": "USD", "total": round(sum(float(b["amount"]) for b in budget_lines), 2), "lines": budget_lines}
                       if feature == "marketing_plan" else None),
            "checklist": doc.get("checklist") or [],
            "next_steps": doc["next_steps"],
            "missing_evidence": missing,
            "coverage": coverage,
            "charts": charts.build_charts(feature, doc, cards, coverage, extra=extra_charts,
                                          asking=template["id"] == "ebay" and feature == "competitor_scan"),
            **template_fields,
            "cards": cards,
            "cost": usage.as_dict(),
            "agents": timings,
            "seconds": round(time.time() - started),
        }
        store.save_result(run_id, result)
        store.update_run(run_id, status="done", stage="done", cost_usd=usage.cost_usd(), agents=agents)
    except Exception as exc:
        traceback.print_exc()
        store.update_run(run_id, status="failed", error=str(exc)[:500], cost_usd=usage.cost_usd(), agents=agents)
