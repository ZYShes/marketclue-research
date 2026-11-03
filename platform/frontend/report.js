// Classic research brief, shared by private and public report routes.
import {
  h, icon, externalLink, domainOf, fmtDate, fmtMoney, fmtCost, fmtSeconds, isStale,
  kindBadge, typeBadge, staleBadge, statusPill, plural, STALE_DAYS,
} from "./ui.js";
import { featureById } from "./features.js";

const SOURCED_NOTE =
  "Sourced means the exact quote matched the captured page. The page may still be wrong.";
const INLINE_REF = /\s*\[(?:card[:#\s]*)?([A-Za-z0-9_-]{4,40})\]/g;
const list = (value) => Array.isArray(value) ? value : [];

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

export function renderReport(result = {}, { run = null, shared = false, actions = null } = {}) {
  const cards = list(result.cards).filter(Boolean);
  const index = new Map(cards.map((card, i) => [card.card_id, { card, n: i + 1 }]));
  const feature = featureById(result.feature || result.brief?.feature || run?.brief?.feature || run?.feature);
  const sourcedCount = cards.filter((card) => card.type === "sourced").length;

  function chip(id) {
    const entry = index.get(id);
    if (!entry) return null;
    const { card, n } = entry;
    return h("button", {
      type: "button", class: `chip ${card.type === "sourced" ? "chip-sourced" : "chip-unverified"}`,
      title: card.claim, "aria-label": `Fact card ${n}: ${card.claim || "Read source"}`,
      "aria-haspopup": "dialog", onclick: () => openCardPanel(card, n),
    }, String(n));
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
    return h("li", { class: "brief-statement" },
      item.kind ? kindBadge(item.kind) : null,
      h("p", {}, richText(item.text, item.card_ids)), methodNote(item));
  }

  function section(id, title, ...content) {
    return h("section", { class: "brief-section", id, "aria-labelledby": `${id}-h` },
      h("h2", { id: `${id}-h` }, title), content);
  }

  const takeaway = asItem(result.takeaway || list(result.summary)[0]);
  const findings = reportFindings(result);
  const content = [section("r-summary", "The brief at a glance",
    takeaway ? h("div", { class: "brief-takeaway" },
      takeaway.kind ? kindBadge(takeaway.kind) : null,
      h("p", { class: "takeaway-text" }, richText(takeaway.text, takeaway.card_ids)), methodNote(takeaway))
      : h("p", { class: "muted" }, "No takeaway was recorded for this report.")),
    section("r-findings", "Findings", findings.length
      ? h("ol", { class: "brief-findings" }, findings.map((finding, i) => {
          const refs = [...new Set([...finding.card_ids, ...[...finding.text.matchAll(INLINE_REF)].map((m) => m[1])])];
          const sources = refs.map((id) => index.get(id)).filter(Boolean);
          return h("li", { class: "brief-finding" },
            h("div", { class: "finding-heading" },
              h("span", { class: "finding-number", "aria-hidden": "true" }, String(i + 1).padStart(2, "0")),
              h("h3", {}, finding.title)),
            finding.kind ? kindBadge(finding.kind) : null,
            h("p", { class: "finding-text" }, richText(finding.text)), methodNote(finding),
            h("details", { class: "finding-sources" },
              h("summary", {}, `Sources for finding ${i + 1}`),
              sources.length ? h("div", { class: "inline-sources" }, sources.map(({ card, n }) => cardTile(card, n)))
                : h("p", { class: "muted" }, "No fact cards linked to this finding.")));
        })) : h("p", { class: "muted" }, "No findings were recorded."))];

  if (feature?.id === "competitor_scan" && result.table) {
    content.push(section("r-prices", result.table.title || "Price comparison",
      h("p", { class: "table-hint", "aria-hidden": "true" }, "Scroll sideways for details."),
      renderPriceTable(result.table, richText)));
  }
  if (feature?.id === "marketing_plan" || (!result.version && (list(result.plan).length || result.budget))) {
    if (list(result.plan).length) content.push(section("r-plan", "Marketing plan",
      list(result.plan).filter(Boolean).map((group) => h("div", { class: "brief-plan-group" },
        h("h3", {}, group.section || "Plan"), h("ul", { class: "brief-statements" }, list(group.items).map(statement))))));
    if (result.budget) content.push(section("r-budget", "4-week budget", renderBudget({ ...result.budget, lines: list(result.budget.lines) }, richText)));
  }
  if (feature?.id === "launch_checklist" && list(result.checklist).length) {
    content.push(section("r-checklist", "Launch checklist", h("ol", { class: "launch-checklist" },
      list(result.checklist).filter(Boolean).map((entry) => h("li", {},
        h("span", { class: "checklist-box", "aria-hidden": "true" }),
        h("div", {}, h("h3", {}, entry.step || "Launch step"),
          h("div", { class: "badge-row" }, entry.kind ? kindBadge(entry.kind) : null,
            entry.official ? h("span", { class: "badge official-badge" }, "Official source") : null),
          h("p", {}, richText(entry.text, entry.card_ids)), methodNote(entry)))))));
  }

  const steps = list(result.next_steps).length ? list(result.next_steps) : list(result.next_checks).map((entry) => ({ text: asItem(entry)?.text }));
  const missing = list(result.missing_evidence);
  content.push(section("r-next", "Next steps & missing evidence",
    steps.length ? h("ol", { class: "brief-next-steps" }, steps.filter(Boolean).map((step) => h("li", {},
      h("p", { class: "next-step-text" }, typeof step === "string" ? step : step.text || ""),
      h("p", { class: "next-step-how" }, h("strong", {}, "How to check: "),
        step.how || "No check method was recorded."))))
      : h("p", { class: "muted" }, "No next steps were recorded."),
    missing.length ? [h("h3", {}, "Missing evidence"), h("ul", { class: "missing-evidence" }, missing.map((item) => h("li", {}, String(item))))] : null));
  content.push(section("r-coverage", "Evidence coverage", renderCoverage(result.coverage), renderCostLine(result)));
  content.push(h("details", { class: "brief-appendix", id: "r-cards" },
    h("summary", {}, `All fact cards (${cards.length})`),
    h("p", { class: "section-note" }, SOURCED_NOTE),
    cards.length ? h("div", { class: "all-fact-cards" }, cards.map((card, i) => cardTile(card, i + 1)))
      : h("p", { class: "muted" }, "No fact cards were recorded.")));
  const brief = result.brief || run?.brief;
  content.push(h("details", { class: "brief-appendix", id: "r-about" }, h("summary", {}, "About this report"),
    h("p", { class: "section-note" }, SOURCED_NOTE), brief ? renderBriefDetails(brief) : null, renderAbout(result)));

  const meta = [];
  if (result.generated_at || run?.created_at) meta.push(fmtDate(result.generated_at || run.created_at));
  meta.push(`${plural(cards.length, "fact card")}, ${sourcedCount} sourced`);
  if (result.seconds != null) meta.push(`Research took ${fmtSeconds(result.seconds)}`);
  return h("article", { class: "report report-v2" },
    h("header", { class: "report-head" },
      h("p", { class: "eyebrow" }, shared ? "Shared report · read only" : "Your research brief"),
      h("h1", { class: "report-title" }, result.title || run?.title || "Your report"),
      feature ? h("p", { class: "report-feature" }, feature.name) : null,
      h("p", { class: "report-meta" }, meta.filter(Boolean).join(" · ")),
      actions ? h("div", { class: "report-actions" }, actions) : null),
    h("div", { class: "classic-report-body" }, content));
}

export function cardTile(card, n) {
  return h("article", { class: "inline-fact-card" },
    h("div", { class: "inline-fact-head" },
      n ? h("span", { class: "inline-card-number" }, `Fact card ${n}`) : null,
      typeBadge(card.type), isStale(card) ? staleBadge() : null),
    card.claim ? h("p", { class: "inline-fact-claim" }, card.claim) : null,
    card.quote ? h("blockquote", { class: "quote" }, h("p", {}, `“${card.quote}”`)) : null,
    externalLink(card.url, card.source_title || domainOf(card.url) || "Open source", "inline-source-link"),
    h("p", { class: "inline-captured" }, `Captured ${fmtDate(card.captured_at) || "date unknown"}`));
}

function renderPriceTable(table, richText) {
  const columns = list(table.columns);
  return h("div", { class: "table-scroll", role: "region", "aria-label": table.title || "Price comparison", tabindex: "0" },
    h("table", { class: "price-comparison-table" },
      h("caption", { class: "visually-hidden" }, table.title || "Price comparison"),
      h("thead", {}, h("tr", {}, columns.map((column) => h("th", { scope: "col" }, column)), h("th", { scope: "col" }, "Sources"))),
      h("tbody", {}, list(table.rows).filter(Boolean).map((row) => h("tr", {},
        list(row.cells).map((cell, i) => h(i === 0 ? "th" : "td", i === 0 ? { scope: "row" } : {}, String(cell ?? ""))),
        h("td", { class: "price-row-sources" }, richText("", row.card_ids)))))));
}

function renderCoverage(coverage) {
  if (!coverage || typeof coverage !== "object") return h("p", { class: "muted" }, "Coverage counts were not recorded for this report.");
  const metrics = [
    ["Research directions", "directions"], ["Pages read", "pages_read"],
    ["Quotes found", "quotes_found"], ["Quotes checked", "quotes_total"],
    ["Claims narrowed", "claims_narrowed"], ["Claims relabelled", "relabelled"],
  ].filter(([, key]) => coverage[key] != null);
  if (!metrics.length) return h("p", { class: "muted" }, "Coverage counts were not recorded for this report.");
  return h("div", { class: "table-scroll coverage-scroll" }, h("table", { class: "coverage-table" },
    h("caption", { class: "visually-hidden" }, "Evidence coverage counts"),
    h("tbody", {}, metrics.map(([label, key]) => h("tr", {},
      h("th", { scope: "row" }, label), h("td", { class: "num" }, String(coverage[key])))))));
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
  return h("details", { class: "brief-details" },
    h("summary", {}, "Your brief"),
    h("dl", { class: "brief-dl" }, rows.map(([k, v]) => [h("dt", {}, k), h("dd", {}, String(v))])),
    questions.length
      ? [h("p", { class: "brief-q-title" }, "Questions researched"), h("ol", { class: "brief-q" }, questions.map((q) => h("li", {}, q)))]
      : null);
}

function renderBudget(budget, richText) {
  const currency = budget.currency || "USD";
  const lines = list(budget.lines).filter(Boolean);
  const total = budget.total != null && Number.isFinite(Number(budget.total)) && Number(budget.total) >= 0
    ? Number(budget.total)
    : lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);

  const table = h("table", { class: "budget-table" },
    h("caption", { class: "visually-hidden" }, `Budget in ${currency}`),
    h("thead", {}, h("tr", {},
      h("th", { scope: "col" }, "Item"),
      h("th", { scope: "col", class: "num" }, "Amount"),
      h("th", { scope: "col" }, "Kind"),
      h("th", { scope: "col" }, "Basis"))),
    h("tbody", {}, lines.map((line) => h("tr", {},
      h("th", { scope: "row", class: "budget-item" }, line.item || ""),
      h("td", { class: "num" }, fmtMoney(line.amount, currency)),
      h("td", {}, kindBadge(line.kind)),
      h("td", { class: "budget-basis" }, richText(isGenericAssumption(line) ? "Not backed by a quote — test it." : line.method || "", line.card_ids))))),
    h("tfoot", {}, h("tr", {},
      h("th", { scope: "row" }, "Total"),
      h("td", { class: "num" }, fmtMoney(total, currency)),
      h("td", {}),
      h("td", {}))));

  return [
    h("p", { class: "table-hint", "aria-hidden": "true" }, "Scroll sideways for details."),
    h("div", { class: "table-scroll", role: "region", "aria-label": "Budget table", tabindex: "0" }, table),
  ];
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
        h("table", { class: "agents-table" },
          h("caption", { class: "visually-hidden" }, "Time each agent took"),
          h("thead", {}, h("tr", {},
            h("th", { scope: "col" }, "Agent"),
            h("th", { scope: "col" }, "Status"),
            h("th", { scope: "col", class: "num" }, "Time"))),
          h("tbody", {}, agents.map((a) => h("tr", {},
            h("th", { scope: "row" }, a.name || "Agent"),
            h("td", {}, statusPill(a.status)),
            h("td", { class: "num" }, a.seconds != null ? fmtSeconds(a.seconds) : "")))),
          Number(result.seconds) > 0
            ? h("tfoot", {}, h("tr", {},
                h("th", { scope: "row" }, "Whole run"),
                h("td", {}),
                h("td", { class: "num" }, fmtSeconds(result.seconds))))
            : null))
    : null;

  return [
    parts.length ? h("p", { class: "cost-detail" }, `${parts.join(", ")}.`) : null,
    agentTable ? h("h3", {}, "Agents") : null,
    agentTable,
  ];
}

// ---- Fact card side panel --------------------------------------------------

let panelReturnFocus = null;

function panel() {
  let dlg = document.getElementById("card-panel");
  if (!dlg) {
    dlg = h("dialog", { id: "card-panel", class: "panel" });
    document.body.append(dlg);
  }
  if (!dlg.dataset.wired) {
    dlg.dataset.wired = "1";
    dlg.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        dlg.close();
        return;
      }
      if (ev.key !== "Tab") return;
      const controls = [...dlg.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((el) => !el.disabled && el.getClientRects().length);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    });
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
  const close = h("button", { type: "button", class: "icon-btn panel-close", "aria-label": "Close fact card", onclick: () => dlg.close() }, icon("close"));

  const notes = [];
  if (stale) {
    notes.push(h("p", { class: "note note-stale" },
      `Over ${STALE_DAYS} days old. Check the source again.`));
  }
  if (card.type !== "sourced") {
    notes.push(h("p", { class: "note note-unverified" },
      "This quote did not match the captured page. Check it before use."));
  }

  dlg.replaceChildren(
    h("div", { class: "panel-inner" },
      h("div", { class: "panel-head" },
        h("p", { class: "eyebrow" }, n ? `Fact card ${n}` : "Fact card"),
        close),
      h("div", { class: "badge-row" },
        typeBadge(card.type),
        stale ? staleBadge() : null,
        card.direction ? h("span", { class: "tag" }, card.direction) : null),
      h("h2", { class: "panel-claim", id: "card-panel-title" }, card.claim || "Untitled card"),
      card.quote ? h("blockquote", { class: "quote quote-lg" }, h("p", {}, `“${card.quote}”`)) : null,
      h("dl", { class: "panel-meta" },
        h("dt", {}, "Source"),
        h("dd", {},
          externalLink(card.url, card.source_title || domainOf(card.url) || "Open source", "source-link"),
          domainOf(card.url) ? h("span", { class: "source-domain" }, domainOf(card.url)) : null),
        h("dt", {}, "Captured"),
        h("dd", {}, fmtDate(card.captured_at) || "Unknown")),
      notes,
      h("p", { class: "note note-help" }, SOURCED_NOTE))
  );
  dlg.setAttribute("aria-labelledby", "card-panel-title");
  if (!dlg.open) dlg.showModal();
  close.focus();
}

export function sourcedNote() {
  return SOURCED_NOTE;
}
