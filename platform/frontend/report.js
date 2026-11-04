// The research report, shared by the private (#/runs/<id>) and public (#/shared/<token>) routes.
// Classic structure: brief at a glance → numbered findings with sources → tool section (with charts)
// → next steps & missing evidence → evidence coverage → all fact cards / about.
import {
  h, icon, externalLink, domainOf, fmtDate, fmtMoney, fmtCost, fmtSeconds, isStale,
  kindBadge, typeBadge, staleBadge, statusChip, plural, trapFocus, STALE_DAYS, templateBadge,
} from "./ui.js";
import { featureById, stageLabel, MODES, templateName, isGeneralTemplate } from "./features.js";
import { renderChart, validSeries } from "./charts.js";

const SOURCED_NOTE =
  "Sourced means the exact quote matched the captured page. The page itself may still be wrong.";
const LISTING_NOTE =
  "For an eBay listing, Sourced means the quoted text matched the listing data saved from eBay on that date. It is the seller's asking price, not a sale.";
// Charts that belong to the eBay sections rather than the tool section (SPEC v4).
const EBAY_CHART_IDS = new Set(["asking_prices", "ebay_costs"]);
const isListingCard = (card) => card && card.source_kind === "ebay_api";

function capturedText(card) {
  const date = fmtDate(isListingCard(card) ? card.retrieved_at || card.captured_at : card.captured_at) || "date unknown";
  return `${isListingCard(card) ? "Retrieved" : "Captured"} ${date}`;
}

// Source badges after the type badge: eBay listing (asking price, date) and/or "from an earlier report".
function listingBadge(card) {
  const listing = isListingCard(card)
    ? h("span", { class: "badge badge-listing" }, (card.earlier ? null : card.label) || "eBay listing (asking price)")
    : null;
  return [listing, earlierBadge(card)].filter(Boolean);
}

// Cards reused from an earlier report in the same project keep their original capture date (SPEC v5).
const EARLIER_LABEL = "from an earlier report in this project";
function earlierBadge(card) {
  if (!card || !card.earlier) return null;
  const text = String(card.label || EARLIER_LABEL);
  return h("span", { class: "badge badge-earlier" }, text.charAt(0).toUpperCase() + text.slice(1));
}

function fmtPct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })}%` : "";
}
const isNum = (v) => v != null && v !== "" && Number.isFinite(Number(v));
const INLINE_REF = /\s*\[(?:card[:#\s]*)?([A-Za-z0-9_-]{4,40})\]/g;
const list = (value) => (Array.isArray(value) ? value : []);

function isGenericAssumption(item) {
  return item.kind === "assumption" &&
    /^not supported by (?:a )?checked quote/i.test(String(item.method || "").trim());
}

function asItem(raw) {
  if (raw == null) return null;
  if (typeof raw !== "object") return { text: String(raw), kind: null, card_ids: [], method: "" };
  return { ...raw, text: String(raw.text || ""), card_ids: list(raw.card_ids) };
}

// Older reports have summary statements and findings grouped by research direction.
function reportFindings(result) {
  const findings = list(result.findings).flatMap((entry) => {
    if (!entry) return [];
    if (Array.isArray(entry.items)) {
      return entry.items.filter(Boolean).map((item) => ({ ...asItem(item), title: item.title || entry.direction || "Finding" }));
    }
    return [{ ...asItem(entry), title: entry.title || entry.direction || "Finding" }];
  });
  if (!result.takeaway) {
    findings.unshift(...list(result.summary).slice(1).filter(Boolean).map((item) => ({ ...asItem(item), title: item.title || "From the overview" })));
  }
  return findings;
}

function methodNote(item) {
  if (!item?.method || !["assumption", "estimate"].includes(item.kind)) return null;
  return h("p", { class: "method" },
    h("span", { class: "method-label" }, item.kind === "estimate" ? "Method: " : "Basis: "),
    isGenericAssumption(item) ? "Not backed by a quote — test it." : String(item.method));
}

function isCoverageChart(spec) {
  return /coverage/i.test(`${spec.id || ""} ${spec.title || ""}`);
}

// Fallback coverage chart for reports that predate result.charts.
function coverageChart(coverage) {
  if (!coverage) return null;
  const series = [
    ["Pages read", coverage.pages_read],
    ["Quotes checked", coverage.quotes_total],
    ["Quotes found word for word", coverage.quotes_found],
  ].filter(([, v]) => v != null && Number.isFinite(Number(v))).map(([label, value]) => ({ label, value: Number(value), card_ids: [] }));
  if (!series.length) return null;
  const found = Number(coverage.quotes_found);
  const total = Number(coverage.quotes_total);
  return {
    id: "coverage", type: "bar", title: "Evidence coverage", unit: "count", kind: "sourced", series,
    caption: Number.isFinite(found) && total ? `${found} of ${total} quotes were found word for word on the captured pages.` : "",
  };
}

const TOOL_SECTION = {
  market_check: { id: "r-themes", title: "Buyer themes" },
  competitor_scan: { id: "r-prices", title: "Price comparison" },
  launch_checklist: { id: "r-checklist", title: "Launch checklist" },
  marketing_plan: { id: "r-plan", title: "Marketing plan" },
};

export function renderReport(result = {}, { run = null, shared = false, actions = null, mockups = null, crumb = null } = {}) {
  const cards = list(result.cards).filter(Boolean);
  const index = new Map(cards.map((card, i) => [card.card_id, { card, n: i + 1 }]));
  const feature = featureById(result.feature || result.brief?.feature || run?.brief?.feature || run?.feature);
  const sourcedCount = cards.filter((card) => card.type === "sourced").length;

  function chip(id) {
    const entry = index.get(id);
    if (!entry) return null;
    return sourceChip(entry.card, entry.n);
  }

  function richText(text, ids = []) {
    const source = String(text || "");
    const out = [];
    const used = new Set();
    let last = 0;
    for (const match of source.matchAll(INLINE_REF)) {
      if (!index.has(match[1])) continue;
      out.push(source.slice(last, match.index), " ", chip(match[1]));
      used.add(match[1]);
      last = match.index + match[0].length;
    }
    out.push(source.slice(last));
    const extra = [...new Set(list(ids))].filter((id) => index.has(id) && !used.has(id));
    if (extra.length) out.push(" ", h("span", { class: "chips" }, extra.map(chip)));
    return out;
  }

  function statement(raw) {
    const item = asItem(raw);
    if (!item) return null;
    return h("li", { class: "statement" },
      item.kind ? kindBadge(item.kind) : null,
      h("div", { class: "statement-body" }, h("p", {}, richText(item.text, item.card_ids)), methodNote(item)));
  }

  const sections = [];
  function section(id, title, ...content) {
    sections.push({ id, title });
    return h("section", { class: "report-section", id, "aria-labelledby": `${id}-h` },
      h("h2", { id: `${id}-h`, tabindex: "-1" }, title), content);
  }

  const charts = list(result.charts).filter((c) => c && validSeries(c).length);
  const ebayChart = (id) => charts.find((c) => c.id === id) || null;
  const toolCharts = charts.filter((c) => !isCoverageChart(c) && !EBAY_CHART_IDS.has(c.id));
  const covSpec = charts.find(isCoverageChart) || coverageChart(result.coverage);
  const chartNodes = (specs) => {
    const nodes = specs.map((spec) => renderChart(spec, { chip })).filter(Boolean);
    return nodes.length ? h("div", { class: "chart-stack" }, nodes) : null;
  };

  const takeaway = asItem(result.takeaway || list(result.summary)[0]);
  const findings = reportFindings(result);
  const content = [];
  content.push(section("r-summary", "The brief at a glance",
    takeaway ? h("div", { class: "takeaway" },
      takeaway.kind ? kindBadge(takeaway.kind) : null,
      h("p", { class: "takeaway-text" }, richText(takeaway.text, takeaway.card_ids)), methodNote(takeaway))
      : h("p", { class: "muted" }, "No takeaway was recorded for this report.")));

  content.push(section("r-findings", "Findings", findings.length
    ? h("ol", { class: "findings" }, findings.map((finding, i) => {
        const refs = [...new Set([...finding.card_ids, ...[...finding.text.matchAll(INLINE_REF)].map((m) => m[1])])];
        const sources = refs.map((id) => index.get(id)).filter(Boolean);
        return h("li", { class: "finding" },
          h("span", { class: "finding-number", "aria-hidden": "true" }, String(i + 1)),
          h("div", { class: "finding-body" },
            h("h3", { class: "finding-title" }, h("span", { class: "visually-hidden" }, `Finding ${i + 1}: `), finding.title),
            h("p", { class: "finding-text" }, finding.kind ? [kindBadge(finding.kind), " "] : null, richText(finding.text, finding.card_ids)),
            methodNote(finding),
            h("details", { class: "finding-sources" },
              h("summary", {}, icon("chevron"), `Sources for finding ${i + 1}`, h("span", { class: "summary-count" }, ` (${sources.length})`)),
              sources.length ? h("div", { class: "source-tiles" }, sources.map(({ card, n }) => cardTile(card, n)))
                : h("p", { class: "muted" }, "No fact cards linked to this finding."))));
      }))
    : h("p", { class: "muted" }, "No findings were recorded.")));

  // Tool section, with its charts first.
  const tool = TOOL_SECTION[feature.id];
  if (feature.id === "competitor_scan" && (result.table || toolCharts.length)) {
    content.push(section(tool.id, result.table?.title || tool.title, chartNodes(toolCharts),
      result.table ? renderPriceTable(result.table, richText) : null));
  } else if (feature.id === "marketing_plan" || (!result.version && (list(result.plan).length || result.budget))) {
    if (list(result.plan).length) {
      content.push(section("r-plan", "Marketing plan",
        list(result.plan).filter(Boolean).map((group) => h("div", { class: "plan-group" },
          h("h3", {}, group.section || "Plan"), h("ul", { class: "statements" }, list(group.items).map(statement))))));
    }
    if (result.budget || toolCharts.length) {
      content.push(section("r-budget", "Budget & projection", chartNodes(toolCharts),
        result.budget ? renderBudget({ ...result.budget, lines: list(result.budget.lines) }, richText) : null));
    }
  } else if (feature.id === "launch_checklist" && (list(result.checklist).length || toolCharts.length)) {
    content.push(section(tool.id, tool.title, chartNodes(toolCharts),
      list(result.checklist).length ? h("ol", { class: "checklist" },
        list(result.checklist).filter(Boolean).map((entry) => h("li", { class: "checklist-item" },
          h("span", { class: "checklist-box", "aria-hidden": "true" }),
          h("div", { class: "checklist-body" },
            h("h3", {}, entry.step || "Launch step"),
            h("div", { class: "badge-row" }, entry.kind ? kindBadge(entry.kind) : null,
              entry.official ? h("span", { class: "badge badge-official" }, "Official source") : null),
            h("p", {}, richText(entry.text, entry.card_ids)), methodNote(entry))))) : null));
  } else if (toolCharts.length) {
    content.push(section(tool?.id || "r-charts", tool && feature.id === "market_check" ? tool.title : "Charts", chartNodes(toolCharts)));
  }

  // eBay seller template (SPEC v4): comparable active listings, then fees, ad scenarios and the ad budget.
  const listings = list(result.listings).filter((l) => l && l.title);
  const askingChart = ebayChart("asking_prices");
  if (listings.length || askingChart) {
    content.push(section("r-listings", "Comparable eBay listings",
      askingChart ? renderChart(askingChart, { chip }) : null,
      listings.length ? renderListings(listings, richText, listingDates(listings, result.generated_at)) : null));
  }
  const costChart = ebayChart("ebay_costs");
  if (result.fees || result.ad_budget || costChart) {
    content.push(section("r-ebay-costs", "eBay fees & ad costs",
      result.fees ? renderFees(result.fees, richText) : null,
      costChart ? renderChart(costChart, { chip }) : null,
      result.ad_budget ? renderAdBudget(result.ad_budget, richText) : null));
  }

  if (mockups) content.push(section("r-mockups", "Mock-ups", mockups));

  const steps = list(result.next_steps).length ? list(result.next_steps) : list(result.next_checks).map((entry) => ({ text: asItem(entry)?.text }));
  const missing = list(result.missing_evidence);
  content.push(section("r-next", "Next steps & missing evidence",
    steps.length ? h("ol", { class: "next-steps" }, steps.filter(Boolean).map((step) => h("li", {},
      h("p", { class: "next-step-text" }, typeof step === "string" ? step : step.text || ""),
      h("p", { class: "next-step-how" }, h("span", { class: "how-label" }, "How to check: "),
        step.how || "No check method was recorded."))))
      : h("p", { class: "muted" }, "No next steps were recorded."),
    missing.length ? [h("h3", { class: "subhead" }, "Missing evidence"), h("ul", { class: "missing" }, missing.map((item) => h("li", {}, String(item))))] : null));

  content.push(section("r-coverage", "Evidence coverage",
    covSpec ? renderChart(covSpec, { chip }) : null,
    renderCoverage(result.coverage), renderCostLine(result)));

  content.push(h("details", { class: "appendix", id: "r-cards" },
    h("summary", {}, icon("chevron"), `All fact cards (${cards.length})`),
    h("p", { class: "section-note" }, SOURCED_NOTE),
    cards.length ? h("div", { class: "source-tiles" }, cards.map((card, i) => cardTile(card, i + 1)))
      : h("p", { class: "muted" }, "No fact cards were recorded.")));
  const brief = result.brief || run?.brief;
  content.push(h("details", { class: "appendix", id: "r-about" }, h("summary", {}, icon("chevron"), "About this report"),
    h("p", { class: "section-note" }, SOURCED_NOTE), brief ? renderBriefDetails(brief) : null, renderAbout(result)));

  const mode = MODES[result.mode || run?.mode];
  const templateId = result.template || run?.template || result.brief?.template;
  const meta = [];
  if (result.generated_at || run?.created_at) meta.push(fmtDate(result.generated_at || run.created_at));
  meta.push(`${plural(cards.length, "fact card")}, ${sourcedCount} sourced`);
  if (result.seconds != null) meta.push(`Research took ${fmtSeconds(result.seconds)}`);
  if (run?.owner_name && shared === false) meta.push(`By ${run.owner_name}`);

  const toc = h("nav", { class: "report-toc", "aria-label": "On this page" },
    h("p", { class: "toc-title" }, "On this page"),
    h("ul", {}, sections.map((s) => h("li", {}, h("a", {
      href: `#${s.id}`,
      onclick: (ev) => {
        ev.preventDefault();
        const target = document.getElementById(`${s.id}-h`);
        if (!target) return;
        target.scrollIntoView({ block: "start" });
        target.focus({ preventScroll: true });
      },
    }, s.title)))));

  const projectInfo = result.project && typeof result.project === "object" ? result.project : null;
  const earlierCount = cards.filter((card) => card.earlier).length;
  const projectNote = !shared && projectInfo && (projectInfo.reused || earlierCount)
    ? h("p", { class: "project-note" },
        h("strong", {}, "Builds on this project. "),
        projectInfo.reused ? String(projectInfo.reused) : "",
        earlierCount ? ` ${plural(earlierCount, "fact card")} from earlier reports ${earlierCount === 1 ? "is" : "are"} cited with ${earlierCount === 1 ? "its" : "their"} original date.` : "")
    : null;

  return h("article", { class: "report" },
    h("header", { class: "report-head" },
      shared ? null : crumb,
      h("p", { class: "eyebrow tool-eyebrow" }, shared ? "Shared report · read only · " : "", `${stageLabel(feature)} · ${feature.name}`),
      h("h1", { class: "report-title", tabindex: "-1" }, result.title || run?.title || "Your report"),
      h("p", { class: "report-meta" },
        meta.filter(Boolean).join(" · "),
        mode ? h("span", { class: `badge badge-mode` }, `${mode.name} research`) : null,
        isGeneralTemplate(templateId) ? null : templateBadge(templateName(templateId))),
      projectNote,
      actions ? h("div", { class: "report-actions" }, actions) : null,
      h("p", { class: "legend" },
        h("span", { class: "legend-item" }, kindBadge("sourced"), " exact quote on a captured page"),
        h("span", { class: "legend-item" }, kindBadge("assumption"), " not backed by a quote"),
        h("span", { class: "legend-item" }, kindBadge("estimate"), " calculated, method shown"))),
    h("div", { class: "report-layout" },
      h("div", { class: "report-body" }, content),
      sections.length > 3 ? toc : null));
}

// Numbered source chip: hover/focus shows a preview card, click opens the full fact card.
export function sourceChip(card, n) {
  const chipEl = h("button", {
    type: "button", class: `chip ${card.type === "sourced" ? "chip-sourced" : "chip-unverified"}${card.earlier ? " chip-earlier" : ""}`,
    "aria-label": `Source ${n}: ${card.claim || card.source_title || "fact card"}${card.earlier ? ` (${card.label || EARLIER_LABEL})` : ""}`,
    "aria-haspopup": "dialog",
    onclick: () => { hideHovercard(); openCardPanel(card, n); },
  }, String(n));
  attachHovercard(chipEl, card, n);
  return chipEl;
}

export function cardTile(card, n) {
  return h("article", { class: "source-tile" },
    h("div", { class: "source-tile-head" },
      n ? h("span", { class: "source-n" }, String(n)) : null,
      h("span", { class: "source-domain" }, domainOf(card.url) || "Source"),
      typeBadge(card.type), listingBadge(card), isStale(card) ? staleBadge() : null),
    card.claim ? h("p", { class: "source-claim" }, card.claim) : null,
    card.quote ? h("blockquote", { class: "quote" }, h("p", {}, `“${card.quote}”`)) : null,
    h("p", { class: "source-foot" },
      externalLink(card.url, card.source_title || domainOf(card.url) || "Open source", "source-link"),
      h("span", { class: "muted" }, ` · ${capturedText(card)}`)));
}

// Distinct retrieval dates of the listings, for "asking prices of active listings on <date>".
function listingDates(listings, fallback) {
  const days = [...new Set(listings.map((l) => l.retrieved_at).filter(Boolean).map((iso) => iso.slice(0, 10)))].sort();
  if (!days.length) return fmtDate(fallback) || "the retrieval date";
  const first = fmtDate(`${days[0]}T12:00:00Z`);
  return days.length === 1 ? first : `${first} – ${fmtDate(`${days[days.length - 1]}T12:00:00Z`)}`;
}

function renderListings(listings, richText, dateText) {
  const note = `Asking prices of active eBay listings on ${dateText}, not sold prices.`;
  const currencyOf = (l) => l.currency || "USD";
  const shipping = (l) => {
    if (l.shipping == null || l.shipping === "") return "Not given";
    return Number(l.shipping) === 0 ? "Free" : fmtMoney(l.shipping, currencyOf(l));
  };
  return [
    h("p", { class: "section-note listing-note" }, note),
    h("div", { class: "table-scroll", role: "region", "aria-label": "Comparable eBay listings table", tabindex: "0" },
      h("table", { class: "data-table listings-table" },
        h("caption", { class: "visually-hidden" }, `Comparable eBay listings. ${note}`),
        h("thead", {}, h("tr", {},
          h("th", { scope: "col" }, "Listing"),
          h("th", { scope: "col", class: "num" }, "Asking price"),
          h("th", { scope: "col", class: "num" }, "Shipping"),
          h("th", { scope: "col" }, "Condition"),
          h("th", { scope: "col" }, "Source"))),
        h("tbody", {}, listings.map((l) => h("tr", {},
          h("th", { scope: "row", class: "listing-title" }, l.url ? externalLink(l.url, l.title, "source-link") : l.title),
          h("td", { class: "num" }, isNum(l.price) ? fmtMoney(l.price, currencyOf(l)) : "—"),
          h("td", { class: "num" }, shipping(l)),
          h("td", {}, l.condition || "Not given"),
          h("td", { class: "chips-cell" }, l.card_id ? richText("", [l.card_id]) : null)))))),
  ];
}

function renderFees(fees, richText) {
  const cur = fees.currency || "USD";
  const money = (v) => (isNum(v) ? fmtMoney(Number(v), cur) : "—");
  const lines = list(fees.lines).filter(Boolean);
  const scenarios = list(fees.scenarios).filter(Boolean);
  const out = [];
  if (fees.complete === false) {
    out.push(h("div", { class: "callout callout-warn" },
      h("p", {}, h("strong", {}, "Incomplete breakdown. "),
        "Some eBay fees could not be checked on an ebay.com page in this run, so they are left out below and no ad budget is suggested. See Missing evidence.")));
  }
  const shippingText = fees.buyer_pays_shipping === true && isNum(fees.shipping_cost)
    ? ` plus ${money(fees.shipping_cost)} shipping paid by the buyer`
    : fees.buyer_pays_shipping === false ? " with free shipping for the buyer" : "";
  if (isNum(fees.price)) {
    out.push(h("p", { class: "fees-intro" },
      `At ${money(fees.price)}`, fees.price_basis ? ` (${String(fees.price_basis).replace(/^./, (c) => c.toLowerCase())})` : "",
      shippingText, isNum(fees.sale_total) ? `, the sale total is ${money(fees.sale_total)}.` : "."));
  }
  if (lines.length) {
    out.push(h("div", { class: "table-scroll", role: "region", "aria-label": "eBay fee breakdown table", tabindex: "0" },
      h("table", { class: "data-table fees-table" },
        h("caption", { class: "visually-hidden" }, `eBay fees per item in ${cur}`),
        h("thead", {}, h("tr", {},
          h("th", { scope: "col" }, "Item"),
          h("th", { scope: "col", class: "num" }, "Rate"),
          h("th", { scope: "col", class: "num" }, "Cost"),
          h("th", { scope: "col" }, "Kind"),
          h("th", { scope: "col" }, "How it is worked out"))),
        h("tbody", {},
          isNum(fees.sale_total) ? h("tr", { class: "fees-total-row" },
            h("th", { scope: "row" }, "Sale total"), h("td", { class: "num" }, ""), h("td", { class: "num" }, money(fees.sale_total)),
            h("td", {}), h("td", { class: "basis" }, "Price plus any shipping the buyer pays")) : null,
          lines.map((line) => h("tr", {},
            h("th", { scope: "row" }, line.item || "Fee"),
            h("td", { class: "num" }, isNum(line.rate_pct) ? fmtPct(line.rate_pct) : "—"),
            h("td", { class: "num" }, money(line.amount)),
            h("td", {}, kindBadge(line.kind || "estimate")),
            h("td", { class: "basis" }, richText(line.method || "", line.card_ids))))),
        isNum(fees.left_before_ads) ? h("tfoot", {}, h("tr", {},
          h("th", { scope: "row" }, "What is left before ads"),
          h("td", { class: "num" }, ""),
          h("td", { class: `num${Number(fees.left_before_ads) < 0 ? " is-loss" : ""}` }, money(fees.left_before_ads)),
          h("td", {}),
          h("td", { class: "basis" }, "Before the cost of making the item"))) : null)));
  }
  if (scenarios.length) {
    out.push(h("h3", { class: "subhead" }, "Promoted Listings General: ad-rate scenarios"),
      h("div", { class: "table-scroll", role: "region", "aria-label": "Ad-rate scenarios table", tabindex: "0" },
        h("table", { class: "data-table scenarios-table" },
          h("caption", { class: "visually-hidden" }, "What is left per item at each Promoted Listings General ad rate (estimates)"),
          h("thead", {}, h("tr", {},
            h("th", { scope: "col" }, "Scenario"),
            h("th", { scope: "col", class: "num" }, "Ad rate"),
            h("th", { scope: "col", class: "num" }, "Ad fee"),
            h("th", { scope: "col", class: "num" }, "What is left"))),
          h("tbody", {}, scenarios.map((s) => {
            const loss = isNum(s.left) && Number(s.left) < 0;
            return h("tr", {},
              h("th", { scope: "row" }, s.label || "Scenario"),
              h("td", { class: "num" }, fmtPct(s.ad_rate_pct)),
              h("td", { class: "num" }, money(s.ad_fee)),
              h("td", { class: `num${loss ? " is-loss" : ""}` }, loss ? `${money(s.left)} (a loss)` : money(s.left)));
          })))));
  }
  if (fees.method) {
    out.push(h("p", { class: "method" }, h("span", { class: "method-label" }, "Method: "), String(fees.method)));
  }
  out.push(h("p", { class: "field-hint" }, "All amounts are estimates per item, before the cost of making it. Fee rates link to the ebay.com pages read in this run."));
  return out;
}

function renderAdBudget(budget, richText) {
  const priority = budget.priority ? asItem(budget.priority) : null;
  const hasRange = isNum(budget.min_rate_pct) || isNum(budget.max_rate_pct);
  return h("div", { class: "ad-budget", role: "group", "aria-labelledby": "ad-budget-h" },
    h("div", { class: "ad-budget-head" },
      h("h3", { id: "ad-budget-h" }, "Ad budget: how much to give eBay ads"),
      kindBadge(budget.kind || "estimate")),
    h("dl", { class: "stat-grid ad-budget-stats" },
      isNum(budget.break_even_rate_pct) ? h("div", { class: "stat" },
        h("dt", {}, "Break-even ad rate"),
        h("dd", {}, fmtPct(budget.break_even_rate_pct)),
        h("dd", { class: "stat-note" }, "At this rate nothing is left")) : null,
      isNum(budget.suggested_max_rate_pct) ? h("div", { class: "stat stat-suggest" },
        h("dt", {}, "Suggested ceiling ", h("span", { class: "badge badge-neutral" }, "Suggestion")),
        h("dd", {}, fmtPct(budget.suggested_max_rate_pct)),
        h("dd", { class: "stat-note" }, "Keep the Promoted Listings General rate at or below this")) : null),
    budget.suggestion ? h("p", {}, String(budget.suggestion)) : null,
    hasRange ? h("p", { class: "ad-range" },
      "eBay's allowed ad rates for Promoted Listings General: ",
      isNum(budget.min_rate_pct) && isNum(budget.max_rate_pct)
        ? `${fmtPct(budget.min_rate_pct)} to ${fmtPct(budget.max_rate_pct)}`
        : isNum(budget.min_rate_pct) ? `from ${fmtPct(budget.min_rate_pct)}` : `up to ${fmtPct(budget.max_rate_pct)}`,
      ". ", richText("", budget.rate_card_ids)) : null,
    budget.method ? h("p", { class: "method" }, h("span", { class: "method-label" }, "Method: "), String(budget.method)) : null,
    priority && priority.text ? h("div", { class: "ad-priority" },
      h("h4", {}, "Promoted Listings Priority (cost per click)"),
      h("p", {}, priority.kind ? [kindBadge(priority.kind), " "] : null, richText(priority.text, priority.card_ids)),
      methodNote(priority)) : null);
}

function renderPriceTable(table, richText) {
  const columns = list(table.columns);
  return h("div", { class: "table-scroll", role: "region", "aria-label": `${table.title || "Price comparison"} table`, tabindex: "0" },
    h("table", { class: "data-table" },
      h("caption", { class: "visually-hidden" }, table.title || "Price comparison"),
      h("thead", {}, h("tr", {}, columns.map((column) => h("th", { scope: "col" }, column)), h("th", { scope: "col" }, "Sources"))),
      h("tbody", {}, list(table.rows).filter(Boolean).map((row) => h("tr", {},
        list(row.cells).map((cell, i) => h(i === 0 ? "th" : "td", i === 0 ? { scope: "row" } : {}, String(cell ?? ""))),
        h("td", { class: "chips-cell" }, richText("", row.card_ids)))))));
}

function renderCoverage(coverage) {
  if (!coverage || typeof coverage !== "object") return h("p", { class: "muted" }, "Coverage counts were not recorded for this report.");
  const metrics = [
    ["Research directions", "directions"], ["Pages read", "pages_read"],
    ["Quotes found", "quotes_found"], ["Quotes checked", "quotes_total"],
    ["Claims narrowed", "claims_narrowed"], ["Claims relabelled", "relabelled"],
  ].filter(([, key]) => coverage[key] != null);
  if (!metrics.length) return h("p", { class: "muted" }, "Coverage counts were not recorded for this report.");
  return h("dl", { class: "stat-grid" }, metrics.map(([label, key]) => h("div", { class: "stat" },
    h("dt", {}, label), h("dd", {}, String(coverage[key])))));
}

export function renderBriefDetails(brief) {
  const rows = [
    ["Business", brief.business],
    ["Customer", brief.customer],
    ["Location", brief.location],
    ["Stage", brief.stage],
    ["Marketing budget", brief.budget_usd != null && brief.budget_usd !== "" ? fmtMoney(brief.budget_usd, "USD") : null],
    ["Goal", brief.goal],
  ].filter(([, v]) => v);
  const questions = Array.isArray(brief.questions) ? brief.questions.filter(Boolean) : [];
  return h("div", { class: "brief-details" },
    h("h3", { class: "subhead" }, "Your brief"),
    h("dl", { class: "kv" }, rows.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, String(v))))),
    questions.length
      ? [h("h3", { class: "subhead" }, "Questions researched"), h("ol", { class: "plain-list" }, questions.map((q) => h("li", {}, q)))]
      : null);
}

function renderBudget(budget, richText) {
  const currency = budget.currency || "USD";
  const lines = list(budget.lines).filter(Boolean);
  const total = budget.total != null && Number.isFinite(Number(budget.total)) && Number(budget.total) >= 0
    ? Number(budget.total)
    : lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  return h("div", { class: "table-scroll", role: "region", "aria-label": "Budget table", tabindex: "0" },
    h("table", { class: "data-table budget-table" },
      h("caption", { class: "visually-hidden" }, `4-week budget in ${currency}`),
      h("thead", {}, h("tr", {},
        h("th", { scope: "col" }, "Item"),
        h("th", { scope: "col", class: "num" }, "Amount"),
        h("th", { scope: "col" }, "Kind"),
        h("th", { scope: "col" }, "Basis"))),
      h("tbody", {}, lines.map((line) => h("tr", {},
        h("th", { scope: "row" }, line.item || ""),
        h("td", { class: "num" }, fmtMoney(line.amount, currency)),
        h("td", {}, kindBadge(line.kind)),
        h("td", { class: "basis" }, richText(isGenericAssumption(line) ? "Not backed by a quote — test it." : line.method || "", line.card_ids))))),
      h("tfoot", {}, h("tr", {},
        h("th", { scope: "row" }, "Total"),
        h("td", { class: "num" }, fmtMoney(total, currency)),
        h("td", {}),
        h("td", {})))));
}

function renderCostLine(result) {
  const raw = result.cost?.usd;
  const usd = Number(raw);
  return raw != null && Number.isFinite(usd)
    ? h("p", { class: "cost-line" }, `This report cost about ${fmtCost(usd)} in AI and search.`)
    : null;
}

function renderAbout(result) {
  const cost = result.cost || {};
  const parts = [];
  if (cost.web_searches != null) parts.push(plural(Number(cost.web_searches) || 0, "web search", "web searches"));
  if (cost.web_fetches != null) parts.push(plural(Number(cost.web_fetches) || 0, "page fetch", "page fetches"));
  if (cost.input_tokens != null || cost.output_tokens != null) {
    const fmt = (n) => (Number(n) || 0).toLocaleString("en-US");
    parts.push(`${fmt(cost.input_tokens)} input and ${fmt(cost.output_tokens)} output tokens`);
  }
  const agents = list(result.agents).filter(Boolean);
  const agentTable = agents.length
    ? h("div", { class: "table-scroll", role: "region", "aria-label": "Agent timings", tabindex: "0" },
        h("table", { class: "data-table" },
          h("caption", { class: "visually-hidden" }, "Time each agent took"),
          h("thead", {}, h("tr", {},
            h("th", { scope: "col" }, "Agent"),
            h("th", { scope: "col" }, "Status"),
            h("th", { scope: "col", class: "num" }, "Time"))),
          h("tbody", {}, agents.map((a) => h("tr", {},
            h("th", { scope: "row" }, a.name || "Agent"),
            h("td", {}, statusChip(a.status)),
            h("td", { class: "num" }, a.seconds != null ? fmtSeconds(a.seconds) : "")))),
          Number(result.seconds) > 0
            ? h("tfoot", {}, h("tr", {},
                h("th", { scope: "row" }, "Whole run"),
                h("td", {}),
                h("td", { class: "num" }, fmtSeconds(result.seconds))))
            : null))
    : null;
  return [
    parts.length ? h("p", { class: "muted" }, `${parts.join(", ")}.`) : null,
    agentTable ? h("h3", { class: "subhead" }, "Agents") : null,
    agentTable,
  ];
}

// ---- Source hover card (preview on hover or keyboard focus) -------------------
// WCAG 1.4.13: dismissible with Escape, hoverable (pointer can move onto it), persistent until
// pointer/focus leaves. Touch devices skip the preview; a tap opens the full fact card.

let hoverTimer = null;
let hideTimer = null;
let hoverAnchor = null;
let escWired = false;
const canHover = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

// The card lives inside <main> (so it is inside a landmark) and is positioned absolutely
// against it; <main> is a size container, which would also capture position: fixed.
function hovercardEl() {
  const mainEl = document.getElementById("main");
  let el = document.getElementById("hovercard");
  if (!el) {
    el = h("div", { id: "hovercard", class: "hovercard", role: "tooltip", hidden: true });
    el.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    el.addEventListener("mouseleave", () => scheduleHide());
  }
  if (el.parentElement !== mainEl) mainEl.append(el);
  if (!escWired) {
    escWired = true;
    document.addEventListener("keydown", (ev) => {
      const card = document.getElementById("hovercard");
      if (ev.key === "Escape" && card && !card.hidden) hideHovercard();
    });
  }
  return el;
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideHovercard, 180);
}

export function hideHovercard() {
  clearTimeout(hoverTimer);
  clearTimeout(hideTimer);
  const el = document.getElementById("hovercard");
  if (el) el.hidden = true;
  if (hoverAnchor) hoverAnchor.removeAttribute("aria-describedby");
  hoverAnchor = null;
}

function showHovercard(anchor, card, n) {
  const el = hovercardEl();
  if (!el || !anchor.isConnected) return;
  clearTimeout(hideTimer);
  if (hoverAnchor && hoverAnchor !== anchor) hoverAnchor.removeAttribute("aria-describedby");
  hoverAnchor = anchor;
  const quote = String(card.quote || "");
  const parts = [
    h("div", { class: "hovercard-head" },
      h("span", { class: "source-n" }, String(n)),
      h("span", { class: "source-domain" }, domainOf(card.url) || "Source"),
      typeBadge(card.type), listingBadge(card), isStale(card) ? staleBadge() : null),
    card.source_title ? h("p", { class: "hovercard-title" }, card.source_title) : null,
    quote ? h("p", { class: "hovercard-quote" }, `“${quote.length > 220 ? `${quote.slice(0, 217)}…` : quote}”`) : null,
    h("p", { class: "hovercard-foot" }, `${capturedText(card)} · Select for the full fact card`),
  ];
  el.replaceChildren(...parts.filter(Boolean));
  el.hidden = false;
  anchor.setAttribute("aria-describedby", "hovercard");
  // Rects are in zoomed pixels; offsets inside <main> are in CSS pixels.
  const zoom = Number(document.documentElement.style.zoom || 1) || 1;
  const r = anchor.getBoundingClientRect();
  const m = el.parentElement.getBoundingClientRect();
  const cw = el.offsetWidth;
  const ch = el.offsetHeight;
  const maxLeft = m.width / zoom - cw - 8;
  const left = Math.max(8, Math.min(maxLeft, (r.left - m.left + r.width / 2) / zoom - cw / 2));
  const fitsBelow = r.bottom + (ch + 16) * zoom < window.innerHeight;
  const top = fitsBelow ? (r.bottom - m.top) / zoom + 8 : Math.max(8, (r.top - m.top) / zoom - ch - 8);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function attachHovercard(anchor, card, n) {
  anchor.addEventListener("mouseenter", () => {
    if (!canHover()) return;
    clearTimeout(hoverTimer);
    clearTimeout(hideTimer);
    hoverTimer = setTimeout(() => showHovercard(anchor, card, n), 220);
  });
  anchor.addEventListener("mouseleave", () => {
    clearTimeout(hoverTimer);
    scheduleHide();
  });
  anchor.addEventListener("focus", () => {
    if (anchor.matches(":focus-visible")) showHovercard(anchor, card, n);
  });
  anchor.addEventListener("blur", () => scheduleHide());
}

// ---- Fact card side sheet -----------------------------------------------------

let panelReturnFocus = null;

function panel() {
  const dlg = document.getElementById("card-panel");
  if (!dlg.dataset.wired) {
    dlg.dataset.wired = "1";
    trapFocus(dlg);
    dlg.addEventListener("click", (ev) => {
      if (ev.target !== dlg) return;
      const r = dlg.getBoundingClientRect();
      const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      if (!inside) dlg.close();
    });
    dlg.addEventListener("close", () => {
      if (panelReturnFocus && panelReturnFocus.isConnected) panelReturnFocus.focus();
      panelReturnFocus = null;
    });
  }
  return dlg;
}

export function closeCardPanel() {
  const dlg = document.getElementById("card-panel");
  if (dlg && dlg.open) dlg.close();
}

export function openCardPanel(card, n) {
  const dlg = panel();
  panelReturnFocus = document.activeElement;
  const stale = isStale(card);
  const close = h("button", { type: "button", class: "icon-btn", "aria-label": "Close fact card", onclick: () => dlg.close() }, icon("close"));
  const notes = [];
  if (stale) notes.push(h("p", { class: "note note-warn" }, `Captured over ${STALE_DAYS} days ago. Check the source again.`));
  if (card.type !== "sourced") notes.push(h("p", { class: "note note-warn" }, "This quote did not match the captured page. Check it before use."));

  dlg.replaceChildren(
    h("div", { class: "sheet-inner" },
      h("div", { class: "sheet-head" },
        h("p", { class: "eyebrow" }, n ? `Fact card ${n}` : "Fact card"),
        close),
      h("div", { class: "badge-row" },
        typeBadge(card.type),
        listingBadge(card),
        stale ? staleBadge() : null,
        card.direction ? h("span", { class: "tag" }, card.direction) : null),
      h("h2", { class: "sheet-title", id: "card-panel-title" }, card.claim || "Untitled card"),
      card.quote ? h("blockquote", { class: "quote quote-lg" }, h("p", {}, `“${card.quote}”`)) : null,
      h("dl", { class: "kv" },
        h("div", {}, h("dt", {}, isListingCard(card) ? "eBay listing" : "Source"),
          h("dd", {}, externalLink(card.url, card.source_title || domainOf(card.url) || "Open source", "source-link"),
            domainOf(card.url) ? h("span", { class: "muted block" }, domainOf(card.url)) : null)),
        h("div", {}, h("dt", {}, isListingCard(card) ? "Retrieved" : "Captured"),
          h("dd", {}, fmtDate(isListingCard(card) ? card.retrieved_at || card.captured_at : card.captured_at) || "Unknown")),
        card.added_by ? h("div", {}, h("dt", {}, "Added by"), h("dd", {}, card.added_by)) : null),
      notes,
      h("p", { class: "note" }, isListingCard(card) ? LISTING_NOTE : SOURCED_NOTE)));
  dlg.setAttribute("aria-labelledby", "card-panel-title");
  if (!dlg.open) dlg.showModal();
  close.focus();
}

export function sourcedNote() {
  return SOURCED_NOTE;
}
