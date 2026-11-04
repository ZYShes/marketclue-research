// MarketClue single-page app: boot, sign-in and the hash router.
import {
  h, storage, setTitle, toast, hideToast, emptyState,
  initializeReadingPreferences, hasReadingPreferences, renderWelcome,
} from "./ui.js";
import { api, ApiError, MOCK, onUnauthorized, friendlyError } from "./api.js";
import {
  state, KEYS, main, go, setRouter, parseRoute, page, loadingBlock, openConvId, setOpenConv,
} from "./core.js";
import { renderShell, refreshHistory, resetHistory, onSignOut, refreshAccount } from "./shell.js";
import { isFeature } from "./features.js";
import { landingPage } from "./landing.js";
import { viewNew, viewConversation } from "./research.js";
import { viewTemplates } from "./templates.js";
import { viewRun, viewShared } from "./run.js";
import { viewLibrary, viewReports } from "./library.js";
import { viewTeam, viewJoin } from "./team.js";
import { viewProject } from "./projects.js";
import { closeCardPanel, hideHovercard } from "./report.js";

const cfg = window.MC_CONFIG || {};
const PROTECTED = new Set(["home", "new", "templates", "c", "runs", "library", "team", "p"]);

let cleanup = null;
let renderSeq = 0;
let firstRender = true;

// ---- Routing ---------------------------------------------------------------

async function router() {
  const parts = parseRoute();
  if (!parts) return;
  if (cleanup) {
    try { cleanup(); } catch { /* ignore */ }
    cleanup = null;
  }
  closeCardPanel();
  hideHovercard();
  hideToast();
  const seq = ++renderSeq;
  const isCurrent = () => seq === renderSeq;
  const [head = "", arg] = parts;

  if (state.user && (!head || head === "home")) {
    const conv = openConvId();
    return go(conv ? `#/c/${encodeURIComponent(conv)}` : "#/new", true);
  }
  if (PROTECTED.has(head) && !state.user) {
    storage.set(KEYS.afterLogin, location.hash);
    return go("#/", true);
  }

  renderShell({ head, arg });
  const moveFocus = !firstRender;
  if (moveFocus) window.scrollTo(0, 0);
  firstRender = false;

  let result;
  if (!head) result = viewLanding();
  else if (head === "new" && (!arg || isFeature(arg))) result = viewNew(isCurrent, arg || null);
  else if (head === "templates" && !arg) result = viewTemplates(isCurrent);
  else if (head === "c" && arg) result = viewConversation(arg, isCurrent);
  else if (head === "p" && arg) result = viewProject(arg, isCurrent);
  else if (head === "runs" && arg) result = viewRun(arg, isCurrent);
  else if (head === "runs") result = viewReports(isCurrent);
  else if (head === "library") result = viewLibrary(isCurrent);
  else if (head === "team") result = viewTeam(isCurrent);
  else if (head === "join" && arg) result = viewJoin(arg, isCurrent, { mountSignIn });
  else if (head === "shared" && arg) result = viewShared(arg, isCurrent);
  else result = viewNotFound();

  const focusPage = () => {
    if (!moveFocus || !isCurrent()) return;
    const target = main.querySelector("h1[tabindex='-1']") || main;
    target.focus({ preventScroll: true });
  };

  if (result && typeof result.then === "function") {
    focusPage();
    result.then((fn) => {
      if (typeof fn === "function") {
        if (isCurrent()) cleanup = fn;
        else fn();
      }
      focusPage();
    }).catch((err) => {
      if (isCurrent()) showPageError(err);
    });
  } else {
    if (typeof result === "function") cleanup = result;
    focusPage();
  }
}

setRouter(router);

function showPageError(err) {
  if (err instanceof ApiError && err.status === 401) return; // handled globally
  main.replaceChildren(page(emptyState({
    title: "Something went wrong", text: friendlyError(err), headingLevel: 1,
    action: h("button", { type: "button", class: "btn btn-secondary", onclick: () => router() }, "Try again"),
  })));
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
  resetHistory();
  const next = storage.get(KEYS.afterLogin);
  storage.remove(KEYS.afterLogin);
  go(next && next.startsWith("#/") && next !== "#/" ? next : "#/new", true);
}

// Renders the sign-in control into container. In mock mode, two demo accounts.
export function mountSignIn(container, { returnTo = null } = {}) {
  const status = h("p", { class: "signin-status", role: "status" });
  signInStatusEl = status;
  if (returnTo) storage.set(KEYS.afterLogin, returnTo);

  if (MOCK) {
    const demo = (label, credential, primary) => {
      const btn = h("button", { type: "button", class: `btn ${primary ? "btn-primary" : "btn-secondary"} btn-lg` }, label);
      btn.addEventListener("click", async () => {
        container.querySelectorAll("button").forEach((b) => { b.disabled = true; });
        try {
          const { user } = await api("/auth/google", { method: "POST", body: { credential }, quiet401: true });
          afterLogin(user);
        } catch (err) {
          status.textContent = friendlyError(err);
          container.querySelectorAll("button").forEach((b) => { b.disabled = false; });
        }
      });
      return btn;
    };
    container.replaceChildren(
      h("div", { class: "signin-buttons" },
        demo("Continue as demo owner", "mock-owner", true),
        demo("Continue as demo member", "mock-member", false)),
      h("p", { class: "fine" }, "Sample accounts. No Google sign-in needed."),
      status);
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
  state.convCache.clear();
  resetHistory();
  setOpenConv(null);
  go("#/", true);
  toast("You are signed out.");
}
onSignOut(signOut);

onUnauthorized(() => {
  if (!state.user) return;
  state.user = null;
  resetHistory();
  const parts = parseRoute();
  if (parts && PROTECTED.has(parts[0] || "")) storage.set(KEYS.afterLogin, location.hash);
  go("#/", true);
  toast("Your session has ended. Please sign in again.");
});

// Keeps the free-report count fresh after a run starts.
export async function refreshMe() {
  try {
    const { user } = await api("/me", { quiet401: true });
    if (user) {
      state.user = user;
      refreshAccount();
    }
  } catch { /* keep current */ }
}
window.addEventListener("mc:refresh-me", refreshMe);
window.addEventListener("mc:refresh-history", () => refreshHistory());

// ---- Landing and not found ---------------------------------------------------

function viewLanding() {
  setTitle("");
  const signin = h("div", { class: "signin" });
  main.replaceChildren(landingPage(signin, state.bootError));
  mountSignIn(signin);
}

function viewNotFound() {
  setTitle("Page not found");
  main.replaceChildren(page(emptyState({
    title: "Page not found", text: "That page does not exist.", headingLevel: 1,
    action: h("a", { class: "btn btn-secondary", href: state.user ? "#/new" : "#/" }, "Go home"),
  })));
  main.querySelector("h1")?.setAttribute("tabindex", "-1");
}

// ---- Boot ------------------------------------------------------------------

async function boot() {
  initializeReadingPreferences();
  if (MOCK) document.documentElement.classList.add("is-mock");
  const footerNote = document.getElementById("mock-note");
  if (MOCK && footerNote) footerNote.hidden = false;

  document.querySelector(".skip-link")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    const target = main.querySelector("h1") || main;
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus();
    target.scrollIntoView({ block: "start" });
  });

  renderShell({ head: "", arg: null });
  if (!hasReadingPreferences()) {
    document.getElementById("shell").classList.add("is-welcome");
    await new Promise((resolve) => main.replaceChildren(renderWelcome(resolve)));
    document.getElementById("shell").classList.remove("is-welcome");
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
