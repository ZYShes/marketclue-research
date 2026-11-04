// Fact library (#/library) and My reports (#/runs), each with a Mine | Team toggle.
import {
  h, setTitle, toggleGroup, externalLink, domainOf, sourceLabel, fmtDate, fmtAgo, fmtCost, isStale, plural,
  typeBadge, staleBadge, statusChip, emptyState,
} from "./ui.js";
import { api, friendlyError } from "./api.js";
import { main, page, pageHeader, loadingBlock, routeQuery, setRouteQuery } from "./core.js";
import { FEATURES, featureById } from "./features.js";
import { openCardPanel } from "./report.js";

function scopeFromQuery() {
  return routeQuery().get("scope") === "team" ? "team" : "mine";
}

function noTeam(what) {
  return emptyState({
    title: "You are not in a team yet",
    text: `Create a team or accept an invite to see ${what} shared by your teammates.`,
    action: h("a", { class: "btn btn-secondary", href: "#/team" }, "Go to Team"),
    headingLevel: 2,
  });
}

// ---- My reports ---------------------------------------------------------------

export function viewReports(isCurrent) {
  setTitle("My reports");
  let scope = scopeFromQuery();
  const body = h("div", { class: "list-body" });
  const toggle = toggleGroup({
    label: "Whose reports", value: scope,
    options: [["mine", "Mine"], ["team", "Team"]],
    onChange: (v) => { scope = v; setRouteQuery({ scope: v === "team" ? "team" : null }); load(); },
  });
  main.replaceChildren(page(
    pageHeader({
      title: "My reports", lede: "Finished and running research. Team shows finished reports in your team's projects.",
      actions: h("a", { class: "btn btn-primary", href: "#/new" }, "New research"),
    }),
    h("div", { class: "toolbar-row" }, toggle),
    body));

  let seq = 0;
  async function load() {
    const mine = ++seq;
    body.replaceChildren(loadingBlock(scope === "team" ? "Loading team reports…" : "Loading your reports…"));
    try {
      const { runs = [] } = await api(scope === "team" ? "/team/runs" : "/runs");
      if (mine !== seq || !isCurrent()) return;
      render(runs);
    } catch (err) {
      if (mine !== seq || !isCurrent()) return;
      if (scope === "team" && (err.status === 404 || err.status === 403)) {
        body.replaceChildren(noTeam("reports"));
        return;
      }
      body.replaceChildren(h("p", { class: "callout callout-error", role: "alert" }, friendlyError(err)));
    }
  }

  function render(runs) {
    if (!runs.length) {
      body.replaceChildren(scope === "team"
        ? emptyState({ title: "No team reports yet", text: "Finished reports in your team's projects will appear here." })
        : emptyState({
            title: "No research yet", text: "Your reports will appear here. The first one is free.",
            action: h("a", { class: "btn btn-primary", href: "#/new" }, "Start your first report"),
          }));
      return;
    }
    body.replaceChildren(
      h("p", { class: "result-count" }, plural(runs.length, "report")),
      h("ul", { class: "row-list" }, runs.map((run) => {
        const feature = featureById(run.feature || run.brief?.feature);
        const meta = [
          feature.name,
          scope === "team" && run.owner_name ? `by ${run.owner_name}` : null,
          fmtAgo(run.created_at),
          scope === "mine" && run.status === "done" && run.cost_usd != null ? `cost about ${fmtCost(run.cost_usd)}` : null,
        ].filter(Boolean).join(" · ");
        return h("li", {},
          h("a", { class: "row-link", href: `#/runs/${encodeURIComponent(run.run_id)}` },
            h("span", { class: "row-main" },
              h("span", { class: "row-title" }, run.title || "Untitled research"),
              h("span", { class: "row-meta" }, meta)),
            statusChip(run.status === "queued" ? "running" : run.status)));
      })));
  }

  load();
}

// ---- Fact library --------------------------------------------------------------

export function viewLibrary(isCurrent) {
  setTitle("Fact library");
  let scope = scopeFromQuery();
  const search = h("input", { type: "search", id: "lib-q", placeholder: "Claims, quotes or sources", autocomplete: "off" });
  const typeSel = h("select", { id: "lib-type" },
    h("option", { value: "" }, "All types"),
    h("option", { value: "sourced" }, "Sourced"),
    h("option", { value: "unverified" }, "Unverified"));
  const dirSel = h("select", { id: "lib-dir" }, h("option", { value: "" }, "All directions"));
  const toolSel = h("select", { id: "lib-tool" },
    h("option", { value: "" }, "All tools"),
    FEATURES.map((f) => h("option", { value: f.id }, f.name)));
  const count = h("p", { class: "result-count", role: "status" });
  const grid = h("div", { class: "library-results" });
  const toolbar = h("form", { class: "toolbar", role: "search", onsubmit: (ev) => ev.preventDefault() },
    h("div", { class: "control control-grow" }, h("label", { for: "lib-q" }, "Search"), search),
    h("div", { class: "control" }, h("label", { for: "lib-type" }, "Type"), typeSel),
    h("div", { class: "control" }, h("label", { for: "lib-dir" }, "Direction"), dirSel),
    h("div", { class: "control" }, h("label", { for: "lib-tool" }, "Tool"), toolSel));
  const toggle = toggleGroup({
    label: "Whose fact cards", value: scope,
    options: [["mine", "Mine"], ["team", "Team"]],
    onChange: (v) => { scope = v; setRouteQuery({ scope: v === "team" ? "team" : null }); loadAll(); },
  });

  main.replaceChildren(page(
    pageHeader({
      title: "Fact library",
      lede: "Every quote your reports rest on, with its source and capture date. Sourced means the quote matched the captured page word for word.",
    }),
    h("div", { class: "toolbar-row" }, toggle),
    toolbar, count, grid));

  let allCards = [];
  let runInfo = new Map();
  let reqSeq = 0;
  let debounce = null;

  const cardFeatures = (card) => new Set([
    card.feature,
    ...(card.run_ids || []).map((id) => runInfo.get(id)?.feature),
  ].filter(Boolean));

  async function loadAll() {
    const mine = ++reqSeq;
    grid.replaceChildren(loadingBlock(scope === "team" ? "Loading team fact cards…" : "Loading your fact cards…"));
    count.textContent = "";
    toolbar.hidden = true;
    try {
      const [cardsRes, runsRes] = await Promise.allSettled([
        api(scope === "team" ? "/team/cards" : "/cards"),
        api(scope === "team" ? "/team/runs" : "/runs"),
      ]);
      if (mine !== reqSeq || !isCurrent()) return;
      if (cardsRes.status === "rejected") throw cardsRes.reason;
      allCards = cardsRes.value.cards || [];
      runInfo = new Map((runsRes.status === "fulfilled" ? runsRes.value.runs || [] : []).map((r) => [r.run_id, r]));
      const directions = [...new Set(allCards.map((c) => c.direction).filter(Boolean))].sort();
      dirSel.replaceChildren(h("option", { value: "" }, "All directions"), directions.map((d) => h("option", { value: d }, d)));
      toolbar.hidden = !allCards.length;
      render(allCards, false);
    } catch (err) {
      if (mine !== reqSeq || !isCurrent()) return;
      if (scope === "team" && (err.status === 404 || err.status === 403)) {
        grid.replaceChildren(noTeam("fact cards"));
        return;
      }
      grid.replaceChildren(h("p", { class: "callout callout-error", role: "alert" }, friendlyError(err)));
    }
  }

  function sourceLine(card) {
    const label = sourceLabel(card);
    const domain = domainOf(card.url);
    // Skip the domain when the label already starts with it (URL-only titles).
    const meta = [domain && !label.startsWith(domain) ? domain : null, card.captured_at ? `captured ${fmtDate(card.captured_at)}` : null].filter(Boolean);
    return h("p", { class: "fact-source" },
      externalLink(card.url, label, "source-link"),
      meta.length ? h("span", { class: "muted" }, ` · ${meta.join(" · ")}`) : null);
  }

  function cardItem(card) {
    const stale = isStale(card);
    const runIds = [...(card.run_ids || [])];
    const used = runIds.map((id) => runInfo.get(id)).filter(Boolean);
    return h("li", {},
      h("article", { class: `fact surface${stale ? " is-stale" : ""}` },
        h("div", { class: "badge-row" },
          typeBadge(card.type),
          stale ? staleBadge() : null,
          card.direction ? h("span", { class: "tag" }, card.direction) : null),
        h("h2", { class: "fact-claim" },
          h("button", { type: "button", class: "link-btn", "aria-haspopup": "dialog", onclick: () => openCardPanel(card, null) }, card.claim || "Untitled card")),
        card.quote ? h("blockquote", { class: "quote" }, h("p", {}, `“${card.quote}”`)) : null,
        sourceLine(card),
        card.added_by && scope === "team" ? h("p", { class: "fact-added muted" }, `Added by ${card.added_by}`) : null,
        used.length
          ? h("div", { class: "fact-used" },
              h("p", { class: "fact-used-label" }, `Used in ${plural(used.length, "report")}`),
              h("ul", { class: "used-list" }, used.map((info) => h("li", {},
                h("a", { href: `#/runs/${encodeURIComponent(info.run_id)}` }, info.title || "Report")))))
          : null));
  }

  function render(cards, filtered) {
    if (!allCards.length) {
      grid.replaceChildren(scope === "team"
        ? emptyState({ title: "No team fact cards yet", text: "Cards from finished reports in your team's projects will appear here." })
        : emptyState({
            title: "No fact cards yet", text: "Cards appear here after your first report finishes.",
            action: h("a", { class: "btn btn-primary", href: "#/new" }, "Start research"),
          }));
      count.textContent = "";
      return;
    }
    count.textContent = filtered
      ? `${plural(cards.length, "card")} of ${allCards.length}`
      : plural(cards.length, "card");
    if (!cards.length) {
      grid.replaceChildren(emptyState({
        title: "No cards match these filters",
        action: h("button", { type: "button", class: "btn btn-secondary", onclick: clearFilters }, "Clear filters"),
      }));
      return;
    }
    grid.replaceChildren(h("ul", { class: "card-grid" }, cards.map(cardItem)));
  }

  async function load() {
    const mine = ++reqSeq;
    const q = search.value.trim();
    const type = typeSel.value;
    const direction = dirSel.value;
    const feature = toolSel.value;
    const filtered = !!(q || type || direction || feature);
    if (!filtered) return render(allCards, false);
    try {
      const { cards = [] } = await api(scope === "team" ? "/team/cards" : "/cards", { query: { q, type, direction } });
      if (mine !== reqSeq || !isCurrent()) return;
      render(feature ? cards.filter((card) => cardFeatures(card).has(feature)) : cards, true);
    } catch (err) {
      if (mine !== reqSeq || !isCurrent()) return;
      count.textContent = friendlyError(err);
    }
  }
  function clearFilters() {
    search.value = "";
    typeSel.value = "";
    dirSel.value = "";
    toolSel.value = "";
    load();
    search.focus();
  }
  search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(load, 250);
  });
  typeSel.addEventListener("change", load);
  dirSel.addEventListener("change", load);
  toolSel.addEventListener("change", load);

  loadAll();
  return () => clearTimeout(debounce);
}
