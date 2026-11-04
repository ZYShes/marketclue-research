"""eBay capabilities: live active listings through the Browse API, and eBay fee estimates.

Every eBay price is the asking price of an active listing on the day it was retrieved; sold prices are not
available to us (Marketplace Insights is a Limited Release). The raw JSON of every search a run uses is saved
to S3 and is the evidence that listing fact cards are checked against.
"""

import hashlib
import json
import threading
import time
from datetime import datetime, timezone

import requests

from .. import store
from ..settings import get_settings
from . import Capability, register

TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"
SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search"
SCOPE = "https://api.ebay.com/oauth/api_scope"
MARKETPLACE = "EBAY_US"
MAX_CALLS_PER_RUN = 8
MAX_LIMIT = 50
TIMEOUT = 30
RETRY_STATUS = {429, 500, 502, 503, 504}
NOT_CONNECTED = "eBay is not connected yet"
CONDITIONS = {"new": "NEW", "used": "USED"}

_token = {"value": None, "expires": 0.0}
_token_lock = threading.Lock()


class EbayError(RuntimeError):
    pass


def available():
    return (True, None) if get_settings().ebay_credentials else (False, NOT_CONNECTED)


def _request(method, url, **kwargs):
    """One HTTP call with a 30 s timeout and one retry after a timeout, connection error, 429 or 5xx."""
    for attempt in range(2):
        try:
            response = requests.request(method, url, timeout=TIMEOUT, **kwargs)
        except (requests.Timeout, requests.ConnectionError):
            if attempt:
                raise
            continue
        if response.status_code in RETRY_STATUS and not attempt:
            continue
        return response


def _access_token(refresh=False):
    """Application token (client-credentials grant), cached in memory until shortly before it expires."""
    with _token_lock:
        if not refresh and _token["value"] and time.time() < _token["expires"]:
            return _token["value"]
        credentials = get_settings().ebay_credentials
        if not credentials:
            raise EbayError(NOT_CONNECTED)
        response = _request(
            "POST", TOKEN_URL, auth=credentials, data={"grant_type": "client_credentials", "scope": SCOPE},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if response.status_code != 200:
            raise EbayError(f"eBay sign-in failed (HTTP {response.status_code})")
        data = response.json()
        _token.update(value=data["access_token"], expires=time.time() + int(data.get("expires_in", 7200)) - 60)
        return _token["value"]


def _browse(params):
    """The raw JSON text of one Browse API search; signs in again once when the token was rejected."""
    for refresh in (False, True):
        headers = {"Authorization": f"Bearer {_access_token(refresh)}", "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE}
        response = _request("GET", SEARCH_URL, params=params, headers=headers)
        if response.status_code == 401 and not refresh:
            continue
        if response.status_code != 200:
            raise EbayError(f"eBay search failed (HTTP {response.status_code})")
        return response.text


def _number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 and number != float("inf") else None


def search_params(tool_input):
    query = " ".join(str(tool_input.get("query") or "").split())[:200]
    if not query:
        raise ValueError("query is required")
    try:
        limit = int(tool_input.get("limit") or 20)
    except (TypeError, ValueError):
        limit = 20
    params = {"q": query, "limit": str(min(max(limit, 1), MAX_LIMIT))}
    category = "".join(ch for ch in str(tool_input.get("category_id") or "") if ch.isdigit())
    if category:
        params["category_ids"] = category
    filters = []
    low, high = _number(tool_input.get("min_price")), _number(tool_input.get("max_price"))
    if low is not None or high is not None:
        filters += [f"price:[{'' if low is None else f'{low:g}'}..{'' if high is None else f'{high:g}'}]", "priceCurrency:USD"]
    condition = CONDITIONS.get(str(tool_input.get("condition") or "").lower())
    if condition:
        filters.append(f"conditions:{{{condition}}}")
    if filters:
        params["filter"] = ",".join(filters)
    return params


def _money(amount):
    return (amount or {}).get("value"), (amount or {}).get("currency") or "USD"


def _price_text(value, currency):
    return f"${value:,.2f}" if currency == "USD" else f"{value:,.2f} {currency}"


def compact_item(item, retrieved_at):
    """The fields a founder needs from one item summary, plus quote_text: the exact string a FINDING quotes."""
    raw_price, currency = _money(item.get("price") or item.get("currentBidPrice"))
    price = _number(raw_price)
    url = (item.get("itemWebUrl") or "").split("?", 1)[0]
    title = " ".join(str(item.get("title") or "").split())
    if price is None or not url or not title:
        return None
    shipping = None
    for option in item.get("shippingOptions") or []:
        cost = _number(_money(option.get("shippingCost"))[0])
        if cost is not None:
            shipping = cost if shipping is None else min(shipping, cost)
    seller = item.get("seller") or {}
    return {
        "title": title, "price": round(price, 2), "currency": currency, "shipping": shipping,
        "condition": item.get("condition") or "", "url": url,
        "image_url": (item.get("image") or {}).get("imageUrl") or "",
        "seller_feedback": seller.get("feedbackScore"), "buying_options": item.get("buyingOptions") or [],
        "retrieved_at": retrieved_at, "quote_text": f"{title} — {_price_text(price, currency)}",
    }


def evidence_text(item):
    """The text a listing card's quote is checked against: the item's title and price fields from the API."""
    shipping = "not given" if item["shipping"] is None else ("free" if item["shipping"] == 0 else _price_text(item["shipping"], item["currency"]))
    return "\n".join([
        item["title"], item["quote_text"], f"Price: {_price_text(item['price'], item['currency'])}",
        f"Condition: {item['condition'] or 'not given'}", f"Shipping: {shipping}",
    ])


def day_text(retrieved_at):
    day = datetime.fromisoformat(retrieved_at.replace("Z", "+00:00"))
    return f"{day:%b} {day.day}, {day.year}"


def listing_label(retrieved_at):
    return f"eBay listing (asking price, {day_text(retrieved_at)})"


def search_listings(name, tool_input, context):
    try:
        params = search_params(tool_input)
    except ValueError as exc:
        return {"error": str(exc)}
    key = hashlib.sha256(json.dumps({"marketplace": MARKETPLACE, **params}, sort_keys=True).encode()).hexdigest()
    with context.key_lock(key):
        cached = store.get_ebay_cache(key)
        if cached:
            raw, retrieved_at = cached["raw"], cached["retrieved_at"]
        else:
            if not context.take("ebay_calls", MAX_CALLS_PER_RUN):
                return {"error": f"This research run has used its {MAX_CALLS_PER_RUN} eBay searches; use the listings you have."}
            if not store.reserve_ebay_call(get_settings().max_ebay_calls_per_day):
                return {"error": "MarketClue's eBay searches for today are used up; use web search instead."}
            raw = _browse(params)
            retrieved_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
            store.put_ebay_cache(key, raw, retrieved_at)
    snapshot_key = store.save_ebay_snapshot(context.run_id, context.next_number("ebay_snapshots"), raw, retrieved_at)
    data = json.loads(raw)
    items = [item for item in (compact_item(entry, retrieved_at) for entry in data.get("itemSummaries") or []) if item]
    label = listing_label(retrieved_at)
    for item in items:
        context.add_evidence(item["url"], {
            "url": item["url"], "title": item["title"], "text": evidence_text(item), "retrieved_at": retrieved_at,
            "source_kind": "ebay_api", "label": label, "snapshot_key": snapshot_key, "item": item,
        })
    return {
        "retrieved_at": retrieved_at, "total": data.get("total", len(items)),
        "note": (f"Asking prices of active listings on {day_text(retrieved_at)}, not sold prices. To cite a listing in a "
                 "FINDING, use its url and copy its quote_text exactly as the quote."),
        "items": [{key: item[key] for key in ("title", "price", "currency", "shipping", "condition", "url",
                                              "seller_feedback", "buying_options", "quote_text")} for item in items],
    }


SEARCH_TOOL = {
    "name": "ebay_search_listings",
    "description": (
        "Search live, active eBay listings on ebay.com (US) that are similar to the founder's product. Returns "
        "each listing's title, asking price, shipping cost, condition, URL and seller feedback score. Prices are "
        "asking prices of active listings on the retrieval date, never sold prices. Use short, specific queries; "
        "each run has a small number of searches."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Keywords, e.g. 'handmade stoneware mug 12 oz'"},
            "category_id": {"type": "string", "description": "Optional eBay category id"},
            "condition": {"type": "string", "enum": ["new", "used"]},
            "min_price": {"type": "number", "description": "Lowest asking price in US dollars"},
            "max_price": {"type": "number", "description": "Highest asking price in US dollars"},
            "limit": {"type": "integer", "minimum": 1, "maximum": MAX_LIMIT, "description": "Listings to return, default 20"},
        },
        "required": ["query"],
    },
}

LISTINGS = register(Capability(
    id="ebay_listings", label="Searches live eBay listings", tool_definitions=[SEARCH_TOOL],
    run=search_listings, available=available,
))
FEES = register(Capability(id="ebay_fees", label="Estimates eBay fees and ad costs"))
