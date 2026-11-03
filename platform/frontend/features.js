// One ordered catalog for the founder journey and conversation entry points.
export const FEATURES = [
  { id: "market_check", step: "Validate", name: "Market check", question: "Who buys, and what do they say?", greeting: "Tell me what you are building and who you think will buy it." },
  { id: "competitor_scan", step: "Price", name: "Competitor & price scan", question: "Who sells this, and for how much?", greeting: "Tell me what you sell, where you sell it, and any competitors you want to compare." },
  { id: "launch_checklist", step: "Launch", name: "Launch checklist", question: "What do I need before I sell?", greeting: "Tell me what you sell and in which city and state." },
  { id: "marketing_plan", step: "Grow", name: "Marketing plan & budget", question: "How do I get my first customers?", greeting: "Tell me what you sell, who it is for, and your budget for the first four weeks." },
];

export function featureById(id) {
  return FEATURES.find((feature) => feature.id === id) || FEATURES.find((feature) => feature.id === "marketing_plan");
}
