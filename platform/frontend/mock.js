// In-browser stand-in for the MarketClue API, used when MC_CONFIG.mock is true or the
// URL has ?mock=1. For development and screenshots only: the data below is a made-up
// sample (a solo founder selling handmade ceramic planters in Seattle) and every source
// URL points at example.com.
//
// State lives in sessionStorage so a reload keeps the demo sign-in, conversation and runs.
// A new run moves through every stage in about RUN_SECONDS seconds.

const STORE_KEY = "mc_mock_state_v1";
const RUN_SECONDS = 10;
const FREE_RUNS = 2; // the seeded sample run counts as one, so the demo user starts with 1 left
const SEED_RUN_ID = "a1b2c3d4e5f6";
const SEED_SHARE = "sample-share";

const DAY = 86400000;
const daysAgo = (d, hours = 0) => new Date(Date.now() - d * DAY - hours * 3600000).toISOString();

const DEMO_USER = {
  sub: "demo-user",
  email: "demo.founder@example.com",
  name: "Demo Founder",
  picture: null,
  is_owner: false,
};

// ---- Fixtures --------------------------------------------------------------

const C = {
  pricing: "3f9a1c0b7d21",
  studio: "8b04e6d2a915",
  drainage: "c71d9e3f0a48",
  market: "1e6b5a9c3d70",
  shop: "a42f7c1e8b06",
  swap: "5d3e0b9a4c12",
  rates: "9c8a2d6f1e34",
  breakage: "e05b4a7c9d63",
};

function fixtureCards() {
  return [
    {
      card_id: C.pricing,
      claim: "Handmade 6 to 8 inch stoneware planters on a large craft marketplace mostly list between $38 and $62.",
      quote: "Most of the 6 to 8 inch stoneware planters in this category are listed between $38 and $62, with saucers usually sold as an $8 to $12 add-on.",
      url: "https://example.com/sample/craft-marketplace/planter-pricing-2026",
      source_title: "Pricing handmade planters: what sellers charge in 2026",
      captured_at: daysAgo(4, 3),
      type: "sourced",
      direction: "Competitors & prices",
      tags: ["pricing", "online"],
    },
    {
      card_id: C.studio,
      claim: "A Seattle pottery studio sells a 6-inch speckled planter with saucer for $54.",
      quote: "6\" Speckled Stoneware Planter with Saucer. $54.00. Made to order in our Georgetown studio, ships in 2 to 3 weeks.",
      url: "https://example.com/sample/rainier-clay-studio/shop/planters",
      source_title: "Rainier Clay Studio · Planters",
      captured_at: daysAgo(4, 3),
      type: "sourced",
      direction: "Competitors & prices",
      tags: ["pricing", "local"],
    },
    {
      card_id: C.drainage,
      claim: "Indoor-plant buyers increasingly treat a drainage hole as a must-have.",
      quote: "Shoppers now treat a drainage hole as a must-have rather than a nice extra.",
      url: "https://example.com/sample/plant-journal/houseplant-trends-spring-2026",
      source_title: "Houseplant buying trends, spring 2026",
      captured_at: daysAgo(142),
      type: "unverified",
      direction: "Competitors & prices",
      tags: ["product"],
    },
    {
      card_id: C.market,
      claim: "The Lakeview Makers Market charges artisan vendors $95 per market day for a 10 by 10 ft stall.",
      quote: "Artisan stall fee: $95 per market day for a 10' x 10' space. Tents are not provided.",
      url: "https://example.com/sample/lakeview-makers-market/vendors",
      source_title: "Lakeview Makers Market · Vendor information",
      captured_at: daysAgo(3, 6),
      type: "sourced",
      direction: "Local channels",
      tags: ["markets", "costs"],
    },
    {
      card_id: C.shop,
      claim: "An independent Seattle plant shop stocks local makers on consignment and keeps 40% of the sale price.",
      quote: "We love stocking local makers. Pieces are taken on consignment and we keep 40% of the sale price.",
      url: "https://example.com/sample/greenway-plant-co/work-with-us",
      source_title: "Greenway Plant Co. · Work with us",
      captured_at: daysAgo(3, 6),
      type: "sourced",
      direction: "Local channels",
      tags: ["retail", "consignment"],
    },
    {
      card_id: C.swap,
      claim: "A Seattle plant-swap community says it has about 6,200 members.",
      quote: "Join 6,200 Seattle plant people swapping cuttings every month.",
      url: "https://example.com/sample/seattle-plant-swap/about",
      source_title: "Seattle Plant Swap · About",
      captured_at: daysAgo(3, 5),
      type: "unverified",
      direction: "Local channels",
      tags: ["community"],
    },
    {
      card_id: C.rates,
      claim: "Ground shipping for a 5 lb parcel from Seattle to Los Angeles starts at about $14.",
      quote: "Ground, 5 lb, 12 x 12 x 10 in, Seattle WA 98108 to Los Angeles CA 90012: from $14.20, 4 business days.",
      url: "https://example.com/sample/parcel-rates/quote?from=98108&to=90012&lb=5",
      source_title: "Parcel rate calculator · sample quote",
      captured_at: daysAgo(2, 20),
      type: "sourced",
      direction: "Shipping & costs",
      tags: ["shipping", "costs"],
    },
    {
      card_id: C.breakage,
      claim: "One ceramics seller saw about 1 in 40 planters arrive cracked before switching to double boxing.",
      quote: "Before we switched to double boxing, about 1 in 40 planters arrived cracked. Since then we have had two breaks all year.",
      url: "https://example.com/sample/maker-forum/threads/shipping-pottery-breakage",
      source_title: "Shipping pottery without breakage · seller forum",
      captured_at: daysAgo(2, 20),
      type: "sourced",
      direction: "Shipping & costs",
      tags: ["shipping", "packaging"],
    },
  ];
}

const BRIEF_FULL = {
  business: "Handmade stoneware planters with drainage holes and saucers, thrown and glazed in a home studio.",
  customer: "Seattle renters aged 25 to 40 who already buy indoor plants and want pots that drain.",
  location: "Seattle, WA",
  stage: "Selling at one weekend market; no online shop yet.",
  budget_usd: 600,
  goal: "40 online orders in the first 8 weeks.",
  questions: [
    "What do comparable handmade planters sell for online and in Seattle?",
    "Which local channels reach indoor-plant buyers, and what do they cost?",
    "What does it cost to ship a boxed planter, and how often do they break?",
  ],
};

const s = (text, kind, card_ids = [], method = "") => ({ text, kind, card_ids, method });

function fixtureResult(title, generatedAt) {
  return {
    title,
    generated_at: generatedAt,
    brief: BRIEF_FULL,
    summary: [
      s("Price the 6-inch planter with saucer at $52. That sits inside the $38 to $62 range for comparable pieces and just under a local studio's $54.", "sourced", [C.pricing, C.studio]),
      s("Start local: one Sunday market stall ($95 a day) and one plant shop on consignment (40% commission) put planters in front of plant buyers before you pay for ads.", "sourced", [C.market, C.shop]),
      s("Shipping is the main risk to margin. Absorbing an average of $12 per order leaves about $31 per $52 planter, so double box and count packaging in the price.", "estimate", [C.rates, C.breakage],
        "$52 price − $9 clay, glaze and firing (assumed) − $12 average shipping (the $14.20 ground quote to Los Angeles, blended with cheaper local orders) = $31."),
    ],
    findings: [
      {
        direction: "Competitors & prices",
        items: [
          s("Comparable handmade planters list for roughly $38 to $62 online; saucers are often an $8 to $12 add-on.", "sourced", [C.pricing]),
          s("A Seattle studio prices a similar 6-inch planter with saucer at $54, made to order with a 2 to 3 week wait.", "sourced", [C.studio]),
          s("Buyers may expect a drainage hole as standard. We could not find this quote on the captured page, so treat it as a lead.", "assumption", [C.drainage]),
        ],
      },
      {
        direction: "Local channels",
        items: [
          s("A Sunday makers market stall costs $95 per market day, tent not included.", "sourced", [C.market]),
          s("At least one independent plant shop takes local makers on consignment and keeps 40% of the sale.", "sourced", [C.shop]),
          s("A local plant-swap group may have several thousand members; the member count was not confirmed on the page.", "assumption", [C.swap]),
        ],
      },
      {
        direction: "Shipping & costs",
        items: [
          s("Ground shipping a boxed 5 lb planter from Seattle to Los Angeles starts at about $14.", "sourced", [C.rates]),
          s("Single-boxed pottery breaks often enough to matter: one seller saw about 1 in 40 arrive cracked.", "sourced", [C.breakage]),
          s("Breakage could cost about $66 over 40 orders without double boxing.", "estimate", [C.breakage],
            "40 orders × 1 in 40 breakage × ($52 replacement planter + $14.20 reshipping) = $66.20."),
        ],
      },
    ],
    cards: fixtureCards(),
    plan: [
      {
        section: "Customers",
        items: [
          s("Seattle renters aged 25 to 40 who already buy indoor plants and want pots that drain.", "assumption"),
          s("Plant-shop shoppers are a warm audience: a local shop already stocks makers on consignment.", "sourced", [C.shop]),
        ],
      },
      {
        section: "Positioning",
        items: [
          s("Handmade in Seattle, made to drain, glazed in small batches. Lead with the drainage hole and saucer, not only the look.", "assumption", [C.drainage]),
        ],
      },
      {
        section: "Pricing",
        items: [
          s("List the 6-inch planter with saucer at $52, within the range of comparable handmade planters.", "sourced", [C.pricing, C.studio]),
          s("Gross margin at $52 is about $31 per planter after shipping.", "estimate", [C.rates],
            "$52 − $9 materials and firing − $12 average shipping = $31."),
        ],
      },
      {
        section: "Channels",
        items: [
          s("Book two Sundays at the makers market in the first month.", "sourced", [C.market]),
          s("Place 6 planters on consignment at one plant shop. At a 40% commission you keep $31.20 of a $52 sale.", "sourced", [C.shop]),
          s("Post weekly in local plant-swap groups. Their size is not confirmed.", "assumption", [C.swap]),
        ],
      },
      {
        section: "Content (4 weeks)",
        items: [
          s("Week 1: a studio process reel (throwing, trimming, drilling the drainage hole).", "assumption"),
          s("Week 2: a 'which plant fits which pot' guide across three sizes.", "assumption"),
          s("Week 3: market-day stories, plus a free pickup option for Seattle buyers.", "assumption"),
          s("Week 4: a packing video that shows double boxing, to answer breakage worries early.", "assumption", [C.breakage]),
        ],
      },
      {
        section: "Measurement",
        items: [
          s("Aim for about 5 online orders a week.", "estimate", [], "40 orders ÷ 8 weeks = 5 a week, from the goal in your brief."),
          s("Give each channel its own discount code (MARKET, SHOP, SWAP) to see where orders come from.", "assumption"),
        ],
      },
      {
        section: "Brand & compliance",
        items: [
          s("Check Washington business license and sales tax rules before your first market day.", "assumption"),
          s("Do not call planters 'food safe' unless the glaze has been tested; planters do not need the claim.", "assumption"),
        ],
      },
    ],
    budget: {
      currency: "USD",
      total: 600,
      lines: [
        { item: "Market stall fees, 2 Sundays", amount: 190, kind: "sourced", card_ids: [C.market], method: "2 × $95 per market day" },
        { item: "Double-box shipping supplies", amount: 140, kind: "estimate", card_ids: [C.breakage], method: "40 orders × $3.50 for two boxes and padding" },
        { item: "Promoted Instagram posts", amount: 150, kind: "assumption", card_ids: [], method: "A test amount: 6 posts at $25" },
        { item: "Consignment stock (6 planters at cost)", amount: 54, kind: "estimate", card_ids: [C.shop], method: "6 × $9 materials and firing" },
        { item: "Photo setup (lightbox and backdrop)", amount: 45, kind: "assumption", card_ids: [], method: "" },
        { item: "Samples and discount codes", amount: 21, kind: "assumption", card_ids: [], method: "" },
      ],
    },
    next_checks: [
      "Ask Greenway Plant Co. whether the 40% consignment split applies to ceramics, and how long unsold pieces stay on the shelf.",
      "Get a real shipping quote for one boxed 6-inch planter to Los Angeles and to Portland, using your actual box size and weight.",
      "Find the drainage-hole claim on an original page, or drop it: the quote was not on the page we captured.",
      "Ask a Seattle Plant Swap admin how many members are active before counting on that reach.",
    ],
    cost: { usd: 0.42, input_tokens: 48210, output_tokens: 7480, web_searches: 8, web_fetches: 6 },
    agents: [
      { name: "Planner", status: "done", seconds: 9 },
      { name: "Competitors & prices", status: "done", seconds: 71 },
      { name: "Local channels", status: "done", seconds: 64 },
      { name: "Shipping & costs", status: "done", seconds: 58 },
      { name: "Verifier", status: "done", seconds: 22 },
      { name: "Marketing planner", status: "done", seconds: 41 },
      { name: "Checker", status: "done", seconds: 17 },
      { name: "Writer", status: "done", seconds: 26 },
    ],
    seconds: 207,
  };
}

const RUN_TITLE = "Handmade ceramic planters in Seattle";

// ---- Simulated run timeline (seconds from start) ---------------------------

const STAGES = [
  [0, "planning"],
  [1.2, "researching"],
  [4.6, "verifying"],
  [6.0, "planning_marketing"],
  [7.4, "checking"],
  [8.6, "writing"],
  [RUN_SECONDS, "done"],
];

// name, start, end, running notes [[from, note]], done note
const AGENTS = [
  ["Planner", 0, 1.2, [[0, "Splitting the brief into research directions"]], "3 directions"],
  ["Competitors & prices", 1.2, 4.0, [[1.2, "Searching: handmade stoneware planter prices"], [2.6, "Reading 2 pages"]], "3 cards"],
  ["Local channels", 1.2, 3.6, [[1.2, "Searching: Seattle makers markets vendor fees"], [2.4, "Reading 3 pages"]], "3 cards"],
  ["Shipping & costs", 1.2, 4.4, [[1.2, "Searching: ship ceramic planter rates"], [3.0, "Reading a seller forum thread"]], "2 cards"],
  ["Verifier", 4.6, 6.0, [[4.6, "Checking 8 quotes against the captured pages"]], "6 sourced, 2 unverified"],
  ["Marketing planner", 6.0, 7.4, [[6.0, "Drafting the plan and budget"]], "7 sections, 6 budget lines"],
  ["Checker", 7.4, 8.6, [[7.4, "Checking every line has a card or a label"]], "No problems found"],
  ["Writer", 8.6, RUN_SECONDS, [[8.6, "Writing the report"]], "Report ready"],
];

// ---- State -----------------------------------------------------------------

function initialState() {
  const cardRuns = {};
  for (const id of Object.values(C)) cardRuns[id] = [SEED_RUN_ID];
  return {
    signedIn: false,
    runsStarted: 1,
    convs: {},
    runs: [
      {
        run_id: SEED_RUN_ID,
        conv_id: "seedconv0001",
        title: RUN_TITLE,
        created_at: daysAgo(3, 4),
        seeded: true,
        share_token: SEED_SHARE,
      },
    ],
    shares: { [SEED_SHARE]: SEED_RUN_ID },
    cardRuns,
  };
}

function loadState() {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return initialState();
}

let state = loadState();

function saveState() {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (data) => ({ status: 200, data });
const fail = (status, code, message) => ({ status, data: { error: { code, message } } });

function userView() {
  return { ...DEMO_USER, free_runs_left: Math.max(0, FREE_RUNS - state.runsStarted) };
}

// ---- Runs ------------------------------------------------------------------

function seedResult(run) {
  return fixtureResult(run.title, new Date(new Date(run.created_at).getTime() + 207000).toISOString());
}

function snapshot(run) {
  if (run.seeded) {
    const agents = {};
    for (const [name, , , , doneNote] of AGENTS) agents[name] = { status: "done", note: doneNote };
    return {
      meta: {
        run_id: run.run_id, conv_id: run.conv_id, title: run.title, brief: BRIEF_FULL,
        status: "done", stage: "done", agents, cost_usd: 0.42, error: null,
        share_token: run.share_token || null, created_at: run.created_at,
        updated_at: run.created_at, result_key: `runs/${run.run_id}.json`,
      },
      result: seedResult(run),
    };
  }

  const t = (Date.now() - run.startedMs) / 1000;
  let stage = STAGES[0][1];
  for (const [from, name] of STAGES) if (t >= from) stage = name;
  const status = t < 0.4 ? "queued" : t >= RUN_SECONDS ? "done" : "running";

  const agents = {};
  for (const [name, start, end, notes, doneNote] of AGENTS) {
    if (t >= end) agents[name] = { status: "done", note: doneNote };
    else if (t >= start && status !== "queued") {
      let note = notes[0][1];
      for (const [from, n] of notes) if (t >= from) note = n;
      agents[name] = { status: "running", note };
    } else agents[name] = { status: "queued", note: "" };
  }

  const done = status === "done";
  if (done && !run.cardsMerged) {
    for (const id of Object.values(C)) {
      state.cardRuns[id] = state.cardRuns[id] || [];
      if (!state.cardRuns[id].includes(run.run_id)) state.cardRuns[id].push(run.run_id);
    }
    run.cardsMerged = true;
    run.finishedAt = new Date(run.startedMs + RUN_SECONDS * 1000).toISOString();
  }

  const meta = {
    run_id: run.run_id, conv_id: run.conv_id, title: run.title, brief: BRIEF_FULL,
    status, stage: status === "queued" ? null : stage, agents,
    cost_usd: Math.round(0.42 * Math.min(1, t / RUN_SECONDS) * 100) / 100,
    error: null, share_token: run.share_token || null, created_at: run.created_at,
    updated_at: new Date().toISOString(), result_key: done ? `runs/${run.run_id}.json` : null,
  };
  let result = null;
  if (done) {
    // The simulated run is compressed into RUN_SECONDS; the result keeps realistic timings.
    result = fixtureResult(run.title, run.finishedAt);
  }
  return { meta, result };
}

function findRun(id) {
  return state.runs.find((r) => r.run_id === id) || null;
}

// ---- Intake (super-agent chat) ---------------------------------------------

function intakeReply(userCount) {
  if (userCount === 1) {
    return {
      reply:
        "Thanks. Handmade planters in Seattle, got it.\n\nTwo quick questions: who do you picture buying them, and where do you sell today?",
      ready: false,
      brief: { ...BRIEF_FULL, customer: "", stage: "", budget_usd: null, goal: "", questions: [] },
    };
  }
  if (userCount === 2) {
    return {
      reply:
        "That helps. Last one: how much can you spend on marketing over the next two months, and what would count as a good result?",
      ready: false,
      brief: { ...BRIEF_FULL, budget_usd: null, goal: "", questions: [] },
    };
  }
  if (userCount === 3) {
    return {
      reply:
        "That's everything I need, and your brief is ready. If anything in it looks off, tell me and I'll change it. Otherwise press Start research.",
      ready: true,
      brief: BRIEF_FULL,
    };
  }
  return {
    reply: "Noted. I've kept the brief as it is. Press Start research when you're happy with it.",
    ready: true,
    brief: BRIEF_FULL,
  };
}

// ---- Router ----------------------------------------------------------------

export async function handle(method, url, body) {
  const [path, qs] = url.split("?");
  const query = new URLSearchParams(qs || "");
  const seg = path.split("/").filter(Boolean).map(decodeURIComponent);
  await delay(path === "/chat" ? 750 : 200);
  try {
    return route(method, seg, query, body || {});
  } finally {
    saveState();
  }
}

function route(method, seg, query, body) {
  const [a, b, c] = seg;

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
    const runId = state.shares[b];
    const run = runId && findRun(runId);
    if (!run) return fail(404, "not_found", "This shared report was not found.");
    const { meta, result } = snapshot(run);
    delete meta.user_sub;
    return ok({ run: meta, result });
  }

  if (!state.signedIn) return fail(401, "unauthorized", "Sign in to continue.");

  if (a === "me" && method === "GET") return ok({ user: userView() });

  if (a === "chat" && method === "POST") {
    const message = String(body.message || "").trim();
    if (!message) return fail(400, "bad_request", "Type a message first.");
    let conv = body.conv_id ? state.convs[body.conv_id] : null;
    if (body.conv_id && !conv) return fail(404, "not_found", "Conversation not found.");
    const now = new Date().toISOString();
    if (!conv) {
      conv = { conv_id: newId(), messages: [], brief: null, ready: false, created_at: now, updated_at: now };
      state.convs[conv.conv_id] = conv;
    }
    if (conv.messages.length >= 30) {
      return fail(429, "conversation_full", "This conversation is full. Start a new one to keep going.");
    }
    conv.messages.push({ role: "user", text: message, at: now });
    const userCount = conv.messages.filter((m) => m.role === "user").length;
    const out = intakeReply(userCount);
    conv.messages.push({ role: "assistant", text: out.reply, at: new Date().toISOString() });
    conv.brief = out.brief;
    conv.ready = out.ready;
    conv.updated_at = new Date().toISOString();
    return ok({ conv_id: conv.conv_id, reply: out.reply, ready: conv.ready, brief: conv.brief, messages: conv.messages });
  }

  if (a === "conversations" && b && method === "GET") {
    const conv = state.convs[b];
    if (!conv) return fail(404, "not_found", "Conversation not found.");
    return ok(conv);
  }

  if (a === "runs" && !b && method === "POST") {
    const conv = state.convs[body.conv_id];
    if (!conv) return fail(404, "not_found", "Conversation not found.");
    if (!conv.ready) return fail(409, "not_ready", "The brief is not ready yet.");
    if (userView().free_runs_left <= 0) {
      return fail(402, "free_run_used", "You have used your free report.");
    }
    const now = Date.now();
    const run = {
      run_id: newId(),
      conv_id: conv.conv_id,
      title: RUN_TITLE,
      created_at: new Date(now).toISOString(),
      startedMs: now,
    };
    state.runs.unshift(run);
    state.runsStarted += 1;
    return ok({ run: snapshot(run).meta });
  }

  if (a === "runs" && !b && method === "GET") {
    const runs = state.runs.map((r) => {
      const { meta } = snapshot(r);
      return { run_id: meta.run_id, title: meta.title, status: meta.status, created_at: meta.created_at, cost_usd: meta.cost_usd };
    });
    runs.sort((x, y) => (x.created_at < y.created_at ? 1 : -1));
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
    const url = `${location.origin}${location.pathname}?mock=1#/shared/${run.share_token}`;
    return ok({ token: run.share_token, url });
  }

  if (a === "cards" && method === "GET") {
    const q = (query.get("q") || "").trim().toLowerCase();
    const type = query.get("type") || "";
    const direction = query.get("direction") || "";
    let cards = fixtureCards()
      .filter((card) => (state.cardRuns[card.card_id] || []).length)
      .map((card) => ({
        ...card,
        run_ids: state.cardRuns[card.card_id],
        stale: Date.now() - new Date(card.captured_at).getTime() > 90 * DAY,
      }));
    if (q) {
      cards = cards.filter((card) =>
        [card.claim, card.quote, card.source_title].some((f) => (f || "").toLowerCase().includes(q)));
    }
    if (type) cards = cards.filter((card) => card.type === type);
    if (direction) cards = cards.filter((card) => card.direction === direction);
    cards.sort((x, y) => (x.captured_at < y.captured_at ? 1 : -1));
    return ok({ cards });
  }

  return fail(404, "not_found", "No such endpoint in mock mode.");
}
