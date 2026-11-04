"""Templates: ready-made setups a founder picks before a tool runs.

A template adds intake questions, capabilities (tools the research agents may call besides web search and
fetch), report sections and source rules. "general" adds nothing: it is exactly the behaviour without
templates.
"""

from . import capabilities

FEATURE_IDS = ["market_check", "competitor_scan", "launch_checklist", "marketing_plan"]
DEFAULT = "general"

EBAY_FEES_PAGE = "https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822"
EBAY_ADS_PAGE = "https://www.ebay.com/help/selling/ebay-advertising/promoted-listings-overview?id=5295"
ASKING_PRICE_RULE = ("Prices from eBay listings are asking prices of active listings on the day they were "
                     "retrieved, never sold prices. Never write \"sells for\" or \"sold for\" about them.")

_nullable = lambda kind: {"type": [kind, "null"]}  # noqa: E731

TEMPLATES = {
    "general": {
        "id": "general",
        "name": "General",
        "description": "Web research for any small business: public pages, checked quotes.",
        "tools": FEATURE_IDS,
        "capabilities": [],
        "intake_needs": "",
        "source_rules": [],
        "brief_fields": {},
        "research": {},
        "writer": {},
    },
    "ebay": {
        "id": "ebay",
        "name": "eBay seller",
        "description": ("For selling on eBay: compares live eBay listings like yours and estimates eBay fees "
                        "and Promoted Listings ad costs, so you can cap what you spend."),
        "tools": FEATURE_IDS,
        "capabilities": ["ebay_listings", "ebay_fees"],
        "intake_needs": ("the eBay category or one close example listing, the item's condition (new or used), "
                         "the price they want to ask, who pays shipping and roughly what it costs, and whether "
                         "they already sell on eBay"),
        "source_rules": [
            "eBay fees, Promoted Listings rules and selling rules come only from ebay.com help pages (US), for "
            f"example {EBAY_FEES_PAGE} and {EBAY_ADS_PAGE}; never from other countries' eBay sites or blogs.",
            ASKING_PRICE_RULE,
        ],
        "brief_fields": {
            "ebay": {
                "type": "object",
                "properties": {
                    "category": _nullable("string"),
                    "example_listing": _nullable("string"),
                    "condition": _nullable("string"),
                    "target_price_usd": _nullable("number"),
                    "buyer_pays_shipping": _nullable("boolean"),
                    "shipping_cost_usd": _nullable("number"),
                    "sells_on_ebay": _nullable("boolean"),
                },
                "required": ["category", "example_listing", "condition", "target_price_usd",
                             "buyer_pays_shipping", "shipping_cost_usd", "sells_on_ebay"],
                "additionalProperties": False,
            },
        },
        "research": {
            "competitor_scan": ("Use ebay_search_listings to find active eBay listings like the founder's item (try "
                                "two or three queries) and cite the closest ones as FINDINGs."),
            "marketing_plan": (f"Fetch {EBAY_FEES_PAGE} and {EBAY_ADS_PAGE} and quote the final value fee rate for "
                               "the founder's category, the per-order fee, and how Promoted Listings General (ad "
                               "rate, charged on a sale) and Priority (charged per click, daily budget) are charged."),
            "launch_checklist": ("Use ebay.com help pages for the eBay seller account, managed payments, sales tax "
                                 "that eBay collects, and item specifics and photo rules."),
            "market_check": ("Use ebay_search_listings and cite listing titles that show what sellers in this "
                             "category emphasise and whom they target. These are listing evidence, not buyer voice."),
        },
        "writer": {
            "competitor_scan": "Rows from eBay listings use the listing's asking price; the table title says they are asking prices of active eBay listings.",
            "marketing_plan": ("Also fill ebay_fees with the inputs for an eBay cost breakdown: the final value fee "
                               "percent and per-order fee in US dollars exactly as an ebay.com fee card states them "
                               "(with those card ids; null when no card states them), the founder's target price, "
                               "the shipping cost and who pays it, three Promoted Listings General ad rates to compare "
                               "(low, typical, high), eBay's minimum and maximum ad rate if a card states them, and "
                               "one statement on Promoted Listings Priority (charged per click; set a daily budget)."),
            "launch_checklist": "Steps cover the eBay seller account, managed payments, sales tax collected by eBay, and item specifics and photo rules, citing ebay.com help pages.",
            "market_check": "Findings from eBay listings describe what listings emphasise and whom they target; say they are listing evidence, not what buyers say.",
        },
    },
}


def get(template_id) -> dict | None:
    return TEMPLATES.get(template_id) if isinstance(template_id, str) else None


def of(brief) -> dict:
    return TEMPLATES.get((brief or {}).get("template") or DEFAULT) or TEMPLATES[DEFAULT]


def availability(template) -> tuple[bool, str | None]:
    return capabilities.available(template["capabilities"])


def public(template) -> dict:
    ok, reason = availability(template)
    return {
        "id": template["id"], "name": template["name"], "description": template["description"],
        "tools": list(template["tools"]),
        "capabilities": [{"id": cid, "label": capabilities.get(cid).label} for cid in template["capabilities"]],
        "available": ok, "unavailable_reason": None if ok else reason,
    }


def listing() -> list[dict]:
    return [public(template) for template in TEMPLATES.values()]
