"""Etsy seller template: the Etsy cost breakdown per sale, built in code from checked inputs (like ebay_report).

Fee rates count only when a sourced card from an etsy.com help or policy page fetched in this run states the
number: listing fee, transaction fee, payment processing fee, each Offsite Ads tier and the Offsite Ads cap.
Everything computed from them is an estimate with its method written out. "What is left" is before the founder's
own cost of making the item, and may be negative (a loss).
"""

import statistics

from .capabilities.etsy import is_etsy_help
from .ebay_report import checked, usd

MAX_TIERS = 3
FEE_BASE_NOTE = ("This assumes Etsy's transaction, processing and Offsite Ads fees are charged on the sale total (price "
                 "plus any shipping the buyer pays); sales tax is left out.")
ETSY_ADS_DEFAULT = ("Etsy Ads on Etsy are charged per click, whether or not the item sells; if you try them, set a small "
                    "daily budget.")
NO_PRICE = "No target price was given and no comparable Etsy listing price was found, so Etsy fees were not estimated."


def _official(card):
    return card.get("type") == "sourced" and is_etsy_help(card.get("url"))


def _number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and abs(number) != float("inf") and number >= 0 else None


def _clean(value, limit=60):
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


def _price(answers, inputs, listings):
    target = _number(answers.get("target_price_usd"))
    if target:
        return target, "Your target price"
    prices = [item["price"] for item in listings or [] if _number(item.get("price"))]
    if prices:
        return round(statistics.median(prices), 2), f"Middle asking price of {len(prices)} comparable Etsy listings (estimate)"
    estimate = _number(inputs.get("target_price_usd"))
    if estimate:
        return estimate, "Estimated price; no target price was given"
    return None, None


def _shipping(answers, inputs):
    own = _number(answers.get("shipping_cost_usd"))
    if own:
        return own, "your estimate"
    estimate = _number(inputs.get("shipping_cost_usd"))
    if estimate:
        method = " ".join(str(inputs.get("shipping_method") or "").split())[:200]
        return estimate, f"estimate{': ' + method if method else ''}"
    return None, None


def fee_breakdown(inputs, cards, brief, listings=()):
    """Returns (fees or None, missing evidence lines). cards are this run's cards; listings are comparable Etsy
    listings ({price}) used for the price when the founder gave none."""
    inputs, answers = inputs or {}, (brief or {}).get("etsy") or {}
    by_id = {card["card_id"]: card for card in cards}
    price, price_basis = _price(answers, inputs, listings)
    if not price:
        return None, [NO_PRICE]
    buyer_pays = answers.get("buyer_pays_shipping")
    if not isinstance(buyer_pays, bool):
        buyer_pays = inputs.get("buyer_pays_shipping")
    assumed = not isinstance(buyer_pays, bool)
    buyer_pays = True if assumed else buyer_pays
    shipping, shipping_basis = _shipping(answers, inputs)
    charged = shipping if buyer_pays and shipping else 0
    total = round(price + charged, 2)
    lines, missing = [], []

    def check(value, ids):
        return checked(value, ids, by_id, official=_official)

    listing, listing_ids = check(inputs.get("listing_fee_usd"), inputs.get("listing_fee_card_ids"))
    if listing:
        lines.append({"item": "Listing fee", "rate_pct": None, "amount": round(listing, 2), "kind": "estimate",
                      "card_ids": listing_ids, "method": f"{usd(listing)} per listing"})
    else:
        listing = None
        missing.append("Etsy's listing fee was not found on an etsy.com page in this run, so it is left out of the cost breakdown.")
    rate, rate_ids = check(inputs.get("transaction_fee_pct"), inputs.get("transaction_fee_card_ids"))
    if rate and rate <= 100:
        amount = round(total * rate / 100, 2)
        lines.append({"item": "Transaction fee", "rate_pct": rate, "amount": amount, "kind": "estimate",
                      "card_ids": rate_ids, "method": f"{rate:g}% × {usd(total)} sale total = {usd(amount)}"})
    else:
        rate = None
        missing.append("Etsy's transaction fee rate was not found on an etsy.com page in this run, so it is left out of the cost breakdown.")
    processing, processing_ids = check(inputs.get("processing_fee_pct"), inputs.get("processing_fee_card_ids"))
    fixed, fixed_ids = check(inputs.get("processing_fee_fixed_usd"), inputs.get("processing_fee_card_ids"))
    if processing and processing <= 100:
        amount = round(total * processing / 100 + (fixed or 0), 2)
        method = f"{processing:g}% × {usd(total)}" + (f" + {usd(fixed)}" if fixed else "") + f" = {usd(amount)}"
        lines.append({"item": "Payment processing fee", "rate_pct": processing, "amount": amount, "kind": "estimate",
                      "card_ids": list(dict.fromkeys(processing_ids + fixed_ids)), "method": method})
        if not fixed and _number(inputs.get("processing_fee_fixed_usd")):
            missing.append("Etsy's fixed payment processing fee per order was not found on an etsy.com page in this run, "
                           "so only the percentage is included.")
    else:
        processing = None
        missing.append("Etsy's payment processing fee was not found on an etsy.com page in this run, so it is left out of the cost breakdown.")
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

    cap, cap_ids = check(inputs.get("offsite_ads_cap_usd"), inputs.get("offsite_ads_cap_card_ids"))
    tiers, seen, unchecked = [], set(), 0
    for tier in (inputs.get("offsite_ads") or [])[:MAX_TIERS]:
        tier_rate, tier_ids = check((tier or {}).get("rate_pct"), (tier or {}).get("card_ids"))
        if not tier_rate or tier_rate > 100:
            unchecked += 1
            continue
        if tier_rate in seen:
            continue
        seen.add(tier_rate)
        raw_fee = round(total * tier_rate / 100, 2)
        fee = min(raw_fee, round(cap, 2)) if cap else raw_fee
        after = round(left - fee, 2)
        tiers.append({
            "label": _clean(tier.get("label")) or f"Offsite Ads at {tier_rate:g}%", "ad_rate_pct": tier_rate,
            "ad_fee": fee, "left": after, "card_ids": list(dict.fromkeys(tier_ids + (cap_ids if fee < raw_fee else []))),
            "kind": "estimate",
            "method": (f"{tier_rate:g}% × {usd(total)} = {usd(raw_fee)}" + (f", capped at {usd(cap)}" if fee < raw_fee else "")
                       + f" Offsite Ads fee; {usd(left)} − {usd(fee)} = {usd(after)} left"),
        })
    if unchecked:
        missing.append("An Offsite Ads fee rate was not found on an etsy.com page in this run, so that scenario is left out.")
    scenarios = []
    if tiers:
        scenarios = [{"label": "Order not from an Offsite Ad", "ad_rate_pct": 0, "ad_fee": 0.0, "left": left,
                      "card_ids": [], "kind": "estimate", "method": "No Offsite Ads fee on this order."}] + tiers
    complete = listing is not None and rate is not None and processing is not None
    if left <= 0:
        summary = (f"At {usd(price)}, nothing is left before your own cost of the item: "
                   + ("fees" + (" and shipping" if shipping else "") + " take the whole sale total" if left == 0
                      else f"each sale loses {usd(-left)} after fees" + (" and shipping" if shipping else ""))
                   + ((", and an order that comes through an Offsite Ad would lose " + ("more." if left < 0 else "money."))
                      if tiers else "."))
    else:
        summary = f"At {usd(price)}, about {usd(left)} of the {usd(total)} sale total is left before your own cost of the item"
        if tiers:
            worst = max(tiers, key=lambda tier: tier["ad_fee"])
            leftover = usd(worst["left"]) if worst["left"] >= 0 else f"a loss of {usd(-worst['left'])}"
            summary += f"; an order from an Offsite Ad at {worst['ad_rate_pct']:g}% leaves {leftover}"
        summary += "."
    if not complete:
        summary += " Some Etsy fees could not be checked, so the real amount left is lower."
    etsy_ads = inputs.get("etsy_ads") if isinstance(inputs.get("etsy_ads"), dict) and (inputs["etsy_ads"].get("text") or "").strip() else None
    fees = {
        "currency": "USD", "price": round(price, 2), "price_basis": price_basis, "buyer_pays_shipping": buyer_pays,
        "shipping_cost": round(shipping, 2) if shipping else None, "sale_total": total, "lines": lines,
        "left_before_ads": left, "scenarios": scenarios, "offsite_ads_cap": round(cap, 2) if cap else None,
        "offsite_ads_cap_card_ids": cap_ids, "complete": complete, "kind": "estimate",
        "method": method + " " + FEE_BASE_NOTE,
        "summary": {"text": summary, "kind": "estimate", "card_ids": [], "method": method},
        "etsy_ads": etsy_ads or {"text": ETSY_ADS_DEFAULT, "kind": "assumption", "card_ids": [], "method": ""},
    }
    return fees, missing
