"""Chart specs for a report, built in code from the writer's structured fields (never drawn by the model)."""

import json
import math
import re


def _number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number >= 0 else None


def _clean(value, limit=60):
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


def _money(value):
    return f"${value:,.0f}" if float(value).is_integer() else f"${value:,.2f}"


def _count(value):
    return f"{value:,.0f}" if value >= 10 or float(value).is_integer() else f"{value:.1f}"


def stated(value, quotes):
    """True when one of the quotes states this number (commas ignored)."""
    numbers = re.findall(r"\d+(?:\.\d+)?", " ".join(quotes).replace(",", ""))
    return any(abs(float(number) - value) < 0.005 for number in numbers)


def _sourced(cards):
    return {card["card_id"]: card for card in cards if card.get("type") == "sourced"}


def _ids(card_ids, by_id):
    return list(dict.fromkeys(cid for cid in card_ids or [] if cid in by_id))


def _chart(chart_id, chart_type, title, caption, unit, kind, series, method=""):
    return {"id": chart_id, "type": chart_type, "title": title, "caption": caption, "unit": unit,
            "kind": kind, "series": series, "method": method}


def price_series(doc, cards):
    """One item per sourced table row whose quote states the price; low/high for from-to prices."""
    by_id = _sourced(cards)
    series = []
    for row in (doc.get("table") or {}).get("rows") or []:
        ids = _ids(row.get("card_ids"), by_id)
        low = _number(row.get("price_usd"))
        if row.get("kind") != "sourced" or not ids or not low:
            continue
        quotes = [by_id[cid]["quote"] for cid in ids]
        if not stated(low, quotes):
            continue
        high = _number(row.get("price_high_usd"))
        if not high or high <= low or not stated(high, quotes):
            high = low
        cells = [_clean(cell, 40) for cell in (row.get("cells") or [])[:2] if _clean(cell)]
        series.append({"label": " · ".join(cells) or "Seller", "value": round(low, 2),
                       "low": round(low, 2), "high": round(high, 2), "card_ids": ids})
    return sorted(series, key=lambda item: item["value"])


def price_charts(doc, cards, asking=False):
    """The price bar chart and the suggested price band; with asking=True (eBay listings) only the band, whose
    comparison says asking prices, because the asking_prices chart shows the listings."""
    series = price_series(doc, cards)
    charts = []
    if series and not asking:
        has_range = any(item["high"] > item["low"] for item in series)
        values = sorted(item["value"] for item in series)
        middle = values[len(values) // 2] if len(values) % 2 else (values[len(values) // 2 - 1] + values[len(values) // 2]) / 2
        top = max(item["high"] for item in series)
        bars = series if has_range else [{key: item[key] for key in ("label", "value", "card_ids")} for item in series]
        charts.append(_chart(
            "prices", "range" if has_range else "bar", "Competitor prices",
            f"Quoted prices run from {_money(values[0])} to {_money(top)}; the middle price is {_money(round(middle, 2))}.",
            "USD", "sourced", bars,
            "Prices as the quoted pages state them; rows without a quoted US dollar price are left out.",
        ))
    band = doc.get("price_band") or {}
    low, high = _number(band.get("low_usd")), _number(band.get("high_usd"))
    if low and high:
        low, high = min(low, high), max(low, high)
        items = []
        caption = f"A suggested price of {_money(low)} to {_money(high)}."
        if series:
            floor, top = series[0]["value"], max(item["high"] for item in series)
            ids = list(dict.fromkeys(cid for item in series for cid in item["card_ids"]))
            items.append({"label": "Competitor prices", "value": floor, "low": floor, "high": top, "card_ids": ids})
            noun = "asking prices of active eBay listings" if asking else "quoted prices"
            caption = f"A suggested price of {_money(low)} to {_money(high)}, against {noun} of {_money(floor)} to {_money(top)}."
        items.append({"label": "Your suggested price", "value": low, "low": low, "high": high, "card_ids": []})
        charts.append(_chart("price_band", "range", "Suggested price band", caption, "USD", "estimate", items,
                             _clean(band.get("method"), 400)))
    return charts


def budget_charts(doc, cards):
    by_id = _sourced(cards)
    series = []
    for line in doc.get("budget") or []:
        amount = _number(line.get("amount"))
        if amount:
            series.append({"label": _clean(line.get("item")) or "Budget line", "value": round(amount, 2),
                           "card_ids": _ids(line.get("card_ids"), by_id)})
    charts = []
    total = sum(item["value"] for item in series)
    if series:
        largest = max(series, key=lambda item: item["value"])
        sourced = all(line.get("kind") == "sourced" for line in doc.get("budget") or [])
        charts.append(_chart(
            "budget", "bar", "4-week budget by line",
            f"{largest['label']} is the largest line: {_money(largest['value'])} of {_money(round(total, 2))}.",
            "USD", "sourced" if sourced else "estimate", series,
            "Each bar is one line of the 4-week budget; together they make the total.",
        ))
    projection = projection_chart(doc.get("projection"), total, by_id)
    if projection:
        charts.append(projection)
    return charts


def projection_chart(inputs, budget_total, by_id):
    """First-month visits and sales from ad spend, cost per click and a conversion range."""
    inputs = inputs or {}
    spend, cpc = _number(inputs.get("ad_spend_usd")), _number(inputs.get("cost_per_click_usd"))
    rates = [_number(inputs.get("conversion_low_pct")), _number(inputs.get("conversion_high_pct"))]
    if not spend or not cpc or None in rates or max(rates) <= 0:
        return None
    if budget_total:
        spend = min(spend, budget_total)
    low_pct, high_pct = min(min(rates), 100), min(max(rates), 100)
    visits = spend / cpc
    sales_low, sales_high = visits * low_pct / 100, visits * high_pct / 100
    ids = _ids(inputs.get("card_ids"), by_id)
    method = (f"{_money(spend)} ads ÷ {_money(cpc)} per click = {_count(visits)} visits; × {low_pct:g}–{high_pct:g}% "
              f"conversion = {_count(sales_low)}–{_count(sales_high)} sales")
    order = _number(inputs.get("average_order_usd"))
    if order:
        method += f"; × {_money(order)} average order = {_money(round(sales_low * order))}–{_money(round(sales_high * order))} in sales"
    basis = _clean(inputs.get("basis"), 400)
    method += f". {basis}" if basis else "."
    series = [
        {"label": "Visits from ads", "value": round(visits), "low": round(visits), "high": round(visits), "card_ids": ids},
        {"label": "Sales", "value": round((sales_low + sales_high) / 2, 1), "low": round(sales_low, 1),
         "high": round(sales_high, 1), "card_ids": ids},
    ]
    return _chart(
        "projection", "range", "First-month projection",
        f"With {_money(spend)} of ads, expect about {_count(visits)} visits and {_count(sales_low)}–{_count(sales_high)} sales in the first month.",
        "count", "estimate", series, method,
    )


def theme_charts(doc, cards):
    by_id = _sourced(cards)
    series = []
    for theme in doc.get("themes") or []:
        ids, label = _ids(theme.get("card_ids"), by_id), _clean(theme.get("label"))
        if ids and label:
            series.append({"label": label, "value": len(ids), "card_ids": ids})
    if not series:
        return []
    series.sort(key=lambda item: -item["value"])
    top = series[0]
    return [_chart(
        "themes", "bar", "Buyer themes in the checked quotes",
        f"“{top['label']}” comes up most often: in {top['value']} of {len(by_id)} checked quotes.",
        "count", "sourced", series,
        "Each checked quote is counted once for every theme it shows, so a quote can count more than once.",
    )]


def checklist_charts(doc, cards):
    steps = doc.get("checklist") or []
    if not steps:
        return []
    groups = {"Official source": [], "Other source": [], "Assumption": []}
    for step in steps:
        if step.get("official"):
            groups["Official source"].append(step)
        elif step.get("kind") == "assumption":
            groups["Assumption"].append(step)
        else:
            groups["Other source"].append(step)
    series = [
        {"label": label, "value": len(items), "card_ids": list(dict.fromkeys(cid for s in items for cid in s.get("card_ids") or []))}
        for label, items in groups.items()
    ]
    official = len(groups["Official source"])
    return [_chart(
        "checklist", "stacked_bar", "Checklist steps by evidence",
        f"{official} of {len(steps)} steps cite an official source; confirm the others with the office.",
        "count", "sourced", series,
        "Official means the cited page is a government site or the selling platform's own help pages.",
    )]


def coverage_chart(coverage):
    found, total, pages = coverage.get("quotes_found", 0), coverage.get("quotes_total", 0), coverage.get("pages_read", 0)
    return _chart(
        "coverage", "bar", "Evidence coverage",
        f"{found} of {total} quotes were found word for word on the {pages} pages read.",
        "count", "sourced",
        [{"label": "Pages read", "value": pages, "card_ids": []},
         {"label": "Quotes checked", "value": total, "card_ids": []},
         {"label": "Quotes found on the page", "value": found, "card_ids": []}],
        "Counted by the quote checker: a quote is found when it appears word for word in the captured page text.",
    )


FEATURE_CHARTS = {
    "market_check": [theme_charts],
    "competitor_scan": [price_charts],
    "marketing_plan": [budget_charts],
    "launch_checklist": [checklist_charts],
}


def _dates(items):
    days = sorted({item["retrieved_at"][:10] for item in items if item.get("retrieved_at")})
    return " and ".join(_day(day) for day in days) or "the retrieval date"


def _day(iso_date):
    year, month, day = (int(part) for part in iso_date.split("-"))
    return f"{['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1]} {day}, {year}"


def asking_prices_chart(listings):
    """Asking prices of the comparable active eBay listings, cheapest first. Never sold prices."""
    usd = [item for item in listings if item.get("currency") == "USD" and _number(item.get("price"))]
    if not usd:
        return None
    usd = sorted(usd, key=lambda item: item["price"])
    values = [item["price"] for item in usd]
    middle = values[len(values) // 2] if len(values) % 2 else (values[len(values) // 2 - 1] + values[len(values) // 2]) / 2
    return _chart(
        "asking_prices", "bar", "Asking prices of comparable eBay listings",
        (f"Asking prices of active listings on {_dates(usd)}, not sold prices: {len(usd)} comparable eBay listings "
         f"ask {_money(values[0])} to {_money(values[-1])}; the middle asking price is {_money(round(middle, 2))}."),
        "USD", "sourced",
        [{"label": _clean(item["title"], 40), "value": item["price"], "card_ids": [item["card_id"]]} for item in usd],
        "Asking prices from the eBay Browse API, without shipping (shown in the listings table). eBay does not give us sold prices.",
    )


def ebay_costs_chart(fees):
    """Where the sale total goes at each ad-rate scenario: fees, shipping, ad fee and what is left."""
    if not fees or not fees.get("complete") or not fees.get("scenarios"):
        return None
    amounts = {line["item"]: line["amount"] for line in fees["lines"]}
    series = []
    for scenario in fees["scenarios"]:
        segments = [{"label": label, "value": amounts[item]} for label, item in
                    (("Final value fee", "Final value fee"), ("Per-order fee", "Per-order fee"), ("Shipping", "Shipping label"))
                    if item in amounts]
        segments += [{"label": "Ad fee", "value": scenario["ad_fee"]},
                     {"label": "What is left", "value": max(scenario["left"], 0)}]
        label = f"Ad rate {scenario['ad_rate_pct']:g}%" + (f" (loss of ${-scenario['left']:,.2f})" if scenario["left"] < 0 else "")
        series.append({"label": label, "value": fees["sale_total"], "card_ids": [], "segments": segments})
    middle = fees["scenarios"][len(fees["scenarios"]) // 2]
    left = middle["left"]
    left_text = f"${left:,.2f}" if left >= 0 else f"a loss of ${-left:,.2f}"
    return _chart(
        "ebay_costs", "stacked_bar", "Where an eBay sale goes, by ad rate",
        f"At a {middle['ad_rate_pct']:g}% ad rate, {left_text} of the ${fees['sale_total']:,.2f} sale total is left before your own cost of the item.",
        "USD", "estimate", series, fees["method"],
    )


def build_charts(feature, doc, cards, coverage, extra=(), asking=False):
    """Chart specs for result.charts; a chart that cannot be built is left out instead of failing the run.
    `extra` charts (a template's) go after the tool's charts, or first with `asking` (eBay listings, which the
    suggested price band is then compared against)."""
    extra = [chart for chart in extra if chart]
    charts = list(extra) if asking else []
    for build in FEATURE_CHARTS.get(feature, []):
        try:
            charts += build(doc, cards, asking=True) if asking and build is price_charts else build(doc, cards)
        except Exception as exc:
            print(json.dumps({"chart_failed": build.__name__, "error": str(exc)[:200]}))
    if not asking:
        charts += extra
    charts.append(coverage_chart(coverage))
    return charts
