// Live run view (#/runs/<id>) that turns into the report, plus the public shared report.
import {
  h, icon, setTitle, toast, copyText, statusChip, fmtDate, emptyState, trapFocus, templateBadge,
} from "./ui.js";
import { api, friendlyError } from "./api.js";
import { state, main, page, loadingBlock, announce, isOwner, rerender } from "./core.js";
import { featureById, stageLabel, MODES, templateName, isGeneralTemplate } from "./features.js";
import { renderReport } from "./report.js";
import { refreshHistory } from "./shell.js";
import { toolIcon } from "./research.js";
import { projectCrumb, openMoveDialog } from "./projects.js";

const STAGES = [
  ["planning", "Planning the research"],
  ["researching", "Reading sources"],
  ["verifying", "Checking quotes"],
  ["planning_marketing", "Drafting the plan"],
  ["checking", "Final check"],
  ["writing", "Writing the report"],
  ["done", "Done"],
];

function stageList(run) {
  const feature = featureById(run.brief?.feature || run.feature);
  const stages = feature.id === "marketing_plan" ? STAGES : STAGES.filter(([key]) => key !== "planning_marketing");
  const idx = run.status === "done" ? stages.length - 1 : stages.findIndex(([key]) => key === run.stage);
  const failed = run.status === "failed";
  return { stages, idx, failed };
}

function stepper(run) {
  const { stages, idx, failed } = stageList(run);
  return h("ol", { class: "stepper", "aria-label": "Research stages" }, stages.map(([key, label], i) => {
    let st = "upcoming";
    if (i < idx || (key === "done" && run.status === "done")) st = "complete";
    else if (i === idx) st = failed ? "failed" : "current";
    const word = { complete: "done", current: "in progress", failed: "stopped", upcoming: "not started" }[st];
    return h("li", { class: `step step-${st}`, "aria-current": st === "current" ? "step" : null },
      h("span", { class: "step-dot", "aria-hidden": "true" }, st === "complete" ? icon("check") : ""),
      h("span", { class: "step-label" }, label),
      h("span", { class: "visually-hidden" }, `: ${word}`));
  }));
}

function agentRows(agents) {
  const entries = Object.entries(agents || {});
  if (!entries.length) return h("p", { class: "muted" }, "Agents appear here once planning starts.");
  return h("ul", { class: "agent-list" },
    entries.map(([name, info]) => {
      const status = (info && info.status) || "queued";
      return h("li", { class: `agent-row agent-${status}` },
        h("div", { class: "agent-main" },
          h("p", { class: "agent-name" }, name),
          info && info.note ? h("p", { class: "agent-note" }, info.note) : null),
        statusChip(status));
    }));
}

export function viewRun(runId, isCurrent) {
  setTitle("Research run");
  main.replaceChildren(loadingBlock("Loading the run…"));
  let alive = true;
  let timer = null;
  let lastStage = null;
  let shownDone = false;
  let progressBuilt = false;
  let project = null; // {project_id, name, team_id} from GET /runs/{id} (SPEC v5)
  const started = Date.now();

  function renderProgress(run) {
    const feature = featureById(run.brief?.feature || run.feature);
    const failed = run.status === "failed";
    const mode = MODES[run.mode];
    const template = run.template || run.brief?.template;
    let statusLine;
    if (failed) statusLine = "This run stopped before it finished.";
    else if (run.status === "queued") statusLine = "Waiting for a research worker…";
    else if (run.status === "done") statusLine = "Finished. Loading the report…";
    else statusLine = "Research in progress. You can leave this page; the report appears in Recent when it is ready.";
    const { stages, idx } = stageList(run);
    const pct = run.status === "done" ? 100 : Math.max(4, Math.round(((idx < 0 ? 0 : idx) / (stages.length - 1)) * 100));

    const body = [
      failed
        ? h("div", { class: "callout callout-error", role: "alert" },
            h("p", {}, h("strong", {}, "What happened: "), run.error || "The research agents ran into a problem."),
            h("p", {}, "This run did not produce a report. ", h("a", { href: "#/new" }, "Start new research"), "."))
        : h("div", { class: "progress", "aria-hidden": "true" }, h("span", { class: "progress-bar", style: `width: ${pct}%` })),
      h("div", { class: "run-grid" },
        h("section", { class: "surface run-card", "aria-labelledby": "stages-h" },
          h("h2", { id: "stages-h" }, "Stages"),
          stepper(run)),
        h("section", { class: "surface run-card", "aria-labelledby": "agents-h" },
          h("h2", { id: "agents-h" }, "Agents"),
          agentRows(run.agents))),
    ];

    if (!progressBuilt) {
      progressBuilt = true;
      main.replaceChildren(page(
        h("header", { class: "page-head" },
          h("div", { class: "page-head-text" },
            project ? projectCrumb(project, feature.id) : null,
            h("p", { class: "eyebrow tool-eyebrow" }, toolIcon(feature.id, 18), `${stageLabel(feature)} · ${feature.name}`),
            h("h1", { tabindex: "-1" }, run.title || "Your report"),
            mode || !isGeneralTemplate(template) ? h("p", { class: "run-mode" },
              mode ? h("span", { class: "badge badge-mode" }, `${mode.name} research`) : null,
              isGeneralTemplate(template) ? null : templateBadge(templateName(template)),
              mode ? h("span", { class: "muted" }, ` usually ${mode.time}, ${mode.cost}`) : null) : null,
            h("p", { class: "lede run-status-line", role: "status" }, statusLine))),
        h("div", { class: "run-body" }, body)));
    } else {
      const line = main.querySelector(".run-status-line");
      if (line && line.textContent !== statusLine) line.textContent = statusLine;
      main.querySelector(".run-body")?.replaceChildren(...body);
    }
  }

  function renderDone(run, result) {
    setTitle(result.title || run.title || "Report");
    const mine = !run.user_sub || !state.user || run.user_sub === state.user.sub;
    const shareSlot = h("div", { class: "share-slot" });
    const actions = [];
    if (mine) {
      const shareBtn = h("button", { type: "button", class: "btn btn-secondary btn-sm" }, icon("share"), "Share");
      shareBtn.addEventListener("click", () => shareRun(run.run_id, shareBtn, shareSlot));
      actions.push(shareBtn);
    }
    const mockupBtn = h("button", { type: "button", class: "btn btn-secondary btn-sm", hidden: true }, icon("image"), "Show a mock-up");
    actions.push(mockupBtn);
    if (mine && run.conv_id) {
      actions.push(h("a", { class: "btn btn-ghost btn-sm", href: `#/c/${encodeURIComponent(run.conv_id)}` }, icon("chat"), "Conversation"));
    }
    if (mine) {
      actions.push(h("button", {
        type: "button", class: "btn btn-ghost btn-sm", "aria-haspopup": "dialog",
        onclick: () => openMoveDialog({ kind: "run", id: run.run_id, current: project?.project_id || run.project_id || null, onMoved: () => rerender() }),
      }, icon("folder"), "Move to project"));
    }
    const mockupReason = h("p", { class: "field-hint", id: "mockup-reason", hidden: true });
    actions.push(mockupReason, shareSlot);
    const mockupSection = h("div", { class: "mockups" });
    const feature = featureById(result.feature || run.brief?.feature || run.feature);
    const crumb = project ? projectCrumb(project, feature.id) : null;
    const article = renderReport(result, { run, actions, mockups: mockupSection, crumb });
    main.replaceChildren(page(article));
    // The Mock-ups section (and its contents link) appear only once an image exists.
    const sectionEl = mockupSection.closest("section");
    const tocItem = main.querySelector('.report-toc a[href="#r-mockups"]')?.parentElement;
    const showSection = (on) => {
      if (sectionEl) sectionEl.hidden = !on;
      if (tocItem) tocItem.hidden = !on;
    };
    showSection(false);
    if (mine) setupMockups(run, { button: mockupBtn, reason: mockupReason, container: mockupSection, showSection });
  }

  async function tick() {
    try {
      const data = await api(`/runs/${encodeURIComponent(runId)}`);
      if (!alive || !isCurrent()) return;
      const run = data.run || {};
      const result = data.result || null;
      project = data.project && data.project.project_id ? data.project : (run.project_id ? { project_id: run.project_id } : null);
      if (run.status === "done" && result) {
        if (!shownDone) {
          shownDone = true;
          const wasLive = progressBuilt;
          renderDone(run, result);
          if (wasLive) {
            announce("Your report is ready.");
            refreshHistory();
            main.querySelector("h1")?.focus({ preventScroll: true });
          }
        }
        return;
      }
      const stageKey = run.status === "failed" ? "failed" : run.stage || run.status;
      if (stageKey !== lastStage) {
        if (lastStage !== null) {
          const label = (STAGES.find(([k]) => k === run.stage) || [null, null])[1];
          announce(run.status === "failed" ? "The run stopped." : label ? `Now: ${label}` : "Waiting to start");
        }
        lastStage = stageKey;
      }
      renderProgress(run);
      if (run.status === "failed") {
        refreshHistory();
        return;
      }
    } catch (err) {
      if (!alive || !isCurrent()) return;
      if (err.status === 401) return;
      if (err.status === 404 || err.status === 403) {
        setTitle("Report not found");
        main.replaceChildren(page(emptyState({
          title: "Report not found", headingLevel: 1,
          text: "This report does not exist, is still private to its author, or belongs to another account.",
          action: h("a", { class: "btn btn-secondary", href: "#/runs" }, "Go to My reports"),
        })));
        main.querySelector("h1")?.setAttribute("tabindex", "-1");
        return;
      }
      const warning = `${friendlyError(err)} We will keep trying.`;
      const old = main.querySelector(".poll-warning");
      const el = h("p", { class: "callout callout-warn poll-warning", role: "status" }, warning);
      if (old) old.replaceWith(el);
      else main.querySelector(".page")?.prepend(el);
    }
    // Poll every 3 s; slow down after ten minutes.
    if (alive) timer = setTimeout(tick, Date.now() - started > 600000 ? 10000 : 3000);
  }

  tick();
  return () => {
    alive = false;
    clearTimeout(timer);
  };
}

async function shareRun(runId, btn, slot) {
  btn.disabled = true;
  try {
    const data = await api(`/runs/${encodeURIComponent(runId)}/share`, { method: "POST" });
    let url;
    try {
      url = data.url ? new URL(data.url, location.origin).href : null;
    } catch {
      url = null;
    }
    if (!url) url = `${location.origin}${location.pathname}${location.search}#/shared/${encodeURIComponent(data.token)}`;
    const copied = await copyText(url);
    const field = h("input", { type: "text", readonly: true, class: "share-url", "aria-label": "Share link", value: url });
    field.addEventListener("focus", () => field.select());
    slot.replaceChildren(
      h("p", { class: "field-hint" },
        copied ? "Link copied. Anyone with it can read this report." : "Copy this link to share the report."),
      field);
    toast(copied ? "Share link copied." : "Share link ready. Copy it from the box.");
    if (!copied) field.focus();
  } catch (err) {
    slot.replaceChildren(h("p", { class: "form-error", role: "alert" }, friendlyError(err)));
  } finally {
    btn.disabled = false;
  }
}

// ---- Mock-ups (optional; hidden when the endpoint answers 503) -------------------

const MOCKUP_KINDS = [
  ["product", "Product photo", "The product on its own, as a studio shot"],
  ["listing", "Marketplace listing", "A listing image with a plain background"],
  ["ad", "Social ad", "A square ad image for a social post"],
];
const MAX_MOCKUPS = 3;

function mockupFigure(m) {
  const kind = MOCKUP_KINDS.find(([k]) => k === m.prompt_kind);
  return h("figure", { class: "mockup" },
    h("div", { class: "mockup-frame" },
      h("img", { src: m.url, alt: `AI mock-up${kind ? ` (${kind[1].toLowerCase()})` : ""}: ${m.prompt || "generated image"}`, loading: "lazy", decoding: "async" }),
      h("span", { class: "mockup-flag", "aria-hidden": "true" }, "AI mock-up")),
    h("figcaption", {},
      h("strong", {}, "AI mock-up — not a real product photo."),
      h("span", { class: "muted" }, ` ${kind ? kind[1] : "Image"} · ${fmtDate(m.created_at)}`)));
}

// Hidden entirely when the endpoint answers 503 (no OpenAI key) or 404.
async function setupMockups(run, { button, reason, container, showSection }) {
  let items;
  try {
    const data = await api(`/runs/${encodeURIComponent(run.run_id)}/mockups`);
    items = Array.isArray(data.mockups) ? data.mockups : [];
    // enabled is false when the server has no image key or this viewer cannot make pictures.
    if (data.enabled === false && !items.length) return;
  } catch (err) {
    if (err.status !== 403) return;
    items = [];
  }
  if (!button.isConnected) return;
  const owner = isOwner();
  const count = h("p", { class: "field-hint", id: "mockup-count" });
  const grid = h("div", { class: "mockup-grid" });
  function render() {
    grid.replaceChildren(...items.map(mockupFigure));
    const full = items.length >= MAX_MOCKUPS;
    button.disabled = !owner || full;
    reason.hidden = owner && !full;
    reason.textContent = !owner
      ? "Mock-ups are limited to owner accounts for now."
      : full ? `This report has the maximum of ${MAX_MOCKUPS} mock-ups.` : "";
    count.textContent = `${items.length} of ${MAX_MOCKUPS} mock-ups used. Each image is an illustration made by an AI model from your brief.`;
    if (reason.hidden) button.removeAttribute("aria-describedby");
    else button.setAttribute("aria-describedby", "mockup-reason");
    showSection(items.length > 0);
  }
  container.replaceChildren(count, grid);
  button.hidden = false;
  render();
  button.addEventListener("click", () => openMockupDialog(run, (m) => {
    items.push(m);
    render();
    const fig = grid.lastElementChild;
    fig?.scrollIntoView({ block: "center" });
    toast("Mock-up ready. It is labelled as an AI image.");
  }));
}

function openMockupDialog(run, onCreated) {
  let dlg = document.getElementById("mockup-dialog");
  if (!dlg) {
    dlg = h("dialog", { id: "mockup-dialog", class: "dialog", "aria-labelledby": "mockup-dialog-title" });
    document.body.append(dlg);
    trapFocus(dlg);
  }
  const opener = document.activeElement;
  let busy = false;
  const status = h("p", { class: "field-hint", role: "status" });
  const error = h("p", { class: "form-error", role: "alert" });
  const submit = h("button", { type: "submit", class: "btn btn-primary" }, "Create mock-up");
  const cancel = h("button", { type: "button", class: "btn btn-secondary", onclick: () => close() }, "Cancel");
  const form = h("form", { class: "stack" },
    h("fieldset", { class: "option-list" },
      h("legend", {}, "What should it show?"),
      MOCKUP_KINDS.map(([key, label, hint], i) => h("label", { class: "option-row", for: `mk-${key}` },
        h("input", { type: "radio", name: "prompt_kind", id: `mk-${key}`, value: key, checked: i === 0 }),
        h("span", { class: "option-text" }, h("span", { class: "option-label" }, label), h("span", { class: "option-hint" }, hint))))),
    h("p", { class: "note" }, "The image is made by an AI model from your brief. It is labelled “AI mock-up — not a real product photo” everywhere it appears."),
    status, error,
    h("div", { class: "form-actions form-actions-end" }, cancel, submit));
  function close() {
    if (busy) return;
    if (dlg.open) dlg.close();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (busy) return;
    busy = true;
    submit.disabled = true;
    cancel.disabled = true;
    error.textContent = "";
    status.textContent = "Creating the mock-up. This can take up to a minute…";
    const kind = form.querySelector("input[name=prompt_kind]:checked")?.value || "product";
    try {
      const m = await api(`/runs/${encodeURIComponent(run.run_id)}/mockup`, { method: "POST", body: { prompt_kind: kind } });
      busy = false;
      close();
      onCreated({ prompt_kind: kind, ...m });
    } catch (err) {
      busy = false;
      submit.disabled = false;
      cancel.disabled = false;
      status.textContent = "";
      error.textContent = friendlyError(err);
    }
  });
  dlg.replaceChildren(
    h("div", { class: "dialog-head" },
      h("h2", { id: "mockup-dialog-title" }, "Show a mock-up"),
      h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onclick: () => close() }, icon("close"))),
    form);
  dlg.oncancel = (ev) => { ev.preventDefault(); close(); };
  dlg.showModal();
  form.querySelector("input")?.focus();
}

// ---- Shared report (public) ----------------------------------------------------

export async function viewShared(token, isCurrent) {
  setTitle("Shared report");
  main.replaceChildren(loadingBlock("Loading the shared report…"));
  let data;
  try {
    data = await api(`/shared/${encodeURIComponent(token)}`, { quiet401: true });
  } catch (err) {
    if (!isCurrent()) return;
    main.replaceChildren(page(emptyState({
      title: "This link does not work", headingLevel: 1,
      text: err.status === 404 ? "The link may be mistyped, or the report is no longer shared." : friendlyError(err),
      action: h("a", { class: "btn btn-secondary", href: "#/" }, "Go to MarketClue"),
    })));
    main.querySelector("h1")?.setAttribute("tabindex", "-1");
    return;
  }
  if (!isCurrent()) return;
  const run = data.run || {};
  if (!data.result) {
    main.replaceChildren(page(emptyState({
      title: run.title || "Shared report", headingLevel: 1,
      text: "This report is not finished yet. Check the link again in a few minutes.",
    })));
    main.querySelector("h1")?.setAttribute("tabindex", "-1");
    return;
  }
  setTitle(data.result.title || run.title || "Shared report");
  main.replaceChildren(page(
    renderReport(data.result, { run, shared: true }),
    state.user
      ? null
      : h("aside", { class: "cta surface", "aria-labelledby": "cta-h" },
          h("h2", { id: "cta-h" }, "Research your own market"),
          h("p", { class: "muted" }, "Get a sourced report for your business. Your first one is free."),
          h("a", { class: "btn btn-primary", href: "#/" }, "Try MarketClue"))));
}

