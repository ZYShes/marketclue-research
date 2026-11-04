// Signed-out landing page. Keeps the slogan "See the market differently." in the v3 visual language.
import { h, kindBadge, typeBadge, externalLink, fmtDate } from "./ui.js";
import { FEATURES } from "./features.js";
import { toolIcon } from "./research.js";

function previewWindow() {
  // A static, readable example of what a report looks like: a finding with numbered sources,
  // an open source preview and a small labelled chart.
  const bars = [["Cedar House", 48], ["Rainier Clay Studio", 54], ["Fern Pottery", 62]];
  return h("figure", { class: "preview" },
    h("div", { class: "preview-window" },
      h("div", { class: "preview-bar", "aria-hidden": "true" }, h("span"), h("span"), h("span")),
      h("div", { class: "preview-body" },
        h("p", { class: "preview-eyebrow" }, "2 · Compare · Check competitors & prices"),
        h("p", { class: "preview-title" }, "Handmade planter prices in Seattle"),
        h("div", { class: "preview-finding" },
          h("span", { class: "finding-number", "aria-hidden": "true" }, "1"),
          h("div", {},
            h("p", { class: "preview-finding-title" }, "Local sets cost $54 to $62"),
            h("p", { class: "preview-text" }, kindBadge("sourced"), " Rainier Clay Studio lists a $54 set with a 2–3 week wait; Fern Pottery lists $62 with studio pickup. ",
              h("span", { class: "chip chip-sourced chip-static" }, h("span", { class: "visually-hidden" }, "source "), "1"), " ",
              h("span", { class: "chip chip-sourced chip-static" }, h("span", { class: "visually-hidden" }, "source "), "2")))),
        h("div", { class: "preview-hover" },
          h("p", { class: "preview-hover-head" }, h("span", { class: "source-n" }, "1"), "example.com", typeBadge("sourced")),
          h("p", { class: "hovercard-quote" }, "“6-inch speckled stoneware planter with saucer: $54. Made to order.”")),
        h("div", { class: "preview-chart" },
          h("p", { class: "preview-chart-title" }, "Planter + saucer price by seller ", kindBadge("sourced")),
          h("ul", { class: "mini-bars" }, bars.map(([label, value]) => h("li", {},
            h("span", { class: "mini-label" }, label),
            h("span", { class: "mini-track" }, h("span", { class: "mini-fill", style: `width: ${Math.round((value / 62) * 100)}%` })),
            h("span", { class: "mini-value" }, `$${value}`))))))),
    h("figcaption", {}, "Sample report: numbered sources open the exact quote, and charts carry their own labels and data."));
}

export function landingPage(signin, bootError) {
  return h("div", { class: "landing" },
    bootError ? h("p", { class: "callout callout-error", role: "alert" }, bootError) : null,
    h("section", { class: "hero", "aria-labelledby": "hero-title" },
      h("div", { class: "hero-copy" },
        h("p", { class: "pill" }, "Market research you can check"),
        h("h1", { id: "hero-title", tabindex: "-1" }, "See the market ", h("em", {}, "differently.")),
        h("p", { class: "hero-sub" },
          "Tell MarketClue what you are building. Agents read public pages and return a short report where every statement is Sourced, an Assumption or an Estimate."),
        h("div", { class: "hero-cta", id: "signin-area" }, signin),
        h("p", { class: "fine" }, "Your first report is free. No card needed.")),
      previewWindow()),

    h("section", { class: "landing-section", "aria-labelledby": "journey-title" },
      h("p", { class: "eyebrow" }, "Four tools, one journey"),
      h("h2", { id: "journey-title" }, "From first question to first customers."),
      h("ol", { class: "journey" }, FEATURES.map((f) => h("li", { class: "journey-step" },
        h("p", { class: "journey-stage" }, h("span", { class: "tool-step" }, String(f.n)), f.stage),
        h("span", { class: "tool-icon" }, toolIcon(f.id)),
        h("h3", {}, f.name),
        h("p", { class: "muted" }, f.question))))),

    h("section", { class: "landing-section trust", "aria-labelledby": "trust-title" },
      h("div", { class: "trust-copy" },
        h("p", { class: "eyebrow" }, "Every claim is checkable"),
        h("h2", { id: "trust-title" }, "Evidence first. Judgment stays yours."),
        h("dl", { class: "kind-list" },
          h("div", {}, h("dt", {}, kindBadge("sourced")), h("dd", {}, "The exact quote was found on the page we captured, with the link and date.")),
          h("div", {}, h("dt", {}, kindBadge("assumption")), h("dd", {}, "No checked quote backs it. Each report says how to test it.")),
          h("div", {}, h("dt", {}, kindBadge("estimate")), h("dd", {}, "Calculated from sourced numbers, with the method written out.")))),
      h("figure", { class: "specimen" },
        h("article", { class: "fact surface" },
          h("div", { class: "badge-row" }, typeBadge("sourced"), h("span", { class: "tag" }, "Sales channels & fees")),
          h("p", { class: "fact-claim" }, "Etsy charges $0.20 to publish a listing."),
          h("blockquote", { class: "quote" }, h("p", {}, "“It costs $0.20 to publish a listing to the marketplace. A listing lasts for four months or until the item is sold.”")),
          h("p", { class: "fact-source" }, externalLink("https://www.etsy.com/sell", "How to sell on Etsy", "source-link"),
            h("span", { class: "muted" }, ` · captured ${fmtDate("2026-10-17T04:21:58Z")}`))),
        h("figcaption", {}, "A real fact card: quote, page and capture date. Sourced shows the quote is on the page, not that the page is right."))),

    h("section", { class: "landing-section closing", "aria-labelledby": "closing-title" },
      h("h2", { id: "closing-title" }, "Start with one good question."),
      h("p", { class: "muted" }, "Three questions from the research lead, a few minutes of reading, one report you can check line by line."),
      h("button", {
        type: "button", class: "btn btn-primary btn-lg",
        onclick: () => {
          const area = document.getElementById("signin-area");
          area?.scrollIntoView({ block: "center" });
          area?.querySelector("button, [role=button], iframe")?.focus();
        },
      }, "Get started")));
}
