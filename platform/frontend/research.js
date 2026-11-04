// New research (#/new: tool picker + existing history) and the conversation view (#/c/<id>).
import {
  h, icon, svg, storage, setTitle, tabs, statusChip, fmtMoney, fmtAgo, emptyState, plural, templateBadge,
} from "./ui.js";
import { api, friendlyError } from "./api.js";
import {
  state, KEYS, main, go, page, pageHeader, loadingBlock, routeQuery, setRouteQuery, announce,
  setOpenConv, openConvId,
} from "./core.js";
import {
  FEATURES, MODES, DEFAULT_FEATURE, featureById, stageLabel, toolIcon,
  DEFAULT_TEMPLATE, templateName, isGeneralTemplate,
} from "./features.js";
import { depthPicker } from "./depth.js";
import {
  GENERAL_FALLBACK, templateIcon, fetchTemplates, rememberTemplate, lastTemplate, capabilityBadges,
} from "./templates.js";
import { refreshHistory, getHistory, onHistory, historyRow, groupHistory } from "./shell.js";
import {
  refreshProjects, getProjects, onProjects, projectById, projectDetail, lastProjectId, rememberProject,
  briefLine, newProjectForm, projectCrumb,
} from "./projects.js";

// toolIcon moved to features.js so small modules can use it without loading this page.
export { toolIcon };

// What the research lead adds to the intake for a template (mirrors the template's intake_needs).
const TEMPLATE_HINTS = {
  ebay: "For eBay it also asks about the category or a close example listing, the condition, your target price and who pays shipping.",
  food_truck: "For a food truck it also asks about the city and state, the cuisine, where you plan to sell and whether you own or rent the truck.",
  restaurant: "For a restaurant or café it also asks about the city and neighbourhood, the number of seats, the cuisine and whether you serve alcohol.",
  daycare: "For a daycare it also asks about the state and city, home or center, the ages you will serve and how many children. It never asks about specific children or families.",
  etsy: "For Etsy it also asks about the product, its size and material, your target price and who pays shipping.",
};

// What the research lead learned for a template (brief.<field>), shown in the brief panel (SPEC v4.1).
// eBay keeps its own block (ebayFields). Kinds: money (US dollars), bool (Yes/No), count.
const TEMPLATE_BRIEF_FIELDS = {
  food_truck: { title: "For the food truck", fields: [["city", "City"], ["state", "State"], ["cuisine", "Cuisine"],
    ["selling_spots", "Where you will sell"], ["truck", "Truck"]] },
  restaurant: { title: "For the restaurant or café", fields: [["city", "City"], ["neighbourhood", "Neighbourhood"],
    ["seats", "Seats", "count"], ["cuisine", "Cuisine"], ["alcohol", "Serves alcohol", "bool"]] },
  daycare: { title: "For the daycare", fields: [["state", "State"], ["city", "City"], ["setting", "Home or center"],
    ["ages_served", "Ages served"], ["planned_children", "Planned number of children", "count"]] },
  etsy: { title: "For Etsy", fields: [["product_type", "Product"], ["size_material", "Size and material"],
    ["target_price_usd", "Target price", "money"]] },
};
// ---- #/new -----------------------------------------------------------------

export function viewNew(isCurrent, featureArg) {
  setTitle("New research");
  const query = routeQuery();
  let selectedTab = query.get("tab") === "existing" ? "existing" : "new";
  let selected = featureArg || query.get("tool") || storage.get("mc_last_tool") || DEFAULT_FEATURE;
  if (!FEATURES.some((f) => f.id === selected)) selected = DEFAULT_FEATURE;
  const firstName = ((state.user && state.user.name) || "").trim().split(/\s+/)[0];

  // New tab: tool picker + first message.
  const input = h("textarea", {
    id: "first-message", rows: "3", maxlength: "2000", autocomplete: "off",
    "aria-describedby": "first-message-hint",
  });
  const hint = h("p", { id: "first-message-hint", class: "field-hint" });
  const sendBtn = h("button", { type: "submit", class: "btn btn-primary" }, "Start conversation", icon("arrow"));
  const error = h("p", { class: "form-error", role: "alert" });
  let sending = false;

  // Template (SPEC v4): loaded from GET /templates; the last choice is remembered per user.
  let templates = null; // null while loading
  let template = query.get("template") || lastTemplate();
  const PREVIEW = 6; // available templates shown here (cards wrap); the rest are on #/templates
  const templateSlot = h("div", { class: "template-slot" });
  const toolStep = h("span", { class: "step-badge", "aria-hidden": "true" }, "1");
  const messageStep = h("span", { class: "step-badge", "aria-hidden": "true" }, "2");
  const toolNote = h("p", { class: "field-hint tool-note", hidden: true });
  const currentTemplate = () => (templates || []).find((t) => t.id === template) || GENERAL_FALLBACK;

  // Project (SPEC v5): the project you came from, else the last used, else none.
  const cameFrom = query.get("project") || "";
  let projectId = cameFrom || lastProjectId() || "";
  let extraProject = null; // a project from the link that is not in the list (e.g. archived)
  const projectSel = h("select", { id: "project-select", "aria-describedby": "project-hint" },
    h("option", { value: "" }, "No project"));
  const projectHint = h("p", { class: "field-hint", id: "project-hint" },
    "Reports in a project build on each other: the research lead reads its brief, reports and fact cards.");
  const newProjectSlot = h("div", { class: "new-project-inline surface", id: "new-project-inline", hidden: true });
  const newProjectBtn = h("button", {
    type: "button", class: "btn btn-secondary", "aria-expanded": "false", "aria-controls": "new-project-inline",
  }, icon("plus"), "New project");
  const known = h("p", { class: "known-brief", id: "known-brief", hidden: true });
  const projectSlot = h("div", { class: "project-picker" },
    h("label", { for: "project-select", class: "step-legend" }, "Project"),
    h("div", { class: "input-row" }, projectSel, newProjectBtn),
    projectHint, newProjectSlot);

  function projectOptions() {
    const all = getProjects();
    const list = (all || []).filter((p) => !p.archived);
    if (extraProject && !list.some((p) => p.project_id === extraProject.project_id)) list.push(extraProject);
    // Forget a remembered project that is gone; the one from the link is checked by updateKnown().
    if (all != null && projectId && projectId !== cameFrom && !list.some((p) => p.project_id === projectId)) projectId = "";
    projectSel.replaceChildren(
      h("option", { value: "" }, "No project"),
      ...list.map((p) => h("option", { value: p.project_id }, p.team ? `${p.name} · Team: ${p.team.name}` : `${p.name} · Personal`)));
    projectSel.value = list.some((p) => p.project_id === projectId) ? projectId : "";
  }

  let knownSeq = 0;
  function updateKnown({ applyTemplate = false } = {}) {
    const mine = ++knownSeq;
    const describe = (withKnown) => input.setAttribute("aria-describedby", withKnown ? "known-brief first-message-hint" : "first-message-hint");
    if (!projectId) {
      known.hidden = true;
      describe(false);
      return;
    }
    projectDetail(projectId).then((data) => {
      if (mine !== knownSeq || !isCurrent()) return;
      const project = data.project || {};
      const line = briefLine(project.brief);
      known.replaceChildren(h("strong", {}, "We already know: "), line);
      known.hidden = !line;
      describe(!!line);
      const preferred = project.default_template;
      if (applyTemplate && preferred && preferred !== template) {
        const ok = !templates || templates.some((t) => t.id === preferred && t.available);
        if (ok) {
          if (templates) {
            const radio = document.getElementById(`template-${preferred}`);
            if (radio) radio.checked = true;
          }
          selectTemplate(preferred);
        }
      }
    }).catch((err) => {
      if (mine !== knownSeq || !isCurrent()) return;
      known.hidden = true;
      describe(false);
      if (err.status === 404 && projectId === cameFrom) {
        projectId = "";
        projectOptions();
      }
    });
  }

  projectSel.addEventListener("change", () => {
    projectId = projectSel.value;
    rememberProject(projectId);
    updateKnown({ applyTemplate: true });
  });
  newProjectBtn.addEventListener("click", () => {
    const open = newProjectSlot.hidden;
    newProjectSlot.hidden = !open;
    newProjectBtn.setAttribute("aria-expanded", String(open));
    if (!open) { newProjectSlot.replaceChildren(); return; }
    newProjectSlot.replaceChildren(newProjectForm({
      idPrefix: "npi",
      onCreated: (project) => {
        if (!isCurrent()) return;
        projectId = project.project_id;
        rememberProject(projectId);
        newProjectSlot.hidden = true;
        newProjectSlot.replaceChildren();
        newProjectBtn.setAttribute("aria-expanded", "false");
        projectOptions();
        updateKnown();
        projectSel.focus();
        announce(`Project ${project.name} created and chosen.`);
      },
      onCancel: () => {
        newProjectSlot.hidden = true;
        newProjectSlot.replaceChildren();
        newProjectBtn.setAttribute("aria-expanded", "false");
        newProjectBtn.focus();
      },
    }));
  });

  function updateComposer() {
    const feature = featureById(selected);
    input.placeholder = feature.placeholder;
    const extra = TEMPLATE_HINTS[template] ? ` ${TEMPLATE_HINTS[template]}` : "";
    hint.textContent = `${feature.greeting} The research lead asks 2–3 short questions before agents start.${extra}`;
  }

  const toolInputs = new Map();
  const toolCards = FEATURES.map((feature) => {
    const radio = h("input", {
      type: "radio", name: "tool", id: `tool-${feature.id}`, value: feature.id, checked: feature.id === selected,
      onchange: () => {
        selected = feature.id;
        storage.set("mc_last_tool", selected);
        updateComposer();
      },
    });
    toolInputs.set(feature.id, radio);
    return h("label", { class: "tool-card", for: `tool-${feature.id}` },
      radio,
      h("span", { class: "tool-stage" }, h("span", { class: "tool-step" }, String(feature.n)), feature.stage),
      h("span", { class: "tool-icon" }, toolIcon(feature.id)),
      h("span", { class: "tool-name" }, feature.name),
      h("span", { class: "tool-question" }, feature.question));
  });

  // A template may support only some tools; the others are shown disabled.
  function updateTools() {
    const supported = new Set(currentTemplate().tools);
    for (const [id, radio] of toolInputs) {
      radio.disabled = !supported.has(id);
      radio.closest(".tool-card").classList.toggle("is-disabled", radio.disabled);
    }
    if (!supported.has(selected)) {
      selected = FEATURES.find((f) => supported.has(f.id))?.id || DEFAULT_FEATURE;
      const radio = toolInputs.get(selected);
      if (radio) radio.checked = true;
    }
    const missing = FEATURES.filter((f) => !supported.has(f.id));
    toolNote.hidden = !missing.length;
    toolNote.textContent = missing.length ? `${currentTemplate().name} does not offer: ${missing.map((f) => f.name).join(", ")}.` : "";
    updateComposer();
  }

  function selectTemplate(id) {
    template = id;
    rememberTemplate(id);
    updateTools();
  }

  function renderTemplates() {
    if (templates == null) {
      templateSlot.replaceChildren(h("p", { class: "loading", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), "Loading templates…"));
      return;
    }
    // A remembered template that is unknown or unavailable falls back to General.
    if (!templates.some((t) => t.id === template && t.available)) template = DEFAULT_TEMPLATE;
    const choose = templates.length > 1;
    toolStep.textContent = choose ? "2" : "1";
    messageStep.textContent = choose ? "3" : "2";
    if (!choose) {
      templateSlot.replaceChildren();
      updateTools();
      return;
    }
    rememberTemplate(template);
    // The first PREVIEW templates in the server's order (an unavailable one is shown disabled with its reason),
    // always including the current choice; the cards wrap on narrow screens.
    let shown = templates.slice(0, PREVIEW);
    const chosen = templates.find((t) => t.id === template);
    if (chosen && !shown.includes(chosen)) shown = [...shown.slice(0, PREVIEW - 1), chosen];
    const cards = shown.map((t) => {
      const base = `template-${t.id}`;
      const described = [`${base}-desc`, `${base}-caps`, t.available ? null : `${base}-reason`].filter(Boolean).join(" ");
      return h("label", { class: `tool-card template-card${t.available ? "" : " is-disabled"}`, for: base },
        h("input", {
          type: "radio", name: "template", id: base, value: t.id, checked: t.id === template, disabled: !t.available,
          "aria-labelledby": `${base}-name`, "aria-describedby": described,
          onchange: () => selectTemplate(t.id),
        }),
        h("span", { class: "template-head" },
          h("span", { class: "tool-icon" }, templateIcon(t.id)),
          h("span", { class: "tool-name", id: `${base}-name` }, t.name)),
        h("span", { class: "tool-question", id: `${base}-desc` }, t.description),
        capabilityBadges(t, `${base}-caps`),
        t.available ? null : h("span", { class: "template-reason", id: `${base}-reason` },
          icon("info"), `Not available: ${t.unavailable_reason || "not set up yet"}`));
    });
    templateSlot.replaceChildren(h("fieldset", { class: "tool-picker template-picker" },
      h("legend", { class: "step-legend" }, h("span", { class: "step-badge", "aria-hidden": "true" }, "1"), "Choose a template"),
      h("p", { class: "field-hint" }, "A template adds sources and report sections for one kind of business. General is ordinary web research."),
      h("div", { class: "template-grid" }, cards),
      h("p", { class: "see-all" },
        h("a", { class: "see-all-link", href: "#/templates" },
          templates.length > shown.length ? `See all ${templates.length} templates` : "Browse templates",
          icon("arrow")),
        templates.length > shown.length
          ? h("span", { class: "field-hint" }, ` ${templates.length - shown.length} more, including ones not set up yet`)
          : null)));
    updateTools();
  }

  function loadTemplates() {
    return fetchTemplates().then((items) => {
      if (!isCurrent()) return;
      templates = items;
      renderTemplates();
    });
  }

  const form = h("form", { class: "start-form", novalidate: true },
    templateSlot,
    h("fieldset", { class: "tool-picker" },
      h("legend", { class: "step-legend" }, toolStep, "Choose a tool"),
      h("p", { class: "journey-line", "aria-hidden": "true" },
        FEATURES.map((f, i) => [h("span", {}, f.stage), i < FEATURES.length - 1 ? h("span", { class: "journey-arrow" }, "→") : null])),
      h("p", { class: "visually-hidden" }, "The tools follow a founder journey: Discover, Compare, Prepare, Grow."),
      h("div", { class: "tool-grid" }, toolCards),
      toolNote),
    h("div", { class: "first-message" },
      h("label", { for: "first-message", class: "step-legend" }, messageStep, "Describe your business"),
      known,
      hint,
      h("div", { class: "composer-box" }, input,
        h("div", { class: "composer-foot" },
          h("p", { class: "field-hint" }, "Enter to send · Shift + Enter for a new line"),
          h("div", { class: "composer-actions" },
            depthPicker({
              id: "depth",
              value: MODES[storage.get(KEYS.mode)] ? storage.get(KEYS.mode) : "quick",
              onChange: (m) => storage.set(KEYS.mode, m),
            }).el,
            sendBtn))),
      error));
  updateComposer();
  renderTemplates();

  async function start() {
    if (sending) return;
    const text = input.value.trim();
    if (!text) {
      error.textContent = "Describe your business first.";
      input.focus();
      return;
    }
    sending = true;
    sendBtn.disabled = true;
    sendBtn.textContent = "Starting…";
    error.textContent = "";
    try {
      const body = { message: text, feature: selected, template };
      if (projectId) body.project_id = projectId;
      const data = await api("/chat", { method: "POST", body });
      if (!isCurrent()) return;
      if (projectId) rememberProject(projectId);
      const conv = normalizeConv({ ...data, feature: data.feature || selected, template: data.template || template, project_id: data.project_id || projectId || null });
      state.convCache.set(conv.conv_id, conv);
      setOpenConv(conv.conv_id);
      refreshHistory();
      go(`#/c/${encodeURIComponent(conv.conv_id)}`);
    } catch (err) {
      if (!isCurrent()) return;
      error.textContent = friendlyError(err);
      sending = false;
      sendBtn.disabled = false;
      sendBtn.replaceChildren("Start conversation", icon("arrow"));
      // The template went away since the page loaded: show its new state (General is then chosen).
      if (err.code === "template_unavailable") loadTemplates();
      if (err.code === "project_not_found") {
        projectId = "";
        rememberProject("");
        refreshProjects().then(() => { if (isCurrent()) { projectOptions(); updateKnown(); } });
      }
    }
  }
  form.addEventListener("submit", (ev) => { ev.preventDefault(); start(); });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      form.requestSubmit();
    }
  });

  // Continue banner for the conversation a reload would return to.
  const openId = openConvId();
  const resumeSlot = h("div", { class: "resume-slot" });
  function renderResume(items) {
    const item = openId && (items || []).find((i) => i.type === "conversation" && i.id === openId);
    resumeSlot.replaceChildren(item
      ? h("div", { class: "resume" },
          h("p", {}, h("span", { class: "resume-label" }, "Continue where you left off: "), h("strong", {}, item.title)),
          h("a", { class: "btn btn-secondary btn-sm", href: item.href }, "Resume", icon("arrow")))
      : "");
  }

  // Existing tab: searchable history.
  const search = h("input", { type: "search", id: "history-q", placeholder: "Search by title or tool", autocomplete: "off" });
  const statusSel = h("select", { id: "history-status" },
    h("option", { value: "" }, "All"),
    h("option", { value: "draft" }, "Drafts"),
    h("option", { value: "ready" }, "Ready"),
    h("option", { value: "running" }, "Running"),
    h("option", { value: "done" }, "Done"),
    h("option", { value: "failed" }, "Failed"));
  const count = h("p", { class: "result-count", role: "status" });
  const listEl = h("div", { class: "history-results" });
  function renderExisting() {
    const items = getHistory();
    if (items == null) {
      listEl.replaceChildren(h("p", { class: "loading", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), "Loading your history…"));
      count.textContent = "";
      return;
    }
    const q = search.value.trim().toLowerCase();
    const st = statusSel.value;
    const filtered = items.filter((item) => {
      if (st && item.status !== st) return false;
      if (!q) return true;
      const feature = item.feature ? featureById(item.feature) : null;
      const projectName = item.project_id ? projectById(item.project_id)?.name : null;
      return [item.title, feature?.name, feature?.stage, projectName].some((v) => v && v.toLowerCase().includes(q));
    });
    count.textContent = q || st ? `${plural(filtered.length, "item")} of ${items.length}` : plural(items.length, "item");
    if (!items.length) {
      listEl.replaceChildren(emptyState({ title: "Nothing here yet", text: "Your conversations and reports will be listed here.", headingLevel: 3 }));
      return;
    }
    if (!filtered.length) {
      listEl.replaceChildren(emptyState({
        title: "No matches", text: "Try another word or status.", headingLevel: 3,
        action: h("button", { type: "button", class: "btn btn-secondary", onclick: () => { search.value = ""; statusSel.value = ""; renderExisting(); search.focus(); } }, "Clear search"),
      }));
      return;
    }
    listEl.replaceChildren(...groupHistory(filtered).map(([label, list]) => h("section", { class: "history-group", "aria-label": label },
      h("h2", { class: "group-title" }, label),
      h("ul", { class: "history-list" }, list.map((item) => h("li", {},
        historyRow(item),
        h("span", { class: "history-when" }, fmtAgo(item.at))))))));
  }
  search.addEventListener("input", renderExisting);
  statusSel.addEventListener("change", renderExisting);

  const existingPanel = h("div", { class: "existing" },
    h("form", { class: "toolbar", role: "search", onsubmit: (ev) => ev.preventDefault() },
      h("div", { class: "control control-grow" }, h("label", { for: "history-q" }, "Search history"), search),
      h("div", { class: "control" }, h("label", { for: "history-status" }, "Status"), statusSel)),
    count, listEl);

  const t = tabs({
    id: "new", label: "Start or continue research", selected: selectedTab,
    items: [
      { key: "new", label: "New", render: () => [resumeSlot, projectSlot, form] },
      { key: "existing", label: "Existing", render: () => existingPanel },
    ],
    onSelect: (key) => { selectedTab = key; setRouteQuery({ tab: key === "existing" ? "existing" : null }); },
  });

  main.replaceChildren(page(
    pageHeader({
      eyebrow: firstName ? `Welcome back, ${firstName}` : "New research",
      title: "What do you want to find out?",
      lede: "Choose a project if this builds on earlier research, pick a template and a tool, and describe your business. Every statement comes back Sourced, an Assumption or an Estimate.",
    }),
    h("div", { class: "tabs-wrap" }, t.list, t.panels)));

  renderResume(getHistory());
  renderExisting();
  loadTemplates();
  projectOptions();
  updateKnown({ applyTemplate: !!cameFrom });
  if (cameFrom && !projectById(cameFrom)) {
    projectDetail(cameFrom).then((data) => {
      if (!isCurrent() || !data.project || projectById(cameFrom)) return;
      extraProject = { ...data.project };
      projectOptions();
    }).catch(() => {});
  }
  const off = onHistory((items) => {
    if (!isCurrent()) return;
    renderResume(items);
    renderExisting();
  });
  const offProjects = onProjects(() => {
    if (!isCurrent()) return;
    const before = projectId;
    projectOptions();
    if (projectId !== before) updateKnown();
    renderExisting();
  });
  refreshHistory();
  refreshProjects();
  return () => { off(); offProjects(); };
}

// ---- #/c/<conv_id> -----------------------------------------------------------

function normalizeConv(c) {
  return {
    conv_id: c.conv_id,
    feature: c.feature || DEFAULT_FEATURE,
    template: c.template || c.brief?.template || DEFAULT_TEMPLATE,
    messages: Array.isArray(c.messages) ? c.messages : [],
    brief: c.brief || null,
    ready: !!c.ready,
    run_id: c.run_id || null,
    run_status: c.run_status || null,
    project_id: c.project_id || null,
    title: c.title || null,
    updated_at: c.updated_at || null,
  };
}

export function viewConversation(convId, isCurrent) {
  const cached = state.convCache.get(convId);
  state.convCache.delete(convId);
  if (cached) return renderConversation(cached, isCurrent);
  setTitle("Conversation");
  main.replaceChildren(loadingBlock("Loading the conversation…"));
  return api(`/conversations/${encodeURIComponent(convId)}`).then((data) => {
    if (!isCurrent()) return null;
    return renderConversation(normalizeConv({ conv_id: convId, ...(data.conversation || data) }), isCurrent);
  }).catch((err) => {
    if (!isCurrent()) return;
    if (err.status === 404 || err.status === 403) {
      if (openConvId() === convId) setOpenConv(null);
      setTitle("Conversation not found");
      main.replaceChildren(page(emptyState({
        title: "Conversation not found", headingLevel: 1,
        text: "It may have been removed, or it belongs to another account.",
        action: h("a", { class: "btn btn-primary", href: "#/new" }, "Start new research"),
      })));
      main.querySelector("h1")?.setAttribute("tabindex", "-1");
      return;
    }
    throw err;
  });
}

function renderConversation(initial, isCurrent) {
  let conv = initial;
  const feature = featureById(conv.feature);
  setTitle(conv.brief?.business ? `${feature.name}: ${conv.brief.business}` : feature.name);
  setOpenConv(conv.conv_id);
  let sending = false;
  let starting = false;
  let pendingText = null;
  // Effort belongs to whoever starts the run (SPEC v3 decisions); the last choice is remembered.
  let mode = MODES[storage.get(KEYS.mode)] ? storage.get(KEYS.mode) : "quick";
  // Research depth sits in the bottom-right corner of the message box; the brief panel shows a summary.
  const picker = depthPicker({
    id: "depth", value: mode,
    onChange: (m) => {
      mode = m;
      storage.set(KEYS.mode, m);
      renderPanel();
    },
  });

  const titleEl = h("h1", { tabindex: "-1", class: "conv-title", id: "conv-title" });
  const log = h("ol", { class: "messages", "aria-label": "Messages" });
  const input = h("textarea", {
    id: "chat-input", rows: "2", maxlength: "2000", autocomplete: "off",
    placeholder: "Reply to the research lead…", "aria-describedby": "chat-hint",
  });
  const sendBtn = h("button", { type: "submit", class: "btn btn-primary composer-send" }, icon("send"), h("span", {}, "Send"));
  const chatError = h("p", { class: "form-error", role: "alert" });
  const composer = h("form", { class: "composer", novalidate: true },
    h("label", { for: "chat-input", class: "visually-hidden" }, "Message to the research lead"),
    h("div", { class: "composer-box" }, input,
      h("div", { class: "composer-foot" },
        h("p", { class: "field-hint", id: "chat-hint" }, "Enter to send · Shift + Enter for a new line"),
        h("div", { class: "composer-actions" }, picker.el, sendBtn))),
    chatError);
  const readyNote = h("div", { class: "ready-slot" });
  const finishedNote = h("div", { class: "finished-slot" });
  const panel = h("aside", { class: "brief-panel", id: "brief", "aria-labelledby": "brief-title" });

  main.replaceChildren(h("div", { class: "page page-wide conv-page" },
    h("div", { class: "conv-layout" },
      h("section", { class: "conv-main", "aria-labelledby": "conv-title" },
        h("header", { class: "conv-head" },
          conv.project_id ? projectCrumb(conv.project_id, feature.id) : null,
          h("p", { class: "eyebrow tool-eyebrow" }, toolIcon(feature.id, 18), `${stageLabel(feature)} · ${feature.name}`),
          titleEl,
          isGeneralTemplate(conv.template) ? null
            : h("p", { class: "run-mode conv-template" }, templateBadge(templateName(conv.template)))),
        finishedNote,
        log, readyNote, composer),
      panel)));

  function message(role, text, extra = "") {
    const isUser = role === "user";
    return h("li", { class: `msg ${isUser ? "msg-user" : "msg-agent"} ${extra}`.trim() },
      isUser ? null : h("span", { class: "msg-avatar", "aria-hidden": "true" }, svg('<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.75 A9.25 9.25 0 0 0 12 21.25 Z" fill="var(--accent)"/></svg>')),
      h("div", { class: "msg-body" },
        h("p", { class: "msg-who" }, isUser ? "You" : "Research lead"),
        h("div", { class: "msg-text" }, text)));
  }

  function renderTitle() {
    titleEl.textContent = conv.brief?.business || conv.title || "New conversation";
  }

  function renderLog() {
    const items = [message("assistant", feature.greeting)];
    for (const m of conv.messages) items.push(message(m.role, m.text));
    if (pendingText != null) {
      items.push(message("user", pendingText));
      items.push(h("li", { class: "msg msg-agent msg-typing" },
        h("span", { class: "msg-avatar", "aria-hidden": "true" }),
        h("div", { class: "msg-body" },
          h("p", { class: "msg-who" }, "Research lead"),
          h("p", { class: "typing" }, h("span", { class: "visually-hidden" }, "The research lead is writing…"),
            h("span", { class: "typing-dots", "aria-hidden": "true" }, h("span"), h("span"), h("span"))))));
    }
    log.replaceChildren(...items);
  }

  function renderNotes() {
    const done = !!conv.run_id;
    composer.hidden = done;
    finishedNote.replaceChildren(done
      ? h("div", { class: "callout" },
          h("p", {}, h("strong", {}, "Research started from this brief. "), "This conversation is closed; start new research to ask something else."),
          h("div", { class: "callout-actions" },
            h("a", { class: "btn btn-primary btn-sm", href: `#/runs/${encodeURIComponent(conv.run_id)}` }, "Open report", icon("arrow")),
            h("a", { class: "btn btn-secondary btn-sm", href: "#/new" }, "New research")))
      : "");
    readyNote.replaceChildren(!done && conv.ready
      ? h("div", { class: "callout callout-ready" },
          h("p", {}, h("strong", {}, "Your brief is ready. "), "Check it, choose a research depth, then start research."),
          h("a", { class: "btn btn-secondary btn-sm only-narrow", href: "#brief", onclick: (ev) => { ev.preventDefault(); jumpToBrief(); } }, "Review brief", icon("arrow")))
      : "");
  }

  function jumpToBrief() {
    panel.scrollIntoView({ block: "start" });
    panel.querySelector("h2")?.focus();
  }

  function briefField(label, value) {
    return h("div", { class: "field" },
      h("dt", {}, label),
      h("dd", { class: value ? "" : "is-empty" }, value || "Not set yet"));
  }

  // eBay seller template: what the research lead learned about the listing (SPEC v4 brief.ebay).
  function ebayFields(e) {
    const money = (v) => (v != null && v !== "" && Number.isFinite(Number(v)) ? fmtMoney(Number(v), "USD") : "");
    let shipping = "";
    if (e.buyer_pays_shipping === true) shipping = e.shipping_cost_usd != null ? `Buyer pays, about ${money(e.shipping_cost_usd)}` : "Buyer pays";
    else if (e.buyer_pays_shipping === false) shipping = e.shipping_cost_usd != null ? `Free for the buyer; you pay about ${money(e.shipping_cost_usd)}` : "Free for the buyer";
    else if (e.shipping_cost_usd != null) shipping = `About ${money(e.shipping_cost_usd)}`;
    const sells = e.sells_on_ebay === true ? "Yes" : e.sells_on_ebay === false ? "Not yet" : "";
    return h("div", { class: "brief-ebay" },
      h("h3", {}, "For eBay"),
      h("dl", { class: "brief-fields" },
        briefField("Category", e.category),
        e.example_listing ? briefField("Example listing", e.example_listing) : null,
        briefField("Condition", e.condition),
        briefField("Target price", money(e.target_price_usd)),
        briefField("Shipping", shipping),
        briefField("Sells on eBay now", sells)));
  }

  // Food truck, Restaurant / café, Daycare / childcare and Etsy seller (SPEC v4.1): brief.<template id>.
  function templateFields(templateId, answers) {
    const spec = TEMPLATE_BRIEF_FIELDS[templateId];
    if (!spec || !answers || typeof answers !== "object") return null;
    const num = (v) => v != null && v !== "" && Number.isFinite(Number(v));
    const show = (value, kind) => {
      if (kind === "money") return num(value) ? fmtMoney(Number(value), "USD") : "";
      if (kind === "bool") return value === true ? "Yes" : value === false ? "No" : "";
      if (kind === "count") return num(value) ? Number(value).toLocaleString("en-US") : "";
      return value == null ? "" : String(value);
    };
    const rows = spec.fields.map(([key, label, kind]) => briefField(label, show(answers[key], kind)));
    if ("buyer_pays_shipping" in answers || "shipping_cost_usd" in answers) {
      const cost = num(answers.shipping_cost_usd) ? fmtMoney(Number(answers.shipping_cost_usd), "USD") : "";
      let shipping = cost ? `About ${cost}` : "";
      if (answers.buyer_pays_shipping === true) shipping = cost ? `Buyer pays, about ${cost}` : "Buyer pays";
      else if (answers.buyer_pays_shipping === false) shipping = cost ? `Free for the buyer; you pay about ${cost}` : "Free for the buyer";
      rows.push(briefField("Shipping", shipping));
    }
    const known = Array.isArray(answers.known_costs) ? answers.known_costs.filter((c) => c && c.item) : [];
    if (known.length) {
      rows.push(briefField("Costs you gave", known.map((c) => `${c.item}: ${num(c.amount_usd) ? fmtMoney(Number(c.amount_usd), "USD") : "no amount"}`).join("; ")));
    }
    return h("div", { class: "brief-ebay brief-template-fields" }, h("h3", {}, spec.title), h("dl", { class: "brief-fields" }, rows));
  }

  function depthSummary() {
    const m = MODES[mode];
    return h("p", { class: "depth-summary" },
      icon("gauge"),
      "Research depth: ", h("strong", {}, m.name), ` · ${m.time} · ${m.cost}`,
      composer.hidden ? null : " · ",
      composer.hidden ? null : h("button", {
        type: "button", class: "link-inline", "aria-controls": "depth-pop",
        onclick: () => picker.open(),
      }, "Change", h("span", { class: "visually-hidden" }, " research depth")));
  }

  function renderPanel() {
    const b = conv.brief;
    const busy = sending || starting;
    const user = state.user || {};
    const noRunsLeft = user.free_runs_left != null && Number(user.free_runs_left) <= 0;
    const questions = b && Array.isArray(b.questions) ? b.questions.filter(Boolean) : [];
    let action;
    if (conv.run_id) {
      action = h("div", { class: "panel-action" },
        h("p", { class: "panel-status" }, "Research ", statusChip(conv.run_status === "done" ? "done" : conv.run_status === "failed" ? "failed" : "running")),
        h("a", { class: "btn btn-primary btn-block", href: `#/runs/${encodeURIComponent(conv.run_id)}` }, "Open report"));
    } else {
      let help;
      if (!conv.ready) help = "Answer the research lead's questions to complete the brief.";
      else if (noRunsLeft) help = "Your free reports have been used.";
      else if (user.free_runs_left != null) {
        const n = Number(user.free_runs_left);
        help = n === 1 ? "This uses your last free report." : `This uses 1 of your ${n} free reports.`;
      } else help = "You can leave while it runs. The report appears in Recent.";
      const startBtn = h("button", {
        type: "button", class: "btn btn-primary btn-block", disabled: !conv.ready || busy,
        "aria-describedby": "start-help",
      }, starting ? "Starting…" : "Start research");
      startBtn.addEventListener("click", startResearch);
      action = h("div", { class: "panel-action" },
        depthSummary(),
        startBtn,
        h("p", { class: "field-hint", id: "start-help" }, help),
        h("p", { class: "form-error", role: "alert", id: "start-error" }));
    }
    // Header, scrollable details and the action stay separate so that on wide screens the panel fits the
    // window: the details scroll inside it and Start research is always visible at the bottom.
    const oldBody = panel.querySelector(".panel-body");
    const keepScroll = oldBody ? oldBody.scrollTop : 0;
    const body = h("div", { class: "panel-body", role: "region", "aria-labelledby": "brief-title" },
        b
          ? h("dl", { class: "brief-fields" },
              briefField("Business", b.business),
              briefField("Customer", b.customer),
              briefField("Location", b.location),
              briefField("Stage", b.stage),
              briefField("Budget (4 weeks)", b.budget_usd != null && b.budget_usd !== "" ? fmtMoney(b.budget_usd, "USD") : ""),
              briefField("Goal", b.goal))
          : h("p", { class: "muted brief-empty" }, "The brief fills in as you answer."),
        b && b.ebay && typeof b.ebay === "object" ? ebayFields(b.ebay) : null,
        b ? Object.keys(TEMPLATE_BRIEF_FIELDS).map((id) => (b[id] ? templateFields(id, b[id]) : null)) : null,
        questions.length
          ? h("div", { class: "brief-questions" },
              h("h3", {}, "Questions to research"),
              h("ol", {}, questions.map((q) => h("li", {}, q))))
          : null,
        b && !conv.run_id ? h("p", { class: "field-hint" }, "Ask in the chat to change anything in the brief.") : null);
    panel.replaceChildren(
      h("div", { class: "brief-panel-inner" },
        h("div", { class: "panel-head" },
          h("h2", { id: "brief-title", tabindex: "-1" }, "Research brief"),
          statusChip(conv.run_id ? "done" : conv.ready ? "ready" : "draft")),
        body,
        action));
    body.scrollTop = keepScroll;
    syncBriefScroll();
  }

  // The details only take a tab stop when they actually scroll (so keyboard users can scroll them).
  function syncBriefScroll() {
    const body = panel.querySelector(".panel-body");
    if (!body) return;
    const scrolls = body.scrollHeight > body.clientHeight + 1;
    body.classList.toggle("is-scrollable", scrolls);
    if (scrolls) body.setAttribute("tabindex", "0");
    else body.removeAttribute("tabindex");
  }
  if (typeof ResizeObserver === "function") new ResizeObserver(syncBriefScroll).observe(panel);

  function renderAll() {
    renderTitle();
    renderLog();
    renderNotes();
    renderPanel();
    sendBtn.disabled = sending || starting;
    input.disabled = starting;
    picker.disabled = starting;
  }

  async function send(text) {
    if (sending || starting) return;
    sending = true;
    pendingText = text;
    chatError.textContent = "";
    input.value = "";
    renderAll();
    log.lastElementChild?.scrollIntoView({ block: "nearest" });
    try {
      const data = await api("/chat", { method: "POST", body: { conv_id: conv.conv_id, message: text } });
      if (!isCurrent()) return;
      const messages = Array.isArray(data.messages)
        ? data.messages
        : [...conv.messages, { role: "user", text }, { role: "assistant", text: data.reply }];
      conv = { ...conv, messages, brief: data.brief || conv.brief, ready: !!data.ready };
      pendingText = null;
      announce(data.reply ? `Research lead: ${data.reply}` : "");
      refreshHistory();
    } catch (err) {
      if (!isCurrent()) return;
      pendingText = null;
      input.value = text;
      chatError.textContent = friendlyError(err);
    } finally {
      sending = false;
      if (isCurrent()) {
        renderAll();
        log.lastElementChild?.scrollIntoView({ block: "nearest" });
        input.focus({ preventScroll: true });
      }
    }
  }

  async function startResearch() {
    if (!conv.ready || starting) return;
    starting = true;
    renderAll();
    try {
      const { run } = await api("/runs", { method: "POST", body: { conv_id: conv.conv_id, mode } });
      setOpenConv(null);
      window.dispatchEvent(new Event("mc:refresh-me"));
      refreshHistory();
      if (isCurrent()) go(`#/runs/${encodeURIComponent(run.run_id)}`);
    } catch (err) {
      starting = false;
      if (!isCurrent()) return;
      renderAll();
      const el = document.getElementById("start-error");
      if (!el) return;
      el.replaceChildren(friendlyError(err));
      // Smarter (or a depth the server does not offer) was refused: offer Quick in one step.
      if (mode !== "quick" && ["smarter_daily_limit", "smarter_owner_only", "invalid_mode"].includes(err.code)) {
        el.append(" ", h("button", {
          type: "button", class: "btn btn-secondary btn-sm",
          onclick: () => {
            mode = "quick";
            storage.set(KEYS.mode, mode);
            picker.set("quick");
            renderPanel();
            picker.focus();
          },
        }, "Switch to Quick"));
      }
    }
  }

  composer.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) {
      chatError.textContent = "Type a message first.";
      input.focus();
      return;
    }
    send(text);
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      composer.requestSubmit();
    }
  });

  renderAll();
  // A conversation that just started keeps the cursor in the composer.
  if (!conv.run_id && conv.messages.length && !conv.ready) {
    requestAnimationFrame(() => {
      if (isCurrent() && document.activeElement === main) input.focus({ preventScroll: true });
    });
  }
  return null;
}
