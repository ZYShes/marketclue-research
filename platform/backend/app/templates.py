"""Templates: ready-made setups a founder picks before a tool runs.

A template adds intake questions, capabilities (tools the research agents may call besides web search and
fetch), report sections and source rules. "general" adds nothing: it is exactly the behaviour without
templates.

Each template is data: `tools` (feature ids it supports), `capabilities`, `intake_needs` (what the research
lead must also learn) and `intake_rules`, `brief_fields` (extra brief properties the intake fills) with their
`brief_heading`, `source_rules`, per-tool `research` and `writer` guidance, `instructions` (a tool instruction
that replaces the default one, e.g. requirements instead of a launch checklist), and `sections`: which report
sections each of the four tools gets. Section ids: `ebay_listings`, `ebay_fees` (eBay seller, built by
ebay_report), `official_requirements`, `local_benchmarks`, `startup_costs` (local businesses, local_report),
`etsy_listings`, `etsy_fees` (Etsy seller, etsy_report). The local and Etsy templates also carry `benchmark`
(what the compared prices are), `requirement_topics`, `cost_lines` (the startup cost lines to look for) and
`privacy` ("children" for daycare: no notes on benchmark rows, never anything about a child or family).
"""

from . import capabilities

FEATURE_IDS = ["market_check", "competitor_scan", "launch_checklist", "marketing_plan"]
DEFAULT = "general"

EBAY_FEES_PAGE = "https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822"
EBAY_ADS_PAGE = "https://www.ebay.com/help/selling/ebay-advertising/promoted-listings-overview?id=5295"
ASKING_PRICE_RULE = ("Prices from eBay listings are asking prices of active listings on the day they were "
                     "retrieved, never sold prices. Never write \"sells for\" or \"sold for\" about them.")

# Etsy's Fees & Payments Policy (US). Re-check at run time; never hard-code the fee numbers.
ETSY_FEES_PAGE = "https://www.etsy.com/legal/fees/"
ETSY_ASKING_RULE = ("Prices from Etsy listings are asking prices on the day the page was fetched, never sold prices. "
                    "Never write \"sells for\" or \"sold for\" about them.")

NOT_LEGAL_ADVICE = "A checklist built from official pages. Confirm each item with the agency; this is not legal advice."

_nullable = lambda kind: {"type": [kind, "null"]}  # noqa: E731

# ---------- Shared rules for the local-business templates ----------

OFFICIAL_RULE = ("Permits, licences, inspections, taxes and rules come from the founder's city, county and state "
                 "government pages (.gov, or a state- or city-run site); a requirement backed only by another kind of "
                 "page is shown as an assumption to check with the agency. Never give legal advice.")
LOCAL_PRICE_RULE = ("Prices of nearby businesses come from their own pages (menus, price lists, tuition pages) or "
                    "their listings, as stated on the day the page was fetched. Do not report ratings or review counts "
                    "unless a fetched page states them.")
NO_PERSONAL_DATA_RULE = ("Never collect, quote or show personal data: no names of private people, home addresses, phone "
                         "numbers or reviews that identify someone.")
CHILD_PRIVACY_RULE = ("Never collect, quote or show anything about specific children or families: no names, photos, ages "
                      "of particular children, health details, or reviews that identify a child or a parent. Use "
                      "providers' own pages and official pages only.")
KNOWN_COSTS_RULE = ("If the founder mentions a cost they already know (a quote, a lease, a price they paid), put it in "
                    "known_costs with its amount in US dollars; do not ask for costs just to fill it.")
CHILD_PRIVACY_INTAKE = ("Never ask for or record anything about specific children or families (names, ages of particular "
                        "children, health, addresses). Ask only about the business: home or center, the age groups it "
                        "will serve and how many children it plans to care for.")

KNOWN_COSTS_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {"item": {"type": "string"}, "amount_usd": {"type": "number"}},
        "required": ["item", "amount_usd"],
        "additionalProperties": False,
    },
}

REQUIREMENTS_INSTRUCTION = (
    "Instead of a launch checklist, list 5-9 requirements in requirements, in the order a founder should check them. "
    "Each has requirement (what is required, a short name), agency (the office that runs it, for example the county "
    "health department), text (what to do, in one or two sentences), kind, card_ids and method. A requirement is "
    "sourced only when a card from a government page (.gov or a state- or city-run site) states it; otherwise it is an "
    "assumption and method says which agency to check with. Give fee_usd only when a cited quote states the fee in US "
    "dollars, with that card's id in fee_card_ids; otherwise fee_usd is null. Do not give legal advice.")

BENCHMARK_WRITER = (
    "The table compares nearby businesses: Seller is the business, Product the item or plan, Price the price their own "
    "page states. Give each row price_unit, what the price is for (for example \"per item\", \"per week\", \"per "
    "month\"), the same wording for rows that compare the same thing. Notes never give ratings or review counts unless "
    "the cited quote states them, and never name private people.")


def _startup_writer(lines):
    return (
        "Also fill startup_costs: one line per startup cost a card supports, in US dollars, with category (one of: "
        + ", ".join(lines) + ", or Other), item, low_usd and high_usd (the range the quotes state; high_usd null for a "
        "single price), basis \"source\" with the ids of the cards whose quotes state those numbers, or basis "
        "\"founder\" for a cost the founder gave in known_costs (then low_usd is that amount and card_ids is empty), "
        "and method (how the line was worked out, in plain English). Leave out any line no card or founder figure "
        "supports; never guess a number. Keep the 4-week marketing budget separate from these startup costs.")


def _local_template(template_id, name, description, *, key, heading, needs, fields, topics, benchmark, cost_lines,
                    research, writer, extra_rules=(), intake_rules=(), privacy=None):
    properties = {**{field: _nullable(kind) for field, kind in fields.items()}, "known_costs": KNOWN_COSTS_SCHEMA}
    return {
        "id": template_id,
        "name": name,
        "description": description,
        "tools": FEATURE_IDS,
        "capabilities": ["official_requirements", "local_benchmarks", "startup_costs"],
        "intake_needs": needs,
        "intake_rules": [KNOWN_COSTS_RULE, *intake_rules],
        "source_rules": [OFFICIAL_RULE, LOCAL_PRICE_RULE, NO_PERSONAL_DATA_RULE, *extra_rules],
        "brief_fields": {
            key: {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False},
        },
        "brief_heading": heading,
        "sections": {"competitor_scan": ["local_benchmarks"], "launch_checklist": ["official_requirements"],
                     "marketing_plan": ["startup_costs"]},
        "instructions": {"launch_checklist": REQUIREMENTS_INSTRUCTION},
        "requirement_topics": topics,
        "benchmark": benchmark,
        "cost_lines": cost_lines,
        "privacy": privacy,
        "research": {
            "launch_checklist": ("Fetch the founder's city, county and state government pages (.gov or a state- or "
                                 f"city-run site) for {topics}. Quote each requirement and any fee exactly as the "
                                 "official page states it."),
            **research,
        },
        "writer": {
            "competitor_scan": BENCHMARK_WRITER + " " + writer.pop("competitor_scan"),
            "launch_checklist": f"Requirements cover {topics}.",
            "marketing_plan": _startup_writer(cost_lines),
            **writer,
        },
    }


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
        "sections": {},
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
        "brief_heading": "About selling on eBay",
        "sections": {"competitor_scan": ["ebay_listings"], "marketing_plan": ["ebay_fees"]},
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
            "marketing_plan": ("Also fill ebay_fees with the inputs for an eBay cost breakdown. In numbers, add one "
                               "entry per number: final_value_fee_pct and per_order_fee_usd (US dollars) exactly as an "
                               "ebay.com fee card states them, with those card ids (leave a number out when no card "
                               "states it); ad_rate_pct three times, for the Promoted Listings General ad rates to "
                               "compare (low, typical, high); ad_rate_min_pct and ad_rate_max_pct when a card states "
                               "eBay's minimum and maximum ad rate; and target_price_usd and shipping_cost_usd for the "
                               "founder's target price and shipping cost. Set shipping_paid_by (buyer, seller or "
                               "unknown) and write one statement on Promoted Listings Priority (charged per click; set "
                               "a daily budget)."),
            "launch_checklist": "Steps cover the eBay seller account, managed payments, sales tax collected by eBay, and item specifics and photo rules, citing ebay.com help pages.",
            "market_check": "Findings from eBay listings describe what listings emphasise and whom they target; say they are listing evidence, not what buyers say.",
        },
    },
    "food_truck": _local_template(
        "food_truck", "Food truck",
        ("For a mobile food business in a US city: permits from official pages, nearby menu prices and startup "
         "costs."),
        key="food_truck", heading="About the food truck",
        needs=("the city and state, the cuisine, where they plan to sell (street, events, office parks or other spots), "
               "and whether they own the truck, will buy one or will rent one"),
        fields={"city": "string", "state": "string", "cuisine": "string", "selling_spots": "string", "truck": "string"},
        topics=("a mobile food unit health permit, the commissary kitchen rule, a fire inspection, a business licence, "
                "street-vending and parking rules, and event vendor fees"),
        benchmark={"title": "Prices nearby", "what": "menu prices", "source": "nearby food trucks' own menus and listings"},
        cost_lines=["Truck (buy or lease)", "Kitchen equipment", "Permits and licences", "Insurance", "First inventory"],
        research={
            "market_check": ("Find who buys from food trucks in the founder's city (office workers, event crowds, "
                             "late-night) and what nearby trucks emphasise on their own pages and menus."),
            "competitor_scan": ("Find food trucks near the founder's selling spots that serve similar food, and fetch "
                                "their own menu pages or listings for item prices."),
            "marketing_plan": ("Find checked costs for a truck (to buy or lease), kitchen equipment, permit fees on "
                               "official pages, insurance and first inventory, and how nearby trucks find customers "
                               "(events, office parks, social media)."),
        },
        writer={
            "market_check": ("Findings describe who the customers are and what nearby trucks emphasise; what a truck "
                             "says about itself is its own claim, not what customers say."),
            "competitor_scan": "Compare menu items like the founder's (a main dish, a side, a drink).",
        },
    ),
    "restaurant": _local_template(
        "restaurant", "Restaurant / café",
        ("For a small restaurant, café or bakery: permits from official pages, nearby menu prices and startup "
         "costs."),
        key="restaurant", heading="About the restaurant or café",
        needs=("the city and neighbourhood, the number of seats, the cuisine or kind of place (restaurant, café, "
               "bakery), and whether they will serve alcohol"),
        fields={"city": "string", "neighbourhood": "string", "seats": "number", "cuisine": "string", "alcohol": "boolean"},
        topics=("a food service establishment permit, the health department's plan review, a business licence, a state "
                "liquor licence if they serve alcohol, and signage and occupancy rules"),
        benchmark={"title": "Prices nearby", "what": "menu prices", "source": "nearby restaurants' and cafés' own menus"},
        cost_lines=["Lease and deposit", "Build-out", "Kitchen equipment", "Permits and licences"],
        research={
            "market_check": ("Find who eats out in the founder's neighbourhood (workers, residents, students, "
                             "visitors) and what nearby places emphasise on their own pages and menus."),
            "competitor_scan": ("Find restaurants, cafés or bakeries near the founder's neighbourhood with a similar "
                                "cuisine, and fetch their own menu pages for item prices."),
            "marketing_plan": ("Find checked costs for a commercial lease and deposit in the neighbourhood, build-out, "
                               "kitchen equipment and permit fees on official pages, and how nearby places find "
                               "customers (delivery apps, local listings, events)."),
        },
        writer={
            "market_check": ("Findings describe who the customers are and what nearby places emphasise; what a place "
                             "says about itself is its own claim, not what customers say."),
            "competitor_scan": "Compare menu items like the founder's (a main dish, a coffee, a pastry).",
        },
    ),
    "daycare": _local_template(
        "daycare", "Daycare / childcare",
        ("For a home daycare or childcare center: licensing from official pages, nearby tuition and startup costs, "
         "never about any child or family."),
        key="daycare", heading="About the daycare",
        needs=("the state and city, whether it will be home-based or a center, the age groups it will serve, and the "
               "planned number of children"),
        fields={"state": "string", "city": "string", "setting": "string", "ages_served": "string",
                "planned_children": "number"},
        topics=("the state childcare licence (in Washington: the Department of Children, Youth, and Families, DCYF), "
                "staff-to-child ratios by age, background checks, training, space rules and inspections, subsidy "
                "programs (in Washington: Working Connections Child Care) and insurance"),
        benchmark={"title": "Prices nearby", "what": "tuition", "source": "nearby providers' own tuition pages"},
        cost_lines=["Space changes", "Safety equipment", "Licensing fees", "Insurance"],
        research={
            "market_check": ("Find which families look for childcare in the founder's city (age groups, full-time or "
                             "part-time, waiting lists) from official reports and providers' own pages, never from "
                             "posts about a particular family."),
            "competitor_scan": ("Find licensed childcare providers near the founder's city for the same age groups and "
                                "fetch their own tuition pages for prices."),
            "marketing_plan": ("Find checked costs for space changes, safety equipment, licensing fees on official "
                               "pages and insurance, and how nearby providers reach families (subsidy listings, local "
                               "directories, community boards)."),
        },
        writer={
            "market_check": ("Findings describe the kinds of families providers serve and what providers emphasise; "
                             "never write about a specific child or family."),
            "competitor_scan": "Compare tuition for the same age group and schedule; never name a child or a family.",
        },
        extra_rules=[CHILD_PRIVACY_RULE],
        intake_rules=[CHILD_PRIVACY_INTAKE],
        privacy="children",
    ),
    "etsy": {
        "id": "etsy",
        "name": "Etsy seller",
        "description": ("For selling handmade or designed goods on Etsy: comparable Etsy listings, Etsy fees and "
                        "Offsite Ads costs per sale."),
        "tools": FEATURE_IDS,
        "capabilities": ["etsy_fees"],
        "intake_needs": ("the product type, its size and material, the price they want to ask, and who pays shipping "
                         "and roughly what it costs"),
        "source_rules": [
            "Etsy fees, Offsite Ads rules and selling rules come only from etsy.com help and policy pages (US), for "
            f"example {ETSY_FEES_PAGE}; never from blogs or other sites.",
            ETSY_ASKING_RULE,
            NO_PERSONAL_DATA_RULE,
        ],
        "brief_fields": {
            "etsy": {
                "type": "object",
                "properties": {
                    "product_type": _nullable("string"),
                    "size_material": _nullable("string"),
                    "target_price_usd": _nullable("number"),
                    "buyer_pays_shipping": _nullable("boolean"),
                    "shipping_cost_usd": _nullable("number"),
                },
                "required": ["product_type", "size_material", "target_price_usd", "buyer_pays_shipping",
                             "shipping_cost_usd"],
                "additionalProperties": False,
            },
        },
        "brief_heading": "About selling on Etsy",
        "sections": {"competitor_scan": ["etsy_listings"], "marketing_plan": ["etsy_fees"]},
        "benchmark": {"title": "Comparable Etsy listings", "what": "asking prices", "asking": True,
                      "source": "Etsy listing pages"},
        "research": {
            "competitor_scan": ("Search for Etsy listings like the founder's item and fetch the listing pages on etsy.com "
                                "(www.etsy.com/listing/...); quote each listing's title and price as the page shows "
                                "them. These are asking prices on the day the page was fetched."),
            "marketing_plan": (f"Fetch {ETSY_FEES_PAGE} and Etsy's help pages on Offsite Ads and quote the listing fee, "
                               "the transaction fee rate, the US payment processing fee, and the Offsite Ads fee rate "
                               "for each sales tier with any cap per order."),
            "launch_checklist": ("Use etsy.com help and policy pages for opening a shop, Etsy Payments, the sales tax "
                                 "Etsy collects and what may be sold as handmade; use government pages (.gov) for a "
                                 "business licence and state tax registration."),
            "market_check": ("Find who buys this kind of item on Etsy and what they say (reviews on etsy.com listing "
                             "pages, forums, articles). Never quote a reviewer by name."),
        },
        "writer": {
            "competitor_scan": ("Rows come from Etsy listing pages: Seller is the shop, Price the listing's asking price "
                                "as the page states it; the table title says they are asking prices of Etsy listings."),
            "marketing_plan": ("Also fill etsy_fees with the inputs for an Etsy cost breakdown. In numbers, add one "
                               "entry per number, each exactly as an etsy.com card states it with those card ids (leave "
                               "a number out when no card states it): listing_fee_usd, transaction_fee_pct, "
                               "processing_fee_pct and processing_fee_fixed_usd (US dollars), one offsite_ads_pct entry "
                               "per Offsite Ads tier with a short label such as \"Shops under the sales threshold\", and "
                               "offsite_ads_cap_usd for the Offsite Ads cap per order; add target_price_usd and "
                               "shipping_cost_usd for the founder's target price and shipping cost. Set "
                               "shipping_paid_by (buyer, seller or unknown) and write one statement on Etsy Ads "
                               "(charged per click; set a daily budget)."),
            "launch_checklist": ("Steps cover opening an Etsy shop, Etsy Payments, the sales tax Etsy collects, Etsy's "
                                 "handmade rules, a business licence and state tax registration, citing etsy.com help "
                                 "pages and government pages."),
            "market_check": "Findings describe who buys and what buyers and listings emphasise; never name a reviewer.",
        },
    },
}


def get(template_id) -> dict | None:
    return TEMPLATES.get(template_id) if isinstance(template_id, str) else None


def of(brief) -> dict:
    return TEMPLATES.get((brief or {}).get("template") or DEFAULT) or TEMPLATES[DEFAULT]


def sections(template, feature) -> list[str]:
    """The report sections a template adds to one tool (none for general)."""
    return list((template.get("sections") or {}).get(feature) or [])


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
