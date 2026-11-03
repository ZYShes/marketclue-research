// MarketClue single-page app: hash router, header, and the views.

import {
  h, icon, svg, ICONS, storage, setTitle, toast, copyText, externalLink, domainOf,
  fmtDate, fmtDateTime, fmtMoney, fmtCost, isStale, plural, initials,
  typeBadge, staleBadge, statusPill, hideToast,
  initializeReadingPreferences, hasReadingPreferences, renderWelcome, openReadingDialog,
} from "./ui.js";
import { api, ApiError, MOCK, onUnauthorized, friendlyError } from "./api.js";
import { renderReport, closeCardPanel } from "./report.js";
import { FEATURES, featureById } from "./features.js";
import { landingPage, toolJourney } from "./landing.js";

const cfg = window.MC_CONFIG || {};
const main = document.getElementById("main");
const headerEl = document.getElementById("site-header");
const liveEl = document.getElementById("live");

const KEY_CONV = "mc_conv_id";
const KEY_AFTER_LOGIN = "mc_after_login";
const PROTECTED = new Set(["home", "new", "runs", "library"]);

const state = { user: null, bootError: null };
let cleanup = null;
let renderSeq = 0;
let firstRender = true;

// ---- Routing ---------------------------------------------------------------

function parseRoute() {
  const hash = location.hash || "#/";
  if (!hash.startsWith("#/")) return null; // in-page anchor, not a route
  return hash.slice(2).split("?")[0].split("/").filter(Boolean).map((p) => {
    try { return decodeURIComponent(p); } catch { return p; }
  });
}

function go(hash, replace = false) {
  if (replace) {
    history.replaceState(null, "", hash);
    router();
  } else if (location.hash === hash) {
    router();
  } else {
    location.hash = hash;
  }
}

function announce(text) {
  if (liveEl) liveEl.textContent = text;
}

async function router() {
  const parts = parseRoute();
  if (!parts) return;
  if (cleanup) {
    try { cleanup(); } catch { /* ignore */ }
    cleanup = null;
  }
  closeCardPanel();
  hideToast();
  const seq = ++renderSeq;
  const isCurrent = () => seq === renderSeq;
  const [head = "", arg] = parts;

  if (!head && state.user) return go("#/home", true);
  if (PROTECTED.has(head) && !state.user) {
    storage.set(KEY_AFTER_LOGIN, location.hash);
    return go("#/", true);
  }

  renderHeader(head);
  if (!firstRender) {
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }
  firstRender = false;

  let result;
  if (!head) result = viewLanding(isCurrent);
  else if (head === "home") result = viewHome(isCurrent);
  else if (head === "new" && arg && FEATURES.some((feature) => feature.id === arg)) result = viewNew(isCurrent, arg);
  else if (head === "new" && !arg) result = viewToolPicker();
  else if (head === "runs" && arg) result = viewRun(arg, isCurrent);
  else if (head === "runs") result = viewRuns(isCurrent);
  else if (head === "library") result = viewLibrary(isCurrent);
  else if (head === "shared" && arg) result = viewShared(arg, isCurrent);
  else result = viewNotFound();

  if (typeof result === "function") cleanup = result;
  else if (result && typeof result.then === "function") {
    result.then((fn) => {
      if (typeof fn === "function") {
        if (isCurrent()) cleanup = fn;
        else fn();
      }
    }).catch((err) => {
      if (isCurrent()) showPageError(err);
    });
  }
}

function showPageError(err) {
  if (err instanceof ApiError && err.status === 401) return; // handled globally
  main.replaceChildren(
    h("div", { class: "wrap page" },
      h("div", { class: "empty" },
        h("h1", {}, "Something went wrong"),
        h("p", {}, friendlyError(err)),
        h("button", { type: "button", class: "btn btn-secondary", onclick: () => router() }, "Try again")))
  );
}

function loadingBlock(text = "Loading…") {
  return h("div", { class: "wrap page" }, h("p", { class: "loading", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), text));
}

// ---- Header ----------------------------------------------------------------

function wordmark() {
  return h("a", { class: "wordmark", href: state.user ? "#/home" : "#/" },
    svg(ICONS.mark),
    h("span", { class: "wordmark-text" }, "MarketClue"));
}

function runsLeftText(user) {
  if (!user) return "";
  if (user.free_runs_left == null) return "Unlimited reports";
  const n = Number(user.free_runs_left) || 0;
  return n > 0 ? `${plural(n, "free report")} left` : "Free report used";
}

function avatar(user, size = "") {
  const fallback = h("span", { class: `avatar avatar-initials ${size}`.trim(), "aria-hidden": "true" }, initials(user));
  if (!user.picture) return fallback;
  const img = h("img", {
    class: `avatar ${size}`.trim(), src: user.picture, alt: "", width: 32, height: 32,
    referrerpolicy: "no-referrer", decoding: "async",
  });
  img.addEventListener("error", () => img.replaceWith(fallback), { once: true });
  return img;
}

function userMenu(user) {
  const menuId = "user-menu";
  const btn = h("button", {
    type: "button", class: "avatar-btn", "aria-haspopup": "true", "aria-expanded": "false",
    "aria-controls": menuId, "aria-label": `Account: ${user.name || user.email}`,
  }, avatar(user));
  const signOutBtn = h("button", { type: "button", class: "menu-item", onclick: signOut }, "Sign out");
  const menu = h("div", { class: "user-menu", id: menuId, hidden: true },
    h("div", { class: "user-menu-head" },
      avatar(user, "avatar-lg"),
      h("div", {},
        user.name ? h("p", { class: "user-name" }, user.name) : null,
        h("p", { class: "user-email" }, user.email || ""))),
    h("p", { class: "user-runs" }, runsLeftText(user)),
    signOutBtn);

  function setOpen(open) {
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) {
      signOutBtn.focus();
      document.addEventListener("click", onDoc, true);
      document.addEventListener("keydown", onKey);
    } else {
      document.removeEventListener("click", onDoc, true);
      document.removeEventListener("keydown", onKey);
    }
  }
  function onDoc(ev) {
    if (!menu.contains(ev.target) && !btn.contains(ev.target)) setOpen(false);
  }
  function onKey(ev) {
    if (ev.key === "Escape") {
      setOpen(false);
      btn.focus();
    }
  }
  btn.addEventListener("click", () => setOpen(menu.hidden));
  return h("div", { class: "user-menu-wrap" }, btn, menu);
}

function renderHeader(route = "") {
  const user = state.user;
  const navLink = (href, label, key) =>
    h("a", { href, class: "nav-link", "aria-current": route === key ? "page" : null }, label);

  const right = [h("button", {
    type: "button", class: "btn btn-reading", "aria-haspopup": "dialog",
    "aria-controls": "reading-dialog", onclick: openReadingDialog,
  }, "Reading & motion")];
  if (user) right.push(userMenu(user));
  else if (route) right.push(h("a", { class: "btn btn-secondary", href: "#/" }, "Sign in"));

  headerEl.replaceChildren(
    h("div", { class: "wrap header-inner" },
      wordmark(),
      user
        ? h("nav", { class: "main-nav", "aria-label": "Main" },
            navLink("#/home", "Home", "home"),
            navLink("#/new", "New research", "new"),
            navLink("#/runs", "My reports", "runs"),
            navLink("#/library", "Fact library", "library"))
        : null,
      h("div", { class: "header-right" }, right))
  );
}

async function refreshMe() {
  try {
    const { user } = await api("/me", { quiet401: true });
    state.user = user || null;
  } catch { /* keep current */ }
  const parts = parseRoute();
  renderHeader(parts ? parts[0] || "" : "");
}

// ---- Auth ------------------------------------------------------------------

let gsiPromise = null;
let gsiInitialized = false;

function loadGsi() {
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve(window.google);
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => (window.google && window.google.accounts ? resolve(window.google) : reject(new Error("gsi")));
    script.onerror = () => {
      gsiPromise = null;
      reject(new Error("gsi"));
    };
    document.head.append(script);
  });
  return gsiPromise;
}

let signInStatusEl = null;

async function onGoogleCredential(response) {
  if (signInStatusEl) signInStatusEl.textContent = "Signing you in…";
  try {
    const { user } = await api("/auth/google", { method: "POST", body: { credential: response.credential }, quiet401: true });
    afterLogin(user);
  } catch (err) {
    if (signInStatusEl) {
      signInStatusEl.textContent = err instanceof ApiError && err.status === 401
        ? "Google sign-in did not go through. Please try again."
        : friendlyError(err);
    }
  }
}

function afterLogin(user) {
  state.user = user;
  const next = storage.get(KEY_AFTER_LOGIN);
  storage.remove(KEY_AFTER_LOGIN);
  go(next && next.startsWith("#/") && next !== "#/" ? next : "#/home", true);
}

function mountSignIn(container) {
  const status = h("p", { class: "signin-status", role: "status" });
  signInStatusEl = status;

  if (MOCK) {
    const btn = h("button", { type: "button", class: "btn btn-primary btn-lg" }, "Continue as demo user");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const { user } = await api("/auth/google", { method: "POST", body: { credential: "mock" }, quiet401: true });
        afterLogin(user);
      } catch (err) {
        status.textContent = friendlyError(err);
        btn.disabled = false;
      }
    });
    container.replaceChildren(btn, h("p", { class: "fine" }, "Sample account. No Google sign-in needed."), status);
    return;
  }

  const slot = h("div", { class: "gsi-slot" }, h("span", { class: "gsi-placeholder" }, "Loading Google sign-in…"));
  container.replaceChildren(slot, status);
  if (!cfg.googleClientId) {
    slot.replaceChildren();
    status.textContent = "Sign-in is not configured for this site yet.";
    return;
  }
  loadGsi().then((google) => {
    if (!slot.isConnected) return;
    if (!gsiInitialized) {
      google.accounts.id.initialize({
        client_id: cfg.googleClientId,
        callback: onGoogleCredential,
        ux_mode: "popup",
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      gsiInitialized = true;
    }
    slot.replaceChildren();
    const width = Math.max(220, Math.min(320, Math.floor(container.getBoundingClientRect().width) || 320));
    google.accounts.id.renderButton(slot, {
      type: "standard", theme: "outline", size: "large", text: "signin_with",
      shape: "pill", logo_alignment: "left", width,
    });
  }).catch(() => {
    slot.replaceChildren();
    status.textContent = "Google sign-in could not load. Check your connection or content blocker, then reload the page.";
  });
}

async function signOut() {
  try { await api("/auth/logout", { method: "POST", quiet401: true }); } catch { /* ignore */ }
  try { window.google && window.google.accounts && window.google.accounts.id.disableAutoSelect(); } catch { /* ignore */ }
  state.user = null;
  storage.remove(KEY_CONV);
  FEATURES.forEach(({ id }) => storage.remove(`${KEY_CONV}_${id}`));
  go("#/", true);
  toast("You are signed out.");
}

onUnauthorized(() => {
  if (!state.user) return;
  state.user = null;
  const parts = parseRoute();
  if (parts && PROTECTED.has(parts[0] || "")) storage.set(KEY_AFTER_LOGIN, location.hash);
  go("#/", true);
  toast("Your session has ended. Please sign in again.");
});

// ---- Landing ---------------------------------------------------------------

function viewLanding() {
  setTitle("");
  const signin = h("div", { class: "signin" });
  main.replaceChildren(landingPage(signin, state.bootError));
  mountSignIn(signin);
}

function beginFeature(feature) {
  // Selecting a tool always starts fresh; a reload can resume that tool's draft.
  storage.remove(`${KEY_CONV}_${feature}`);
}

function viewToolPicker() {
  setTitle("Choose a tool");
  main.replaceChildren(h("div", { class: "wrap page" },
    h("div", { class: "page-head" }, h("p", { class: "eyebrow" }, "New research"),
      h("h1", {}, "What do you want to find out?"),
      h("p", { class: "lede-sm" }, "Choose a tool to start your brief.")),
    toolJourney({ interactive: true, onChoose: beginFeature })));
}

function viewHome(isCurrent) {
  setTitle("Home");
  const name = (state.user.name || "").trim().split(/\s+/)[0];
  const reportCount = h("span", { class: "entry-count", role: "status" }, "Loading…");
  const cardCount = h("span", { class: "entry-count", role: "status" }, "Loading…");
  const quota = h("p", { class: "home-quota" }, state.user.is_owner ? "" : runsLeftText(state.user));
  const savedTile = (href, label, count) => h("a", { class: "saved-tile", href },
    h("h2", {}, label), count, h("span", { class: "entry-arrow", "aria-hidden": "true" }, "↗"));
  main.replaceChildren(h("div", { class: "wrap page home-page" },
    h("div", { class: "page-head" }, h("p", { class: "eyebrow" }, "Your workspace"),
      h("h1", {}, name ? `Welcome back, ${name}.` : "Welcome back."), quota),
    toolJourney({ interactive: true, onChoose: beginFeature }),
    h("section", { class: "saved-grid", "aria-label": "Your saved research" },
      savedTile("#/runs", "My reports", reportCount), savedTile("#/library", "Fact library", cardCount))));
  Promise.allSettled([api("/runs"), api("/cards"), api("/me")]).then(([runs, cards, me]) => {
    if (!isCurrent()) return;
    reportCount.textContent = runs.status === "fulfilled" ? plural((runs.value.runs || []).length, "report") : "Count unavailable";
    cardCount.textContent = cards.status === "fulfilled" ? plural((cards.value.cards || []).length, "fact card") : "Count unavailable";
    if (me.status === "fulfilled" && me.value.user) {
      state.user = me.value.user;
      quota.textContent = state.user.is_owner ? "" : runsLeftText(state.user);
      renderHeader("home");
    }
  });
}

// ---- New research (super-agent chat) --------------------------------------

function viewNew(isCurrent, featureId) {
  const feature = featureById(featureId);
  const convKey = `${KEY_CONV}_${featureId}`;
  setTitle(feature.name);
  let conv = { conv_id: storage.get(convKey), feature: featureId, messages: [], brief: null, ready: false };
  let sending = false;
  let starting = false;
  let restoring = !!conv.conv_id;
  let pendingText = null;

  const log = h("ol", { class: "messages", "aria-label": "Conversation with the research agent" });
  const logBox = h("div", { class: "chat-log", tabindex: "0", role: "region", "aria-label": "Conversation" }, log);
  const input = h("textarea", {
    id: "chat-input", rows: "3", maxlength: "2000", autocomplete: "off",
    placeholder: "For example: Handmade planters for Seattle plant lovers.",
  });
  const sendBtn = h("button", { type: "submit", class: "btn btn-primary" }, "Send");
  const chatError = h("p", { class: "form-error", role: "alert" });
  const form = h("form", { class: "composer", novalidate: true },
    h("label", { for: "chat-input", class: "composer-label" }, "Your message"),
    input,
    h("div", { class: "composer-row" },
      h("p", { class: "hint" }, "Enter to send, Shift + Enter for a new line"),
      sendBtn),
    chatError);
  const briefCol = h("div", { class: "brief-col" });
  const resetBtn = h("button", { type: "button", class: "btn btn-quiet", onclick: startOver }, "Start over");

  main.replaceChildren(
    h("div", { class: "wrap page" },
      h("div", { class: "page-head page-head-row" },
        h("div", {},
          h("p", { class: "eyebrow" }, "New research"),
          h("h1", {}, feature.name),
          h("p", { class: "lede-sm" }, feature.question)),
        resetBtn),
      h("div", { class: "chat-layout" },
        h("section", { class: "chat-col", "aria-label": "Chat" }, logBox, form),
        briefCol))
  );

  function message(role, text, extraClass = "") {
    const isUser = role === "user";
    return h("li", { class: `msg ${isUser ? "msg-user" : "msg-agent"} ${extraClass}`.trim() },
      h("p", { class: "msg-who" }, isUser ? "You" : "Research agent"),
      h("div", { class: "msg-text" }, text));
  }

  function renderLog() {
    const items = [message("assistant", feature.greeting)];
    for (const m of conv.messages || []) items.push(message(m.role, m.text));
    if (pendingText != null) {
      items.push(message("user", pendingText));
      items.push(h("li", { class: "msg msg-agent msg-typing", "aria-label": "The research agent is typing" },
        h("p", { class: "msg-who" }, "Research agent"),
        h("div", { class: "typing", "aria-hidden": "true" }, h("span"), h("span"), h("span"))));
    }
    log.replaceChildren(...items);
    logBox.scrollTop = logBox.scrollHeight;
  }

  function briefField(label, value, empty = "Not set yet") {
    return h("div", { class: "field" },
      h("dt", {}, label),
      h("dd", { class: value ? "" : "is-empty" }, value || empty));
  }

  function renderBrief() {
    resetBtn.disabled = sending || starting || restoring;
    sendBtn.disabled = sending || starting || restoring;
    input.disabled = starting || restoring;
    const b = conv.brief;
    const ready = !!conv.ready;
    const user = state.user || {};
    const noRunsLeft = user.free_runs_left != null && Number(user.free_runs_left) <= 0;
    const startBtn = h("button", {
      type: "button", class: "btn btn-primary btn-block",
      disabled: !ready || starting || sending || restoring, "aria-describedby": "start-help",
    }, starting ? "Starting…" : "Start research");
    startBtn.addEventListener("click", startResearch);
    const startError = h("p", { class: "form-error", role: "alert", id: "start-error" });

    let help;
    if (!ready) help = "Complete the brief to start.";
    else if (noRunsLeft) help = "Your free report has been used.";
    else if (user.free_runs_left != null) {
      const n = Number(user.free_runs_left);
      help = n === 1 ? "This uses your free report." : `This uses 1 of your ${n} free reports.`;
    }
    else help = "Research takes a few minutes.";

    const questions = b && Array.isArray(b.questions) ? b.questions.filter(Boolean) : [];
    briefCol.replaceChildren(
      h("section", { class: `brief-card${ready ? " is-ready" : ""}`, "aria-labelledby": "brief-title" },
        h("div", { class: "brief-head" },
          h("h2", { id: "brief-title" }, "Research brief"),
          h("span", { class: `status ${ready ? "status-done" : "status-queued"}` }, ready ? "Ready" : "In progress")),
        b
          ? h("dl", { class: "brief-fields" },
              briefField("Business", b.business),
              briefField("Customer", b.customer),
              briefField("Location", b.location),
              briefField("Stage", b.stage),
              briefField("Marketing budget", b.budget_usd != null && b.budget_usd !== "" ? fmtMoney(b.budget_usd, "USD") : ""),
              briefField("Goal", b.goal))
          : h("p", { class: "brief-empty" }, "Your brief will appear here."),
        questions.length
          ? h("div", { class: "brief-questions" },
              h("h3", {}, "Questions to research"),
              h("ol", {}, questions.map((q) => h("li", {}, q))))
          : null,
        b ? h("p", { class: "fine" }, "Ask in chat to change the brief.") : null,
        startBtn,
        h("p", { class: "fine start-help", id: "start-help" }, help),
        startError)
    );
  }

  function renderAll() {
    renderLog();
    renderBrief();
  }

  async function send(text) {
    if (sending || starting || restoring) return;
    sending = true;
    pendingText = text;
    chatError.textContent = "";
    sendBtn.disabled = true;
    input.value = "";
    renderAll();
    try {
      const body = { message: text };
      if (conv.conv_id) body.conv_id = conv.conv_id;
      else body.feature = featureId;
      const data = await api("/chat", { method: "POST", body });
      if (!isCurrent()) return;
      const messages = Array.isArray(data.messages)
        ? data.messages
        : [...(conv.messages || []), { role: "user", text }, { role: "assistant", text: data.reply }];
      conv = { conv_id: data.conv_id || conv.conv_id, feature: data.feature || featureId, messages, brief: data.brief || null, ready: !!data.ready };
      if (conv.conv_id) storage.set(convKey, conv.conv_id);
      pendingText = null;
      announce(data.reply ? `Research agent: ${data.reply}` : "");
    } catch (err) {
      if (!isCurrent()) return;
      pendingText = null;
      input.value = text;
      chatError.textContent = friendlyError(err);
    } finally {
      sending = false;
      sendBtn.disabled = false;
      if (isCurrent()) {
        renderAll();
        input.focus();
      }
    }
  }

  async function startResearch() {
    if (!conv.ready || starting) return;
    starting = true;
    renderBrief();
    try {
      const { run } = await api("/runs", { method: "POST", body: { conv_id: conv.conv_id } });
      storage.remove(convKey);
      refreshMe();
      if (isCurrent()) go(`#/runs/${encodeURIComponent(run.run_id)}`);
    } catch (err) {
      starting = false;
      if (!isCurrent()) return;
      renderBrief();
      const el = document.getElementById("start-error");
      if (el) el.textContent = friendlyError(err);
      const help = document.getElementById("start-help");
      if (help) help.hidden = true;
    }
  }

  function startOver() {
    storage.remove(convKey);
    conv = { conv_id: null, feature: featureId, messages: [], brief: null, ready: false };
    chatError.textContent = "";
    renderAll();
    input.focus();
  }

  form.addEventListener("submit", (ev) => {
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
      form.requestSubmit();
    }
  });

  renderAll();

  if (conv.conv_id) {
    api(`/conversations/${encodeURIComponent(conv.conv_id)}`).then((data) => {
      if (!isCurrent()) return;
      const c = data.conversation || data;
      if (c.feature && c.feature !== featureId) return startOver();
      conv = {
        feature: c.feature || featureId,
        conv_id: c.conv_id || conv.conv_id,
        messages: Array.isArray(c.messages) ? c.messages : [],
        brief: c.brief || null,
        ready: !!c.ready,
      };
      renderAll();
    }).catch((err) => {
      if (!isCurrent()) return;
      if (err.status === 404) {
        storage.remove(convKey);
        conv = { conv_id: null, feature: featureId, messages: [], brief: null, ready: false };
        renderAll();
      } else if (err.status !== 401) {
        chatError.textContent = friendlyError(err);
      }
    }).finally(() => {
      if (!isCurrent()) return;
      restoring = false;
      renderAll();
    });
  }
}

// ---- Run view --------------------------------------------------------------

const STAGES = [
  ["planning", "Planning"],
  ["researching", "Researching"],
  ["verifying", "Verifying quotes"],
  ["planning_marketing", "Marketing plan"],
  ["checking", "Final check"],
  ["writing", "Writing"],
  ["done", "Done"],
];

function stepper(run) {
  const feature = featureById(run.brief?.feature || run.feature);
  const stages = feature.id === "marketing_plan" ? STAGES : STAGES.filter(([key]) => key !== "planning_marketing");
  const idx = run.status === "done" ? stages.length - 1 : stages.findIndex(([key]) => key === run.stage);
  const failed = run.status === "failed";
  const items = stages.map(([key, label], i) => {
    let st = "upcoming";
    if (i < idx || (key === "done" && run.status === "done")) st = "complete";
    else if (i === idx) st = failed ? "failed" : "current";
    const word = { complete: "done", current: "in progress", failed: "stopped", upcoming: "not started" }[st];
    return h("li", { class: `step step-${st}`, "aria-current": st === "current" ? "step" : null },
      h("span", { class: "step-dot", "aria-hidden": "true" }, st === "complete" ? icon("check") : String(i + 1)),
      h("span", { class: "step-label" }, label),
      h("span", { class: "visually-hidden" }, `: ${word}`));
  });
  let caption;
  if (run.status === "queued" || idx < 0) caption = "Waiting to start";
  else caption = `Step ${idx + 1} of ${stages.length}: ${stages[idx][1]}${failed ? " (stopped)" : ""}`;
  return h("div", { class: "stepper-wrap" },
    h("ol", { class: "stepper", "aria-label": "Research stages", style: `--stage-count: ${stages.length}` }, items),
    h("p", { class: "stepper-caption", "aria-hidden": "true" }, caption));
}

function agentRows(agents) {
  const entries = Object.entries(agents || {});
  if (!entries.length) return h("p", { class: "muted" }, "Agents appear here once planning starts.");
  return h("ul", { class: "agent-list" },
    entries.map(([name, info]) => {
      const status = (info && info.status) || "queued";
      return h("li", { class: `agent-row agent-${status}` },
        h("span", { class: "agent-dot", "aria-hidden": "true" }),
        h("div", { class: "agent-main" },
          h("p", { class: "agent-name" }, name),
          info && info.note ? h("p", { class: "agent-note" }, info.note) : null),
        statusPill(status));
    }));
}

function viewRun(runId, isCurrent) {
  setTitle("Research run");
  main.replaceChildren(loadingBlock("Loading the run…"));
  let alive = true;
  let timer = null;
  let lastStage = null;
  let shownDone = false;

  function renderProgress(run, warning) {
    const failed = run.status === "failed";
    let statusLine;
    if (failed) statusLine = "This run stopped before it finished.";
    else if (run.status === "queued") statusLine = "Waiting for a research worker…";
    else if (run.status === "done") statusLine = "Finished. Loading the report…";
    else statusLine = "Research in progress. This may take a few minutes.";

    main.replaceChildren(
      h("div", { class: "wrap page run-page" },
        h("div", { class: "page-head" },
          h("p", { class: "eyebrow" }, featureById(run.brief?.feature || run.feature).name),
          h("h1", {}, run.title || "Your report"),
          h("p", { class: "muted", role: "status" }, statusLine)),
        warning ? h("p", { class: "banner banner-warn", role: "status" }, warning) : null,
        failed
          ? h("div", { class: "banner banner-error", role: "alert" },
              h("p", {}, run.error ? `What happened: ${run.error}` : "The research agents ran into a problem."),
              h("p", {}, "This run did not produce a report. ", h("a", { href: "#/new" }, "Start a new research brief"), "."))
          : null,
        stepper(run),
        h("section", { class: "agents-section", "aria-labelledby": "agents-h" },
          h("h2", { id: "agents-h" }, "Agents"),
          agentRows(run.agents)),
        !failed
          ? h("p", { class: "fine" },
              "Your report will be saved in ", h("a", { href: "#/runs" }, "My reports"), ".")
          : null)
    );
  }

  function renderDone(run, result) {
    setTitle(result.title || run.title || "Report");
    const shareSlot = h("div", { class: "share-slot" });
    const shareBtn = h("button", { type: "button", class: "btn btn-secondary" }, "Share");
    shareBtn.addEventListener("click", () => shareRun(run.run_id, shareBtn, shareSlot));
    const actions = [shareBtn, h("a", { class: "btn btn-quiet", href: "#/runs" }, "My reports"), shareSlot];
    main.replaceChildren(h("div", { class: "wrap page" }, renderReport(result, { run, actions })));
  }

  async function tick() {
    let warning = null;
    try {
      const data = await api(`/runs/${encodeURIComponent(runId)}`);
      if (!alive || !isCurrent()) return;
      const run = data.run || {};
      const result = data.result || null;
      if (run.status === "done" && result) {
        if (!shownDone) {
          shownDone = true;
          renderDone(run, result);
          announce("Your report is ready.");
        }
        return;
      }
      const stageKey = run.status === "failed" ? "failed" : run.stage || run.status;
      if (stageKey !== lastStage) {
        lastStage = stageKey;
        const label = (STAGES.find(([k]) => k === run.stage) || [null, null])[1];
        announce(run.status === "failed" ? "The run stopped." : label ? `Now: ${label}` : "Waiting to start");
      }
      renderProgress(run, null);
      if (run.status === "failed") return;
    } catch (err) {
      if (!alive || !isCurrent()) return;
      if (err.status === 401) return;
      if (err.status === 404 || err.status === 403) {
        main.replaceChildren(
          h("div", { class: "wrap page" },
            h("div", { class: "empty" },
              h("h1", {}, "Run not found"),
              h("p", {}, "This run does not exist or belongs to another account."),
              h("a", { class: "btn btn-secondary", href: "#/runs" }, "Go to My reports"))));
        return;
      }
      warning = `${friendlyError(err)} We will keep trying.`;
      const banner = main.querySelector(".run-page .page-head");
      if (banner) {
        const old = main.querySelector(".banner-warn");
        const el = h("p", { class: "banner banner-warn", role: "status" }, warning);
        if (old) old.replaceWith(el); else banner.after(el);
      } else {
        main.replaceChildren(h("div", { class: "wrap page" }, h("p", { class: "banner banner-warn", role: "status" }, warning)));
      }
    }
    if (alive) timer = setTimeout(tick, 3000);
  }

  tick();
  return () => {
    alive = false;
    clearTimeout(timer);
  };
}

async function shareRun(runId, btn, slot) {
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "Creating link…";
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
      h("p", { class: "share-note" },
        copied ? "Link copied. Anyone with it can read this report." : "Copy this link to share the report."),
      field);
    toast(copied ? "Share link copied." : "Share link ready. Copy it from the box.");
    if (!copied) field.focus();
  } catch (err) {
    slot.replaceChildren(h("p", { class: "form-error", role: "alert" }, friendlyError(err)));
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ---- My runs ---------------------------------------------------------------

async function viewRuns(isCurrent) {
  setTitle("My reports");
  main.replaceChildren(loadingBlock("Loading your reports…"));
  const { runs = [] } = await api("/runs");
  if (!isCurrent()) return;
  const head = h("div", { class: "page-head page-head-row" },
    h("div", {}, h("p", { class: "eyebrow" }, "Your reports"), h("h1", {}, "My reports")),
    h("a", { class: "btn btn-primary", href: "#/new" }, "New research"));

  const body = runs.length
    ? h("ul", { class: "run-list" },
        runs.map((run) =>
          h("li", {},
            h("a", { class: "run-row", href: `#/runs/${encodeURIComponent(run.run_id)}` },
              h("span", { class: "run-title" }, run.title || "Untitled research"),
              h("span", { class: "run-meta" },
                [featureById(run.feature || run.brief?.feature).name, fmtDateTime(run.created_at), run.status === "done" && run.cost_usd != null ? `cost about ${fmtCost(run.cost_usd)}` : null]
                  .filter(Boolean).join(" · ")),
              h("span", { class: "run-status" }, statusPill(run.status))))))
    : h("div", { class: "empty" },
        h("h2", {}, "No research yet"),
        h("p", {}, "Your reports will appear here. The first one is free."),
        h("a", { class: "btn btn-primary", href: "#/new" }, "Start your first report"));

  main.replaceChildren(h("div", { class: "wrap page" }, head, body));
}

// ---- Library ---------------------------------------------------------------

async function viewLibrary(isCurrent) {
  setTitle("Fact library");
  main.replaceChildren(loadingBlock("Loading your fact cards…"));

  const [cardsRes, runsRes] = await Promise.allSettled([api("/cards"), api("/runs")]);
  if (!isCurrent()) return;
  if (cardsRes.status === "rejected") throw cardsRes.reason;
  const allCards = cardsRes.value.cards || [];
  const runInfo = new Map(
    (runsRes.status === "fulfilled" ? runsRes.value.runs || [] : []).map((r) => [r.run_id, r]));
  const directions = [...new Set(allCards.map((c) => c.direction).filter(Boolean))].sort();
  const cardFeatures = (card) => new Set([
    card.feature,
    ...(card.run_ids || []).map((id) => {
      const run = runInfo.get(id);
      return run?.feature || run?.brief?.feature;
    }),
  ].filter(Boolean));
  const availableFeatures = FEATURES.filter(({ id }) => allCards.some((card) => cardFeatures(card).has(id)));

  const search = h("input", { type: "search", id: "lib-q", placeholder: "Claims, quotes or sources", autocomplete: "off" });
  const typeSel = h("select", { id: "lib-type" },
    h("option", { value: "" }, "All types"),
    h("option", { value: "sourced" }, "Sourced"),
    h("option", { value: "unverified" }, "Unverified"));
  const dirSel = h("select", { id: "lib-dir" },
    h("option", { value: "" }, "All directions"),
    directions.map((d) => h("option", { value: d }, d)));
  const featureSel = h("select", { id: "lib-feature" },
    h("option", { value: "" }, "All tools"),
    availableFeatures.map(({ id, name }) => h("option", { value: id }, name)));
  const count = h("p", { class: "result-count", role: "status" });
  const grid = h("div", { class: "library-results" });

  const toolbar = h("form", { class: "toolbar", role: "search", onsubmit: (ev) => ev.preventDefault() },
    h("div", { class: "control control-grow" }, h("label", { for: "lib-q" }, "Search"), search),
    h("div", { class: "control" }, h("label", { for: "lib-type" }, "Type"), typeSel),
    h("div", { class: "control" }, h("label", { for: "lib-dir" }, "Direction"), dirSel),
    availableFeatures.length ? h("div", { class: "control" }, h("label", { for: "lib-feature" }, "Tool"), featureSel) : null);

  main.replaceChildren(
    h("div", { class: "wrap page" },
      h("div", { class: "page-head" },
        h("p", { class: "eyebrow" }, "Your fact cards"),
        h("h1", {}, "Fact library"),
        h("p", { class: "lede-sm" },
          "Quotes and sources from all your reports.")),
      allCards.length ? toolbar : null,
      allCards.length ? count : null,
      grid)
  );

  function cardItem(card) {
    const stale = isStale(card);
    const runIds = [...(card.run_ids || [])].sort((a, b) =>
      String((runInfo.get(b) || {}).created_at || "").localeCompare(String((runInfo.get(a) || {}).created_at || "")));
    const usedNodes = runIds.map((id) => {
      const info = runInfo.get(id);
      return h("li", {},
        h("a", { href: `#/runs/${encodeURIComponent(id)}` }, (info && info.title) || `Run ${id}`),
        info && info.created_at ? h("span", { class: "used-date" }, fmtDate(info.created_at)) : null);
    });
    return h("li", {},
      h("article", { class: `fact${stale ? " is-stale" : ""}` },
        h("div", { class: "badge-row" },
          typeBadge(card.type),
          stale ? staleBadge() : null,
          card.direction ? h("span", { class: "tag" }, card.direction) : null),
        h("p", { class: "fact-claim" }, card.claim),
        card.quote ? h("blockquote", { class: "quote" }, h("p", {}, `“${card.quote}”`)) : null,
        h("p", { class: "fact-source" },
          externalLink(card.url, card.source_title || domainOf(card.url) || "Source", "source-link"),
          h("span", { class: "muted" }, ` · ${domainOf(card.url)}${card.captured_at ? ` · captured ${fmtDate(card.captured_at)}` : ""}`)),
        usedNodes.length
          ? h("div", { class: "fact-used" },
              h("p", { class: "fact-used-label" }, `Used in ${plural(usedNodes.length, "report")}`),
              h("ul", { class: "used-list" }, usedNodes))
          : null));
  }

  function render(cards, filtered) {
    if (!allCards.length) {
      grid.replaceChildren(h("div", { class: "empty" },
        h("h2", {}, "No fact cards yet"),
        h("p", {}, "Cards appear here after your first report finishes."),
        h("a", { class: "btn btn-primary", href: "#/new" }, "Start research")));
      return;
    }
    count.textContent = filtered
      ? `${plural(cards.length, "card")} match${cards.length === 1 ? "es" : ""} out of ${allCards.length}`
      : `${plural(cards.length, "card")}`;
    if (!cards.length) {
      grid.replaceChildren(h("div", { class: "empty empty-sm" },
        h("p", {}, "No cards match these filters."),
        h("button", { type: "button", class: "btn btn-secondary", onclick: clearFilters }, "Clear filters")));
      return;
    }
    grid.replaceChildren(h("ul", { class: "card-grid" }, cards.map(cardItem)));
  }

  let reqSeq = 0;
  let debounce = null;
  async function load() {
    const mine = ++reqSeq;
    const q = search.value.trim();
    const type = typeSel.value;
    const direction = dirSel.value;
    const feature = featureSel.value;
    const filtered = !!(q || type || direction || feature);
    if (!filtered) return render(allCards, false);
    try {
      const { cards = [] } = await api("/cards", { query: { q, type, direction } });
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
    featureSel.value = "";
    load();
    search.focus();
  }
  search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(load, 250);
  });
  typeSel.addEventListener("change", load);
  dirSel.addEventListener("change", load);
  featureSel.addEventListener("change", load);

  render(allCards, false);
  return () => clearTimeout(debounce);
}

// ---- Shared report (public) ------------------------------------------------

async function viewShared(token, isCurrent) {
  setTitle("Shared report");
  main.replaceChildren(loadingBlock("Loading the shared report…"));
  let data;
  try {
    data = await api(`/shared/${encodeURIComponent(token)}`, { quiet401: true });
  } catch (err) {
    if (!isCurrent()) return;
    main.replaceChildren(
      h("div", { class: "wrap page" },
        h("div", { class: "empty" },
          h("h1", {}, "This link does not work"),
          h("p", {}, err.status === 404
            ? "The link may be mistyped, or the report is no longer shared."
            : friendlyError(err)),
          h("a", { class: "btn btn-secondary", href: "#/" }, "Go to MarketClue"))));
    return;
  }
  if (!isCurrent()) return;
  const run = data.run || {};
  if (!data.result) {
    main.replaceChildren(
      h("div", { class: "wrap page" },
        h("div", { class: "empty" },
          h("h1", {}, run.title || "Shared report"),
          h("p", {}, "This report is not finished yet. Check the link again in a few minutes."))));
    return;
  }
  setTitle(data.result.title || run.title || "Shared report");
  main.replaceChildren(
    h("div", { class: "wrap page" },
      renderReport(data.result, { run, shared: true }),
      state.user
        ? null
        : h("aside", { class: "cta", "aria-label": "About MarketClue" },
            h("h2", {}, "Research your own market"),
            h("p", {}, "Get a sourced report for your business. Your first is free."),
            h("a", { class: "btn btn-primary", href: "#/" }, "Try MarketClue"))));
}

// ---- Not found -------------------------------------------------------------

function viewNotFound() {
  setTitle("Page not found");
  main.replaceChildren(
    h("div", { class: "wrap page" },
      h("div", { class: "empty" },
        h("h1", {}, "Page not found"),
        h("p", {}, "That page does not exist."),
        h("a", { class: "btn btn-secondary", href: state.user ? "#/home" : "#/" }, "Go home"))));
}

// ---- Boot ------------------------------------------------------------------

async function boot() {
  initializeReadingPreferences();
  if (MOCK) document.documentElement.classList.add("is-mock");
  const footerNote = document.getElementById("mock-note");
  if (MOCK && footerNote) footerNote.hidden = false;

  document.querySelector(".skip-link")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    main.focus();
    main.scrollIntoView();
  });

  renderHeader("");
  if (!hasReadingPreferences()) {
    setTitle("Welcome");
    await new Promise((resolve) => main.replaceChildren(renderWelcome(resolve)));
  }
  main.replaceChildren(loadingBlock());
  try {
    const { user } = await api("/me", { quiet401: true });
    state.user = user || null;
  } catch (err) {
    state.user = null;
    if (!(err instanceof ApiError) || err.status !== 401) {
      state.bootError = err instanceof ApiError && err.code === "network"
        ? err.message
        : "MarketClue could not check your sign-in just now. Please reload the page in a moment.";
    }
  }
  window.addEventListener("hashchange", router);
  router();
}

boot();
