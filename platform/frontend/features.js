// The four research tools in journey order (SPEC v3: Discover → Compare → Prepare → Grow).
export const FEATURES = [
  {
    id: "market_check", n: 1, stage: "Discover", name: "Find your customers", short: "Customers",
    question: "Who buys, and what do they say?",
    greeting: "Tell me what you are building and who you think will buy it.",
    placeholder: "For example: Handmade stoneware planters for Seattle plant lovers.",
  },
  {
    id: "competitor_scan", n: 2, stage: "Compare", name: "Check competitors & prices", short: "Competitors",
    question: "Who sells this, and for how much?",
    greeting: "Tell me what you sell, where you sell it, and any competitors you want to compare.",
    placeholder: "For example: 6-inch planters with saucers, sold in Seattle and online.",
  },
  {
    id: "launch_checklist", n: 3, stage: "Prepare", name: "Get ready to sell", short: "Launch",
    question: "What do I need before I sell?",
    greeting: "Tell me what you sell and in which city and state.",
    placeholder: "For example: Planters made in my home studio, sold at Seattle markets.",
  },
  {
    id: "marketing_plan", n: 4, stage: "Grow", name: "Get your first customers", short: "Growth",
    question: "Which channels, and what will it cost?",
    greeting: "Tell me what you sell, who it is for, and your budget for the first four weeks.",
    placeholder: "For example: Planters for Seattle plant owners, $600 for the first month.",
  },
];

export const DEFAULT_FEATURE = "market_check";

export function isFeature(id) {
  return FEATURES.some((feature) => feature.id === id);
}

export function featureById(id) {
  return FEATURES.find((feature) => feature.id === id) || FEATURES.find((feature) => feature.id === "marketing_plan");
}

export function stageLabel(feature) {
  return `${feature.n} · ${feature.stage}`;
}

// Effort modes, cheapest first; the research depth slider has one stop per mode.
// SPEC v3 defines quick and smarter; balanced is the middle stop (the backend must list it in
// pipeline.MODES, otherwise POST /api/runs answers 400 invalid_mode).
export const MODES = {
  quick: { id: "quick", name: "Quick", time: "1½ min", cost: "about $0.35", detail: "Fast model, up to 3 research directions, 3 pages each." },
  balanced: { id: "balanced", name: "Balanced", time: "2 min", cost: "about $0.90", detail: "Mid-size model, up to 4 directions, 3 pages each, careful writing." },
  smarter: { id: "smarter", name: "Smarter", time: "3 min", cost: "about $2–2.50", detail: "Strongest model, up to 4 directions, 4 pages each, careful writing." },
};
export const MODE_ORDER = ["quick", "balanced", "smarter"];
