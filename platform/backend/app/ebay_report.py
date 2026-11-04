"""eBay seller template: comparable listings and the eBay cost breakdown, built in code from checked inputs.

Fee rates count only when a sourced card from an ebay.com help page fetched in this run states the number;
everything computed from them is an estimate with its method written out. "What is left" is before the
founder's own cost of making or buying the item.
"""

import math
import re
import statistics
import urllib.parse

from .charts import stated

MAX_LISTINGS = 12
SCENARIO_LABELS = {1: ["Typical"], 2: ["Low", "High"], 3: ["Low", "Typical", "High"]}
AD_BASE_NOTE = "This assumes the ad fee is charged on the sale total (price plus any shipping the buyer pays)."
PRIORITY_DEFAULT = ("Promoted Listings Priority is charged per click, whether or not the item sells; if you try it, "
                    "set a small daily budget.")


def usd(value):
    return f"{'-' if value < 0 else ''}${abs(value):,.2f}"


def _number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number >= 0 else None


def _official(card):
    host = urllib.parse.urlsplit(card.get("url") or "").netloc.lower()
    return (card.get("type") == "sourced" and card.get("source_kind") != "ebay_api"
            and (host == "ebay.com" or host.endswith(".ebay.com")))


def _states(value, quote):
    if stated(value, [quote]):
        return True
    return value < 1 and "cent" in quote.lower() and stated(round(value * 100, 2), [quote])


def checked(value, card_ids, by_id, official=_official):
    """(value, ids of ebay.com help-page cards that state it), or (None, []) when no such card states it.
    `official` decides which cards count (the Etsy template passes its etsy.com help-page test)."""
    value = _number(value)
    if value is None:
        return None, []
    ids = [cid for cid in dict.fromkeys(card_ids or []) if cid in by_id and official(by_id[cid])
           and _states(value, by_id[cid]["quote"])]
    return (value, ids) if ids else (None, [])


def cited_listings(cards, evidence):
    """Comparable active listings that a sourced fact card cites, cheapest first (US dollar prices first)."""
    listings = {}
    for card in cards:
        page = evidence.get(card.get("url")) if card.get("source_kind") == "ebay_api" and card.get("type") == "sourced" else None
        if page and page["item"]["url"] not in listings:
            item = page["item"]
            listings[item["url"]] = {
                **{key: item[key] for key in ("title", "price", "currency", "shipping", "condition", "url", "image_url",
                                              "seller_feedback", "buying_options", "retrieved_at")},
                "card_id": card["card_id"],
            }
    return sorted(listings.values(), key=lambda item: (item["currency"] != "USD", item["price"]))[:MAX_LISTINGS]


def _median(values):
    return round(statistics.median(values), 2) if values else None


def _price(answers, inputs, listings):
    target = _number(answers.get("target_price_usd"))
    if target:
        return target, "Your target price"
    middle = _median([item["price"] for item in listings if item["currency"] == "USD"])
    if middle:
        count = sum(1 for item in listings if item["currency"] == "USD")
        return middle, f"Middle asking price of {count} comparable active eBay listings (estimate)"
    estimate = _number(inputs.get("target_price_usd"))
    if estimate:
        return estimate, "Estimated price; no target price was given"
    return None, None


def _shipping(answers, inputs, listings):
    own = _number(answers.get("shipping_cost_usd"))
    if own:
        return own, "your estimate"
    estimate = _number(inputs.get("shipping_cost_usd"))
    if estimate:
        method = " ".join(str(inputs.get("shipping_method") or "").split())[:200]
        return estimate, f"estimate{': ' + method if method else ''}"
    paid = [item["shipping"] for item in listings if item.get("shipping")]
    if paid:
        return _median(paid), f"middle shipping cost of {len(paid)} comparable listings"
    return None, None


def _ad_rates(inputs, low, high):
    rates = []
    for value in inputs.get("ad_rates_pct") or []:
        rate = _number(value)
        if rate and rate <= 100:
            rate = min(max(rate, low or 0), high or 100)
            rates.append(round(rate, 2))
    return sorted(set(rates))[:3]


def fee_breakdown(inputs, cards, brief, listings):
    """Returns (fees, ad_budget, missing_evidence lines). fees is None without a price to work from."""
    inputs, answers = inputs or {}, (brief or {}).get("ebay") or {}
    by_id = {card["card_id"]: card for card in cards}
    price, price_basis = _price(answers, inputs, listings)
    if not price:
        return None, None, ["No target price was given and no comparable listing price was found, so eBay fees were not estimated."]
    buyer_pays = answers.get("buyer_pays_shipping")
    if not isinstance(buyer_pays, bool):
        buyer_pays = inputs.get("buyer_pays_shipping")
    assumed = not isinstance(buyer_pays, bool)
    buyer_pays = True if assumed else buyer_pays
    shipping, shipping_basis = _shipping(answers, inputs, listings)
    charged = shipping if buyer_pays and shipping else 0
    total = round(price + charged, 2)
    missing, lines = [], []

    rate, rate_ids = checked(inputs.get("final_value_fee_pct"), inputs.get("final_value_fee_card_ids"), by_id)
    if rate is not None and 0 < rate <= 100:
        amount = round(total * rate / 100, 2)
        lines.append({"item": "Final value fee", "rate_pct": rate, "amount": amount, "kind": "estimate",
                      "card_ids": rate_ids, "method": f"{rate:g}% × {usd(total)} sale total = {usd(amount)}"})
    else:
        rate = None
        missing.append("eBay's final value fee rate for this category was not found on an ebay.com page in this run, "
                       "so it is left out of the cost breakdown.")
    order, order_ids = checked(inputs.get("per_order_fee_usd"), inputs.get("per_order_fee_card_ids"), by_id)
    if order is not None:
        lines.append({"item": "Per-order fee", "rate_pct": None, "amount": round(order, 2), "kind": "estimate",
                      "card_ids": order_ids, "method": f"{usd(order)} per order"})
    else:
        missing.append("eBay's per-order fee was not found on an ebay.com page in this run, so it is left out of the cost breakdown.")
    if shipping:
        method = (f"The buyer pays {usd(shipping)} shipping ({shipping_basis}); you spend it on the label" if buyer_pays
                  else f"Free shipping for the buyer: you pay about {usd(shipping)} for the label ({shipping_basis})")
        if assumed:
            method += "; assumes the buyer pays shipping"
        lines.append({"item": "Shipping label", "rate_pct": None, "amount": round(shipping, 2), "kind": "estimate",
                      "card_ids": [], "method": method})
    left = round(total - sum(line["amount"] for line in lines), 2)
    method = (f"What is left = {usd(total)} sale total"
              + "".join(f" − {usd(line['amount'])} {line['item'].lower()}" for line in lines)
              + f" = {usd(left)}, before your own cost of the item.")
    if charged:
        method = f"Sale total = {usd(price)} price + {usd(charged)} shipping paid by the buyer. " + method
    if not shipping:
        method += " Shipping is not included."

    low, low_ids = checked(inputs.get("ad_rate_min_pct"), inputs.get("ad_rate_card_ids"), by_id)
    high, high_ids = checked(inputs.get("ad_rate_max_pct"), inputs.get("ad_rate_card_ids"), by_id)
    if low is not None and high is not None and low > high:
        low, high = None, None
    rates = _ad_rates(inputs, low, high)
    scenarios = []
    for label, ad_rate in zip(SCENARIO_LABELS.get(len(rates), []), rates):
        ad_fee = round(total * ad_rate / 100, 2)
        scenarios.append({
            "label": label, "ad_rate_pct": ad_rate, "ad_fee": ad_fee, "left": round(left - ad_fee, 2), "kind": "estimate",
            "method": f"{ad_rate:g}% × {usd(total)} = {usd(ad_fee)} ad fee; {usd(left)} − {usd(ad_fee)} = {usd(round(left - ad_fee, 2))} left",
        })
    complete = rate is not None and order is not None
    fees = {
        "currency": "USD", "price": round(price, 2), "price_basis": price_basis, "buyer_pays_shipping": buyer_pays,
        "shipping_cost": round(shipping, 2) if shipping else None, "sale_total": total, "lines": lines,
        "left_before_ads": left, "scenarios": scenarios, "complete": complete, "kind": "estimate",
        "method": method + (" " + AD_BASE_NOTE if scenarios else ""),
    }
    if not complete:
        return fees, None, missing
    break_even = round(max(left, 0) / total * 100, 1) if total else 0
    ceiling = round(break_even / 2, 1)
    if break_even <= 0:
        suggestion = "Suggestion: do not use Promoted Listings General at this price; nothing is left before ads."
    else:
        suggestion = (f"Suggestion: keep the Promoted Listings General ad rate at or below {ceiling:g}%, half the "
                      f"break-even rate, so you keep at least half of what is left.")
        if low is not None and ceiling < low:
            suggestion += f" eBay's lowest ad rate is {low:g}%, above this ceiling."
    priority = inputs.get("priority") if isinstance(inputs.get("priority"), dict) and (inputs["priority"].get("text") or "").strip() else None
    ad_budget = {
        "break_even_rate_pct": break_even, "suggested_max_rate_pct": ceiling, "suggestion": suggestion,
        "min_rate_pct": low, "max_rate_pct": high, "rate_card_ids": list(dict.fromkeys(low_ids + high_ids)),
        "kind": "estimate",
        "method": (f"Break-even ad rate = {usd(max(left, 0))} left before ads ÷ {usd(total)} sale total = {break_even:g}%; "
                   f"the suggested ceiling is half of it. {AD_BASE_NOTE}"),
        "priority": priority or {"text": PRIORITY_DEFAULT, "kind": "assumption", "card_ids": [], "method": ""},
    }
    return fees, ad_budget, missing


_SELLS = re.compile(r"\b(sells|sell|sold|selling) for\b", re.IGNORECASE)
_LISTED = {"sells": "is listed at", "sell": "are listed at", "sold": "was listed at", "selling": "listed at"}


def asking_wording(value):
    """Rewrites "sells for" and similar phrases in every string of a writer answer; eBay shows asking prices."""
    if isinstance(value, str):
        def listed(match):
            words = _LISTED[match.group(1).lower()]
            return words[0].upper() + words[1:] if match.group(1)[0].isupper() else words
        return _SELLS.sub(listed, value)
    if isinstance(value, list):
        return [asking_wording(item) for item in value]
    if isinstance(value, dict):
        return {key: asking_wording(item) if key not in {"card_ids", "kind"} else item for key, item in value.items()}
    return value
