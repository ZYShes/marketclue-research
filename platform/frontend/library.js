// Fact library (#/library) and My reports (#/runs). One scope picker on each (SPEC v5): Mine, each of the
// person's teams (that team's project reports and cards) and each visible project. The choice is kept in the
// address (?scope=team:<id> | project:<id>) and remembered per page; a scope that no longer exists falls back to Mine.
import {
  h, icon, setTitle, toggleGroup, externalLink, domainOf, sourceLabel, fmtDate, fmtAgo, fmtCost, isStale, plural, storage, toast,
  typeBadge, staleBadge, statusChip, emptyState,
} from "./ui.js";
import { api, friendlyError } from "./api.js";
import { state, main, page, pageHeader, loadingBlock, routeQuery, setRouteQuery } from "./core.js";
import { FEATURES, featureById } from "./features.js";
import { openCardPanel } from "./report.js";
import { loadTeams, projectHref } from "./projects.js";
import { deleteHistoryItem } from "./shell.js";

const MINE = { kind: "mine", value: "mine", name: "Mine" };
const scopeKey = (pageId) => `mc_scope_${pageId}_${(state.user && state.user.sub) || "anon"}`;

// Teams (GET /teams) and non-archived projects (GET /projects) the person can choose from.
async function scopeChoices() {
  const [teamsRes, projectsRes] = await Promise.allSettled([loadTeams({ fresh: true }), api("/projects")]);
  const teams = (teamsRes.status === "fulfilled" ? teamsRes.value : [])
    .filter((t) => t && t.team_id)
    .map((t) => ({ kind: "team", value: `team:${t.team_id}`, id: t.team_id, name: t.name || "Team" }));
  const rawProjects = projectsRes.status === "fulfilled" ? projectsRes.value : [];
  const projects = (Array.isArray(rawProjects) ? rawProjects : Array.isArray(rawProjects?.projects) ? rawProjects.projects : [])
    .filter((p) => p && p.project_id && !p.archived)
    .map((p) => ({ kind: "project", value: `project:${p.project_id}`, id: p.project_id, name: p.name || "Untitled project", team: p.team }));
  return { teams, projects };
}

// The address wins, then the remembered choice; the old ?scope=team means the first team.
function resolveScope(pageId, choices) {
  const wanted = routeQuery().get("scope") || storage.get(scopeKey(pageId)) || "mine";
  if (wanted === "team") return choices.teams[0] || MINE;
  return [...choices.teams, ...choices.projects].find((c) => c.value === wanted) || MINE;
}

function scopePaths(scope) {
  if (scope.kind === "team") {
    const base = `/teams/${encodeURIComponent(scope.id)}`;
    return { runs: `${base}/runs`, cards: `${base}/cards` };
  }
  if (scope.kind === "project") {
    const base = `/projects/${encodeURIComponent(scope.id)}`;
    return { runs: `${base}/runs`, cards: `${base}/cards` };
  }
  return { runs: "/runs", cards: "/cards" };
}

function scopePicker({ id, label, choices, scope, onChange }) {
  const select = h("select", { id, "aria-describedby": `${id}-hint` },
    h("option", { value: MINE.value, selected: scope.kind === "mine" }, "Mine"),
    choices.teams.length
      ? h("optgroup", { label: "Teams" }, choices.teams.map((c) => h("option", { value: c.value, selected: c.value === scope.value }, `Team · ${c.name}`)))
      : null,
    choices.projects.length
      ? h("optgroup", { label: "Projects" }, choices.projects.map((c) => h("option", { value: c.value, selected: c.value === scope.value }, `Project · ${c.name}`)))
      : null);
  const hint = h("p", { class: "field-hint", id: `${id}-hint` });
  const describe = (s) => {
    hint.textContent = s.kind === "team"
      ? `Finished reports and fact cards in ${s.name}'s projects.`
      : s.kind === "project"
        ? `Finished reports and fact cards in this project${s.team ? `, shared with ${s.team.name}` : ""}, plus your own reports in progress.`
        : "Your own reports and fact cards.";
  };
  describe(scope);
  select.addEventListener("change", () => {
    const next = [...choices.teams, ...choices.projects].find((c) => c.value === select.value) || MINE;
    describe(next);
    onChange(next);
  });
  return h("div", { class: "control scope-picker" }, h("label", { for: id }, label), select, hint);
}

function rememberScope(pageId, scope) {
  setRouteQuery({ scope: scope.kind === "mine" ? null : scope.value });
  if (scope.kind === "mine") storage.remove(scopeKey(pageId));
  else storage.set(scopeKey(pageId), scope.value);
}

// A team or project that is gone (left, removed, archived) answers 404: show Mine instead.
function isGone(scope, err) {
  return scope.kind !== "mine" && (err.status === 404 || err.status === 403);
}

// ---- My reports ---------------------------------------------------------------

export async function viewReports(isCurrent) {
  setTitle("My reports");
  const body = h("div", { class: "list-body" });
  const pickerSlot = h("div", { class: "toolbar-row" });
  main.replaceChildren(page(
    pageHeader({
      title: "My reports",
      lede: "Your research, or the finished reports of a team or a project you are in.",
      actions: h("a", { class: "btn btn-primary", href: "#/new" }, "New research"),
    }),
    pickerSlot,
    body));
  body.replaceChildren(loadingBlock("Loading your reports…"));
  const choices = await scopeChoices();
  if (!isCurrent()) return;
  let scope = resolveScope("reports", choices);
  rememberScope("reports", scope);
  const picker = scopePicker({
    id: "reports-scope", label: "Show reports from", choices, scope,
    onChange: (next) => { scope = next; rememberScope("reports", scope); load(); },
  });
  pickerSlot.replaceChildren(picker);

  let seq = 0;
  async function load() {
    const mine = ++seq;
    body.replaceChildren(loadingBlock(scope.kind === "mine" ? "Loading your reports…" : `Loading reports from ${scope.name}…`));
    try {
      const { runs = [] } = await api(scopePaths(scope).runs);
      if (mine !== seq || !isCurrent()) return;
      render(runs);
    } catch (err) {
      if (mine !== seq || !isCurrent()) return;
      if (isGone(scope, err)) {
        toast(`${scope.name} is no longer available to you. Showing your own reports.`);
        scope = MINE;
        picker.querySelector("select").value = MINE.value;
        rememberScope("reports", scope);
        return load();
      }
      body.replaceChildren(h("p", { class: "callout callout-error", role: "alert" }, friendlyError(err)));
    }
  }

  function emptyFor() {
    if (scope.kind === "team") {
      return emptyState({ title: "No reports in this team's projects yet", text: `Finished reports filed in ${scope.name}'s projects appear here.` });
    }
    if (scope.kind === "project") {
      return emptyState({
        title: "No reports in this project yet", text: "Start research in the project and its reports appear here.",
        action: h("a", { class: "btn btn-secondary", href: projectHref(scope.id) }, "Open the project"),
      });
    }
    return emptyState({
      title: "No research yet", text: "Your reports will appear here. The first one is free.",
      action: h("a", { class: "btn btn-primary", href: "#/new" }, "Start your first report"),
    });
  }

  function render(runs) {
    if (!runs.length) {
      body.replaceChildren(emptyFor());
      return;
    }
    body.replaceChildren(
      h("p", { class: "result-count", role: "status" }, plural(runs.length, "report")),
      h("ul", { class: "row-list" }, runs.map((run) => {
        const feature = featureById(run.feature || run.brief?.feature);
        const author = run.user_sub || run.owner_sub;
        // GET /runs (Mine) lists only the person's own reports; its rows carry no user_sub.
        const own = scope.kind === "mine" || run.mine === true || (!!author && author === state.user?.sub);
        const byOther = scope.kind !== "mine" && run.owner_name && !own;
        const meta = [
          feature.name,
          byOther ? `by ${run.owner_name}` : null,
          fmtAgo(run.created_at),
          scope.kind === "mine" && run.status === "done" && run.cost_usd != null ? `cost about ${fmtCost(run.cost_usd)}` : null,
        ].filter(Boolean).join(" · ");
        const running = run.status === "queued" || run.status === "running";
        const title = run.title || "Untitled research";
        const li = h("li", { class: own ? "row-with-action" : null },
          h("a", { class: "row-link", href: `#/runs/${encodeURIComponent(run.run_id)}` },
            h("span", { class: "row-main" },
              h("span", { class: "row-title" }, title),
              h("span", { class: "row-meta" }, meta)),
            statusChip(run.status === "queued" ? "running" : (run.status || "done"))),
          own && !running
            ? h("button", {
              type: "button", class: "icon-btn history-delete", title: "Delete report", "aria-label": `Delete report: ${title}`,
              onclick: async () => {
                if (await deleteHistoryItem({ type: "report", id: run.run_id, key: `run:${run.run_id}`, title })) {
                  li.remove();
                  const left = body.querySelectorAll(".row-list li").length;
                  const countEl = body.querySelector(".result-count");
                  if (countEl) countEl.textContent = plural(left, "report");
                  if (!left) body.replaceChildren(emptyFor());
                }
              },
            }, icon("trash"))
            : null);
        return li;
      })));
  }

  load();
}

// ---- Fact library --------------------------------------------------------------

export async function viewLibrary(isCurrent) {
  setTitle("Fact library");
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
  const pickerSlot = h("div", { class: "toolbar-row" });

  main.replaceChildren(page(
    pageHeader({
      title: "Fact library",
      lede: "Every quote your reports rest on, with its source and capture date. Sourced means the quote matched the captured page word for word.",
    }),
    pickerSlot, toolbar, count, grid));
  toolbar.hidden = true;
  grid.replaceChildren(loadingBlock("Loading your fact cards…"));

  let allCards = [];
  let runInfo = new Map();
  let reqSeq = 0;
  let debounce = null;
  const cleanup = () => clearTimeout(debounce);

  const choices = await scopeChoices();
  if (!isCurrent()) return cleanup;
  let scope = resolveScope("library", choices);
  rememberScope("library", scope);
  const picker = scopePicker({
    id: "lib-scope", label: "Show fact cards from", choices, scope,
    onChange: (next) => { scope = next; rememberScope("library", scope); resetFilters(); loadAll(); },
  });
  pickerSlot.replaceChildren(picker);

  const cardFeatures = (card) => new Set([
    card.feature,
    ...(card.run_ids || []).map((id) => runInfo.get(id)?.feature),
  ].filter(Boolean));

  async function loadAll() {
    const mine = ++reqSeq;
    grid.replaceChildren(loadingBlock(scope.kind === "mine" ? "Loading your fact cards…" : `Loading fact cards from ${scope.name}…`));
    count.textContent = "";
    toolbar.hidden = true;
    try {
      const paths = scopePaths(scope);
      const [cardsRes, runsRes] = await Promise.allSettled([api(paths.cards), api(paths.runs)]);
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
      if (isGone(scope, err)) {
        toast(`${scope.name} is no longer available to you. Showing your own fact cards.`);
        scope = MINE;
        picker.querySelector("select").value = MINE.value;
        rememberScope("library", scope);
        return loadAll();
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
        card.added_by && scope.kind !== "mine" ? h("p", { class: "fact-added muted" }, `Added by ${card.added_by}`) : null,
        used.length
          ? h("div", { class: "fact-used" },
              h("p", { class: "fact-used-label" }, `Used in ${plural(used.length, "report")}`),
              h("ul", { class: "used-list" }, used.map((info) => h("li", {},
                h("a", { href: `#/runs/${encodeURIComponent(info.run_id)}` }, info.title || "Report")))))
          : null));
  }

  function emptyFor() {
    if (scope.kind === "team") {
      return emptyState({ title: "No fact cards in this team's projects yet", text: `Cards from finished reports in ${scope.name}'s projects appear here.` });
    }
    if (scope.kind === "project") {
      return emptyState({
        title: "No fact cards in this project yet", text: "Cards appear here when a report in the project finishes.",
        action: h("a", { class: "btn btn-secondary", href: projectHref(scope.id) }, "Open the project"),
      });
    }
    return emptyState({
      title: "No fact cards yet", text: "Cards appear here after your first report finishes.",
      action: h("a", { class: "btn btn-primary", href: "#/new" }, "Start research"),
    });
  }

  function render(cards, filtered) {
    if (!allCards.length) {
      grid.replaceChildren(emptyFor());
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
      const { cards = [] } = await api(scopePaths(scope).cards, { query: { q, type, direction } });
      if (mine !== reqSeq || !isCurrent()) return;
      render(feature ? cards.filter((card) => cardFeatures(card).has(feature)) : cards, true);
    } catch (err) {
      if (mine !== reqSeq || !isCurrent()) return;
      count.textContent = friendlyError(err);
    }
  }
  function resetFilters() {
    search.value = "";
    typeSel.value = "";
    dirSel.value = "";
    toolSel.value = "";
  }
  function clearFilters() {
    resetFilters();
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
  return cleanup;
}
