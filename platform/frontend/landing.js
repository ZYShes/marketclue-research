import { h, svg, typeBadge, externalLink, fmtDate } from "./ui.js";
import { FEATURES } from "./features.js";

const TOOL_ICONS = {
  market_check: '<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6M7 10h6m-3-3v6"/>',
  competitor_scan: '<path d="M4 20V10m5 10V4m6 16v-7m5 7V7M2 21h20"/>',
  launch_checklist: '<rect x="4" y="3" width="16" height="19" rx="1"/><path d="m7 9 2 2 3-4m-5 9 2 2 3-4m3-5h2m-2 7h2"/>',
  marketing_plan: '<path d="m3 10 15-6v16L3 14zM7 15l2 6h4l-2-5m10-6h2m-2 4h2"/>',
};

export function toolIcon(id) {
  return svg(`<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${TOOL_ICONS[id]}</svg>`);
}

export function toolJourney({ interactive = false, onChoose } = {}) {
  return h("div", { class: `tool-journey${interactive ? " tool-journey-large" : ""}` },
    FEATURES.map((feature, i) => {
      const props = interactive
        ? { href: `#/new/${feature.id}`, onclick: () => onChoose?.(feature.id) }
        : {};
      return h(interactive ? "a" : "article", { ...props, class: "tool-tile" },
        h("div", { class: "journey-step" }, h("span", { class: "step-number" }, `0${i + 1}`), feature.step,
          i < FEATURES.length - 1 ? h("span", { class: "journey-arrow", "aria-hidden": "true" }, "→") : null),
        h("span", { class: "tool-icon" }, toolIcon(feature.id)),
        h("h3", {}, feature.name),
        h("p", {}, feature.question),
        interactive ? h("span", { class: "tool-start" }, "Start a conversation", h("span", { "aria-hidden": "true" }, "↗")) : null);
    }));
}

export function landingPage(signin, bootError) {
  const captionTitle = h("h2", {}, "Start with a better question.");
  const captionText = h("p", {}, "Compare a price. Explore a feature. Find a starting point.");
  const hero = h("section", { class: "hero hero-ask", "aria-labelledby": "hero-title" },
    h("div", { class: "hero-meta" }, h("span", {}, "AN INDEPENDENT VIEW OF YOUR MARKET"), h("span", {}, "VOL. 02 — FOUNDER RESEARCH")),
    h("div", { class: "hero-type" },
      h("h1", { id: "hero-title" }, "See the market", h("br"), h("em", {}, "differently.")),
      h("p", { class: "hero-subline" }, "From scattered product information to a perspective you can explain."),
      signin, h("p", { class: "hero-free" }, "Your first report is free.")),
    h("div", { class: "lens-space", "aria-hidden": "true" },
      h("div", { class: "lens-scene" },
        h("div", { class: "axis axis-x" }), h("div", { class: "axis axis-y" }),
        h("div", { class: "lens lens-back" }), h("div", { class: "lens lens-front" }), h("div", { class: "lens-core" }),
        h("span", { class: "coordinate coordinate-a" }, "01 — QUESTION"),
        h("span", { class: "coordinate coordinate-b" }, "02 — EVIDENCE"),
        h("span", { class: "coordinate coordinate-c" }, "03 — PERSPECTIVE"))),
    h("div", { class: "hero-bottom" }, h("span", {}, "LESS NOISE. MORE CONTEXT."), h("span", { "aria-hidden": "true" }, "↙ EXPLORE THE PROCESS")));
  const stages = [
    ["ask", "Ask", "Start with a better question.", "Compare a price. Explore a feature. Find a starting point."],
    ["trace", "Trace", "Follow the evidence.", "Every finding leads back to a captured source."],
    ["decide", "Decide", "Make room for judgment.", "See the limits, follow the sources, and choose your next step."],
  ];
  const controls = stages.map(([mode, label, title, text], i) => h("button", {
    type: "button", "aria-pressed": String(i === 0), "aria-controls": "process-caption",
    onclick: () => {
      hero.className = `hero hero-${mode}`;
      controls.forEach((button, index) => button.setAttribute("aria-pressed", String(index === i)));
      captionTitle.textContent = title;
      captionText.textContent = text;
    },
  }, h("span", {}, `0${i + 1}`), label));
  return h("div", { class: "wrap page landing" },
    bootError ? h("p", { class: "banner banner-error", role: "alert" }, bootError) : null,
    h("div", { class: "hero-cover" }, hero,
      h("div", { class: "process-switch", role: "group", "aria-label": "Explore the process" }, controls),
      h("div", { id: "process-caption", class: "process-copy", role: "status", "aria-live": "polite" }, captionTitle, captionText)),
    h("section", { class: "landing-tools", "aria-labelledby": "tools-title" },
      h("h2", { id: "tools-title" }, "Four tools for one founder"), toolJourney()),
    h("figure", { class: "specimen" },
      h("div", { class: "fact fact-specimen" },
        h("div", { class: "badge-row" }, typeBadge("sourced"), h("span", { class: "tag" }, "Sales channels & fees")),
        h("p", { class: "fact-claim" }, "Etsy charges $0.20 to publish a listing."),
        h("blockquote", { class: "quote" }, h("p", {}, "“It costs $0.20 to publish a listing to the marketplace. A listing lasts for four months or until the item is sold.”")),
        h("p", { class: "fact-source" }, externalLink("https://www.etsy.com/sell", "How to sell on Etsy"),
          h("span", { class: "sample-date" }, `Captured ${fmtDate("2026-10-17T04:21:58Z")}`))),
      h("figcaption", {}, "Every sourced finding links to a quote, a page, and a capture date.")));
}
