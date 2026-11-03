// Renders the result document (used by the run view and the public shared view)
// and the fact-card side panel.

import {
  h, icon, externalLink, domainOf, fmtDate, fmtMoney, fmtCost, fmtSeconds, isStale,
  kindBadge, typeBadge, staleBadge, statusPill, plural, STALE_DAYS,
} from "./ui.js";

const SOURCED_NOTE =
  "Sourced means the exact quote matched the captured page. The page may still be wrong.";

// Inline card references inside text, e.g. "[3f9a1c0b7d21]" or "[card:3f9a1c0b7d21]".
const INLINE_REF = /\s*\[(?:card[:#\s]*)?([A-Za-z0-9_-]{4,40})\]/g;

function isGenericAssumption(item) {
  return item.kind === "assumption" &&
    /^not supported by (?:a )?checked quote/i.test(String(item.method || "").trim());
}

function asItem(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") return { text: raw, kind: null, card_ids: [], method: "" };
  if (typeof raw !== "object") return { text: String(raw), kind: null, card_ids: [], method: "" };
  return {
    text: String(raw.text || ""),
    kind: raw.kind || null,
    card_ids: Array.isArray(raw.card_ids) ? raw.card_ids : [],
    method: raw.method || "",
  };
}

export function renderReport(result, { run = null, shared = false, actions = null } = {}) {
  const cards = Array.isArray(result.cards) ? result.cards : [];
  const index = new Map(cards.map((card, i) => [card.card_id, { card, n: i + 1 }]));
  const sourcedCount = cards.filter((c) => c.type === "sourced").length;

  function chip(id) {
    const entry = index.get(id);
    if (!entry) return null;
    const { card, n } = entry;
    return h(
      "button",
      {
        type: "button",
        class: `chip ${card.type === "sourced" ? "chip-sourced" : "chip-unverified"}`,
        title: card.claim,
        "aria-label": `Fact card ${n}${card.type === "sourced" ? "" : " (unverified)"}: ${card.claim}`,
        "aria-haspopup": "dialog",
        onclick: () => openCardPanel(card, n),
      },
      String(n)
    );
  }

  // Text with inline references turned into chips, then any remaining card_ids as chips.
  function richText(text, ids = []) {
    const out = [];
    const used = new Set();
    let last = 0;
    for (const m of String(text || "").matchAll(INLINE_REF)) {
      if (!index.has(m[1])) continue;
      out.push(text.slice(last, m.index), " ", chip(m[1]));
      used.add(m[1]);
      last = m.index + m[0].length;
    }
    out.push(String(text || "").slice(last));
    const extra = (ids || []).filter((id) => index.has(id) && !used.has(id));
    if (extra.length) {
      const group = h("span", { class: "chips" });
      for (const id of extra) group.append(chip(id));
      out.push(" ", group);
    }
    return out;
  }

  function statement(raw) {
    const item = asItem(raw);
    if (!item) return null;
    const genericAssumption = isGenericAssumption(item);
    const method =
      item.method && (item.kind === "estimate" || item.kind === "assumption")
        ? h("p", { class: "method" },
            genericAssumption ? null : h("span", { class: "method-label" }, item.kind === "estimate" ? "Estimate: " : "Basis: "),
            genericAssumption ? "Not backed by a quote — test it." : item.method)
        : null;
    return h(
      "li",
      { class: `statement${item.kind ? "" : " statement-plain"}` },
      item.kind ? h("span", { class: "statement-kind" }, kindBadge(item.kind)) : null,
      h("div", { class: "statement-body" }, h("p", { class: "statement-text" }, richText(item.text, item.card_ids)), method)
    );
  }

  function statements(list, extraClass = "") {
    const items = (Array.isArray(list) ? list : []).map(statement).filter(Boolean);
    if (!items.length) return h("p", { class: "muted" }, "Nothing here for this report.");
    return h("ul", { class: `statements ${extraClass}`.trim() }, items);
  }

  const sections = [];
  const toc = [];
  const openSections = new Set(["r-summary", "r-plan", "r-budget", "r-next"]);
  function section(id, title, ...content) {
    toc.push([id, title]);
    sections.push(
      h("details", { class: "report-section", id, open: openSections.has(id) },
        h("summary", { id: `${id}-h` }, h("h2", {}, title)),
        h("div", { class: "report-section-content" }, content))
    );
  }

  // Brief
  const brief = result.brief || (run && run.brief);
  const briefBlock = brief ? renderBriefDetails(brief) : null;

  // Summary
  section("r-summary", "Summary", statements(result.summary, "statements-summary"));

  // Findings
  const findings = Array.isArray(result.findings) ? result.findings : [];
  section(
    "r-findings",
    "Findings",
    findings.length
      ? findings.map((group) =>
          h("div", { class: "direction" },
            h("h3", {}, group.direction || "Findings"),
            statements(group.items)))
      : h("p", { class: "muted" }, "No findings in this report.")
  );

  // Marketing plan
  const plan = Array.isArray(result.plan) ? result.plan : [];
  section(
    "r-plan",
    "Marketing plan",
    plan.length
      ? plan.map((group) => h("div", { class: "plan-section" }, h("h3", {}, group.section || "Plan"), statements(group.items)))
      : h("p", { class: "muted" }, "No plan in this report.")
  );

  // Budget
  section("r-budget", "Budget",
    result.budget && Array.isArray(result.budget.lines) && result.budget.lines.length
      ? renderBudget(result.budget, richText)
      : h("p", { class: "muted" }, "No budget in this report."));

  // Next checks
  const checks = Array.isArray(result.next_checks) ? result.next_checks : [];
  section("r-next", "Next checks",
    checks.length
      ? h("ol", { class: "next-checks" }, checks.map((c) => h("li", {}, richText(typeof c === "string" ? c : asItem(c).text))))
      : h("p", { class: "muted" }, "No next checks in this report."));

  // Fact cards
  section("r-cards", "Fact cards",
      h("p", { class: "section-note" }, cards.length
        ? `${plural(cards.length, "card")}. Select one to read the quote.`
        : "No fact cards in this report."),
      h("ol", { class: "source-list" },
        cards.map((card, i) =>
          h("li", {},
            h("button", {
              type: "button",
              class: "source-row",
              "aria-haspopup": "dialog",
              onclick: () => openCardPanel(card, i + 1),
            },
            h("span", { class: `source-n ${card.type === "sourced" ? "chip-sourced" : "chip-unverified"}`, "aria-hidden": "true" }, String(i + 1)),
            h("span", { class: "source-main" },
              h("span", { class: "source-claim" }, card.claim),
              h("span", { class: "source-meta" },
                [card.source_title || domainOf(card.url), domainOf(card.url)].filter(Boolean).join(" · "))),
            h("span", { class: "source-badges" }, typeBadge(card.type), isStale(card) ? staleBadge() : null))))));

  // Keep the brief and technical details available without crowding the report.
  section("r-about", "About this report", briefBlock, renderAbout(result));

  const metaBits = [];
  if (result.generated_at) metaBits.push(`Generated ${fmtDate(result.generated_at)}`);
  if (cards.length) metaBits.push(`${plural(cards.length, "fact card")}, ${sourcedCount} sourced`);
  if (Number(result.seconds) > 0) metaBits.push(`Research took ${fmtSeconds(result.seconds)}`);

  const tocNav = h("nav", { class: "report-toc", "aria-label": "Report sections" },
    h("p", { class: "toc-title" }, "In this report"),
    h("ol", {}, toc.map(([id, title]) =>
      h("li", {}, h("a", {
        href: `#${id}`,
        onclick: (ev) => {
          ev.preventDefault();
          const target = document.getElementById(`${id}-h`);
          if (target) {
            target.parentElement.open = true;
            target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
            target.focus({ preventScroll: true });
          }
        },
      }, title)))));

  return h("article", { class: "report" },
    h("header", { class: "report-head" },
      h("p", { class: "eyebrow" }, shared ? "Shared report · read only" : "MarketClue report"),
      h("h1", { class: "report-title" }, result.title || (run && run.title) || "Your report"),
      metaBits.length ? h("p", { class: "report-meta" }, metaBits.join(" · ")) : null,
      actions ? h("div", { class: "report-actions" }, actions) : null),
    h("div", { class: "report-grid" },
      h("div", { class: "report-body" }, renderLegend(), sections, renderCostLine(result)),
      tocNav));
}

function prefersReducedMotion() {
  return document.documentElement.classList.contains("reading-reduced-motion") ||
    (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function renderLegend() {
  const kinds = [
    ["sourced", "Backed by a quote. Select a number to read it."],
    ["assumption", "Not backed by a quote — test it."],
    ["estimate", "A calculated number. The method is shown."],
  ];
  return h("div", { class: "kind-legend", role: "note", "aria-label": "Report labels" },
    kinds.map(([kind, description]) => h("span", { title: description },
      kindBadge(kind), h("span", { class: "visually-hidden" }, `: ${description}`))));
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
  const lines = budget.lines;
  const total = Number.isFinite(Number(budget.total)) && Number(budget.total) > 0
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
  const usd = Number((result.cost || {}).usd);
  return Number.isFinite(usd)
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

  const agents = Array.isArray(result.agents) ? result.agents : [];
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
