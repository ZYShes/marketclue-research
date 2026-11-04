"""Local-business templates (Food truck, Restaurant / café, Daycare / childcare) and Etsy listings: requirements,
nearby prices and startup costs, built in code from checked fact cards and the writer's structured fields.

- Requirements: Sourced only when a cited card comes from an official government page fetched in this run;
  otherwise an Assumption that says which agency to check with. A fee is shown only when a sourced card from this
  run states it.
- Benchmarks: only table rows whose cited sourced card states the price; prices are what each page stated on the
  day it was fetched. Ratings and review counts are kept only when the quote states them.
- Startup costs: each line is a range from sourced cost cards or a figure the founder gave in the brief; a line
  with neither is left out and named in missing evidence; the total is a range, never one precise number.
"""

import math
import re

from .capabilities.local import is_official
from .charts import stated
from .templates import NOT_LEGAL_ADVICE

MAX_BENCHMARKS = 12
DEFAULT_AGENCY = "the city, county or state office"
_RATING = re.compile(r"\b\d(?:\.\d)?\s*(?:/\s*5\s*)?(?:stars?|★)|\b\d[\d,]*\s+(?:reviews?|ratings?)\b|\brat(?:ed|ing)\b|★", re.I)


def _number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def _clean(value, limit=120):
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


def usd(value):
    return f"{'-' if value < 0 else ''}${abs(value):,.2f}"


def whole_usd(value):
    return f"${value:,.0f}"


def _ids(card_ids, by_id):
    return [cid for cid in dict.fromkeys(card_ids or []) if cid in by_id]


def checked_number(value, card_ids, by_id):
    """(value, ids of the cards in by_id whose quote states it), or (None, []) when none does."""
    value = _number(value)
    if value is None:
        return None, []
    ids = [cid for cid in _ids(card_ids, by_id) if stated(value, [by_id[cid]["quote"]])]
    return (value, ids) if ids else (None, [])


# ---------- official_requirements ----------

def requirements(items, run_cards):
    """Returns (section or None, missing evidence lines). run_cards are this run's cards with this run's check."""
    by_id = {card["card_id"]: card for card in run_cards if card.get("type") == "sourced"}
    out, missing = [], []
    for raw in items or []:
        name = _clean(raw.get("requirement") or raw.get("step"), 120)
        if not name:
            continue
        agency = _clean(raw.get("agency"), 120) or DEFAULT_AGENCY
        cited = [by_id[cid] for cid in _ids(raw.get("card_ids"), by_id)]
        official = [card for card in cited if is_official(card["url"])]
        sourced = raw.get("kind") == "sourced" and bool(official)
        link = (official if sourced else cited or [None])[0]
        fee, fee_ids = checked_number(raw.get("fee_usd"), raw.get("fee_card_ids"), by_id)
        if fee is None and _number(raw.get("fee_usd")) is not None:
            missing.append(f"The fee for \"{name}\" was not stated on a page checked in this run, so it is left out.")
        out.append({
            "requirement": name,
            "agency": agency,
            "text": _clean(raw.get("text"), 600),
            "url": link["url"] if link else None,
            "source_title": link.get("source_title") if link else None,
            "captured_at": link.get("captured_at") if link else None,
            "fee_usd": round(fee, 2) if fee is not None else None,
            "fee_card_ids": fee_ids,
            "kind": "sourced" if sourced else "assumption",
            "official": sourced,
            "card_ids": [card["card_id"] for card in (official if sourced else cited)],
            "method": "" if sourced else f"Not confirmed on an official page in this run. Check with {agency}.",
        })
    if not out:
        return None, missing
    unconfirmed = sum(1 for item in out if not item["official"])
    if unconfirmed:
        missing.insert(0, f"{unconfirmed} of {len(out)} requirements could not be confirmed on an official government "
                          "page in this run; check them with the agency named.")
    return {"title": "Requirements to check", "note": NOT_LEGAL_ADVICE, "items": out,
            "official_count": len(out) - unconfirmed}, missing


# ---------- local_benchmarks / etsy_listings ----------

def _notes(value, quotes, privacy):
    notes = _clean(value, 160)
    if privacy or not notes:
        return ""
    if _RATING.search(notes):
        numbers = re.findall(r"\d+(?:\.\d+)?", notes.replace(",", ""))
        if not numbers or not all(stated(float(number), quotes) for number in numbers):
            return ""
    return notes


def benchmarks(doc, by_id, config, privacy=False):
    """Returns (section or None, missing lines). by_id holds the sourced cards a price may come from."""
    items, skipped = [], 0
    for row in (doc.get("table") or {}).get("rows") or []:
        low = _number(row.get("price_usd"))
        ids = _ids(row.get("card_ids"), by_id)
        quotes = [by_id[cid]["quote"] for cid in ids]
        if not low:
            continue
        if row.get("kind") != "sourced" or not ids or not stated(low, quotes):
            skipped += 1
            continue
        high = _number(row.get("price_high_usd"))
        if not high or high <= low or not stated(high, quotes):
            high = None
        cells = [str(cell or "") for cell in row.get("cells") or []]
        card = by_id[ids[0]]
        items.append({
            "business": _clean(cells[0] if cells else "", 80) or card.get("source_title") or "Business",
            "item": _clean(cells[1] if len(cells) > 1 else "", 80),
            "price": round(low, 2),
            "price_high": round(high, 2) if high else None,
            "unit": _clean(row.get("price_unit"), 40) or None,
            "notes": _notes(cells[3] if len(cells) > 3 else "", quotes, privacy),
            "url": card["url"],
            "source_title": card.get("source_title") or "",
            "retrieved_at": card.get("captured_at"),
            "card_ids": ids,
            "kind": "sourced",
        })
    items.sort(key=lambda item: item["price"])
    missing = []
    if skipped:
        where = "an etsy.com listing page fetched in this run" if config.get("asking") else "the cited page"
        missing.append(f"{skipped} price{'s' if skipped > 1 else ''} in the table could not be checked against a quote "
                       f"on {where}, so {'they are' if skipped > 1 else 'it is'} left out of {config['title']}.")
    if not items:
        return None, missing
    return {"title": config["title"], "what": config["what"], "source": config.get("source", ""),
            "asking": bool(config.get("asking")), "items": items[:MAX_BENCHMARKS]}, missing


# ---------- startup_costs ----------

def _step(total):
    return 10 ** max(1, math.floor(math.log10(total)) - 1) if total > 0 else 10


def startup_costs(lines, cost_lines, by_id, answers):
    """Returns (section or None, missing lines). by_id holds the sourced cards a cost may come from; answers is the
    brief's template object, whose known_costs are the founder's own figures."""
    known = [_number(entry.get("amount_usd")) for entry in (answers or {}).get("known_costs") or [] if isinstance(entry, dict)]
    known = [amount for amount in known if amount]
    kept, dropped = [], []
    for raw in lines or []:
        item = _clean(raw.get("item"), 80)
        category = raw.get("category") if raw.get("category") in cost_lines else "Other"
        low, high = _number(raw.get("low_usd")), _number(raw.get("high_usd"))
        method = _clean(raw.get("method"), 300)
        if not item or not low:
            dropped.append((category, item or category))
            continue
        if raw.get("basis") == "founder":
            if not any(abs(amount - low) < 0.005 for amount in known):
                dropped.append((category, item))
                continue
            kept.append({"category": category, "item": item, "low": round(low, 2), "high": round(low, 2),
                         "basis": "founder", "kind": "estimate", "card_ids": [],
                         "method": f"Your own figure from the brief: {usd(low)}." + (f" {method}" if method else "")})
            continue
        ids = _ids(raw.get("card_ids"), by_id)
        quotes = [by_id[cid]["quote"] for cid in ids]
        if not ids or not stated(low, quotes):
            dropped.append((category, item))
            continue
        if not high or high <= low or not stated(high, quotes):
            high = low
        span = usd(low) if high == low else f"{usd(low)} to {usd(high)}"
        kept.append({"category": category, "item": item, "low": round(low, 2), "high": round(high, 2),
                     "basis": "source", "kind": "estimate", "card_ids": ids,
                     "method": (method + " " if method else "") + f"Checked quote{'s' if len(ids) > 1 else ''}: {span}."})
    covered = {line["category"] for line in kept}
    absent = [category for category in cost_lines if category not in covered]
    missing = [f"No checked source or figure of yours gave a cost for {category[0].lower() + category[1:]}, so it is "
               "left out of the startup costs." for category in absent]
    for category, item in dict.fromkeys(dropped):
        if category in covered or category == "Other":
            missing.append(f"The cost of {item[0].lower() + item[1:]} could not be checked against a quote or your own "
                           "figures, so it is left out of the startup costs.")
    if not kept:
        return None, missing
    order = {category: n for n, category in enumerate(cost_lines)}
    kept.sort(key=lambda line: (order.get(line["category"], len(cost_lines)), -line["high"]))
    sum_low, sum_high = round(sum(line["low"] for line in kept), 2), round(sum(line["high"] for line in kept), 2)
    step = _step(sum_high)
    total_low = math.floor(sum_low / step) * step
    total_high = math.ceil(sum_high / step) * step
    if total_high <= total_low:
        total_high = total_low + step
    method = (f"Total = {usd(sum_low)} (the low ends added up) to {usd(sum_high)} (the high ends added up), rounded "
              f"outward to the nearest {whole_usd(step)}: about {whole_usd(total_low)} to {whole_usd(total_high)}. "
              "Each line comes from a checked quote or a figure you gave; it is a range, not a quote for your business.")
    if absent:
        method += " Not included: " + ", ".join(category[0].lower() + category[1:] for category in absent) + "."
    return {"currency": "USD", "lines": kept, "sum_low": sum_low, "sum_high": sum_high, "total_low": total_low,
            "total_high": total_high, "missing_lines": absent, "kind": "estimate", "method": method}, missing
