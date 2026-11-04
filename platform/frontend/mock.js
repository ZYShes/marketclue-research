// Development-only API fixtures for ?mock=1. Every report, quote and price below is invented
// sample data, and every source uses a reserved example.com domain.
// Session storage keeps the demo sign-in, conversations, runs and team across reloads.
//
// Two demo accounts:
//   owner  — "Demo Founder", owner account (unlimited reports, mock-ups allowed), owns the
//            team "Clay & Leaf Studio".
//   member — "Sam Rivera", regular account (free reports), not in a team yet but has
//            a pending invite: open #/join/sample-invite to accept it.
// Anyone may pick any research depth (SPEC v3 decisions): quick, balanced or smarter.
// Page URL switches: &mockups=off makes the mock-up endpoints answer 503 (button hidden);
// &smarter=limit makes Smarter runs answer 429 smarter_daily_limit;
// &ebay=off shows the eBay seller template as not connected (409 template_unavailable);
// &fees=partial makes the eBay fee sample incomplete (no per-order fee, no ad budget).
// eBay samples (SPEC v4) use invented listings on example.com, never real eBay items.
// Projects (SPEC v5): the owner has a personal project "Handmade ceramic planters" (runs at every stage),
// a team project "Planters on eBay" in "Clay & Leaf Studio" (with a report by Riley), and an archived
// personal project. The owner is in two teams: owns "Clay & Leaf Studio", member of "North Market Makers".

const STORE_KEY = "mc_mock_state_v6";
const STORE_VERSION = 6;
const LIVE_PROJECT_LIMIT = 10;
const TEAM_LIMIT = 10;
const EARLIER_LABEL = "from an earlier report in this project";
const TEMPLATES = [
  {
    id: "general", name: "General",
    description: "Research from public web pages. Works for any business.",
    tools: ["market_check", "competitor_scan", "launch_checklist", "marketing_plan"],
    capabilities: [],
  },
  {
    id: "ebay", name: "eBay seller",
    description: "For selling on eBay: compares live eBay listings and estimates eBay fees and ad costs.",
    tools: ["market_check", "competitor_scan", "launch_checklist", "marketing_plan"],
    capabilities: [
      { id: "ebay_listings", label: "Searches live eBay listings" },
      { id: "ebay_fees", label: "Estimates eBay fees and ad costs" },
    ],
  },
];
const ebayOff = () => pageQuery.get("ebay") === "off";
function templatesView() {
  return TEMPLATES.map((t) => {
    const off = t.id === "ebay" && ebayOff();
    return { ...t, available: !off, unavailable_reason: off ? "eBay is not connected yet" : null };
  });
}
const templateOf = (value) => (TEMPLATES.some((t) => t.id === value) ? value : "general");
const DURATION = { quick: 18, balanced: 24, smarter: 30 };
const MODE_IDS = Object.keys(DURATION);
const FREE_RUNS = 2;
const DAY = 86400000;
const HOUR = 3600000;
const daysAgo = (d) => new Date(Date.now() - d * DAY).toISOString();
const hoursAgo = (hrs) => new Date(Date.now() - hrs * HOUR).toISOString();
const pageQuery = new URLSearchParams(location.search);

const USERS = {
  "demo-owner": { sub: "demo-owner", email: "demo.founder@example.com", name: "Demo Founder", picture: null, is_owner: true },
  "demo-member": { sub: "demo-member", email: "sam.rivera@example.com", name: "Sam Rivera", picture: null, is_owner: false },
  "demo-riley": { sub: "demo-riley", email: "riley.chen@example.com", name: "Riley Chen", picture: null, is_owner: false },
  "demo-jordan": { sub: "demo-jordan", email: "jordan.lee@example.com", name: "Jordan Lee", picture: null, is_owner: false },
};
// Mock flags: &projects=limit puts the signed-in person at 10 live projects (create and restore answer 429);
// &limit=riley gives Riley Chen 10 live projects, so handing a team over to Riley answers 429.
const LIVE_EXTRA = { me: pageQuery.get("projects") === "limit" ? 8 : 0, "demo-riley": pageQuery.get("limit") === "riley" ? 10 : 0 };
const TOOL_NAMES = {
  market_check: "Find your customers",
  competitor_scan: "Check competitors & prices",
  launch_checklist: "Get ready to sell",
  marketing_plan: "Get your first customers",
};
const TITLES = {
  market_check: "Sample · Who buys handmade planters?",
  competitor_scan: "Sample · Handmade planter prices in Seattle",
  launch_checklist: "Sample · Ready to sell planters in Seattle",
  marketing_plan: "Sample · First customers for handmade planters",
};
const featureId = (value) => Object.hasOwn(TOOL_NAMES, value) ? value : "market_check";
const item = (text, kind = "assumption", card_ids = [], method = "") => ({ text, kind, card_ids, method });
const finding = (title, text, kind, card_ids = [], method = "") => ({ title, ...item(text, kind, card_ids, method) });

function card(id, feature, direction, claim, quote, source, path, type = "sourced", age = 3) {
  return {
    card_id: id, feature, direction, claim, quote,
    source_title: `Sample · ${source}`, url: `https://example.com/sample/${path}`,
    captured_at: daysAgo(age), type, tags: ["sample", feature], dedupe_key: `dk-${id}`,
  };
}

const CARD_SETS = {
  market_check: [
    card("mc-buyers", "market_check", "Buyer language", "One sample buyer values a planter that protects the shelf.",
      "I wanted a handmade pot with a drainage hole and a saucer that actually protects my shelf.", "Plant shop customer interview", "plant-shop/interview-01"),
    card("mc-gift", "market_check", "Buying occasions", "A sample retailer presents its planter as a housewarming gift.",
      "Our 6-inch planter and matching saucer make a practical housewarming gift. Gift wrapping is available.", "Cedar House · Planter gifts", "cedar-house/gifts"),
    card("mc-local", "market_check", "Routes to buyers", "A sample plant shop carries locally made ceramics.",
      "Our shelves pair indoor plants with small-batch ceramics made by local artists.", "Greenway Plant Co. · About", "greenway/about"),
    card("mc-demand", "market_check", "Demand limits", "A claimed local community member count could not be confirmed.",
      "Join 6,200 Seattle plant people swapping cuttings every month.", "Seattle Plant Swap · About", "plant-swap/about", "unverified", 104),
  ],
  competitor_scan: [
    card("cs-rainier", "competitor_scan", "Local studios", "A sample local studio lists a 6-inch planter with saucer at $54.",
      "6-inch speckled stoneware planter with saucer: $54. Made to order; dispatch in 2–3 weeks.", "Rainier Clay Studio · Planters", "rainier-clay/planters"),
    card("cs-cedar", "competitor_scan", "Online sellers", "A sample online seller lists a 6-inch planter at $38 before the saucer and shipping.",
      "6-inch ceramic planter: $38. Matching saucer: $10. Shipping calculated at checkout.", "Cedar House · Shop", "cedar-house/shop"),
    card("cs-fern", "competitor_scan", "Local studios", "A sample studio lists a planter and saucer set at $62 with local pickup.",
      "Small-batch planter and saucer set: $62. Free studio pickup in Seattle.", "Fern Pottery · Planter set", "fern-pottery/set"),
    card("cs-shipping", "competitor_scan", "Shipping & costs", "A sample parcel quote for a boxed 5 lb planter is $14.20.",
      "Ground shipping: 5 lb, 12 × 12 × 10 in, Seattle to Los Angeles — $14.20.", "Parcel calculator · Example quote", "parcel/quote"),
  ],
  launch_checklist: [
    card("lc-business", "launch_checklist", "Business registration", "The sample business portal asks sellers to check licensing before trading.",
      "Before you begin selling, check which state and city business licences apply to your business activities.", "Official business portal · Getting started", "official/business-licensing"),
    card("lc-tax", "launch_checklist", "Tax & records", "The sample tax portal asks retail sellers to confirm registration and recordkeeping requirements.",
      "Retail sellers should confirm tax registration requirements and keep records of sales and collected tax.", "Official revenue portal · Retail sales", "official/retail-sales"),
    card("lc-market", "launch_checklist", "Market requirements", "The sample market application asks for liability insurance and a stall plan.",
      "Vendor applications must include a certificate of liability insurance and a description of the stall setup.", "Lakeview Makers Market · Vendor application", "lakeview/vendors"),
    card("lc-home", "launch_checklist", "Home studio", "A home-studio permit requirement was not confirmed in the captured sample.",
      "Every home pottery studio needs a special permit.", "Maker forum · Home studios", "maker-forum/home-studios", "unverified"),
  ],
  marketing_plan: [
    card("mp-market", "marketing_plan", "Local channels", "A sample makers market charges $95 per market day.",
      "Artisan stall fee: $95 per market day for a 10 × 10 ft space. Tents are not provided.", "Lakeview Makers Market · Vendor information", "lakeview/fees"),
    card("mp-shop", "marketing_plan", "Local channels", "A sample plant shop keeps 40% of consignment sales.",
      "We stock local makers on consignment and keep 40% of the sale price.", "Greenway Plant Co. · Work with us", "greenway/consignment"),
    card("mp-price", "marketing_plan", "Pricing", "A sample competitor lists a 6-inch planter with saucer for $54.",
      "6-inch speckled stoneware planter with saucer: $54. Made to order; dispatch in 2–3 weeks.", "Rainier Clay Studio · Planters", "rainier-clay/planters"),
    card("mp-packing", "marketing_plan", "Shipping & costs", "One sample seller describes fewer breakages after changing its packaging.",
      "Before double boxing, about one in forty planters arrived cracked. We now use two boxes and padding.", "Maker forum · Shipping ceramics", "maker-forum/packing"),
  ],
  riley: [
    card("rc-market", "competitor_scan", "Online marketplaces", "A sample marketplace seller lists a 6-inch planter at $44 with free shipping.",
      "Speckled 6-inch planter with drainage plug — $44, free US shipping, ships in 5 days.", "Craft marketplace · Listing", "marketplace/listing-6in", "sourced", 6),
    card("rc-bundle", "competitor_scan", "Online marketplaces", "A sample shop sells a three-planter bundle for $118.",
      "Set of three nesting planters (4, 6 and 8 inch) with saucers: $118.", "Nest & Clay · Bundles", "nest-clay/bundles", "sourced", 6),
  ],
};

// ---- eBay seller template samples (SPEC v4) -------------------------------------------
// Invented active listings. Prices are asking prices on the retrieval date, never sold prices.

const usd = (v) => `$${Number(v).toFixed(2)}`;
const shortDate = (iso) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
const EBAY_LISTINGS = [
  ["eb-l1", "Ceramic plant pot 6 inch, drainage hole and saucer, matte white", 24.99, 0, "New", 8805],
  ["eb-l2", "Vintage stoneware planter with saucer, 6 in", 32.0, 11.2, "Pre-owned", 1203],
  ["eb-l3", "Speckled pottery planter with drip tray, 6.5 in", 39.95, null, "New", 2044],
  ["eb-l4", "Handmade stoneware planter 6 in with saucer, speckled glaze", 44.0, 9.85, "New", 1520],
  ["eb-l5", "Handmade ceramic succulent pots, set of 2 with saucers", 52.0, 0, "New", 97],
  ["eb-l6", "Wheel-thrown 6 in planter with saucer, made in USA", 58.0, 12.4, "New", 312],
  ["eb-l7", "Studio pottery planter 6 in, glazed stoneware with saucer", 64.0, 14.0, "New", 640],
].map(([id, title, price, shipping, condition, feedback], i) => ({
  id, title: `Sample · ${title}`, price, shipping, condition, feedback,
  url: `https://example.com/sample/ebay/itm/10000000000${i + 1}`,
}));

function listingCards(age) {
  const at = daysAgo(age);
  return EBAY_LISTINGS.map((l) => ({
    card_id: l.id, feature: "competitor_scan", direction: "Comparable eBay listings",
    claim: `An active eBay listing asks ${usd(l.price)} for “${l.title}” (asking price on ${shortDate(at)}).`,
    quote: `${l.title} — ${usd(l.price)}`,
    source_title: l.title, url: l.url, captured_at: at, retrieved_at: at, type: "sourced",
    source_kind: "ebay_api", label: `eBay listing (asking price, ${shortDate(at)})`,
    snapshot_key: "runs/sample/ebay/1.json", tags: ["sample", "ebay"], dedupe_key: `dk-${l.id}`,
  }));
}

function listingRows(age) {
  const at = daysAgo(age);
  return EBAY_LISTINGS.map((l) => ({
    title: l.title, price: l.price, currency: "USD", shipping: l.shipping, condition: l.condition, url: l.url,
    image_url: null, seller_feedback: l.feedback, buying_options: ["FIXED_PRICE"], retrieved_at: at, card_id: l.id,
  }));
}

const EBAY_HELP_CARDS = [
  card("eb-fvf", "marketing_plan", "eBay fees", "The sample eBay fee page lists a 13.6% final value fee for most categories.",
    "For most categories, the final value fee is 13.6% of the total amount of the sale, up to $7,500.", "eBay help · Selling fees", "ebay-help/selling-fees", "sourced", 0),
  card("eb-order", "marketing_plan", "eBay fees", "The sample eBay fee page lists a $0.40 per-order fee above $10.",
    "A per-order fee of $0.40 applies when the total amount of the sale is over $10.", "eBay help · Selling fees", "ebay-help/selling-fees#per-order", "sourced", 0),
  card("eb-ads", "marketing_plan", "Promoted Listings", "In the sample help page, General ads cost a chosen rate of 2% to 100% and are paid only on a sale.",
    "You choose an ad rate from 2% to 100% of the total sale amount and pay it only when a buyer clicks your ad and buys within 30 days.", "eBay help · Promoted Listings", "ebay-help/promoted-listings", "sourced", 0),
  card("eb-priority", "marketing_plan", "Promoted Listings", "In the sample help page, Priority ads charge per click within a daily budget.",
    "With Priority, you set a daily budget and pay for each click on your ad, whether or not the item sells.", "eBay help · Promoted Listings Priority", "ebay-help/priority", "sourced", 0),
  card("eb-ship", "marketing_plan", "Shipping costs", "A sample parcel quote for a boxed 5 lb planter is $11.50.",
    "Ground shipping: 5 lb, 12 × 12 × 10 in, Seattle to Denver — $11.50.", "Parcel calculator · Example quote", "parcel/quote-denver", "sourced", 0),
];

CARD_SETS.ebay_competitor_scan = [
  ...listingCards(0),
  card("eb-cond", "competitor_scan", "Listing details", "The sample eBay help page asks sellers to state the item condition.",
    "Choose the condition that best describes your item and describe any flaws in the listing.", "eBay help · Item condition", "ebay-help/condition", "sourced", 0),
];
CARD_SETS.ebay_marketing_plan = EBAY_HELP_CARDS;

function fixtureCards(set) {
  return CARD_SETS[set] || [];
}

const cardSetOf = (run) => run.cardSet || (run.template === "ebay" && CARD_SETS[`ebay_${run.feature}`] ? `ebay_${run.feature}` : run.feature);

function ebayBrief(feature, overrides = {}) {
  return {
    ...fixtureBrief(feature),
    template: "ebay",
    business: "Handmade 6-inch stoneware planters with matching saucers, to sell on eBay.",
    customer: "US indoor-plant owners and gift buyers shopping on eBay.",
    location: "Ships from Seattle, WA", stage: "Selling at weekend markets; not on eBay yet.",
    budget_usd: 300, goal: "Price the planters for eBay and keep ad spend under control.",
    questions: {
      market_check: ["What do comparable eBay listings emphasise?", "Which buyers do those listings target?"],
      competitor_scan: ["What do comparable active eBay listings ask?", "How do they handle shipping and saucers?"],
      launch_checklist: ["What does eBay require before the first listing?", "Which listing rules apply to handmade planters?"],
      marketing_plan: ["What do eBay fees take from a $48 sale?", "How high can a Promoted Listings ad rate go before nothing is left?"],
    }[feature],
    ebay: {
      category: "Home & Garden › Planters & Pots", example_listing: null, condition: "New",
      target_price_usd: 48, buyer_pays_shipping: true, shipping_cost_usd: 11.5, sells_on_ebay: false,
    },
    ...overrides,
  };
}

function fixtureBrief(feature, overrides = {}) {
  return {
    feature,
    business: "Handmade stoneware planters with drainage holes and matching saucers.",
    customer: "Seattle indoor-plant buyers and housewarming gift shoppers.",
    location: "Seattle, WA", stage: "Testing at weekend markets; no online shop yet.",
    budget_usd: 600, goal: "Find the first 40 customers in eight weeks.",
    questions: {
      market_check: ["Who buys handmade planters?", "What do buyers value, and what is still unproven?"],
      competitor_scan: ["What do comparable planters cost?", "Do the prices include saucers, shipping and pickup?"],
      launch_checklist: ["What should I verify before selling locally?", "Which official requirements apply to a home studio?"],
      marketing_plan: ["Which channels can reach the first customers?", "How should I spend a $600 test budget?"],
    }[feature],
    ...overrides,
  };
}

function coverageChart(cov) {
  return {
    id: "coverage", type: "bar", title: "Evidence coverage", unit: "count", kind: "sourced",
    caption: `${cov.quotes_found} of ${cov.quotes_total} quotes were found word for word on the ${cov.pages_read} pages read.`,
    series: [
      { label: "Pages read", value: cov.pages_read, card_ids: [] },
      { label: "Quotes checked", value: cov.quotes_total, card_ids: [] },
      { label: "Quotes found word for word", value: cov.quotes_found, card_ids: [] },
    ],
    method: "",
  };
}

function fixtureCharts(feature, set) {
  if (set === "riley") {
    return [{
      id: "price-by-seller", type: "bar", unit: "USD", kind: "sourced",
      title: "Listed price by online seller",
      caption: "The marketplace listing at $44 includes shipping, which the bundle price does not.",
      series: [
        { label: "Craft marketplace (6-inch, shipped)", value: 44, card_ids: ["rc-market"] },
        { label: "Nest & Clay (3-planter bundle)", value: 118, card_ids: ["rc-bundle"] },
      ],
      method: "",
    }];
  }
  return {
    market_check: [{
      id: "buyer-themes", type: "bar", unit: "count", kind: "sourced",
      title: "How often each buyer theme appears",
      caption: "Function (drainage and a saucer) comes up most often across the checked quotes.",
      series: [
        { label: "Function: drainage, saucer", value: 3, card_ids: ["mc-buyers", "mc-gift"] },
        { label: "Gift or housewarming", value: 2, card_ids: ["mc-gift"] },
        { label: "Locally made", value: 2, card_ids: ["mc-local"] },
        { label: "Community or swaps", value: 1, card_ids: ["mc-demand"] },
      ],
      method: "Count of checked quotes that mention each theme; one quote can mention more than one.",
    }],
    competitor_scan: [
      {
        id: "price-by-seller", type: "range", unit: "USD", kind: "sourced",
        title: "Planter + saucer price by seller",
        caption: "Comparable sets run from $48 to $62; Cedar House is $38 without the saucer.",
        series: [
          { label: "Cedar House", low: 38, high: 48, value: 48, card_ids: ["cs-cedar"] },
          { label: "Rainier Clay Studio", value: 54, card_ids: ["cs-rainier"] },
          { label: "Fern Pottery", value: 62, card_ids: ["cs-fern"] },
        ],
        method: "",
      },
      {
        id: "price-band", type: "range", unit: "USD", kind: "estimate",
        title: "Suggested test price band",
        caption: "A $50–56 band sits between the bundled online price and the local studios.",
        series: [
          { label: "Comparable sets (sourced range)", low: 48, high: 62, card_ids: ["cs-cedar", "cs-fern"] },
          { label: "Suggested test price", low: 50, high: 56, value: 52, card_ids: [] },
        ],
        method: "Lower end: Cedar House $48 bundle + $2 for local pickup convenience; upper end: Rainier $54 + $2 for a matching saucer finish. Test before committing.",
      },
    ],
    launch_checklist: [{
      id: "steps-by-kind", type: "stacked_bar", unit: "count", kind: "sourced",
      title: "Launch steps by kind of evidence",
      caption: "Two of the four steps rest on official sources; one is still an assumption.",
      series: [
        { label: "Official source", value: 2, card_ids: ["lc-business", "lc-tax"] },
        { label: "Other source", value: 1, card_ids: ["lc-market"] },
        { label: "Assumption", value: 1, card_ids: ["lc-home"] },
      ],
      method: "",
    }],
    marketing_plan: [
      {
        id: "budget-by-line", type: "bar", unit: "USD", kind: "estimate",
        title: "4-week budget by line",
        caption: "Market days are the largest line; promotion waits until organic replies come in.",
        series: [
          { label: "Two market days", value: 190, card_ids: ["mp-market"] },
          { label: "Small promotion test", value: 150, card_ids: [] },
          { label: "Packaging trial", value: 140, card_ids: ["mp-packing"] },
          { label: "Six consignment pieces", value: 54, card_ids: [] },
          { label: "Photo backdrop", value: 45, card_ids: [] },
          { label: "Samples & contingency", value: 21, card_ids: [] },
        ],
        method: "Amounts from the budget table below; each line's basis is shown there.",
      },
      {
        id: "projection", type: "range", unit: "count", kind: "estimate",
        title: "First-month orders: a projection",
        caption: "Roughly 12–30 orders in four weeks if the assumptions hold; most would come from market days.",
        series: [
          { label: "Market days", low: 8, high: 16, value: 12, card_ids: ["mp-market"] },
          { label: "Plant shop consignment", low: 2, high: 6, card_ids: ["mp-shop"] },
          { label: "Promotion test", low: 2, high: 8, card_ids: [] },
        ],
        method: "Market: 2 days × 200 visitors × 2–4% buy ≈ 8–16. Shop: 6 pieces × 40–100% sell-through ≈ 2–6. Promotion: $150 ÷ $0.80 per click ≈ 190 clicks × 1–4% ≈ 2–8.",
      },
    ],
  }[feature] || [];
}

// Fee arithmetic of the eBay marketing sample: $48 target price, buyer pays $11.50 shipping.
const EBAY_FEES = {
  currency: "USD", price: 48, price_basis: "Your target price", buyer_pays_shipping: true, shipping_cost: 11.5, sale_total: 59.5,
  lines: [
    { item: "Final value fee", rate_pct: 13.6, amount: 8.09, kind: "estimate", card_ids: ["eb-fvf"], method: "13.6% × $59.50 sale total" },
    { item: "Per-order fee", rate_pct: null, amount: 0.4, kind: "estimate", card_ids: ["eb-order"], method: "$0.40 per order over $10" },
    { item: "Shipping label", rate_pct: null, amount: 11.5, kind: "estimate", card_ids: ["eb-ship"], method: "The buyer pays $11.50 shipping and you buy the label (sample parcel quote)" },
  ],
  left_before_ads: 39.51,
  scenarios: [
    { label: "Low", ad_rate_pct: 2, ad_fee: 1.19, left: 38.32, method: "2% × $59.50 = $1.19" },
    { label: "Typical", ad_rate_pct: 5, ad_fee: 2.98, left: 36.53, method: "5% × $59.50 = $2.98" },
    { label: "High", ad_rate_pct: 10, ad_fee: 5.95, left: 33.56, method: "10% × $59.50 = $5.95" },
  ],
  complete: true, kind: "estimate",
  method: "What is left = $59.50 sale total − $8.09 final value fee − $0.40 per-order fee − $11.50 shipping − ad fee. Before the cost of making the item.",
};
const EBAY_FEES_PARTIAL = {
  ...EBAY_FEES,
  lines: EBAY_FEES.lines.filter((l) => l.item !== "Per-order fee"),
  left_before_ads: 39.91, scenarios: [], complete: false,
  method: "What is left = $59.50 sale total − $8.09 final value fee − $11.50 shipping. The per-order fee could not be checked, so it is not included.",
};
const EBAY_AD_BUDGET = {
  break_even_rate_pct: 66.4, suggested_max_rate_pct: 33.2,
  suggestion: "Suggestion: keep the Promoted Listings General ad rate at or below 33.2%, half the break-even rate, so at least half of what is left stays with you. Start at 2–5% and raise it only if the listing gets few views.",
  min_rate_pct: 2, max_rate_pct: 100, rate_card_ids: ["eb-ads"], kind: "estimate",
  method: "Break-even = $39.51 left before ads ÷ $59.50 sale total = 66.4%; suggested ceiling = 66.4% ÷ 2 = 33.2%.",
  priority: { text: "Priority (cost per click) charges for every click on the ad, whether or not the item sells, within a daily budget you set.", kind: "sourced", card_ids: ["eb-priority"], method: "" },
};

function ebayCostsChart() {
  return {
    id: "ebay_costs", type: "stacked_bar", unit: "USD", kind: "estimate",
    title: "Where an eBay sale goes, by ad rate",
    caption: "At a 5% ad rate, $36.53 of the $59.50 sale total is left before the cost of making the planter.",
    series: EBAY_FEES.scenarios.map((s) => ({
      label: `Ad rate ${s.ad_rate_pct}%`, value: EBAY_FEES.sale_total, card_ids: [],
      segments: [
        { label: "Final value fee", value: 8.09 }, { label: "Per-order fee", value: 0.4 }, { label: "Shipping", value: 11.5 },
        { label: "Ad fee", value: s.ad_fee }, { label: "What is left", value: Math.max(0, s.left) },
      ],
    })),
    method: EBAY_FEES.method,
  };
}

function shortLabel(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 20 ? cut.lastIndexOf(" ") : cut.length).replace(/[,\s]+$/, "")}…`;
}

function askingPricesChart(age) {
  const at = daysAgo(age);
  const sorted = [...EBAY_LISTINGS].sort((a, b) => a.price - b.price);
  return {
    id: "asking_prices", type: "bar", unit: "USD", kind: "sourced",
    title: "Asking prices of comparable eBay listings",
    caption: `Asking prices of ${sorted.length} active listings on ${shortDate(at)}, not sold prices: ${usd(sorted[0].price)} to ${usd(sorted[sorted.length - 1].price)}, middle ${usd(sorted[Math.floor(sorted.length / 2)].price)}.`,
    series: sorted.map((l) => ({ label: shortLabel(l.title.replace(/^Sample · /, ""), 40), value: l.price, card_ids: [l.id] })),
    method: `Item prices from the eBay Browse API on ${shortDate(at)}; shipping is listed separately in the table.`,
  };
}

function ebayResult(run, base) {
  const partial = pageQuery.get("fees") === "partial";
  if (run.feature === "competitor_scan") {
    return {
      ...base,
      table: null,
      listings: listingRows(0),
      charts: [askingPricesChart(0), ...base.charts.filter((c) => c.id === "coverage")],
      takeaway: item("Seven comparable active eBay listings ask $24.99 to $64.00 for a 6-inch planter, before shipping; the handmade stoneware ones ask $44 to $64. A $48 asking price with shipping charged separately would sit among them. These are asking prices on the retrieval date, not sold prices.", "sourced", ["eb-l1", "eb-l7", "eb-l4"]),
      findings: [
        finding("Handmade listings ask $44 to $64", "The four handmade stoneware listings with a saucer ask between $44.00 and $64.00 before shipping.", "sourced", ["eb-l4", "eb-l6", "eb-l7"]),
        finding("The cheapest listings include free shipping", "The lowest asking price, $24.99, comes with free shipping; it is a mass-made matte pot, not a handmade one.", "sourced", ["eb-l1"]),
        finding("Shipping changes the comparison", "Shipping on the other listings runs from $9.85 to $14.00; one listing gives no shipping cost in its data.", "sourced", ["eb-l4", "eb-l7", "eb-l3"]),
        finding("Condition matters on eBay", "One comparable listing is pre-owned; eBay asks sellers to state the condition and describe flaws.", "sourced", ["eb-l2", "eb-cond"]),
      ],
      next_steps: [
        { text: "Watch three comparable listings for two weeks.", how: "Note whether each one ends, is relisted or lowers its asking price. MarketClue cannot see sold prices." },
        { text: "Price one shipped planter to three ZIP codes.", how: "Use eBay's shipping calculator for a near, middle and far address and compare with the listings above." },
      ],
      missing_evidence: ["Sold prices: eBay's sold-item data is not available to MarketClue, so every price here is an asking price.", "One listing did not give a shipping cost."],
    };
  }
  if (run.feature === "marketing_plan") {
    const fees = partial ? EBAY_FEES_PARTIAL : EBAY_FEES;
    return {
      ...base,
      fees,
      ad_budget: partial ? null : EBAY_AD_BUDGET,
      charts: [
        {
          id: "budget", type: "bar", unit: "USD", kind: "estimate", title: "4-week budget by line",
          caption: "Packaging is the largest line; ad fees are capped at $60.",
          series: [
            { label: "Packaging for 20 orders", value: 70, card_ids: [] },
            { label: "Promoted Listings General fees (cap)", value: 60, card_ids: ["eb-ads"] },
            { label: "Sample planters for photos", value: 54, card_ids: [] },
            { label: "Photo light and backdrop", value: 45, card_ids: [] },
            { label: "Contingency", value: 71, card_ids: [] },
          ],
          method: "Amounts from the budget table below; each line's basis is shown there.",
        },
        ...(partial ? [] : [ebayCostsChart()]),
        ...base.charts.filter((c) => c.id === "coverage"),
      ],
      takeaway: item("At a $48 target price with $11.50 shipping paid by the buyer, about $39.51 of each sale is left before ads and before the cost of making the planter. A Promoted Listings General rate of 2–5% keeps most of it.", "estimate", ["eb-fvf", "eb-order"], "$59.50 − $8.09 − $0.40 − $11.50 = $39.51."),
      findings: [
        finding("eBay fees take about $8.49 per sale", "The 13.6% final value fee and the $0.40 per-order fee come to $8.49 on a $59.50 sale total.", "estimate", ["eb-fvf", "eb-order"], "13.6% × $59.50 = $8.09; + $0.40 = $8.49."),
        finding("General ads are paid only on a sale", "With Promoted Listings General you pay the chosen rate only when a buyer clicks the ad and buys within 30 days.", "sourced", ["eb-ads"]),
        finding("Priority ads can cost money without a sale", "Priority charges for each click, whether or not the item sells, so it needs a daily budget.", "sourced", ["eb-priority"]),
      ],
      plan: [
        { section: "Pricing", items: [item("List at $48 with shipping charged separately, matching the handmade listings.", "assumption", [])] },
        { section: "Channels", items: [item("Start with Promoted Listings General at 2–5%; try Priority only with a small daily budget.", "assumption", ["eb-ads", "eb-priority"])] },
        { section: "Measurement", items: [item("Track views, clicks and sales per listing each week, and the ad fee per sale.")] },
      ],
      budget: {
        currency: "USD", total: 300,
        lines: [
          { item: "Packaging for 20 orders", amount: 70, kind: "estimate", card_ids: [], method: "20 × $3.50 assumed packing cost." },
          { item: "Promoted Listings General fees (cap)", amount: 60, kind: "estimate", card_ids: ["eb-ads"], method: "About 20 sales × $59.50 × 5% ≈ $60." },
          { item: "Sample planters for photos", amount: 54, kind: "estimate", card_ids: [], method: "6 × $9 assumed materials and firing cost." },
          { item: "Photo light and backdrop", amount: 45, kind: "assumption", card_ids: [], method: "A planning allowance, not a supplier quote." },
          { item: "Contingency", amount: 71, kind: "assumption", card_ids: [], method: "Uncommitted remainder of the $300 test budget." },
        ],
      },
      next_steps: [
        { text: "Check the fee for your exact eBay category.", how: "Open eBay's selling fees page and find the final value fee for Home & Garden › Planters & Pots." },
        { text: "Cap ad spend for the first month.", how: "Set the General ad rate at 5% and stop if the ad fee per sale goes above $3." },
      ],
      missing_evidence: [
        "Suggested ad rates for your listings need a connected eBay seller account (not available yet).",
        ...(partial ? ["eBay's per-order fee was not found on an ebay.com page in this run, so it is left out."] : []),
      ],
    };
  }
  return base;
}

function fixtureResult(run, generatedAt) {
  const feature = run.feature;
  const set = cardSetOf(run);
  const template = templateOf(run.template);
  const coverage = { directions: run.mode === "quick" || !run.mode ? 3 : 4, pages_read: { smarter: 9, balanced: 8 }[run.mode] || 6, quotes_found: feature === "market_check" || feature === "launch_checklist" ? 3 : 4, quotes_total: 4, claims_narrowed: 2, relabelled: 1 };
  if (template === "ebay" && set.startsWith("ebay_")) {
    coverage.quotes_total = fixtureCards(set).length;
    coverage.quotes_found = coverage.quotes_total;
  }
  const result = {
    version: template === "ebay" ? 4 : 3, template, feature, mode: run.mode || "quick", title: run.title, generated_at: generatedAt, brief: run.brief,
    ...(template === "ebay" ? { listings: [], fees: null, ad_budget: null } : {}),
    table: null, plan: [], budget: null, checklist: [], cards: fixtureCards(set),
    coverage,
    charts: [...fixtureCharts(feature, set), coverageChart(coverage)],
    cost: {
      smarter: { usd: 2.14, input_tokens: 182400, output_tokens: 21800, web_searches: 14, web_fetches: 16 },
      balanced: { usd: 0.88, input_tokens: 121300, output_tokens: 15200, web_searches: 12, web_fetches: 12 },
    }[run.mode] || { usd: 0.36, input_tokens: 48210, output_tokens: 7480, web_searches: 8, web_fetches: 9 },
    agents: [
      { name: "Planner", status: "done", seconds: 9 },
      { name: TOOL_NAMES[feature], status: "done", seconds: 71 },
      { name: "Verifier", status: "done", seconds: 22 },
      { name: "Writer", status: "done", seconds: 26 },
    ],
    seconds: { smarter: 184, balanced: 126 }[run.mode] || 92,
  };
  if (set === "riley") {
    return {
      ...result,
      takeaway: item("Online, a single 6-inch planter is listed at $44 including shipping, and bundles bring the per-piece price down to about $39. Price online sets against shipped totals, not shelf prices.", "estimate", ["rc-market", "rc-bundle"], "$118 bundle ÷ 3 planters ≈ $39 each, before shipping."),
      findings: [
        finding("Free shipping is part of the headline price", "The sample marketplace listing includes US shipping in its $44 price.", "sourced", ["rc-market"]),
        finding("Bundles lower the price per planter", "A three-planter set at $118 works out to about $39 per piece before shipping.", "estimate", ["rc-bundle"], "$118 ÷ 3 ≈ $39.33."),
      ],
      table: {
        title: "Price comparison", columns: ["Seller", "Product", "Price", "Notes"],
        rows: [
          { cells: ["Craft marketplace", "6-inch planter", "$44", "Free US shipping; 5-day dispatch"], card_ids: ["rc-market"] },
          { cells: ["Nest & Clay", "3 nesting planters + saucers", "$118", "About $39 per planter before shipping"], card_ids: ["rc-bundle"] },
        ],
      },
      next_steps: [{ text: "Price one shipped set to three addresses.", how: "Use the marketplace's checkout for a near, middle and far ZIP code and note the totals." }],
      missing_evidence: ["No sales volume or reviews count for either listing."],
    };
  }
  const byFeature = {
    market_check: {
      takeaway: item("Start with indoor-plant owners who care about drainage and matching saucers, then test gift buyers separately. These sample sources suggest a useful audience hypothesis; they do not establish demand.", "assumption", ["mc-buyers", "mc-gift"]),
      findings: [
        finding("Function is part of the appeal", "One sample buyer mentions a drainage hole and a saucer that protects the shelf. Use those words in interviews before treating them as a wider preference.", "sourced", ["mc-buyers"]),
        finding("Gifts offer a second buying occasion", "A sample retailer presents a planter set as a housewarming gift. That is evidence of its positioning, rather than proof of gift sales.", "sourced", ["mc-gift"]),
        finding("Local shops are a place to learn", "A sample plant shop stocks local ceramics. Its customers may be useful interview candidates, but the shop listing gives no sales volume.", "assumption", ["mc-local", "mc-demand"]),
      ],
      next_steps: [
        { text: "Talk to five recent planter buyers.", how: "Ask what they last bought, what they paid and which alternatives they considered. Record exact wording." },
        { text: "Test one functional message and one gift message.", how: "Show each version to a separate group of ten people and count replies or paid reservations." },
      ],
      missing_evidence: ["No representative buyer sample or verified sales volume.", "The local community size was not confirmed; membership is not purchase intent."],
    },
    competitor_scan: {
      takeaway: item("The three sample sellers list comparable pieces from $38 to $62. Compare the full bundle: adding Cedar House's $10 saucer moves its $38 headline price to $48 before shipping.", "sourced", ["cs-rainier", "cs-cedar", "cs-fern"]),
      findings: [
        finding("The lowest headline price excludes the saucer", "Cedar House lists a $38 planter and a $10 saucer separately. Its comparable set costs $48 before shipping.", "sourced", ["cs-cedar"]),
        finding("Local sets cost $54 to $62", "Rainier Clay Studio lists a $54 set with a 2–3 week wait. Fern Pottery lists a $62 set and offers studio pickup.", "sourced", ["cs-rainier", "cs-fern"]),
        finding("Shipping can change the comparison", "The sample parcel quote is $14.20 for one route and box size. It is not a seller's checkout price or a universal delivery rate.", "sourced", ["cs-shipping"]),
      ],
      table: {
        title: "Price comparison", columns: ["Seller", "Product", "Price", "Notes"],
        rows: [
          { cells: ["Cedar House", "6-inch planter + saucer", "$48", "$38 planter + $10 saucer; shipping extra"], card_ids: ["cs-cedar"] },
          { cells: ["Rainier Clay Studio", "6-inch planter + saucer", "$54", "Made to order; 2–3 week dispatch"], card_ids: ["cs-rainier"] },
          { cells: ["Fern Pottery", "Planter + saucer set", "$62", "Free Seattle studio pickup"], card_ids: ["cs-fern"] },
        ],
      },
      next_steps: [
        { text: "Compare checkout totals for one delivery address.", how: "Use the same size and saucer option at each seller; note shipping, tax and delivery date." },
        { text: "Check the cost of your own $52 offer.", how: "Add materials, labour, packing, payment fees and delivery before choosing a test price." },
      ],
      missing_evidence: ["No transaction prices, discount history or seller sales volume.", "Sizes and glaze finishes are similar, rather than identical."],
    },
    launch_checklist: {
      takeaway: item("Confirm your state and city requirements before booking a market stall. This sample checklist shows how official sources and open questions appear; it does not confirm your legal obligations.", "assumption", ["lc-business", "lc-tax"]),
      findings: [
        finding("Check both state and city requirements", "The sample official business portal directs sellers to check licensing for their activities. The right requirements depend on the business and location.", "sourced", ["lc-business"]),
        finding("Tax setup belongs before the first sale", "The sample revenue portal asks retail sellers to confirm registration and keep sales records. It does not resolve the founder's exact registration status.", "sourced", ["lc-tax"]),
        finding("A market application has its own conditions", "The sample market requests liability insurance and a stall description. A forum's blanket claim about home studios was not verified.", "sourced", ["lc-market"]),
      ],
      checklist: [
        { step: "Confirm business registration and licences", text: "Use the official state and city portals for your trading name, activities and Seattle address.", kind: "sourced", card_ids: ["lc-business"], official: true },
        { step: "Confirm retail tax and recordkeeping requirements", text: "Check registration, collection and filing requirements before accepting payments.", kind: "sourced", card_ids: ["lc-tax"], official: true },
        { step: "Check home-studio rules", text: "Ask the city about your kiln, home business and customer pickup arrangements. The forum claim is unverified.", kind: "assumption", card_ids: ["lc-home"], official: false },
        { step: "Prepare the market application", text: "Confirm insurance coverage, stall equipment and application deadlines with the organiser.", kind: "sourced", card_ids: ["lc-market"], official: false },
      ],
      next_steps: [
        { text: "Verify the checklist against current official pages.", how: "Search the official state revenue and city business portals for your exact business activity and address." },
        { text: "Ask the organiser for the current vendor agreement.", how: "Confirm insurance limits, equipment rules, cancellation terms and deadlines in writing." },
      ],
      missing_evidence: ["No address-specific zoning or home-studio determination.", "No verified insurance quote, filing fee or permit approval."],
    },
    marketing_plan: {
      takeaway: item("Test two local channels before buying broad ads: a makers market and one plant shop. Keep the first four weeks within $600 and track orders by channel; the sales target is a test, not a forecast.", "assumption", ["mp-market", "mp-shop"]),
      findings: [
        finding("A market creates a bounded first test", "The sample market charges $95 a day. Two market days would cost $190 before travel, equipment and time.", "estimate", ["mp-market"], "2 market days × $95 = $190."),
        finding("Consignment reduces cash kept per sale", "The sample shop keeps 40% of the sale price. At a proposed $52 price, the maker keeps $31.20 before production costs.", "estimate", ["mp-shop"], "$52 × (1 − 0.40) = $31.20 before costs."),
        finding("Packaging needs a small trial", "One sample seller describes breakage before double boxing. Test your actual packaging; this anecdote cannot predict your breakage rate.", "sourced", ["mp-packing"]),
      ],
      plan: [
        { section: "Customers & positioning", items: [item("Start with Seattle indoor-plant owners. Show the drainage hole, matching saucer and locally made finish.")] },
        { section: "Channels & offer", items: [item("Try two market days and ask one plant shop about a six-piece consignment trial.", "assumption", ["mp-market", "mp-shop"]), item("Test a $52 planter-and-saucer offer with free local pickup.", "assumption", ["mp-price"])] },
        { section: "Content (4 weeks)", items: [item("Week 1: photograph the set and invite ten buyer interviews."), item("Week 2: share a making video and run the first market day."), item("Week 3: show the planter in a real home and follow up with shop visitors."), item("Week 4: run the second market day and compare paid orders by channel.")] },
        { section: "Measurement", items: [item("Use separate MARKET and SHOP codes. Record conversations, paid orders and contribution after channel costs.")] },
      ],
      budget: {
        currency: "USD", total: 600,
        lines: [
          { item: "Two market days", amount: 190, kind: "estimate", card_ids: ["mp-market"], method: "2 × $95 sample stall fee." },
          { item: "Packaging trial", amount: 140, kind: "estimate", card_ids: ["mp-packing"], method: "40 sets × $3.50 assumed packing cost." },
          { item: "Small promotion test", amount: 150, kind: "assumption", card_ids: [], method: "A capped test allowance; spend only after organic replies." },
          { item: "Six consignment pieces at cost", amount: 54, kind: "estimate", card_ids: [], method: "6 × $9 assumed materials and firing cost." },
          { item: "Photo backdrop", amount: 45, kind: "assumption", card_ids: [], method: "A planning allowance, not a supplier quote." },
          { item: "Samples & contingency", amount: 21, kind: "assumption", card_ids: [], method: "Uncommitted remainder of the $600 test budget." },
        ],
      },
      next_steps: [
        { text: "Confirm market and consignment terms.", how: "Ask for current fees, commission, payment timing and return rules before committing stock." },
        { text: "Measure contribution per order after four weeks.", how: "Subtract materials, labour, fees, shipping and promotion from revenue for each channel." },
      ],
      missing_evidence: ["No paid-ad conversion data or verified customer acquisition cost.", "Production labour, equipment and actual shipping costs are not included in the $600 test budget."],
    },
  };
  const general = { ...result, ...byFeature[feature] };
  return template === "ebay" && set.startsWith("ebay_") ? ebayResult(run, general) : general;
}

// ---- Sample intake ------------------------------------------------------------

const SAMPLE_ANSWERS = {
  market_check: ["Handmade stoneware planters with drainage holes, sold in Seattle.", "Mostly plant owners at weekend markets; a few bought them as gifts.", "Who the customer is matters most."],
  competitor_scan: ["Handmade 6-inch planters with saucers, Seattle and online.", "6-inch speckled finish, including the saucer.", "Both delivered and pickup prices, please."],
  launch_checklist: ["Planters made in my home studio, sold in Seattle, WA.", "Markets first, then a few shops.", "Yes, I fire at home; the business is not registered yet."],
  marketing_plan: ["Handmade planters for Seattle indoor-plant owners.", "Plant owners at weekend markets; I sell there today.", "$600 for four weeks; 40 customers would be a great result."],
};

const EBAY_ANSWERS = ["Handmade 6-inch stoneware planters with saucers; I want to sell them on eBay.", "Home & Garden, new, made to order.", "About $48, the buyer pays shipping; I am not on eBay yet."];

function ebayIntakeReply(feature, count) {
  const questions = [
    "Which eBay category fits, or can you share a close example listing? Is the item new or used?",
    "What price are you aiming for, and will the buyer pay shipping? Do you already sell on eBay?",
  ];
  const brief = ebayBrief(feature);
  if (count < 3) {
    return {
      reply: `${count === 1 ? "This demo uses a handmade-planter business that wants to sell on eBay. " : "Thanks. "}${questions[count - 1]}`,
      ready: false,
      brief: { ...brief, goal: "", questions: [], ebay: count === 1 ? { ...brief.ebay, target_price_usd: null, buyer_pays_shipping: null, shipping_cost_usd: null, sells_on_ebay: null } : brief.ebay },
    };
  }
  return {
    reply: count === 3
      ? "Your brief is ready, including the eBay details. Choose a research depth, then press Start research to see a simulated eBay report."
      : "The demo brief is unchanged. Press Start research when you are ready.",
    ready: true, brief,
  };
}

function intakeReply(feature, count, template = "general") {
  if (template === "ebay") return ebayIntakeReply(feature, count);
  const questions = {
    market_check: ["Who do you picture buying these planters, and what have they told you so far?", "Which buying question matters most: the customer, the occasion or willingness to pay?"],
    competitor_scan: ["Which planter size and finish should we compare? Should the price include a saucer?", "Should we compare local pickup, delivered prices or both? Any sellers to include?"],
    launch_checklist: ["For the Seattle sample, will you sell from home, online, at markets or through shops?", "Will you make the planters at home, and have you registered the business yet?"],
    marketing_plan: ["Who is the first customer, and where do you sell today?", "What is your four-week marketing budget, and what would count as a good result?"],
  }[feature];
  const brief = fixtureBrief(feature);
  if (count < 3) {
    return {
      reply: `${count === 1 ? "This demo uses a handmade-planter business in Seattle. " : "Thanks. "}${questions[count - 1]}`,
      ready: false, brief: { ...brief, goal: "", questions: [], ...(count === 1 ? { customer: "", stage: "", budget_usd: null } : {}) },
    };
  }
  return {
    reply: count === 3
      ? "Your brief is ready. Check it in the Research brief panel, choose a research depth, then press Start research to see a simulated report."
      : "The demo brief is unchanged. Press Start research when you are ready.",
    ready: true, brief,
  };
}

function seedConversation(id, owner, feature, answers, when, extra = {}) {
  const messages = [];
  const template = templateOf(extra.template);
  let out = null;
  answers.forEach((text, i) => {
    messages.push({ role: "user", text, at: when });
    out = intakeReply(feature, i + 1, template);
    messages.push({ role: "assistant", text: out.reply, at: when });
  });
  return {
    conv_id: id, owner, feature, messages, brief: out ? out.brief : null, ready: out ? out.ready : false,
    run_id: null, created_at: when, updated_at: when, ...extra, template,
  };
}

// ---- State ------------------------------------------------------------------------

function initialState() {
  const now = Date.now();
  const runs = [
    { run_id: "a1b2c3d4e5f6", owner: "demo-owner", feature: "marketing_plan", mode: "smarter", created_at: hoursAgo(1.2), seeded: true, project_id: "proj-planters" },
    { run_id: "f0e1d2c3b4a5", owner: "demo-owner", feature: "competitor_scan", mode: "quick", created_at: new Date(now - 4000).toISOString(), startedMs: now - 4000, title: "Sample · Saucer prices at Seattle plant shops", project_id: "proj-planters" },
    { run_id: "c1d2e3f4a5b6", owner: "demo-owner", feature: "competitor_scan", mode: "quick", created_at: daysAgo(2), seeded: true, project_id: "proj-planters" },
    { run_id: "d1e2f3a4b5c6", owner: "demo-owner", feature: "launch_checklist", mode: "balanced", created_at: daysAgo(4), seeded: true, project_id: "proj-planters" },
    { run_id: "e9f8a7b6c5d4", owner: "demo-owner", feature: "market_check", mode: "quick", created_at: daysAgo(5), seeded: true, failed: true, title: "Sample · Who buys glaze workshops?", error: "The research agents could not reach enough public pages. Try again with a narrower question." },
    { run_id: "b1c2d3e4f5a6", owner: "demo-owner", feature: "market_check", mode: "quick", created_at: daysAgo(12), seeded: true },
    { run_id: "aa11bb22cc33", owner: "demo-riley", feature: "competitor_scan", cardSet: "riley", mode: "quick", created_at: daysAgo(3), seeded: true, title: "Sample · Planter prices across online shops", project_id: "proj-ebay" },
    { run_id: "dd44ee55ff66", owner: "demo-member", feature: "market_check", mode: "quick", created_at: daysAgo(6), seeded: true, title: "Sample · Who buys handmade planters? (Sam)" },
    { run_id: "eb01c0ffee01", owner: "demo-owner", feature: "competitor_scan", template: "ebay", mode: "balanced", created_at: hoursAgo(5), seeded: true, title: "Sample · Handmade planters on eBay: comparable listings", project_id: "proj-ebay" },
    { run_id: "eb02c0ffee02", owner: "demo-owner", feature: "marketing_plan", template: "ebay", mode: "quick", created_at: hoursAgo(8), seeded: true, title: "Sample · eBay fees and ad budget for a $48 planter", project_id: "proj-ebay" },
    { run_id: "cc77dd88ee99", owner: "demo-owner", feature: "market_check", mode: "quick", created_at: daysAgo(30), seeded: true, title: "Sample · Who books weekend pottery classes?", project_id: "proj-classes" },
  ].map((run) => ({
    ...run, template: templateOf(run.template), conv_id: `conv-${run.run_id}`, title: run.title || TITLES[run.feature],
    brief: run.template === "ebay" ? ebayBrief(run.feature) : fixtureBrief(run.feature),
    share_token: run.run_id === "a1b2c3d4e5f6" ? "sample-share" : null,
  }));
  const convs = {};
  for (const run of runs) {
    convs[run.conv_id] = seedConversation(run.conv_id, run.owner, run.feature,
      run.template === "ebay" ? EBAY_ANSWERS : SAMPLE_ANSWERS[run.feature], run.created_at,
      { run_id: run.run_id, template: run.template, project_id: run.project_id || null });
  }
  convs["conv-ebay-ready"] = seedConversation("conv-ebay-ready", "demo-owner", "competitor_scan", EBAY_ANSWERS, hoursAgo(1), { template: "ebay" });
  convs["conv-draft-01"] = seedConversation("conv-draft-01", "demo-owner", "market_check",
    ["Weekend wheel-throwing classes for beginners in Ballard."], hoursAgo(3));
  convs["conv-draft-01"].brief = { ...fixtureBrief("market_check"), business: "Weekend wheel-throwing classes for beginners in Ballard.", customer: "", stage: "", budget_usd: null, goal: "", questions: [] };
  convs["conv-ready-01"] = seedConversation("conv-ready-01", "demo-owner", "launch_checklist", SAMPLE_ANSWERS.launch_checklist, hoursAgo(26));
  convs["conv-ready-01"].brief = { ...convs["conv-ready-01"].brief, business: "Selling planters at the Fremont Sunday market." };
  convs["conv-sam-01"] = seedConversation("conv-sam-01", "demo-member", "competitor_scan", [SAMPLE_ANSWERS.competitor_scan[0]], hoursAgo(2));
  const shares = { "sample-share": "a1b2c3d4e5f6" };
  const teams = {
    "team-clay": {
      team_id: "team-clay", name: "Clay & Leaf Studio", owner_sub: "demo-owner", created_at: daysAgo(20),
      members: [
        { sub: "demo-owner", role: "owner", joined_at: daysAgo(20) },
        { sub: "demo-riley", role: "member", joined_at: daysAgo(10) },
      ],
      invites: [
        { token: "sample-invite", email: "sam.rivera@example.com", created_at: hoursAgo(5), expires_at: new Date(now + 7 * DAY - 5 * HOUR).toISOString(), status: "pending" },
        { token: "invite-alex", email: "alex.kim@example.com", created_at: daysAgo(1), expires_at: new Date(now + 6 * DAY).toISOString(), status: "pending" },
      ],
    },
  };
  teams["team-north"] = {
    team_id: "team-north", name: "North Market Makers", owner_sub: "demo-riley", created_at: daysAgo(40),
    members: [
      { sub: "demo-riley", role: "owner", joined_at: daysAgo(40) },
      { sub: "demo-owner", role: "member", joined_at: daysAgo(15) },
      { sub: "demo-jordan", role: "member", joined_at: daysAgo(12) },
    ],
    invites: [],
  };
  const projects = {
    "proj-planters": {
      project_id: "proj-planters", name: "Handmade ceramic planters", owner_sub: "demo-owner", team_id: null,
      brief: { business: "Handmade stoneware planters with drainage holes and saucers", customer: "Seattle indoor-plant owners and gift buyers", location: "Seattle, WA", stage: "Testing at weekend markets", budget_usd: 600 },
      default_template: "general", created_at: daysAgo(14), updated_at: hoursAgo(1.2), archived: false,
    },
    "proj-ebay": {
      project_id: "proj-ebay", name: "Planters on eBay", owner_sub: "demo-owner", team_id: "team-clay",
      brief: { business: "Handmade 6-inch stoneware planters with saucers", customer: "US plant owners shopping on eBay", location: "Ships from Seattle, WA", stage: null, budget_usd: 300 },
      default_template: "ebay", created_at: daysAgo(6), updated_at: hoursAgo(5), archived: false,
    },
    "proj-stall": {
      project_id: "proj-stall", name: "Market stall planters", owner_sub: "demo-owner", team_id: "team-north",
      brief: { business: "Small planters for the North Market stall", customer: "Weekend market shoppers", location: "Seattle, WA", stage: null, budget_usd: null },
      default_template: "general", created_at: daysAgo(9), updated_at: daysAgo(9), archived: false,
    },
    "proj-classes": {
      project_id: "proj-classes", name: "Wheel-throwing classes", owner_sub: "demo-owner", team_id: null,
      brief: { business: "Weekend wheel-throwing classes for beginners", customer: null, location: "Ballard, Seattle", stage: "Idea", budget_usd: null },
      default_template: "general", created_at: daysAgo(31), updated_at: daysAgo(29), archived: true,
    },
  };
  return { version: STORE_VERSION, signedIn: false, persona: "demo-owner", runsStarted: {}, convs, runs, shares, teams, projects, mockups: {} };
}

function loadState() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || "null");
    if (saved && saved.version === STORE_VERSION && Array.isArray(saved.runs) && saved.convs && saved.teams && saved.projects) return saved;
  } catch { /* A blocked or malformed demo store starts a fresh sample session. */ }
  return initialState();
}
let state = loadState();
function saveState() {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* Demo can also run without storage. */ }
}
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ok = (data) => ({ status: 200, data });
const fail = (status, code, message) => ({ status, data: { error: { code, message } } });
const me = () => USERS[state.persona];
function userView() {
  const u = me();
  const started = state.runsStarted[u.sub] || 0;
  return { ...u, free_runs_left: u.is_owner ? null : Math.max(0, FREE_RUNS - started) };
}

// ---- Teams and projects (SPEC v5) ---------------------------------------------------

const memberOf = (team, sub) => !!team && team.members.some((m) => m.sub === sub);
function teamsOf(sub) {
  const joined = (t) => t.members.find((m) => m.sub === sub)?.joined_at || "";
  return Object.values(state.teams).filter((t) => memberOf(t, sub)).sort((a, b) => joined(a).localeCompare(joined(b)));
}
const firstTeam = () => teamsOf(me().sub)[0] || null;
const findProject = (id) => (id && state.projects[id]) || null;
function canSeeProject(p, sub = me().sub) {
  if (!p) return false;
  return p.team_id ? memberOf(state.teams[p.team_id], sub) : p.owner_sub === sub;
}
function canManageProject(p, sub = me().sub) {
  return canSeeProject(p, sub) && (p.owner_sub === sub || (!!p.team_id && state.teams[p.team_id]?.owner_sub === sub));
}
function projectRole(p, sub = me().sub) {
  if (p.owner_sub === sub) return "owner";
  if (p.team_id && state.teams[p.team_id]?.owner_sub === sub) return "team_owner";
  return "member";
}
// Live = not archived; a person may own at most 10 (SPEC v5). Mock flags add invisible ones (LIVE_EXTRA).
function liveCount(sub) {
  const own = Object.values(state.projects).filter((p) => p.owner_sub === sub && !p.archived).length;
  return own + (sub === me().sub ? LIVE_EXTRA.me : 0) + (LIVE_EXTRA[sub] && sub !== me().sub ? LIVE_EXTRA[sub] : 0);
}
const liveLimitMessage = () => "You have 10 live projects, the most one person can have. Archive one to start another.";
const teamRef = (p) => (p.team_id && state.teams[p.team_id] ? { team_id: p.team_id, name: state.teams[p.team_id].name } : null);
const projectRuns = (p) => state.runs.filter((run) => run.project_id === p.project_id);
const visibleInProject = (run) => run.owner === me().sub || runStatus(run) === "done";

function projectRow(p) {
  const runs = projectRuns(p);
  const done = runs.filter((run) => runStatus(run) === "done");
  const stages = Object.fromEntries(Object.keys(TOOL_NAMES).map((f) => [f, done.filter((run) => run.feature === f).length]));
  const last = runs.filter(visibleInProject).map((run) => run.created_at).sort().pop() || null;
  return {
    project_id: p.project_id, name: p.name, team: teamRef(p), role: projectRole(p), can_manage: canManageProject(p),
    archived: !!p.archived, default_template: p.default_template || "general", stages, last_run_at: last, updated_at: p.updated_at,
  };
}

function listProjects({ archived = false, teamId = null } = {}) {
  const sub = me().sub;
  return Object.values(state.projects)
    .filter((p) => canSeeProject(p, sub) && (archived || !p.archived) && (!teamId || p.team_id === teamId))
    .map(projectRow)
    .sort((a, b) => String(b.last_run_at || b.updated_at).localeCompare(String(a.last_run_at || a.updated_at)));
}

function takeawayText(run) {
  const result = snapshot(run).result;
  const text = result?.takeaway?.text || "";
  return text.length > 300 ? `${text.slice(0, 297)}…` : text;
}

function projectRunRow(run) {
  const meta = snapshot(run).meta;
  return {
    run_id: run.run_id, title: meta.title, status: meta.status, feature: meta.feature, mode: meta.mode, template: meta.template,
    created_at: meta.created_at, takeaway: meta.status === "done" ? takeawayText(run) : null,
    user_sub: run.owner, owner_name: meta.owner_name, mine: run.owner === me().sub,
  };
}

function convRow(conv) {
  const run = conv.run_id ? findRun(conv.run_id) : null;
  const firstUser = conv.messages.find((m) => m.role === "user");
  return {
    conv_id: conv.conv_id, feature: conv.feature, template: templateOf(conv.template), project_id: conv.project_id || null,
    title: run?.title || conv.brief?.business || (firstUser ? firstUser.text.slice(0, 80) : "New conversation"),
    ready: conv.ready, run_id: conv.run_id || null, run_status: run ? runStatus(run) : null, updated_at: conv.updated_at,
  };
}

function projectDetailView(p) {
  const runs = projectRuns(p).filter(visibleInProject).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const stages = {};
  for (const f of Object.keys(TOOL_NAMES)) {
    const done = runs.filter((run) => run.feature === f && runStatus(run) === "done");
    const latest = done[0] || null;
    stages[f] = {
      count: done.length,
      latest: latest ? {
        run_id: latest.run_id, title: latest.title, takeaway: takeawayText(latest), created_at: latest.created_at,
        mode: latest.mode || "quick", template: templateOf(latest.template),
      } : null,
    };
  }
  const conversations = Object.values(state.convs)
    .filter((conv) => conv.owner === me().sub && conv.project_id === p.project_id)
    .sort((x, y) => y.updated_at.localeCompare(x.updated_at)).map(convRow);
  return {
    project: {
      project_id: p.project_id, name: p.name, owner_sub: p.owner_sub, team: teamRef(p), brief: { ...p.brief },
      default_template: p.default_template || "general", archived: !!p.archived, created_at: p.created_at, updated_at: p.updated_at,
      role: projectRole(p), can_manage: canManageProject(p),
    },
    stages, runs: runs.map(projectRunRow), conversations,
  };
}

function projectCards(p) {
  const byKey = new Map();
  const runs = projectRuns(p).filter((run) => runStatus(run) === "done").sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const run of runs) {
    for (const entry of fixtureCards(cardSetOf(run))) {
      const existing = byKey.get(entry.dedupe_key);
      if (existing) {
        if (!existing.run_ids.includes(run.run_id)) existing.run_ids.push(run.run_id);
        continue;
      }
      byKey.set(entry.dedupe_key, {
        ...entry, run_ids: [run.run_id], stale: Date.now() - new Date(entry.captured_at).getTime() > 90 * DAY,
        added_by: USERS[run.owner]?.name || "Teammate", added_by_sub: run.owner,
      });
    }
  }
  return [...byKey.values()];
}

// A report in a project cites one sourced card from the most recent earlier finished report in it.
function withProject(run, result) {
  const p = findProject(run.project_id);
  if (!p || !result) return result;
  const earlierRun = projectRuns(p)
    .filter((other) => other.run_id !== run.run_id && other.created_at < run.created_at && runStatus(other) === "done")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const own = new Set((result.cards || []).map((c) => c.card_id));
  const earlier = earlierRun ? fixtureCards(cardSetOf(earlierRun)).find((c) => c.type === "sourced" && !own.has(c.card_id)) : null;
  const out = { ...result, project: { project_id: p.project_id, name: p.name, team_id: p.team_id, reused: null, earlier_cards: 0 } };
  if (!earlier) return out;
  out.cards = [...(result.cards || []), { ...earlier, earlier: true, label: EARLIER_LABEL }];
  out.findings = (result.findings || []).map((f, i) => (i === 0 ? { ...f, card_ids: [...(f.card_ids || []), earlier.card_id] } : f));
  out.project.reused = `“${earlierRun.title}” already answered part of this question, so this run cites its fact card instead of researching it again.`;
  out.project.earlier_cards = 1;
  return out;
}

// ---- Simulated run progress ---------------------------------------------------

function timeline(feature, total, template = "general") {
  const ebayTasks = {
    competitor_scan: ["Comparable eBay listings", "Shipping on eBay", "Listing details"],
    marketing_plan: ["eBay fees", "Promoted Listings", "Shipping costs"],
  };
  const tasks = (template === "ebay" && ebayTasks[feature]) || {
    market_check: ["Buyer language", "Buying occasions", "Routes to buyers"],
    competitor_scan: ["Local studios", "Online sellers", "Shipping & costs"],
    launch_checklist: ["Business registration", "Tax & records", "Market requirements"],
    marketing_plan: ["Local channels", "Pricing", "Shipping & costs"],
  }[feature];
  const s = total / 18;
  return [
    ["Planner", 0, 2 * s, "Preparing the research plan", "3 research directions"],
    ...tasks.map((name, i) => [name, 2 * s, (7 + i) * s, "Reading sample source pages", "Sample evidence collected"]),
    ["Verifier", 9 * s, 11 * s, "Checking quotes word for word", "Quotes checked"],
    [feature === "marketing_plan" ? "Marketing planner" : "Report editor", 11 * s, 13 * s, feature === "marketing_plan" ? "Drafting the plan and budget" : "Organising findings and next steps", "Draft ready"],
    ["Checker", 13 * s, 15.5 * s, "Checking labels and missing evidence", "Evidence limits recorded"],
    ["Writer", 15.5 * s, total, "Writing the report and charts", "Report ready"],
  ];
}

function snapshot(run) {
  const feature = featureId(run.feature);
  const total = DURATION[run.mode] || DURATION.quick;
  const t = run.seeded ? total : Math.max(0, (Date.now() - run.startedMs) / 1000);
  const failed = !!run.failed;
  const done = !failed && t >= total;
  const status = failed ? "failed" : done ? "done" : t < 0.4 ? "queued" : "running";
  const s = total / 18;
  const stages = [[0, "planning"], [2 * s, "researching"], [9 * s, "verifying"], [11 * s, feature === "marketing_plan" ? "planning_marketing" : "checking"], [13 * s, "checking"], [15.5 * s, "writing"], [total, "done"]];
  let stage = "planning";
  for (const [from, value] of stages) if (t >= from) stage = value;
  if (failed) stage = "researching";
  const agents = Object.fromEntries(timeline(feature, total, run.template).map(([name, start, end, note, finished]) => {
    if (failed) return [name, name === "Planner" ? { status: "done", note: finished } : start <= 2 * s ? { status: "failed", note: "Too few pages could be read" } : { status: "queued", note: "" }];
    return [name, {
      status: t >= end ? "done" : t >= start && status !== "queued" ? "running" : "queued",
      note: t >= end ? finished : t >= start && status !== "queued" ? note : "",
    }];
  }));
  const finishedAt = new Date(new Date(run.created_at).getTime() + total * 1000).toISOString();
  const owner = USERS[run.owner];
  return {
    meta: {
      run_id: run.run_id, user_sub: run.owner, owner_name: owner ? owner.name : null, conv_id: run.conv_id, project_id: run.project_id || null,
      feature, mode: run.mode || "quick", template: templateOf(run.template), title: run.title, brief: run.brief || fixtureBrief(feature),
      status, stage: status === "queued" ? null : stage, agents,
      cost_usd: done ? fixtureResult(run, finishedAt).cost.usd : Math.round(0.36 * Math.min(1, t / total) * 100) / 100,
      error: failed ? run.error : null, share_token: run.share_token || null, created_at: run.created_at,
      updated_at: done ? finishedAt : new Date().toISOString(), result_key: done ? `runs/${run.run_id}.json` : null,
    },
    result: done ? fixtureResult(run, finishedAt) : null,
  };
}
const findRun = (id) => state.runs.find((run) => run.run_id === id) || null;
const runStatus = (run) => snapshot(run).meta.status;

// A done run is readable by everyone who can see its project; unfiled runs stay private (SPEC v5).
function canRead(run) {
  if (run.owner === me().sub) return true;
  return runStatus(run) === "done" && canSeeProject(findProject(run.project_id));
}

function runRow(run) {
  const { meta } = snapshot(run);
  return {
    run_id: meta.run_id, conv_id: meta.conv_id, feature: meta.feature, mode: meta.mode, template: meta.template, title: meta.title,
    status: meta.status, created_at: meta.created_at, cost_usd: meta.cost_usd, owner_name: meta.owner_name, project_id: run.project_id || null,
    owner_sub: run.owner,
  };
}

function cardsFor(subs, { withAddedBy = false } = {}) {
  const byKey = new Map();
  const runs = state.runs
    .filter((run) => subs.includes(run.owner) && runStatus(run) === "done")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const run of runs) {
    for (const entry of fixtureCards(cardSetOf(run))) {
      const existing = byKey.get(entry.dedupe_key);
      if (existing) {
        if (!existing.run_ids.includes(run.run_id)) existing.run_ids.push(run.run_id);
        continue;
      }
      byKey.set(entry.dedupe_key, {
        ...entry, run_ids: [run.run_id],
        stale: Date.now() - new Date(entry.captured_at).getTime() > 90 * DAY,
        ...(withAddedBy ? { added_by: USERS[run.owner]?.name || "Teammate" } : {}),
      });
    }
  }
  return [...byKey.values()];
}

function filterCards(cards, query) {
  const q = (query.get("q") || "").trim().toLowerCase();
  let out = cards;
  if (q) out = out.filter((entry) => [entry.claim, entry.quote, entry.source_title].some((value) => value.toLowerCase().includes(q)));
  for (const key of ["type", "direction", "feature"]) if (query.get(key)) out = out.filter((entry) => entry[key] === query.get(key));
  return out.sort((x, y) => y.captured_at.localeCompare(x.captured_at));
}

function teamView(team) {
  const role = team.owner_sub === me().sub ? "owner" : "member";
  const mine = Object.values(state.projects).filter((p) => p.team_id === team.team_id && p.owner_sub === me().sub);
  return {
    leaving: {
      needs_new_owner: role === "owner" || mine.length > 0,
      projects: mine.map((p) => ({ project_id: p.project_id, name: p.name, archived: !!p.archived })),
    },
    team: { team_id: team.team_id, name: team.name, owner_sub: team.owner_sub, created_at: team.created_at },
    role,
    members: team.members.map((m) => ({ ...USERS[m.sub], ...m, email: USERS[m.sub]?.email, name: USERS[m.sub]?.name })),
    invites: role === "owner" ? team.invites.filter((i) => i.status === "pending").map((i) => ({ ...i, invite_url: inviteUrl(i.token) })) : [],
    projects: listProjects({ teamId: team.team_id }),
  };
}
const inviteUrl = (token) => `${location.origin}${location.pathname}?mock=1#/join/${token}`;

function teamListRow(team) {
  const mine = team.members.find((m) => m.sub === me().sub);
  return {
    team_id: team.team_id, name: team.name, role: team.owner_sub === me().sub ? "owner" : "member",
    owner_sub: team.owner_sub, joined_at: mine?.joined_at || null, member_count: team.members.length,
  };
}

function createTeam(name) {
  if (!name) return fail(400, "bad_request", "Enter a team name.");
  if (teamsOf(me().sub).length >= TEAM_LIMIT) return fail(429, "team_limit", "You can be in at most 10 teams.");
  const id = `team-${newId()}`;
  const now = new Date().toISOString();
  state.teams[id] = { team_id: id, name: name.slice(0, 80), owner_sub: me().sub, created_at: now, members: [{ sub: me().sub, role: "owner", joined_at: now }], invites: [] };
  return ok(teamView(state.teams[id]));
}

// Team actions shared by /teams/{id}/… and the old /team/… routes (first team).
function teamAction(team, method, b, c, query, body) {
  const user = me();
  const isOwner = team.owner_sub === user.sub;
  if (!b && method === "GET") return ok(teamView(team));
  if (b === "invites" && !c && method === "POST") {
    if (!isOwner) return fail(403, "team_owner_only", "Only the team owner can invite people.");
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, "invalid_email", "Enter a valid email address.");
    if (team.members.some((m) => USERS[m.sub]?.email.toLowerCase() === email)) return fail(409, "already_member", "That person is already in the team.");
    const token = newId() + newId();
    team.invites.push({ token, email, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 7 * DAY).toISOString(), status: "pending" });
    return ok({ token, invite_url: inviteUrl(token), emailed: false });
  }
  if (b === "invites" && c && method === "DELETE") {
    if (!isOwner) return fail(403, "team_owner_only", "Only the team owner can revoke invites.");
    const inv = team.invites.find((i) => i.token === c);
    if (!inv) return fail(404, "not_found", "Invite not found.");
    inv.status = "revoked";
    return ok({ ok: true });
  }
  if (b === "members" && c && method === "DELETE") {
    if (!isOwner) return fail(403, "team_owner_only", "Only the team owner can remove members.");
    if (c === user.sub) return fail(400, "cannot_remove_owner", "The owner cannot remove themself.");
    if (!memberOf(team, c)) return fail(404, "not_found", "Member not found.");
    // Their projects in this team go to the team owner; any over the owner's 10 live are archived.
    for (const p of Object.values(state.projects).filter((x) => x.team_id === team.team_id && x.owner_sub === c)) {
      if (!p.archived && liveCount(user.sub) >= LIVE_PROJECT_LIMIT) p.archived = true;
      p.owner_sub = user.sub;
      p.updated_at = new Date().toISOString();
    }
    team.members = team.members.filter((m) => m.sub !== c);
    return ok({ ok: true });
  }
  if (b === "leave" && method === "POST") {
    const others = team.members.filter((m) => m.sub !== user.sub);
    if (isOwner && !others.length) return fail(403, "owner_cannot_leave", "You are the only member, so you cannot leave this team.");
    const mine = Object.values(state.projects).filter((p) => p.team_id === team.team_id && p.owner_sub === user.sub);
    const next = body.new_owner_sub;
    if ((isOwner || mine.length) && !next) return fail(400, "new_owner_required", "Choose who takes over before you leave.");
    if (next && (next === user.sub || !memberOf(team, next))) return fail(400, "invalid_new_owner", "Choose another member of this team.");
    if (next) {
      const moving = mine.filter((p) => !p.archived).length;
      if (moving && liveCount(next) + moving > LIVE_PROJECT_LIMIT) {
        return fail(429, "project_limit", `${USERS[next]?.name || "That member"} already has 10 live projects.`);
      }
      for (const p of mine) { p.owner_sub = next; p.updated_at = new Date().toISOString(); }
      if (isOwner) {
        team.owner_sub = next;
        team.members.forEach((m) => { if (m.sub === next) m.role = "owner"; });
      }
    }
    team.members = team.members.filter((m) => m.sub !== user.sub);
    return ok({ ok: true });
  }
  // Team sharing is per project: runs and cards of the team's projects only.
  const teamProjects = Object.values(state.projects).filter((p) => p.team_id === team.team_id);
  if (b === "runs" && method === "GET") {
    const runs = state.runs.filter((run) => teamProjects.some((p) => p.project_id === run.project_id) && runStatus(run) === "done")
      .map(runRow).sort((x, y) => y.created_at.localeCompare(x.created_at));
    return ok({ runs });
  }
  if (b === "cards" && method === "GET") {
    const byKey = new Map();
    for (const p of teamProjects) for (const entry of projectCards(p)) if (!byKey.has(entry.dedupe_key)) byKey.set(entry.dedupe_key, entry);
    return ok({ cards: filterCards([...byKey.values()], query) });
  }
  return fail(404, "not_found", "No such endpoint in mock mode.");
}

// ---- HTTP-shaped mock router ------------------------------------------------------

export async function handle(method, url, body) {
  const [path, qs] = url.split("?");
  const query = new URLSearchParams(qs || "");
  const segments = path.split("/").filter(Boolean).map(decodeURIComponent);
  await delay(path === "/chat" ? 650 : path.endsWith("/mockup") ? 1400 : 120);
  try { return route(method, segments, query, body || {}); }
  finally { saveState(); }
}

function route(method, segments, query, body) {
  const [a, b, c] = segments;
  if (a === "health") return ok({ ok: true });
  if (a === "auth" && b === "google" && method === "POST") {
    state.signedIn = true;
    state.persona = body.credential === "mock-member" ? "demo-member" : "demo-owner";
    return ok({ user: userView() });
  }
  if (a === "auth" && b === "logout" && method === "POST") {
    state.signedIn = false;
    return ok({ ok: true });
  }
  if (a === "shared" && b && method === "GET") {
    const run = findRun(state.shares[b]);
    if (!run) return fail(404, "not_found", "This shared report was not found.");
    const { meta, result } = snapshot(run);
    const { user_sub: _drop, ...publicMeta } = meta;
    return ok({ run: publicMeta, result });
  }
  if (a === "invites" && b && method === "GET") {
    return ok({ team_name: "Clay & Leaf Studio", inviter_name: "Demo Owner", email_hint: "d\u2022\u2022\u2022@example.com",
      status: "pending", expires_at: new Date(Date.now() + 6 * 864e5).toISOString() });
  }
  if (!state.signedIn) return fail(401, "unauthorized", "Sign in to continue.");
  const user = me();
  if (a === "me" && method === "GET") return ok({ user: userView() });
  if (a === "templates" && !b && method === "GET") return ok(templatesView());

  // Conversations
  if (a === "chat" && method === "POST") {
    const message = String(body.message || "").trim();
    if (!message) return fail(400, "bad_request", "Type a message first.");
    let conv = body.conv_id ? state.convs[body.conv_id] : null;
    if (body.conv_id && (!conv || conv.owner !== user.sub)) return fail(404, "not_found", "Conversation not found.");
    if (!conv) {
      const project = body.project_id ? findProject(body.project_id) : null;
      if (body.project_id && !canSeeProject(project)) return fail(404, "project_not_found", "Project not found.");
      const template = body.template == null ? (project?.default_template || "general") : body.template;
      const known = templatesView().find((t) => t.id === template);
      if (!known) return fail(400, "invalid_template", "Choose one of the listed templates.");
      if (!known.tools.includes(featureId(body.feature))) return fail(400, "invalid_template", "This template does not offer that tool.");
      if (!known.available) return fail(409, "template_unavailable", known.unavailable_reason);
      const mine = Object.values(state.convs).filter((x) => x.owner === user.sub);
      if (mine.length >= 20) return fail(429, "conversation_limit", "You have reached the limit of 20 conversations.");
      const now = new Date().toISOString();
      conv = { conv_id: newId(), owner: user.sub, feature: featureId(body.feature), template, project_id: project ? project.project_id : null, messages: [], brief: null, ready: false, run_id: null, created_at: now, updated_at: now };
      state.convs[conv.conv_id] = conv;
    }
    if (conv.messages.length >= 30) return fail(429, "conversation_full", "This conversation is full. Start a new one to keep going.");
    conv.messages.push({ role: "user", text: message, at: new Date().toISOString() });
    // A project with a brief needs one question fewer: the research lead already knows those facts.
    const project = findProject(conv.project_id);
    const known = project && project.brief?.business ? 1 : 0;
    const answered = conv.messages.filter((entry) => entry.role === "user").length;
    const output = intakeReply(conv.feature, answered + known, templateOf(conv.template));
    const reply = known && answered === 1 ? `I already know this project's brief, so I have one question fewer. ${output.reply}` : output.reply;
    output.reply = reply;
    conv.messages.push({ role: "assistant", text: output.reply, at: new Date().toISOString() });
    const fromProject = project ? Object.fromEntries(Object.entries(project.brief || {}).filter(([, v]) => v != null && v !== "")) : {};
    conv.brief = answered === 1
      ? { ...output.brief, ...fromProject, business: fromProject.business || message.slice(0, 120) }
      : { ...output.brief, ...fromProject, business: conv.brief?.business || fromProject.business || output.brief.business };
    conv.ready = output.ready;
    conv.updated_at = new Date().toISOString();
    return ok({ conv_id: conv.conv_id, feature: conv.feature, template: templateOf(conv.template), project_id: conv.project_id || null, reply: output.reply, ready: conv.ready, brief: conv.brief, messages: conv.messages, run_id: conv.run_id });
  }
  if (a === "conversations" && !b && method === "GET") {
    const limit = Math.min(50, Number(query.get("limit")) || 50);
    const conversations = Object.values(state.convs)
      .filter((conv) => conv.owner === user.sub)
      .sort((x, y) => y.updated_at.localeCompare(x.updated_at))
      .slice(0, limit)
      .map(convRow);
    return ok({ conversations });
  }
  if (a === "conversations" && b && method === "PATCH") {
    const conv = state.convs[b];
    if (!conv || conv.owner !== user.sub) return fail(404, "not_found", "Conversation not found.");
    const target = body.project_id ? findProject(body.project_id) : null;
    if (body.project_id && !canSeeProject(target)) return fail(404, "project_not_found", "Project not found.");
    conv.project_id = target ? target.project_id : null;
    const { owner: _o, ...rest } = conv;
    return ok({ ...rest, template: templateOf(conv.template), run_status: conv.run_id ? runStatus(findRun(conv.run_id)) : null });
  }
  if (a === "conversations" && b && method === "GET") {
    const conv = state.convs[b];
    if (!conv || conv.owner !== user.sub) return fail(404, "not_found", "Conversation not found.");
    const run = conv.run_id ? findRun(conv.run_id) : null;
    const { owner: _o, ...rest } = conv;
    return ok({ ...rest, template: templateOf(conv.template), run_status: run ? runStatus(run) : null });
  }

  // Runs
  if (a === "runs" && !b && method === "POST") {
    const conv = state.convs[body.conv_id];
    if (!conv || conv.owner !== user.sub) return fail(404, "not_found", "Conversation not found.");
    if (!conv.ready) return fail(409, "not_ready", "The brief is not ready yet.");
    if (conv.run_id) return fail(409, "already_started", "Research already started from this conversation.");
    const mode = body.mode || "quick";
    if (!MODE_IDS.includes(mode)) return fail(400, "invalid_mode", "mode must be quick, balanced or smarter");
    if (mode === "smarter" && pageQuery.get("smarter") === "limit") return fail(429, "smarter_daily_limit", "Smarter research has reached today's limit.");
    const template = templateOf(conv.template);
    const tpl = templatesView().find((t) => t.id === template);
    if (tpl && !tpl.available) return fail(409, "template_unavailable", tpl.unavailable_reason);
    if (userView().free_runs_left !== null && userView().free_runs_left <= 0) return fail(402, "free_run_used", "You have used your free reports.");
    const now = Date.now();
    const run = {
      run_id: newId(), owner: user.sub, conv_id: conv.conv_id, feature: conv.feature, mode, template, brief: conv.brief,
      title: conv.brief?.business ? `${TOOL_NAMES[conv.feature]}: ${conv.brief.business}`.slice(0, 90) : TITLES[conv.feature],
      created_at: new Date(now).toISOString(), startedMs: now, share_token: null, project_id: conv.project_id || null,
    };
    state.runs.unshift(run);
    conv.run_id = run.run_id;
    conv.updated_at = run.created_at;
    state.runsStarted[user.sub] = (state.runsStarted[user.sub] || 0) + 1;
    return ok({ run: snapshot(run).meta });
  }
  if (a === "runs" && !b && method === "GET") {
    const runs = state.runs.filter((run) => run.owner === user.sub).map(runRow);
    runs.sort((x, y) => y.created_at.localeCompare(x.created_at));
    return ok({ runs });
  }
  if (a === "runs" && b) {
    const run = findRun(b);
    if (!run || !canRead(run)) return fail(404, "not_found", "Run not found.");
    if (!c && method === "GET") {
      const { meta, result } = snapshot(run);
      const project = findProject(run.project_id);
      return ok({
        run: meta, result: withProject(run, result), access: run.owner === user.sub ? "owner" : "project",
        project: project && canSeeProject(project) ? { project_id: project.project_id, name: project.name, team_id: project.team_id } : null,
      });
    }
    if (!c && method === "PATCH") {
      if (run.owner !== user.sub) return fail(403, "forbidden", "Only the author can move this report.");
      const target = body.project_id ? findProject(body.project_id) : null;
      if (body.project_id && !canSeeProject(target)) return fail(404, "project_not_found", "Project not found.");
      run.project_id = target ? target.project_id : null;
      return ok({ run: snapshot(run).meta });
    }
    if (c === "share" && method === "POST") {
      if (run.owner !== user.sub) return fail(403, "forbidden", "Only the author can share this report.");
      if (!run.share_token) {
        run.share_token = newId() + newId();
        state.shares[run.share_token] = run.run_id;
      }
      return ok({ token: run.share_token, url: `${location.origin}${location.pathname}?mock=1#/shared/${run.share_token}` });
    }
    if (c === "mockups" && method === "GET") {
      if (pageQuery.get("mockups") === "off") return fail(503, "mockups_disabled", "Mock-ups are not configured.");
      return ok({ mockups: state.mockups[run.run_id] || [] });
    }
    if (c === "mockup" && method === "POST") {
      if (pageQuery.get("mockups") === "off") return fail(503, "mockups_disabled", "Mock-ups are not configured.");
      if (!user.is_owner) return fail(403, "owner_only", "Mock-ups are limited to owner accounts.");
      const list = state.mockups[run.run_id] ||= [];
      if (list.length >= 3) return fail(409, "mockup_limit", "This report already has 3 mock-ups.");
      const kind = ["product", "listing", "ad"].includes(body.prompt_kind) ? body.prompt_kind : "product";
      const prompts = {
        product: "Studio photo of a speckled stoneware planter with a matching saucer and a small fern, soft daylight.",
        listing: "Marketplace listing image: speckled 6-inch planter with saucer on a plain warm background.",
        ad: "Square social ad: planter on a sunny shelf with the line ‘Made in Seattle’.",
      };
      const entry = { url: `assets/mockup-${kind}.svg`, prompt: prompts[kind], prompt_kind: kind, created_at: new Date().toISOString() };
      list.push(entry);
      return ok(entry);
    }
  }

  // Fact cards
  if (a === "cards" && method === "GET") return ok({ cards: filterCards(cardsFor([user.sub]), query) });

  // Projects (SPEC v5)
  if (a === "projects" && !b && method === "GET") return ok(listProjects({ archived: query.get("archived") === "1" }));
  if (a === "projects" && !b && method === "POST") {
    const name = String(body.name || "").trim().slice(0, 80);
    if (!name) return fail(400, "invalid_request", "Enter a project name.");
    if (body.team_id && !memberOf(state.teams[body.team_id], user.sub)) return fail(404, "no_team", "You are not in that team.");
    if (liveCount(user.sub) >= LIVE_PROJECT_LIMIT) return fail(429, "project_limit", liveLimitMessage());
    const now = new Date().toISOString();
    const brief = { business: null, customer: null, location: null, stage: null, budget_usd: null, ...(body.brief || {}) };
    const p = {
      project_id: `proj-${newId()}`, name, owner_sub: user.sub, team_id: body.team_id || null, brief,
      default_template: templateOf(body.default_template), created_at: now, updated_at: now, archived: false,
    };
    state.projects[p.project_id] = p;
    return ok(projectDetailView(p));
  }
  if (a === "projects" && b) {
    const p = findProject(b);
    if (!p || !canSeeProject(p)) return fail(404, "project_not_found", "Project not found.");
    if (!c && method === "GET") return ok(projectDetailView(p));
    if (!c && method === "PATCH") {
      if (!canManageProject(p)) return fail(403, "project_owner_only", "Only the project owner or the team owner can change this project.");
      if (body.name != null) {
        const name = String(body.name).trim().slice(0, 80);
        if (!name) return fail(400, "invalid_request", "Enter a project name.");
        p.name = name;
      }
      if (body.brief && typeof body.brief === "object") {
        for (const key of ["business", "customer", "location", "stage", "budget_usd"]) if (key in body.brief) p.brief[key] = body.brief[key];
      }
      if ("team_id" in body) {
        if (body.team_id && !memberOf(state.teams[body.team_id], user.sub)) return fail(404, "no_team", "You are not in that team.");
        p.team_id = body.team_id || null;
      }
      if ("archived" in body) {
        if (p.archived && !body.archived && liveCount(p.owner_sub) >= LIVE_PROJECT_LIMIT) {
          return fail(429, "project_limit", p.owner_sub === user.sub ? liveLimitMessage()
            : `${USERS[p.owner_sub]?.name || "The project owner"} already has 10 live projects.`);
        }
        p.archived = !!body.archived;
      }
      if (body.default_template) p.default_template = templateOf(body.default_template);
      p.updated_at = new Date().toISOString();
      return ok(projectDetailView(p));
    }
    if (c === "cards" && method === "GET") return ok({ cards: filterCards(projectCards(p), query) });
    if (c === "runs" && method === "GET") return ok({ runs: projectDetailView(p).runs });
  }

  // Teams: a person can be in several (SPEC v5); the old /team routes act on the first team joined.
  if (a === "teams" && !b && method === "GET") return ok(teamsOf(user.sub).map(teamListRow));
  if (a === "teams" && !b && method === "POST") return createTeam(String(body.name || "").trim());
  if (a === "teams" && b) {
    const team = state.teams[b];
    if (!memberOf(team, user.sub)) return fail(404, "no_team", "You are not in that team.");
    return teamAction(team, method, c, segments[3], query, body);
  }
  if (a === "team") {
    const team = firstTeam();
    if (!b && method === "GET" && !team) return ok({ team: null, role: null, members: [], invites: [], projects: [] });
    if (!b && method === "POST") return createTeam(String(body.name || "").trim());
    if (b === "join" && method === "POST") {
      for (const t of Object.values(state.teams)) {
        const inv = t.invites.find((i) => i.token === body.token);
        if (!inv) continue;
        if (memberOf(t, user.sub)) return ok(teamView(t));
        if (inv.status === "revoked") return fail(410, "invite_revoked", "This invite was revoked.");
        if (inv.status !== "pending" || new Date(inv.expires_at).getTime() < Date.now()) return fail(410, "invite_expired", "This invite has expired.");
        if (inv.email.toLowerCase() !== user.email.toLowerCase()) return fail(403, "invite_email_mismatch", "This invite is for a different email address.");
        if (teamsOf(user.sub).length >= TEAM_LIMIT) return fail(429, "team_limit", "You can be in at most 10 teams.");
        inv.status = "accepted";
        t.members.push({ sub: user.sub, role: "member", joined_at: new Date().toISOString() });
        return ok(teamView(t));
      }
      return fail(404, "invite_not_found", "Invite not found.");
    }
    if (!team) return fail(404, "no_team", "You are not in a team.");
    return teamAction(team, method, b, c, query, body);
  }
  return fail(404, "not_found", "No such endpoint in mock mode.");
}
