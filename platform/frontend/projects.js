// Projects (SPEC v5): the project store, the new-project and move dialogs, the breadcrumb, and the
// project page (#/p/<id>) with its journey strip, Reports and Fact cards tabs and the project brief.
import {
  h, icon, setTitle, toast, tabs, statusChip, fmtDate, fmtAgo, fmtMoney, emptyState, plural, storage,
  trapFocus, typeBadge, staleBadge, isStale, externalLink, domainOf,
} from "./ui.js";
import { api, friendlyError } from "./api.js";
import { state, main, page, loadingBlock, rerender, announce } from "./core.js";
import { FEATURES, featureById } from "./features.js";
import { openCardPanel } from "./report.js";
import { toolIcon } from "./research.js";

export const BRIEF_FIELDS = [
  ["business", "Business"],
  ["customer", "Customer"],
  ["location", "Location"],
  ["stage", "Stage"],
  ["budget_usd", "Budget (4 weeks)"],
];

// ---- Store ------------------------------------------------------------------

let projects = null;
let projectsError = null;
let projectsPromise = null;
let showArchived = false;
const listeners = new Set();
const details = new Map(); // project_id → GET /projects/{id} (for the brief and default template)

function normalizeProjects(data) {
  const raw = Array.isArray(data) ? data : Array.isArray(data?.projects) ? data.projects : [];
  return raw.filter((p) => p && p.project_id).map((p) => ({ ...p, name: p.name || "Untitled project" }));
}

export function refreshProjects() {
  if (!state.user) return Promise.resolve([]);
  if (projectsPromise) return projectsPromise;
  projectsPromise = api("/projects", { query: { archived: showArchived ? 1 : null } })
    .then((data) => {
      projects = normalizeProjects(data);
      projectsError = null;
    })
    .catch((err) => {
      projectsError = err;
    })
    .then(() => {
      listeners.forEach((fn) => fn(projects));
      return projects || [];
    })
    .finally(() => { projectsPromise = null; });
  return projectsPromise;
}

export function getProjects() {
  return projects;
}

export function archivedShown() {
  return showArchived;
}

// Archived projects are hidden from lists unless asked for (GET /projects?archived=1).
export function setShowArchived(on) {
  showArchived = !!on;
  return refreshProjects();
}

export function projectsFailed() {
  return projects == null && !!projectsError;
}

export function onProjects(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function projectById(id) {
  return (projects || []).find((p) => p.project_id === id) || null;
}

export function resetProjects() {
  projects = null;
  projectsError = null;
  showArchived = false;
  details.clear();
  teams = null;
}

export function projectDetail(id, { fresh = false } = {}) {
  if (!fresh && details.has(id)) return Promise.resolve(details.get(id));
  return api(`/projects/${encodeURIComponent(id)}`).then((data) => {
    details.set(id, data);
    return data;
  });
}

let teams = null;
export function resetTeamsCache() {
  teams = null;
}
export function loadTeams({ fresh = false } = {}) {
  if (teams && !fresh) return Promise.resolve(teams);
  return api("/teams")
    .then((data) => (teams = Array.isArray(data) ? data : Array.isArray(data?.teams) ? data.teams : []))
    .catch(() => (teams = []));
}

const lastKey = () => `mc_last_project_${(state.user && state.user.sub) || "anon"}`;
export function lastProjectId() {
  return storage.get(lastKey()) || "";
}
export function rememberProject(id) {
  if (id) storage.set(lastKey(), id);
  else storage.remove(lastKey());
}

export function projectHref(id) {
  return `#/p/${encodeURIComponent(id)}`;
}

export function teamLabel(project) {
  return project?.team ? project.team.name || "Team" : "Personal";
}

// One line of what the project already knows, for "We already know: …".
export function briefLine(brief) {
  if (!brief) return "";
  return BRIEF_FIELDS.map(([key]) => {
    const v = brief[key];
    if (v == null || v === "") return null;
    return key === "budget_usd" ? `${fmtMoney(Number(v), "USD")} for 4 weeks` : String(v).trim();
  }).filter(Boolean).join(" · ");
}

// ---- Breadcrumb: Project › Compare ------------------------------------------------

// `project` may be {project_id, name} or just an id; the name is looked up in the store when missing.
export function projectCrumb(project, featureId) {
  const id = typeof project === "string" ? project : project?.project_id;
  if (!id) return null;
  const feature = featureId ? featureById(featureId) : null;
  const link = h("a", { href: projectHref(id) });
  const setName = () => {
    const name = (typeof project === "object" && project?.name) || projectById(id)?.name;
    link.textContent = name || "Project";
  };
  setName();
  if (!(typeof project === "object" && project?.name)) {
    const off = onProjects(() => {
      if (!link.isConnected) { off(); return; }
      setName();
    });
    if (getProjects() == null) refreshProjects();
  }
  return h("nav", { class: "crumbs", "aria-label": "Breadcrumb" },
    h("ol", {},
      h("li", {}, link),
      feature ? h("li", { "aria-current": "page" }, feature.stage) : null));
}

// ---- New project form (inline, or inside the sidebar dialog) ------------------------

export function newProjectForm({ idPrefix = "np", onCreated, onCancel = null, autofocus = true }) {
  const name = h("input", {
    type: "text", id: `${idPrefix}-name`, maxlength: "80", autocomplete: "off", required: true,
    "aria-describedby": `${idPrefix}-name-hint`,
  });
  const owner = h("select", { id: `${idPrefix}-owner`, "aria-describedby": `${idPrefix}-owner-hint` },
    h("option", { value: "" }, "Personal"));
  const ownerHint = h("p", { class: "field-hint", id: `${idPrefix}-owner-hint` }, "Only you see a personal project.");
  const error = h("p", { class: "form-error", role: "alert" });
  const submit = h("button", { type: "submit", class: "btn btn-primary btn-sm" }, "Create project");
  const form = h("form", { class: "new-project-form stack", novalidate: true },
    h("div", { class: "control" },
      h("label", { for: `${idPrefix}-name` }, "Project name"),
      name,
      h("p", { class: "field-hint", id: `${idPrefix}-name-hint` }, "One business idea or product, for example “Handmade ceramic planters”.")),
    h("div", { class: "control" },
      h("label", { for: `${idPrefix}-owner` }, "Belongs to"),
      owner, ownerHint),
    error,
    h("div", { class: "form-actions" },
      submit,
      onCancel ? h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => onCancel() }, "Cancel") : null));
  loadTeams().then((list) => {
    owner.append(...list.map((t) => h("option", { value: t.team_id }, `Team · ${t.name}`)));
    ownerHint.textContent = list.length
      ? "A team project is shared with everyone in that team: finished reports and fact cards, not conversations."
      : "Only you see a personal project. Join or create a team on the Team page to share projects.";
  });
  owner.addEventListener("change", () => {
    ownerHint.textContent = owner.value
      ? "Everyone in this team sees the project, its finished reports and fact cards. Conversations stay private."
      : "Only you see a personal project.";
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const value = name.value.trim();
    if (!value) {
      error.textContent = "Enter a project name.";
      name.setAttribute("aria-invalid", "true");
      name.focus();
      return;
    }
    name.removeAttribute("aria-invalid");
    submit.disabled = true;
    error.textContent = "";
    try {
      const body = { name: value.slice(0, 80) };
      if (owner.value) body.team_id = owner.value;
      const data = await api("/projects", { method: "POST", body });
      const project = data.project || data;
      if (data.project) details.set(project.project_id, data);
      await refreshProjects();
      onCreated(project);
    } catch (err) {
      submit.disabled = false;
      error.textContent = friendlyError(err);
    }
  });
  if (autofocus) requestAnimationFrame(() => name.focus());
  return form;
}

function dialogShell(id, title) {
  let dlg = document.getElementById(id);
  if (!dlg) {
    dlg = h("dialog", { id, class: "dialog dialog-sm", "aria-labelledby": `${id}-title` });
    document.body.append(dlg);
    trapFocus(dlg);
  }
  const opener = document.activeElement;
  const close = () => {
    if (dlg.open) dlg.close();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  };
  dlg.oncancel = (ev) => { ev.preventDefault(); close(); };
  const head = h("div", { class: "dialog-head" },
    h("h2", { id: `${id}-title` }, title),
    h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onclick: () => close() }, icon("close")));
  return { dlg, head, close };
}

// Sidebar "+ New project": the same short form in a dialog; opens the new project.
export function openNewProjectDialog() {
  const { dlg, head, close } = dialogShell("new-project-dialog", "New project");
  const form = newProjectForm({
    idPrefix: "npd",
    onCreated: (project) => {
      close();
      toast(`Project “${project.name}” created.`);
      location.hash = projectHref(project.project_id);
    },
    onCancel: close,
  });
  dlg.replaceChildren(head, form);
  dlg.showModal();
  form.querySelector("input")?.focus();
}

// "Move to project" for a report (PATCH /runs/{id}) or a conversation (PATCH /conversations/{id}).
export async function openMoveDialog({ kind = "run", id, current = null, finished = true, onMoved }) {
  const { dlg, head, close } = dialogShell("move-dialog", kind === "run" ? "Move report to a project" : "Move conversation to a project");
  dlg.replaceChildren(head, h("p", { class: "loading", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), "Loading projects…"));
  dlg.showModal();
  const list = (await refreshProjects()).filter((p) => !p.archived || p.project_id === current);
  if (!dlg.open) return;
  const select = h("select", { id: "move-project", "aria-describedby": "move-hint" },
    h("option", { value: "" }, "No project"),
    list.map((p) => h("option", { value: p.project_id, selected: p.project_id === current }, p.team ? `${p.name} (Team · ${p.team.name})` : `${p.name} (Personal)`)));
  const hint = h("p", { class: "field-hint", id: "move-hint" });
  const syncHint = () => {
    const target = list.find((p) => p.project_id === select.value);
    hint.textContent = !target
      ? "Without a project the report is private to you."
      : target.team
        ? (finished ? `Everyone in ${target.team.name} will be able to read this finished report.` : `When it finishes, everyone in ${target.team.name} can read it.`)
        : "The project is personal, so the report stays private to you.";
  };
  syncHint();
  select.addEventListener("change", syncHint);
  const error = h("p", { class: "form-error", role: "alert" });
  const submit = h("button", { type: "submit", class: "btn btn-primary" }, "Move");
  const form = h("form", { class: "stack", novalidate: true },
    h("div", { class: "control" }, h("label", { for: "move-project" }, "Project"), select, hint),
    error,
    h("div", { class: "form-actions form-actions-end" },
      h("button", { type: "button", class: "btn btn-secondary", onclick: () => close() }, "Cancel"), submit));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const target = select.value || null;
    if (target === (current || null)) { close(); return; }
    submit.disabled = true;
    error.textContent = "";
    try {
      await api(kind === "run" ? `/runs/${encodeURIComponent(id)}` : `/conversations/${encodeURIComponent(id)}`,
        { method: "PATCH", body: { project_id: target } });
      details.clear();
      refreshProjects();
      window.dispatchEvent(new Event("mc:refresh-history"));
      close();
      const name = list.find((p) => p.project_id === target)?.name;
      toast(target ? `Moved to “${name}”.` : "Removed from the project.");
      onMoved?.(target);
    } catch (err) {
      submit.disabled = false;
      error.textContent = friendlyError(err);
    }
  });
  dlg.replaceChildren(head, form);
  select.focus();
}

// ---- Project page (#/p/<id>) --------------------------------------------------------

export function viewProject(id, isCurrent) {
  setTitle("Project");
  main.replaceChildren(loadingBlock("Loading the project…"));
  return projectDetail(id, { fresh: true }).then((data) => {
    if (!isCurrent()) return null;
    return renderProject(id, data, isCurrent);
  }).catch((err) => {
    if (!isCurrent()) return;
    if (err.status === 404 || err.status === 403) {
      setTitle("Project not found");
      main.replaceChildren(page(emptyState({
        title: "Project not found", headingLevel: 1,
        text: "It may belong to a team you are no longer in, or the link is mistyped.",
        action: h("a", { class: "btn btn-secondary", href: "#/new" }, "Go to New research"),
      })));
      main.querySelector("h1")?.setAttribute("tabindex", "-1");
      return;
    }
    throw err;
  });
}

function stageCard(projectId, feature, stage) {
  const latest = stage?.latest || null;
  const count = Number(stage?.count) || 0;
  const startHref = `#/new/${feature.id}?project=${encodeURIComponent(projectId)}`;
  const headId = `stage-${feature.id}-h`;
  return h("li", { class: `stage-card${latest ? " is-started" : ""}`, "aria-labelledby": headId },
    h("p", { class: "stage-label" }, h("span", { class: "tool-step" }, String(feature.n)), feature.stage),
    h("h3", { class: "stage-tool", id: headId }, h("span", { class: "stage-icon" }, toolIcon(feature.id, 18)), feature.name),
    latest
      ? h("div", { class: "stage-latest" },
          h("a", { class: "stage-title", href: `#/runs/${encodeURIComponent(latest.run_id)}` }, latest.title || "Report"),
          h("p", { class: "stage-meta" }, [fmtDate(latest.created_at), count > 1 ? plural(count, "report") : null].filter(Boolean).join(" · ")),
          latest.takeaway ? h("p", { class: "stage-takeaway" }, latest.takeaway) : null,
          h("a", { class: "stage-start", href: startHref },
            icon("plus"), h("span", {}, "Research again"), h("span", { class: "visually-hidden" }, `: ${feature.stage}`)))
      : h("div", { class: "stage-latest" },
          h("p", { class: "stage-empty" }, "Not started"),
          h("a", { class: "btn btn-secondary btn-sm stage-start-btn", href: startHref },
            "Start", h("span", { class: "visually-hidden" }, ` ${feature.stage}: ${feature.name}`), icon("arrow"))));
}

function reportRow(run) {
  const feature = featureById(run.feature);
  const meta = [
    feature.stage,
    run.mine === false && run.owner_name ? `by ${run.owner_name}` : null,
    fmtAgo(run.created_at),
  ].filter(Boolean).join(" · ");
  const status = run.status === "queued" ? "running" : run.status;
  return h("li", {},
    h("a", { class: "row-link", href: `#/runs/${encodeURIComponent(run.run_id)}` },
      h("span", { class: "row-main" },
        h("span", { class: "row-title" }, run.title || "Untitled research"),
        h("span", { class: "row-meta" }, meta),
        run.status === "done" && run.takeaway ? h("span", { class: "row-takeaway" }, run.takeaway) : null),
      status === "done" ? null : statusChip(status)));
}

function factCard(card) {
  const stale = isStale(card);
  return h("li", {},
    h("article", { class: `fact surface${stale ? " is-stale" : ""}` },
      h("div", { class: "badge-row" },
        typeBadge(card.type),
        stale ? staleBadge() : null,
        card.direction ? h("span", { class: "tag" }, card.direction) : null),
      h("h3", { class: "fact-claim" },
        h("button", { type: "button", class: "link-btn", "aria-haspopup": "dialog", onclick: () => openCardPanel(card, null) }, card.claim || "Untitled card")),
      card.quote ? h("blockquote", { class: "quote" }, h("p", {}, `“${card.quote}”`)) : null,
      h("p", { class: "fact-source" },
        externalLink(card.url, card.source_title || domainOf(card.url) || "Source", "source-link"),
        h("span", { class: "muted" }, ` · ${domainOf(card.url)}${card.captured_at ? ` · captured ${fmtDate(card.captured_at)}` : ""}`)),
      card.added_by ? h("p", { class: "fact-added muted" }, `Added by ${card.added_by}`) : null));
}

function renderProject(id, data, isCurrent) {
  const project = data.project || {};
  const stages = data.stages || {};
  const runs = (Array.isArray(data.runs) ? data.runs : []).slice()
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  setTitle(project.name || "Project");
  rememberProject(id);

  // Header: name, team or Personal, one main action (+ settings for whoever may manage it).
  const actions = [
    h("a", { class: "btn btn-primary", href: `#/new?project=${encodeURIComponent(id)}` }, icon("plus"), "New research in this project"),
  ];
  if (project.can_manage) {
    actions.push(h("button", { type: "button", class: "btn btn-secondary", onclick: () => openSettings(project) }, "Project settings"));
  }
  const header = h("header", { class: "page-head project-head" },
    h("div", { class: "page-head-text" },
      h("p", { class: "eyebrow" }, project.team ? "Team project" : "Personal project"),
      h("h1", { tabindex: "-1" }, project.name || "Project"),
      h("p", { class: "project-owner" },
        h("span", { class: `badge ${project.team ? "badge-team" : "badge-neutral"}` }, project.team ? `Team · ${project.team.name}` : "Personal"),
        project.archived ? h("span", { class: "badge badge-neutral" }, "Archived") : null,
        h("span", { class: "muted" }, project.team
          ? " Everyone in the team sees finished reports and fact cards. Conversations stay private."
          : " Only you see this project."))),
    h("div", { class: "page-head-actions" }, actions));

  // Journey strip.
  const journey = h("section", { class: "project-journey", "aria-labelledby": "journey-h" },
    h("h2", { id: "journey-h", class: "section-title" }, "Journey"),
    h("ol", { class: "journey-strip" }, FEATURES.map((f) => stageCard(id, f, stages[f.id]))));

  // Reports tab: every report the viewer may read, newest first, filtered by stage.
  const stageSel = h("select", { id: "project-stage" },
    h("option", { value: "" }, "All stages"),
    FEATURES.map((f) => h("option", { value: f.id }, `${f.n} · ${f.stage}`)));
  const reportCount = h("p", { class: "result-count", role: "status" });
  const reportList = h("div", {});
  function renderReports() {
    const st = stageSel.value;
    const shown = st ? runs.filter((r) => r.feature === st) : runs;
    reportCount.textContent = st ? `${plural(shown.length, "report")} of ${runs.length}` : plural(runs.length, "report");
    if (!runs.length) {
      reportList.replaceChildren(emptyState({
        title: "No reports yet", headingLevel: 3,
        text: "Start any stage of the journey; finished reports appear here.",
        action: h("a", { class: "btn btn-primary", href: `#/new?project=${encodeURIComponent(id)}` }, "New research in this project"),
      }));
      return;
    }
    reportList.replaceChildren(shown.length
      ? h("ul", { class: "row-list" }, shown.map(reportRow))
      : emptyState({ title: "No reports at this stage yet", headingLevel: 3 }));
  }
  stageSel.addEventListener("change", renderReports);
  const reportsPanel = h("div", { class: "project-reports" },
    h("div", { class: "toolbar toolbar-one" }, h("div", { class: "control" }, h("label", { for: "project-stage" }, "Stage"), stageSel)),
    reportCount, reportList);

  // Fact cards tab: the project's knowledge base.
  const cardSearch = h("input", { type: "search", id: "project-cards-q", placeholder: "Claims, quotes or sources", autocomplete: "off" });
  const cardCount = h("p", { class: "result-count", role: "status" });
  const cardList = h("div", {});
  let cardSeq = 0;
  let cardTimer = null;
  let totalCards = null;
  async function loadCards() {
    const mine = ++cardSeq;
    const q = cardSearch.value.trim();
    if (totalCards == null) cardList.replaceChildren(loadingBlock("Loading fact cards…"));
    try {
      const { cards = [] } = await api(`/projects/${encodeURIComponent(id)}/cards`, { query: { q } });
      if (mine !== cardSeq || !isCurrent()) return;
      if (!q) totalCards = cards.length;
      cardCount.textContent = q ? `${plural(cards.length, "card")} of ${totalCards ?? cards.length}` : plural(cards.length, "card");
      if (!cards.length) {
        cardList.replaceChildren(q
          ? emptyState({ title: "No cards match", headingLevel: 3, action: h("button", { type: "button", class: "btn btn-secondary", onclick: () => { cardSearch.value = ""; loadCards(); cardSearch.focus(); } }, "Clear search") })
          : emptyState({ title: "No fact cards yet", headingLevel: 3, text: "Cards from finished reports in this project collect here. The research lead reads them before new research." }));
        return;
      }
      cardList.replaceChildren(h("ul", { class: "card-grid" }, cards.map(factCard)));
    } catch (err) {
      if (mine !== cardSeq || !isCurrent()) return;
      cardList.replaceChildren(h("p", { class: "callout callout-error", role: "alert" }, friendlyError(err)));
    }
  }
  cardSearch.addEventListener("input", () => {
    clearTimeout(cardTimer);
    cardTimer = setTimeout(loadCards, 250);
  });
  const cardsPanel = h("div", { class: "project-cards" },
    h("form", { class: "toolbar toolbar-one", role: "search", onsubmit: (ev) => ev.preventDefault() },
      h("div", { class: "control" }, h("label", { for: "project-cards-q" }, "Search fact cards"), cardSearch)),
    cardCount, cardList);

  const t = tabs({
    id: "project", label: "Project contents", selected: "reports",
    items: [
      { key: "reports", label: "Reports", count: runs.length, render: () => reportsPanel },
      { key: "cards", label: "Fact cards", render: () => cardsPanel },
    ],
  });

  // Project brief box (five short fields); Edit for whoever may manage the project.
  const briefBox = h("section", { class: "surface project-brief", "aria-labelledby": "pbrief-h" });
  let brief = { ...(project.brief || {}) };
  function renderBrief() {
    briefBox.replaceChildren(
      h("div", { class: "card-head" },
        h("h2", { id: "pbrief-h", tabindex: "-1" }, "Project brief"),
        project.can_manage ? h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: editBrief }, "Edit", h("span", { class: "visually-hidden" }, " project brief")) : null),
      h("dl", { class: "brief-fields" }, BRIEF_FIELDS.map(([key, label]) => {
        const v = brief[key];
        const text = v == null || v === "" ? "" : key === "budget_usd" ? fmtMoney(Number(v), "USD") : String(v);
        return h("div", { class: "field" }, h("dt", {}, label), h("dd", { class: text ? "" : "is-empty" }, text || "Not set yet"));
      })),
      h("p", { class: "field-hint" }, "The research lead reads this brief and skips questions it already answers."));
  }
  function editBrief() {
    const inputs = BRIEF_FIELDS.map(([key, label]) => {
      const input = h("input", {
        type: "text", id: `pb-${key}`, autocomplete: "off",
        inputmode: key === "budget_usd" ? "decimal" : null, maxlength: key === "budget_usd" ? "12" : "200",
        value: brief[key] == null ? "" : String(brief[key]),
      });
      return [key, h("div", { class: "control" }, h("label", { for: `pb-${key}` }, key === "budget_usd" ? `${label}, US dollars` : label), input), input];
    });
    const error = h("p", { class: "form-error", role: "alert" });
    const save = h("button", { type: "submit", class: "btn btn-primary btn-sm" }, "Save brief");
    const form = h("form", { class: "stack", novalidate: true },
      h("h2", { id: "pbrief-h", tabindex: "-1" }, "Edit project brief"),
      inputs.map(([, el]) => el),
      error,
      h("div", { class: "form-actions" }, save,
        h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => { renderBrief(); briefBox.querySelector("h2")?.focus(); } }, "Cancel")));
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const next = {};
      for (const [key, , input] of inputs) {
        const raw = input.value.trim();
        if (key === "budget_usd") {
          const n = Number(raw.replace(/[$,\s]/g, ""));
          if (raw && (!Number.isFinite(n) || n < 0)) {
            error.textContent = "Enter the budget as a number, for example 600.";
            input.setAttribute("aria-invalid", "true");
            input.focus();
            return;
          }
          next[key] = raw ? n : null;
        } else next[key] = raw || null;
      }
      save.disabled = true;
      error.textContent = "";
      try {
        const data = await api(`/projects/${encodeURIComponent(id)}`, { method: "PATCH", body: { brief: next } });
        brief = { ...((data.project || data).brief || next) };
        details.delete(id);
        renderBrief();
        briefBox.querySelector("h2")?.focus();
        announce("Project brief saved.");
      } catch (err) {
        save.disabled = false;
        error.textContent = friendlyError(err);
      }
    });
    briefBox.replaceChildren(form);
    inputs[0][2].focus();
  }
  renderBrief();

  main.replaceChildren(page(
    header,
    project.archived ? h("p", { class: "callout callout-warn" }, "This project is archived. It is hidden from the project list; its reports and fact cards stay readable.") : null,
    journey,
    h("div", { class: "project-layout" },
      h("div", { class: "project-main tabs-wrap" }, t.list, t.panels),
      briefBox)));
  renderReports();
  loadCards();
  return () => clearTimeout(cardTimer);
}

// Rename, move between Personal and a team, archive (project owner or team owner only).
async function openSettings(project) {
  const { dlg, head, close } = dialogShell("project-settings", "Project settings");
  dlg.replaceChildren(head, h("p", { class: "loading", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), "Loading…"));
  dlg.showModal();
  const myTeams = await loadTeams({ fresh: true });
  if (!dlg.open) return;
  const name = h("input", { type: "text", id: "ps-name", maxlength: "80", value: project.name || "", autocomplete: "off" });
  const owner = h("select", { id: "ps-owner", "aria-describedby": "ps-owner-hint" },
    h("option", { value: "", selected: !project.team }, "Personal"),
    myTeams.map((t) => h("option", { value: t.team_id, selected: project.team?.team_id === t.team_id }, `Team · ${t.name}`)));
  if (project.team && !myTeams.some((t) => t.team_id === project.team.team_id)) {
    owner.append(h("option", { value: project.team.team_id, selected: true }, `Team · ${project.team.name}`));
  }
  const ownerHint = h("p", { class: "field-hint", id: "ps-owner-hint" },
    "Moving the project moves all its reports: a team sees them, Personal makes them private to the project owner.");
  const error = h("p", { class: "form-error", role: "alert" });
  const save = h("button", { type: "submit", class: "btn btn-primary" }, "Save");
  const archiveBtn = h("button", { type: "button", class: "btn btn-danger-quiet" }, project.archived ? "Restore project" : "Archive project");
  async function patch(body, message) {
    error.textContent = "";
    save.disabled = true;
    archiveBtn.disabled = true;
    try {
      await api(`/projects/${encodeURIComponent(project.project_id)}`, { method: "PATCH", body });
      details.delete(project.project_id);
      await refreshProjects();
      close();
      toast(message);
      rerender();
    } catch (err) {
      save.disabled = false;
      archiveBtn.disabled = false;
      error.textContent = friendlyError(err);
    }
  }
  archiveBtn.addEventListener("click", () => patch({ archived: !project.archived },
    project.archived ? "Project restored." : "Project archived. “Show archived” in the Projects list brings it back."));
  const form = h("form", { class: "stack", novalidate: true },
    h("div", { class: "control" }, h("label", { for: "ps-name" }, "Project name"), name),
    h("div", { class: "control" }, h("label", { for: "ps-owner" }, "Belongs to"), owner, ownerHint),
    error,
    h("div", { class: "form-actions form-actions-split" }, archiveBtn,
      h("span", { class: "form-actions" },
        h("button", { type: "button", class: "btn btn-secondary", onclick: () => close() }, "Cancel"), save)));
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const value = name.value.trim();
    if (!value) {
      error.textContent = "Enter a project name.";
      name.setAttribute("aria-invalid", "true");
      name.focus();
      return;
    }
    const body = {};
    if (value !== project.name) body.name = value.slice(0, 80);
    const teamId = owner.value || null;
    if (teamId !== (project.team?.team_id || null)) body.team_id = teamId;
    if (!Object.keys(body).length) { close(); return; }
    patch(body, "Project updated.");
  });
  dlg.replaceChildren(head, form);
  name.focus();
}
