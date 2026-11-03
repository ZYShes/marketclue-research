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

from . import claude, store

MAX_DIRECTIONS = 4
USER_AGENT = "MarketClueBot/0.1 (+https://github.com/ZYShes/marketclue-research)"

PLAN_SECTIONS = ["Customers", "Positioning", "Pricing", "Channels", "Content (4 weeks)", "Measurement", "Brand & compliance"]


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
    return "\n".join(lines)


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


def plan_directions(usage, brief):
    out = claude.json_call(
        usage,
        system="You are the research lead at MarketClue. You split a solo founder's research into independent directions that separate research agents can run in parallel.",
        prompt=(
            f"{brief_text(brief)}\n\n"
            f"Split this into 2 to {MAX_DIRECTIONS} research directions that public web pages can answer, "
            "for example competitors and their prices, what customers praise or complain about, channels "
            "similar sellers use, suppliers and costs. Give each a short name (2-4 words), one research "
            "question, and 2-3 search hints. Also give the report a short title (max 8 words)."
        ),
        schema=DIRECTIONS_SCHEMA,
        effort="medium",
    )
    return out["title"], out["directions"][:MAX_DIRECTIONS]


# ---------- 2. Research agents, in parallel ----------

RESEARCH_SYSTEM = """You are a MarketClue research agent. You research one question for a solo founder
using web_search and web_fetch. Search first, then fetch the two or three most useful pages (seller
pages, reviews, forums, articles). Only report what you read in the fetched page text.

Finish with a list of 3-6 findings in exactly this format, one per line:
FINDING | <one-sentence claim in plain English> | "<exact quote copied character for character from the fetched page text, 1-2 sentences, under 300 characters>" | <the fetched page URL>

The quote must appear word for word in the page you fetched; do not paraphrase, merge or fix it.
Prefer concrete facts: prices, product details, what customers say, numbers with dates."""

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


def research(usage, brief, direction):
    prompt = (
        f"{brief_text(brief)}\n\nYour research direction: {direction['name']}\n"
        f"Question: {direction['question']}\nSearch hints: {', '.join(direction.get('search_hints') or [])}"
    )
    blocks = claude.research_call(usage, system=RESEARCH_SYSTEM, prompt=prompt)
    pages = claude.fetched_pages(blocks)
    report = "\n".join(b.text for b in blocks if b.type == "text")
    rows = [line for line in report.splitlines() if line.strip().startswith("FINDING")]
    if not rows:
        return [], pages, claude.search_hits(blocks)
    findings = claude.json_call(
        usage,
        system="You convert research notes into JSON without changing any wording.",
        prompt="Convert each FINDING line into an object. Copy claim, quote (without the surrounding quotation marks) and URL exactly.\n\n" + "\n".join(rows),
        schema=FINDINGS_SCHEMA,
        effort="low",
    )["findings"]
    return findings, pages, claude.search_hits(blocks)


# ---------- 3. Quote checks against captured page text ----------

def normalize_text(value):
    value = unicodedata.normalize("NFKC", html.unescape(value or ""))
    value = value.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    value = value.replace("–", "-").replace("—", "-").replace(" ", " ")
    value = re.sub(r"[*_`#>\[\]]", "", value)
    return re.sub(r"\s+", " ", value).strip().lower()


def normalize_url(url):
    parts = urllib.parse.urlsplit((url or "").strip())
    path = parts.path.rstrip("/") or "/"
    return urllib.parse.urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, parts.query, ""))


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
        if not page or not quote_found(f["quote"], page["text"]):
            fallback = fetch_page(f["url"])
            if fallback and quote_found(f["quote"], fallback["text"]):
                page = fallback
        sourced = bool(page) and quote_found(f["quote"], page["text"])
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


# ---------- 4. Marketing plan and budget ----------

def _item_schema(with_amount=False):
    props = {
        "text": {"type": "string"},
        "kind": {"type": "string", "enum": ["sourced", "assumption", "estimate"]},
        "card_ids": {"type": "array", "items": {"type": "string"}},
        "method": {"type": "string"},
    }
    required = ["text", "kind", "card_ids", "method"]
    if with_amount:
        props = {"item": {"type": "string"}, "amount": {"type": "number"}, **{k: v for k, v in props.items() if k != "text"}}
        required = ["item", "amount", "kind", "card_ids", "method"]
    return {"type": "object", "properties": props, "required": required, "additionalProperties": False}


PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "array", "items": _item_schema()},
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"direction": {"type": "string"}, "items": {"type": "array", "items": _item_schema()}},
                "required": ["direction", "items"],
                "additionalProperties": False,
            },
        },
        "plan": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"section": {"type": "string", "enum": PLAN_SECTIONS}, "items": {"type": "array", "items": _item_schema()}},
                "required": ["section", "items"],
                "additionalProperties": False,
            },
        },
        "budget": {"type": "array", "items": _item_schema(with_amount=True)},
        "next_checks": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "findings", "plan", "budget", "next_checks"],
    "additionalProperties": False,
}

PLAN_SYSTEM = """You are MarketClue's planning agent. You turn checked research into a short, practical
marketing plan and budget for a solo founder. Every statement has a kind:
- sourced: directly supported by the cited fact cards (cite their ids in card_ids);
- assumption: your judgement or a common practice, not backed by a card (card_ids empty);
- estimate: a number you computed; method explains how (e.g. "3 posts a week x 4 weeks x $15 boost").
Only cite cards whose quote really supports the statement. Budget amounts are in US dollars for the
first 4 weeks; budget lines that use a price from a card are sourced, otherwise estimate or assumption.
If the founder gave a budget, stay within it. Keep it short: 3 summary bullets, 2-4 items per section,
3-6 budget lines, 3-5 next checks that say exactly what to verify and how. Plain English."""


def plan_and_budget(usage, brief, cards, directions):
    card_lines = [
        {"id": c["card_id"], "direction": c["direction"], "claim": c["claim"], "quote": c["quote"], "source": c["source_title"]}
        for c in cards
        if c["type"] == "sourced"
    ]
    prompt = (
        f"{brief_text(brief)}\n\nResearch directions: {', '.join(d['name'] for d in directions)}\n\n"
        f"Checked fact cards (JSON):\n{json.dumps(card_lines, ensure_ascii=False)}\n\n"
        "Write the summary, findings grouped by direction (only from the cards), the marketing plan "
        "(sections: " + ", ".join(PLAN_SECTIONS) + ") and a 4-week budget."
    )
    return claude.json_call(usage, system=PLAN_SYSTEM, prompt=prompt, schema=PLAN_SCHEMA, effort="medium", max_tokens=32000)


# ---------- 5. The checker ----------

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


def _sourced_items(doc):
    """Yields (id, item) for every item that claims to be sourced."""
    groups = [("s", doc["summary"])]
    groups += [(f"f{i}-", g["items"]) for i, g in enumerate(doc["findings"])]
    groups += [(f"p{i}-", g["items"]) for i, g in enumerate(doc["plan"])]
    groups += [("b", doc["budget"])]
    for prefix, items in groups:
        for j, item in enumerate(items):
            if item.get("kind") == "sourced":
                yield f"{prefix}{j}", item


def check(usage, doc, cards):
    by_id = {c["card_id"]: c for c in cards if c["type"] == "sourced"}
    items = dict(_sourced_items(doc))
    for item in items.values():
        item["card_ids"] = [cid for cid in item.get("card_ids") or [] if cid in by_id]
    review = []
    for item_id, item in items.items():
        if not item["card_ids"]:
            continue
        review.append({
            "id": item_id,
            "statement": item.get("text") or f"{item.get('item')}: ${item.get('amount')}",
            "quotes": [by_id[cid]["quote"] for cid in item["card_ids"]],
        })
    unsupported = set()
    if review:
        out = claude.json_call(
            usage,
            system="You are MarketClue's checker. You judge whether quoted evidence supports each statement. Be strict: the quotes must state it, not just relate to it.",
            prompt="List the ids of statements that the quotes do NOT support.\n\n" + json.dumps(review, ensure_ascii=False),
            schema=CHECK_SCHEMA,
            effort="low",
        )
        unsupported = {u["id"] for u in out["unsupported"]}
    for item_id, item in items.items():
        if item_id in unsupported or not item["card_ids"]:
            item["kind"] = "assumption"
            item["card_ids"] = []
            item["method"] = item.get("method") or "Not supported by a checked quote; treat as an assumption."
    return len(unsupported)


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
        sub = meta["user_sub"]
        store.update_run(run_id, status="running", stage="planning")
        t0 = time.time()
        set_agent("Research lead", "running", "Splitting the work")
        title, directions = plan_directions(usage, brief)
        set_agent("Research lead", "done", f"{len(directions)} research directions", time.time() - t0)
        store.update_run(run_id, title=title, stage="researching")

        with lock:
            for d in directions:
                agents[d["name"]] = {"status": "running", "note": d["question"]}
            store.update_run(run_id, agents=dict(agents))

        def work(direction):
            t = time.time()
            try:
                findings, pages, hits = research(usage, brief, direction)
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
        for direction, findings, pages in results:
            raw_cards += make_cards(direction, findings, pages)
        cards = store.put_cards(sub, raw_cards, run_id) if raw_cards else []
        sourced = sum(1 for c in cards if c["type"] == "sourced")
        set_agent("Quote checker", "done", f"{sourced} of {len(cards)} quotes found on the page", time.time() - t0)
        if not sourced:
            raise RuntimeError("No finding could be checked against its source page. Try a more specific question.")

        store.update_run(run_id, stage="planning_marketing")
        t0 = time.time()
        set_agent("Marketing planner", "running", "Writing the plan and budget")
        doc = plan_and_budget(usage, brief, cards, directions)
        set_agent("Marketing planner", "done", "Plan and budget ready", time.time() - t0)

        store.update_run(run_id, stage="checking")
        t0 = time.time()
        set_agent("Reviewer", "running", "Checking every sourced statement")
        relabelled = check(usage, doc, cards)
        set_agent("Reviewer", "done", f"{relabelled} statements relabelled as assumptions", time.time() - t0)

        store.update_run(run_id, stage="writing")
        budget_lines = doc["budget"]
        result = {
            "title": title,
            "generated_at": now(),
            "brief": brief,
            "summary": doc["summary"],
            "findings": doc["findings"],
            "cards": cards,
            "plan": doc["plan"],
            "budget": {"currency": "USD", "total": round(sum(float(b["amount"]) for b in budget_lines), 2), "lines": budget_lines},
            "next_checks": doc["next_checks"],
            "cost": usage.as_dict(),
            "agents": timings,
            "seconds": round(time.time() - started),
        }
        store.save_result(run_id, result)
        store.update_run(run_id, status="done", stage="done", cost_usd=usage.cost_usd(), agents=agents)
    except Exception as exc:
        traceback.print_exc()
        store.update_run(run_id, status="failed", error=str(exc)[:500], cost_usd=usage.cost_usd(), agents=agents)
