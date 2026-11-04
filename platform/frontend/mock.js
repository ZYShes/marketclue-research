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
// &smarter=limit makes Smarter runs answer 429 smarter_daily_limit.

const STORE_KEY = "mc_mock_state_v3";
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
};
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

function fixtureCards(set) {
  return CARD_SETS[set] || [];
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

function fixtureResult(run, generatedAt) {
  const feature = run.feature;
  const set = run.cardSet || feature;
  const coverage = { directions: run.mode === "quick" || !run.mode ? 3 : 4, pages_read: { smarter: 9, balanced: 8 }[run.mode] || 6, quotes_found: feature === "market_check" || feature === "launch_checklist" ? 3 : 4, quotes_total: 4, claims_narrowed: 2, relabelled: 1 };
  const result = {
    version: 3, feature, mode: run.mode || "quick", title: run.title, generated_at: generatedAt, brief: run.brief,
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
  return { ...result, ...byFeature[feature] };
}

// ---- Sample intake ------------------------------------------------------------

const SAMPLE_ANSWERS = {
  market_check: ["Handmade stoneware planters with drainage holes, sold in Seattle.", "Mostly plant owners at weekend markets; a few bought them as gifts.", "Who the customer is matters most."],
  competitor_scan: ["Handmade 6-inch planters with saucers, Seattle and online.", "6-inch speckled finish, including the saucer.", "Both delivered and pickup prices, please."],
  launch_checklist: ["Planters made in my home studio, sold in Seattle, WA.", "Markets first, then a few shops.", "Yes, I fire at home; the business is not registered yet."],
  marketing_plan: ["Handmade planters for Seattle indoor-plant owners.", "Plant owners at weekend markets; I sell there today.", "$600 for four weeks; 40 customers would be a great result."],
};

function intakeReply(feature, count) {
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
  let out = null;
  answers.forEach((text, i) => {
    messages.push({ role: "user", text, at: when });
    out = intakeReply(feature, i + 1);
    messages.push({ role: "assistant", text: out.reply, at: when });
  });
  return {
    conv_id: id, owner, feature, messages, brief: out ? out.brief : null, ready: out ? out.ready : false,
    run_id: null, created_at: when, updated_at: when, ...extra,
  };
}

// ---- State ------------------------------------------------------------------------

function initialState() {
  const now = Date.now();
  const runs = [
    { run_id: "a1b2c3d4e5f6", owner: "demo-owner", feature: "marketing_plan", mode: "smarter", created_at: hoursAgo(1.2), seeded: true },
    { run_id: "f0e1d2c3b4a5", owner: "demo-owner", feature: "competitor_scan", mode: "quick", created_at: new Date(now - 4000).toISOString(), startedMs: now - 4000, title: "Sample · Saucer prices at Seattle plant shops" },
    { run_id: "c1d2e3f4a5b6", owner: "demo-owner", feature: "competitor_scan", mode: "quick", created_at: daysAgo(2), seeded: true },
    { run_id: "d1e2f3a4b5c6", owner: "demo-owner", feature: "launch_checklist", mode: "balanced", created_at: daysAgo(4), seeded: true },
    { run_id: "e9f8a7b6c5d4", owner: "demo-owner", feature: "market_check", mode: "quick", created_at: daysAgo(5), seeded: true, failed: true, title: "Sample · Who buys glaze workshops?", error: "The research agents could not reach enough public pages. Try again with a narrower question." },
    { run_id: "b1c2d3e4f5a6", owner: "demo-owner", feature: "market_check", mode: "quick", created_at: daysAgo(12), seeded: true },
    { run_id: "aa11bb22cc33", owner: "demo-riley", feature: "competitor_scan", cardSet: "riley", mode: "quick", created_at: daysAgo(3), seeded: true, title: "Sample · Planter prices across online shops" },
    { run_id: "dd44ee55ff66", owner: "demo-member", feature: "market_check", mode: "quick", created_at: daysAgo(6), seeded: true, title: "Sample · Who buys handmade planters? (Sam)" },
  ].map((run) => ({
    ...run, conv_id: `conv-${run.run_id}`, title: run.title || TITLES[run.feature],
    brief: fixtureBrief(run.feature), share_token: run.run_id === "a1b2c3d4e5f6" ? "sample-share" : null,
  }));
  const convs = {};
  for (const run of runs) {
    convs[run.conv_id] = seedConversation(run.conv_id, run.owner, run.feature, SAMPLE_ANSWERS[run.feature], run.created_at, { run_id: run.run_id });
  }
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
  const teamOf = { "demo-owner": "team-clay", "demo-riley": "team-clay" };
  return { version: 3, signedIn: false, persona: "demo-owner", runsStarted: {}, convs, runs, shares, teams, teamOf, mockups: {} };
}

function loadState() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || "null");
    if (saved && saved.version === 3 && Array.isArray(saved.runs) && saved.convs && saved.teams) return saved;
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
  return { ...u, team_id: state.teamOf[u.sub] || null, free_runs_left: u.is_owner ? null : Math.max(0, FREE_RUNS - started) };
}
const myTeam = () => state.teams[state.teamOf[me().sub]] || null;

// ---- Simulated run progress ---------------------------------------------------

function timeline(feature, total) {
  const tasks = {
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
  const agents = Object.fromEntries(timeline(feature, total).map(([name, start, end, note, finished]) => {
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
      run_id: run.run_id, user_sub: run.owner, owner_name: owner ? owner.name : null, conv_id: run.conv_id,
      feature, mode: run.mode || "quick", title: run.title, brief: run.brief || fixtureBrief(feature),
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

function canRead(run) {
  if (run.owner === me().sub) return true;
  const team = myTeam();
  return !!team && team.members.some((m) => m.sub === run.owner) && runStatus(run) === "done";
}

function runRow(run) {
  const { meta } = snapshot(run);
  return {
    run_id: meta.run_id, conv_id: meta.conv_id, feature: meta.feature, mode: meta.mode, title: meta.title,
    status: meta.status, created_at: meta.created_at, cost_usd: meta.cost_usd, owner_name: meta.owner_name,
  };
}

function cardsFor(subs, { withAddedBy = false } = {}) {
  const byKey = new Map();
  const runs = state.runs
    .filter((run) => subs.includes(run.owner) && runStatus(run) === "done")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const run of runs) {
    for (const entry of fixtureCards(run.cardSet || run.feature)) {
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
  return {
    team: { team_id: team.team_id, name: team.name, owner_sub: team.owner_sub, created_at: team.created_at },
    role,
    members: team.members.map((m) => ({ ...USERS[m.sub], ...m, email: USERS[m.sub]?.email, name: USERS[m.sub]?.name })),
    invites: role === "owner" ? team.invites.filter((i) => i.status === "pending").map((i) => ({ ...i, invite_url: inviteUrl(i.token) })) : undefined,
  };
}
const inviteUrl = (token) => `${location.origin}${location.pathname}?mock=1#/join/${token}`;

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

  // Conversations
  if (a === "chat" && method === "POST") {
    const message = String(body.message || "").trim();
    if (!message) return fail(400, "bad_request", "Type a message first.");
    let conv = body.conv_id ? state.convs[body.conv_id] : null;
    if (body.conv_id && (!conv || conv.owner !== user.sub)) return fail(404, "not_found", "Conversation not found.");
    if (!conv) {
      const mine = Object.values(state.convs).filter((x) => x.owner === user.sub);
      if (mine.length >= 20) return fail(429, "conversation_limit", "You have reached the limit of 20 conversations.");
      const now = new Date().toISOString();
      conv = { conv_id: newId(), owner: user.sub, feature: featureId(body.feature), messages: [], brief: null, ready: false, run_id: null, created_at: now, updated_at: now };
      state.convs[conv.conv_id] = conv;
    }
    if (conv.messages.length >= 30) return fail(429, "conversation_full", "This conversation is full. Start a new one to keep going.");
    conv.messages.push({ role: "user", text: message, at: new Date().toISOString() });
    const output = intakeReply(conv.feature, conv.messages.filter((entry) => entry.role === "user").length);
    conv.messages.push({ role: "assistant", text: output.reply, at: new Date().toISOString() });
    conv.brief = conv.messages.filter((m) => m.role === "user").length === 1
      ? { ...output.brief, business: message.slice(0, 120) }
      : { ...output.brief, business: conv.brief?.business || output.brief.business };
    conv.ready = output.ready;
    conv.updated_at = new Date().toISOString();
    return ok({ conv_id: conv.conv_id, feature: conv.feature, reply: output.reply, ready: conv.ready, brief: conv.brief, messages: conv.messages, run_id: conv.run_id });
  }
  if (a === "conversations" && !b && method === "GET") {
    const limit = Math.min(50, Number(query.get("limit")) || 50);
    const conversations = Object.values(state.convs)
      .filter((conv) => conv.owner === user.sub)
      .sort((x, y) => y.updated_at.localeCompare(x.updated_at))
      .slice(0, limit)
      .map((conv) => {
        const run = conv.run_id ? findRun(conv.run_id) : null;
        const firstUser = conv.messages.find((m) => m.role === "user");
        return {
          conv_id: conv.conv_id, feature: conv.feature,
          title: run?.title || conv.brief?.business || (firstUser ? firstUser.text.slice(0, 80) : "New conversation"),
          ready: conv.ready, run_id: conv.run_id || null, run_status: run ? runStatus(run) : null, updated_at: conv.updated_at,
        };
      });
    return ok({ conversations });
  }
  if (a === "conversations" && b && method === "GET") {
    const conv = state.convs[b];
    if (!conv || conv.owner !== user.sub) return fail(404, "not_found", "Conversation not found.");
    const run = conv.run_id ? findRun(conv.run_id) : null;
    const { owner: _o, ...rest } = conv;
    return ok({ ...rest, run_status: run ? runStatus(run) : null });
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
    if (userView().free_runs_left !== null && userView().free_runs_left <= 0) return fail(402, "free_run_used", "You have used your free reports.");
    const now = Date.now();
    const run = {
      run_id: newId(), owner: user.sub, conv_id: conv.conv_id, feature: conv.feature, mode, brief: conv.brief,
      title: conv.brief?.business ? `${TOOL_NAMES[conv.feature]}: ${conv.brief.business}`.slice(0, 90) : TITLES[conv.feature],
      created_at: new Date(now).toISOString(), startedMs: now, share_token: null,
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
      return ok({ run: meta, result });
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

  // Teams
  if (a === "team") {
    const team = myTeam();
    if (!b && method === "GET") return team ? ok(teamView(team)) : ok({ team: null, role: null, members: [], invites: [] });
    if (!b && method === "POST") {
      if (team) return fail(403, "already_in_team", "You are already in a team.");
      const name = String(body.name || "").trim();
      if (!name) return fail(400, "bad_request", "Enter a team name.");
      const id = `team-${newId()}`;
      state.teams[id] = { team_id: id, name: name.slice(0, 80), owner_sub: user.sub, created_at: new Date().toISOString(), members: [{ sub: user.sub, role: "owner", joined_at: new Date().toISOString() }], invites: [] };
      state.teamOf[user.sub] = id;
      return ok(teamView(state.teams[id]));
    }
    if (b === "join" && method === "POST") {
      if (team) return fail(409, "already_in_team", "You are already in a team.");
      for (const t of Object.values(state.teams)) {
        const inv = t.invites.find((i) => i.token === body.token);
        if (!inv) continue;
        if (inv.status === "revoked") return fail(410, "invite_revoked", "This invite was revoked.");
        if (inv.status !== "pending" || new Date(inv.expires_at).getTime() < Date.now()) return fail(410, "invite_expired", "This invite has expired.");
        if (inv.email.toLowerCase() !== user.email.toLowerCase()) return fail(403, "invite_email_mismatch", "This invite is for a different email address.");
        inv.status = "accepted";
        t.members.push({ sub: user.sub, role: "member", joined_at: new Date().toISOString() });
        state.teamOf[user.sub] = t.team_id;
        return ok(teamView(t));
      }
      return fail(404, "not_found", "Invite not found.");
    }
    if (!team) return fail(404, "not_in_team", "You are not in a team.");
    const isOwner = team.owner_sub === user.sub;
    if (b === "invites" && !c && method === "POST") {
      if (!isOwner) return fail(403, "forbidden", "Only the team owner can invite people.");
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, "bad_request", "Enter a valid email address.");
      if (team.members.some((m) => USERS[m.sub]?.email.toLowerCase() === email)) return fail(409, "already_member", "That person is already in the team.");
      const token = newId() + newId();
      team.invites.push({ token, email, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 7 * DAY).toISOString(), status: "pending" });
      return ok({ token, invite_url: inviteUrl(token), emailed: false });
    }
    if (b === "invites" && c && method === "DELETE") {
      if (!isOwner) return fail(403, "forbidden", "Only the team owner can revoke invites.");
      const inv = team.invites.find((i) => i.token === c);
      if (!inv) return fail(404, "not_found", "Invite not found.");
      inv.status = "revoked";
      return ok({ ok: true });
    }
    if (b === "members" && c && method === "DELETE") {
      if (!isOwner) return fail(403, "forbidden", "Only the team owner can remove members.");
      if (c === user.sub) return fail(400, "cannot_remove_self", "The owner cannot remove themself.");
      team.members = team.members.filter((m) => m.sub !== c);
      delete state.teamOf[c];
      return ok({ ok: true });
    }
    if (b === "leave" && method === "POST") {
      if (isOwner) return fail(400, "owner_cannot_leave", "The owner cannot leave the team.");
      team.members = team.members.filter((m) => m.sub !== user.sub);
      delete state.teamOf[user.sub];
      return ok({ ok: true });
    }
    const subs = team.members.map((m) => m.sub);
    if (b === "runs" && method === "GET") {
      const runs = state.runs.filter((run) => subs.includes(run.owner) && runStatus(run) === "done").map(runRow);
      runs.sort((x, y) => y.created_at.localeCompare(x.created_at));
      return ok({ runs });
    }
    if (b === "cards" && method === "GET") return ok({ cards: filterCards(cardsFor(subs, { withAddedBy: true }), query) });
  }
  return fail(404, "not_found", "No such endpoint in mock mode.");
}
