// Development-only API fixtures. Every report, quote and price below is invented
// sample data, and every source uses a reserved example.com domain.
// Session storage keeps the demo sign-in and simulated runs across reloads.

const STORE_KEY = "mc_mock_state_v2";
const RUN_SECONDS = 18;
const FREE_RUNS = 8; // Sample reports do not consume the demo's simulation allowance.
const SEED_RUN_ID = "a1b2c3d4e5f6";
const SEED_SHARE = "sample-share";
const DAY = 86400000;
const daysAgo = (d) => new Date(Date.now() - d * DAY).toISOString();

const DEMO_USER = {
  sub: "demo-user", email: "demo.founder@example.com", name: "Demo Founder",
  picture: null, is_owner: false,
};
const FEATURES = {
  market_check: { name: "Market check", id: "b1c2d3e4f5a6", title: "Sample · Who buys handmade planters?" },
  competitor_scan: { name: "Competitor & price scan", id: "c1d2e3f4a5b6", title: "Sample · Handmade planter prices in Seattle" },
  launch_checklist: { name: "Launch checklist", id: "d1e2f3a4b5c6", title: "Sample · Ready to sell planters in Seattle" },
  marketing_plan: { name: "Marketing plan & budget", id: SEED_RUN_ID, title: "Sample · First customers for handmade planters" },
};
const featureId = (value) => Object.hasOwn(FEATURES, value) ? value : "marketing_plan";
const item = (text, kind = "assumption", card_ids = [], method = "") => ({ text, kind, card_ids, method });
const finding = (title, text, kind, card_ids = [], method = "") => ({ title, ...item(text, kind, card_ids, method) });

function card(id, feature, direction, claim, quote, source, path, type = "sourced", age = 3) {
  return {
    card_id: id, feature, direction, claim, quote,
    source_title: `Sample · ${source}`, url: `https://example.com/sample/${path}`,
    captured_at: daysAgo(age), type, tags: ["sample", feature],
  };
}

function fixtureCards(feature) {
  const groups = {
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
  };
  return feature ? groups[featureId(feature)] : Object.values(groups).flat();
}

function fixtureBrief(feature) {
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
  };
}

function fixtureResult(feature, title, generatedAt, brief = fixtureBrief(feature)) {
  const result = {
    version: 2, feature, title, generated_at: generatedAt, brief,
    table: null, plan: [], budget: null, checklist: [], cards: fixtureCards(feature),
    coverage: { directions: 3, pages_read: 6, quotes_found: feature === "market_check" || feature === "launch_checklist" ? 3 : 4, quotes_total: 4, claims_narrowed: 2, relabelled: 1 },
    cost: { usd: 0.42, input_tokens: 48210, output_tokens: 7480, web_searches: 8, web_fetches: 6 },
    agents: [
      { name: "Planner", status: "done", seconds: 9 },
      { name: FEATURES[feature].name, status: "done", seconds: 71 },
      { name: "Verifier", status: "done", seconds: 22 },
      { name: "Writer", status: "done", seconds: 26 },
    ],
    seconds: 207,
  };
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

// ---- Demo session ---------------------------------------------------------

function initialState() {
  const runs = Object.entries(FEATURES).map(([feature, data], index) => ({
    run_id: data.id, conv_id: `seed-${feature}`, feature, title: data.title,
    brief: fixtureBrief(feature), created_at: daysAgo(index + 1), seeded: true,
    share_token: feature === "marketing_plan" ? SEED_SHARE : `sample-${feature.replaceAll("_", "-")}`,
  }));
  const shares = Object.fromEntries(runs.map((run) => [run.share_token, run.run_id]));
  const cardRuns = {};
  for (const run of runs) for (const entry of fixtureCards(run.feature)) cardRuns[entry.card_id] = [run.run_id];
  return { signedIn: false, runsStarted: 0, convs: {}, runs, shares, cardRuns };
}
function loadState() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || "null");
    if (saved && Array.isArray(saved.runs) && saved.convs && saved.shares && saved.cardRuns) return saved;
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
const userView = () => ({ ...DEMO_USER, free_runs_left: Math.max(0, FREE_RUNS - state.runsStarted) });

// ---- Simulated run progress -----------------------------------------------

function timeline(feature) {
  const featureTasks = {
    market_check: ["Buyer language", "Buying occasions", "Routes to buyers"],
    competitor_scan: ["Local studios", "Online sellers", "Shipping & costs"],
    launch_checklist: ["Business registration", "Tax & records", "Market requirements"],
    marketing_plan: ["Local channels", "Pricing", "Shipping & costs"],
  }[feature];
  return [
    ["Planner", 0, 2, "Preparing the sample research brief", "3 research directions"],
    ...featureTasks.map((name, index) => [name, 2, 7 + index, "Reading sample source pages", "Sample evidence collected"]),
    ["Verifier", 9, 11, "Checking sample quotes and labels", "Quotes checked"],
    [feature === "marketing_plan" ? "Marketing planner" : "Report editor", 11, 13, feature === "marketing_plan" ? "Drafting the sample plan and budget" : "Organising findings and next checks", "Draft ready"],
    ["Checker", 13, 15.5, "Checking labels and missing evidence", "Evidence limits recorded"],
    ["Writer", 15.5, RUN_SECONDS, "Writing the sample report", "Sample report ready"],
  ];
}
function snapshot(run) {
  const feature = featureId(run.feature);
  const t = run.seeded ? RUN_SECONDS : Math.max(0, (Date.now() - run.startedMs) / 1000);
  const done = t >= RUN_SECONDS;
  const status = done ? "done" : t < 0.4 ? "queued" : "running";
  const stages = [[0, "planning"], [2, "researching"], [9, "verifying"], [11, feature === "marketing_plan" ? "planning_marketing" : "checking"], [13, "checking"], [15.5, "writing"], [RUN_SECONDS, "done"]];
  let stage = "planning";
  for (const [from, value] of stages) if (t >= from) stage = value;
  const agents = Object.fromEntries(timeline(feature).map(([name, start, end, note, finished]) => [name, {
    status: t >= end ? "done" : t >= start && status !== "queued" ? "running" : "queued",
    note: t >= end ? finished : t >= start && status !== "queued" ? note : "",
  }]));
  if (done && !run.cardsMerged) {
    for (const entry of fixtureCards(feature)) {
      const ids = state.cardRuns[entry.card_id] ||= [];
      if (!ids.includes(run.run_id)) ids.push(run.run_id);
    }
    run.cardsMerged = true;
  }
  const finishedAt = new Date(new Date(run.created_at).getTime() + (run.seeded ? 207 : RUN_SECONDS) * 1000).toISOString();
  return {
    meta: {
      run_id: run.run_id, conv_id: run.conv_id, feature, title: run.title, brief: run.brief || fixtureBrief(feature),
      status, stage: status === "queued" ? null : stage, agents,
      cost_usd: Math.round(0.42 * Math.min(1, t / RUN_SECONDS) * 100) / 100,
      error: null, share_token: run.share_token || null, created_at: run.created_at,
      updated_at: done ? finishedAt : new Date().toISOString(), result_key: done ? `runs/${run.run_id}.json` : null,
    },
    result: done ? fixtureResult(feature, run.title, finishedAt, run.brief) : null,
  };
}
const findRun = (id) => state.runs.find((run) => run.run_id === id) || null;

// ---- Feature-specific sample intake ---------------------------------------

function intakeReply(feature, count) {
  const questions = {
    market_check: ["Who do you picture buying these planters, and what have they told you so far?", "Which buying question matters most: the customer, the occasion or willingness to pay?"],
    competitor_scan: ["Which planter size and finish should we compare? Should the price include a saucer?", "Should we compare local pickup, delivered prices or both? Any sellers to include?"],
    launch_checklist: ["For the Seattle sample, will you sell from home, online, at markets or through shops?", "Will you make the planters at home, and have you registered the business yet?"],
    marketing_plan: ["Who is the first customer, and where do you sell today?", "What is your four-week marketing budget, and what would count as a good result?"],
  }[feature];
  const brief = fixtureBrief(feature);
  if (count < 3) return {
    reply: `${count === 1 ? "This demo uses a handmade-planter business in Seattle. " : "Thanks. "}${questions[count - 1]}`,
    ready: false, brief: { ...brief, goal: "", questions: [] },
  };
  return {
    reply: count === 3
      ? "Your sample brief is ready. Check it below, then press Start research to see a simulated report."
      : "The demo brief is unchanged. Press Start research when you are ready to see the sample report.",
    ready: true, brief,
  };
}

// ---- HTTP-shaped mock router ---------------------------------------------

export async function handle(method, url, body) {
  const [path, qs] = url.split("?");
  const query = new URLSearchParams(qs || "");
  const segments = path.split("/").filter(Boolean).map(decodeURIComponent);
  await delay(path === "/chat" ? 650 : 150);
  try { return route(method, segments, query, body || {}); }
  finally { saveState(); }
}
function route(method, segments, query, body) {
  const [a, b, c] = segments;
  if (a === "health") return ok({ ok: true });
  if (a === "auth" && b === "google" && method === "POST") {
    state.signedIn = true;
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
    return ok({ run: meta, result });
  }
  if (!state.signedIn) return fail(401, "unauthorized", "Sign in to continue.");
  if (a === "me" && method === "GET") return ok({ user: userView() });

  if (a === "chat" && method === "POST") {
    const message = String(body.message || "").trim();
    if (!message) return fail(400, "bad_request", "Type a message first.");
    let conv = body.conv_id ? state.convs[body.conv_id] : null;
    if (body.conv_id && !conv) return fail(404, "not_found", "Conversation not found.");
    if (!conv) {
      if (Object.keys(state.convs).length >= 20) return fail(429, "conversation_limit", "The demo has reached its conversation limit. Start a fresh browser session.");
      const now = new Date().toISOString();
      conv = { conv_id: newId(), feature: featureId(body.feature), messages: [], brief: null, ready: false, created_at: now, updated_at: now };
      state.convs[conv.conv_id] = conv;
    }
    if (conv.messages.length >= 30) return fail(429, "conversation_full", "This conversation is full. Start a new one to keep going.");
    conv.messages.push({ role: "user", text: message, at: new Date().toISOString() });
    const output = intakeReply(conv.feature, conv.messages.filter((entry) => entry.role === "user").length);
    conv.messages.push({ role: "assistant", text: output.reply, at: new Date().toISOString() });
    conv.brief = output.brief;
    conv.ready = output.ready;
    conv.updated_at = new Date().toISOString();
    return ok({ conv_id: conv.conv_id, feature: conv.feature, reply: output.reply, ready: conv.ready, brief: conv.brief, messages: conv.messages });
  }
  if (a === "conversations" && b && method === "GET") {
    const conv = state.convs[b];
    return conv ? ok(conv) : fail(404, "not_found", "Conversation not found.");
  }
  if (a === "runs" && !b && method === "POST") {
    const conv = state.convs[body.conv_id];
    if (!conv) return fail(404, "not_found", "Conversation not found.");
    if (!conv.ready) return fail(409, "not_ready", "The brief is not ready yet.");
    if (userView().free_runs_left <= 0) return fail(402, "free_run_used", "You have used the demo's sample report allowance.");
    const now = Date.now();
    const run = {
      run_id: newId(), conv_id: conv.conv_id, feature: conv.feature, brief: conv.brief,
      title: FEATURES[conv.feature].title, created_at: new Date(now).toISOString(), startedMs: now,
    };
    state.runs.unshift(run);
    state.runsStarted += 1;
    return ok({ run: snapshot(run).meta });
  }
  if (a === "runs" && !b && method === "GET") {
    const runs = state.runs.map((entry) => {
      const { meta } = snapshot(entry);
      return { run_id: meta.run_id, feature: meta.feature, title: meta.title, status: meta.status, created_at: meta.created_at, cost_usd: meta.cost_usd };
    });
    runs.sort((x, y) => y.created_at.localeCompare(x.created_at));
    return ok({ runs });
  }
  if (a === "runs" && b && !c && method === "GET") {
    const run = findRun(b);
    if (!run) return fail(404, "not_found", "Run not found.");
    const { meta, result } = snapshot(run);
    return ok({ run: meta, result });
  }
  if (a === "runs" && b && c === "share" && method === "POST") {
    const run = findRun(b);
    if (!run) return fail(404, "not_found", "Run not found.");
    if (!run.share_token) {
      run.share_token = newId() + newId();
      state.shares[run.share_token] = run.run_id;
    }
    return ok({ token: run.share_token, url: `${location.origin}${location.pathname}?mock=1#/shared/${run.share_token}` });
  }
  if (a === "cards" && method === "GET") {
    const q = (query.get("q") || "").trim().toLowerCase();
    let cards = fixtureCards()
      .filter((entry) => (state.cardRuns[entry.card_id] || []).length)
      .map((entry) => ({ ...entry, run_ids: state.cardRuns[entry.card_id], stale: Date.now() - new Date(entry.captured_at).getTime() > 90 * DAY }));
    if (q) cards = cards.filter((entry) => [entry.claim, entry.quote, entry.source_title].some((value) => value.toLowerCase().includes(q)));
    for (const key of ["type", "direction", "feature"]) if (query.get(key)) cards = cards.filter((entry) => entry[key] === query.get(key));
    cards.sort((x, y) => y.captured_at.localeCompare(x.captured_at));
    return ok({ cards });
  }
  return fail(404, "not_found", "No such endpoint in mock mode.");
}
