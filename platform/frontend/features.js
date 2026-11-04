import { svg } from "./ui.js";

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
  balanced: { id: "balanced", name: "Balanced", time: "1½–2 min", cost: "about $1", detail: "Mid-size model, up to 4 directions, 3 pages each, careful writing." },
  smarter: { id: "smarter", name: "Smarter", time: "3 min", cost: "about $2–2.50", detail: "Strongest model, up to 4 directions, 4 pages each, careful writing." },
};
export const MODE_ORDER = ["quick", "balanced", "smarter"];

// Templates (SPEC v4). GET /api/templates is the source of truth; these names cover reports and
// pages rendered before (or without) that list. "general" is the default and shows no badge.
export const DEFAULT_TEMPLATE = "general";
export const TEMPLATE_NAMES = {
  general: "General", ebay: "eBay seller", food_truck: "Food truck", restaurant: "Restaurant / café",
  daycare: "Daycare / childcare", etsy: "Etsy seller",
};

export function templateName(id) {
  return TEMPLATE_NAMES[id] || (id ? String(id) : TEMPLATE_NAMES.general);
}

export function isGeneralTemplate(id) {
  return !id || id === DEFAULT_TEMPLATE;
}

// Tool icons (used by the landing page, run pages, projects and New research).
const TOOL_ICONS = {
  market_check: '<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6M7.5 10h5m-2.5-2.5v5"/>',
  competitor_scan: '<path d="M4 20V11m5 9V5m6 15v-7m5 7V8M2.5 21h19"/>',
  launch_checklist: '<rect x="4.5" y="3" width="15" height="18.5" rx="2"/><path d="m8 9 1.6 1.6L12.5 7.5M8 15.5l1.6 1.6 2.9-3.1M14.5 9.5h2m-2 6.5h2"/>',
  marketing_plan: '<path d="M3.5 10.5 17 5v14L3.5 13.5z"/><path d="M7 14.5 8.5 20h3.5l-1.5-4.8M20 10v4"/>',
};

export function toolIcon(id, size = 22) {
  return svg(`<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${TOOL_ICONS[id]}</svg>`);
}
