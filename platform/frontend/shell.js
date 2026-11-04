// App shell: left sidebar (New research, Recent history, links, account), mobile top bar
// and drawer, plus the history store that mixes conversations and reports.
import {
  h, svg, icon, ICONS, avatar, statusChip, historyGroup, openReadingDialog, currentZoom,
} from "./ui.js";
import { api } from "./api.js";
import { state, runsLeftText } from "./core.js";
import { featureById } from "./features.js";

const shellEl = document.getElementById("shell");
const topbarEl = document.getElementById("topbar");
const sidebarEl = document.getElementById("sidebar");
const backdropEl = document.getElementById("sidebar-backdrop");
const contentEl = document.getElementById("content");

const NARROW_BELOW = 960; // CSS px at the current page zoom

let signOutHandler = () => {};
export function onSignOut(fn) {
  signOutHandler = fn;
}

// ---- History store ----------------------------------------------------------

let historyItems = null;
let historyError = null;
let historyPromise = null;
let pollTimer = null;
const listeners = new Set();

function runStatus(status) {
  if (status === "queued" || status === "running") return "running";
  if (status === "done" || status === "failed") return status;
  return "running";
}

function later(a, b) {
  if (!a) return b;
  if (!b) return a;
  return String(a) > String(b) ? a : b;
}

export function mergeHistory(convs, runs) {
  const items = [];
  const runById = new Map(runs.map((r) => [r.run_id, r]));
  const seen = new Set();
  for (const c of convs) {
    if (!c || !c.conv_id) continue;
    if (c.run_id) {
      const r = runById.get(c.run_id);
      seen.add(c.run_id);
      items.push({
        key: `run:${c.run_id}`, type: "report", id: c.run_id, conv_id: c.conv_id,
        title: (r && r.title) || c.title || "Untitled research",
        feature: c.feature || (r && r.feature), status: runStatus((r && r.status) || c.run_status),
        at: later(c.updated_at, r && r.created_at), href: `#/runs/${encodeURIComponent(c.run_id)}`,
      });
    } else {
      items.push({
        key: `conv:${c.conv_id}`, type: "conversation", id: c.conv_id,
        title: c.title || "New conversation", feature: c.feature,
        status: c.ready ? "ready" : "draft", at: c.updated_at || c.created_at,
        href: `#/c/${encodeURIComponent(c.conv_id)}`,
      });
    }
  }
  for (const r of runs) {
    if (!r || !r.run_id || seen.has(r.run_id)) continue;
    items.push({
      key: `run:${r.run_id}`, type: "report", id: r.run_id, conv_id: r.conv_id || null,
      title: r.title || "Untitled research", feature: r.feature || r.brief?.feature,
      status: runStatus(r.status), at: r.created_at, href: `#/runs/${encodeURIComponent(r.run_id)}`,
    });
  }
  items.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  return items;
}

export function refreshHistory() {
  if (!state.user) return Promise.resolve([]);
  if (historyPromise) return historyPromise;
  historyPromise = Promise.allSettled([api("/conversations", { query: { limit: 50 } }), api("/runs")])
    .then(([convRes, runRes]) => {
      const convs = convRes.status === "fulfilled" ? convRes.value.conversations || [] : [];
      const runs = runRes.status === "fulfilled" ? runRes.value.runs || [] : [];
      historyError = convRes.status === "rejected" && runRes.status === "rejected" ? runRes.reason : null;
      historyItems = mergeHistory(convs, runs);
      listeners.forEach((fn) => fn(historyItems));
      schedulePoll();
      return historyItems;
    })
    .finally(() => { historyPromise = null; });
  return historyPromise;
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (state.user && (historyItems || []).some((item) => item.status === "running")) {
    pollTimer = setTimeout(refreshHistory, 15000);
  }
}

export function getHistory() {
  return historyItems;
}

export function onHistory(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetHistory() {
  historyItems = null;
  historyError = null;
  clearTimeout(pollTimer);
}

export function historyRow(item, { compact = false, current = false } = {}) {
  const feature = item.feature ? featureById(item.feature) : null;
  return h("a", {
    class: `history-row${compact ? " is-compact" : ""}`, href: item.href,
    "aria-current": current ? "page" : null,
  },
  h("span", { class: "history-main" },
    h("span", { class: "history-title" }, item.title),
    compact ? null : h("span", { class: "history-meta" },
      [feature ? feature.name : null, item.type === "report" ? "Report" : "Conversation"].filter(Boolean).join(" · "))),
  statusChip(item.status));
}

export function groupHistory(items) {
  const groups = new Map([["Today", []], ["This week", []], ["Earlier", []]]);
  for (const item of items) groups.get(historyGroup(item.at)).push(item);
  return [...groups.entries()].filter(([, list]) => list.length);
}

// ---- Layout mode --------------------------------------------------------------

let drawerOpen = false;
let mode = "public";

export function isNarrow() {
  return window.innerWidth / currentZoom() < NARROW_BELOW;
}

function applyLayout() {
  const narrow = isNarrow();
  document.documentElement.classList.toggle("is-narrow", narrow);
  if (!narrow && drawerOpen) setDrawer(false, false);
  syncInert();
}

function syncInert() {
  const trap = mode === "app" && drawerOpen && isNarrow();
  contentEl.inert = trap;
  topbarEl.inert = trap;
  const hideSidebar = mode === "app" && isNarrow() && !drawerOpen;
  sidebarEl.inert = hideSidebar;
  if (hideSidebar) sidebarEl.setAttribute("aria-hidden", "true");
  else sidebarEl.removeAttribute("aria-hidden");
}

function setDrawer(open, restoreFocus = true) {
  drawerOpen = open;
  shellEl.classList.toggle("drawer-open", open);
  backdropEl.hidden = !open;
  const menuBtn = document.getElementById("menu-btn");
  if (menuBtn) menuBtn.setAttribute("aria-expanded", String(open));
  syncInert();
  if (open) {
    const first = sidebarEl.querySelector(".sb-close") || sidebarEl.querySelector("a, button");
    first?.focus();
  } else if (restoreFocus && menuBtn && isNarrow()) {
    menuBtn.focus();
  }
}

export function closeDrawer() {
  if (drawerOpen) setDrawer(false, false);
}

window.addEventListener("resize", applyLayout);
window.addEventListener("mc:layout", applyLayout);
backdropEl.addEventListener("click", () => setDrawer(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && drawerOpen) {
    event.preventDefault();
    setDrawer(false);
  }
});

// ---- Rendering ------------------------------------------------------------------

function wordmark(href) {
  return h("a", { class: "wordmark", href }, svg(ICONS.mark), h("span", { class: "wordmark-text" }, "MarketClue"));
}

function readingButton(extraClass = "") {
  return h("button", {
    type: "button", class: `btn btn-ghost ${extraClass}`.trim(), "aria-haspopup": "dialog",
    "aria-controls": "reading-dialog", onclick: openReadingDialog,
  }, icon("reading"), h("span", {}, "Reading & motion"));
}

function accountMenu(user) {
  const menuId = "account-menu";
  const btn = h("button", {
    type: "button", class: "account-btn", "aria-expanded": "false", "aria-controls": menuId,
  },
  avatar(user),
  h("span", { class: "account-text" },
    h("span", { class: "account-name" }, user.name || user.email || "Account"),
    h("span", { class: "account-sub" }, runsLeftText(user))),
  icon("chevronDown"));
  const signOutBtn = h("button", { type: "button", class: "menu-item", onclick: () => signOutHandler() },
    icon("logout"), "Sign out");
  const menu = h("div", { class: "account-menu", id: menuId, hidden: true },
    h("p", { class: "account-menu-email" }, user.email || ""),
    signOutBtn);

  function setOpen(open) {
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) {
      signOutBtn.focus();
      document.addEventListener("click", onDoc, true);
      document.addEventListener("keydown", onKey, true);
    } else {
      document.removeEventListener("click", onDoc, true);
      document.removeEventListener("keydown", onKey, true);
    }
  }
  function onDoc(ev) {
    if (!menu.contains(ev.target) && !btn.contains(ev.target)) setOpen(false);
  }
  function onKey(ev) {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      setOpen(false);
      btn.focus();
    }
  }
  btn.addEventListener("click", () => setOpen(menu.hidden));
  return h("div", { class: "account" }, menu, btn);
}

function navLink(href, label, iconName, current) {
  return h("li", {}, h("a", { class: "sb-link", href, "aria-current": current ? "page" : null },
    icon(iconName), h("span", {}, label)));
}

let currentRoute = { head: "", arg: null };

function renderRecent(container) {
  const items = historyItems;
  const { head, arg } = currentRoute;
  const isCurrent = (item) => (item.type === "conversation" && head === "c" && arg === item.id) ||
    (item.type === "report" && head === "runs" && arg === item.id);
  let body;
  if (items == null) {
    body = historyError
      ? h("p", { class: "sb-note" }, "History could not load.")
      : h("p", { class: "sb-note", role: "status" }, "Loading…");
  } else if (!items.length) {
    body = h("p", { class: "sb-note" }, "Your conversations and reports will appear here.");
  } else {
    const shown = items.slice(0, 14);
    body = [
      groupHistory(shown).map(([label, list]) => h("div", { class: "sb-group" },
        h("h3", { class: "sb-group-title" }, label),
        h("ul", { class: "sb-list" }, list.map((item) => h("li", {}, historyRow(item, { compact: true, current: isCurrent(item) })))))),
      items.length > shown.length || items.length > 6
        ? h("a", { class: "sb-more", href: "#/new?tab=existing" }, "View all history", icon("arrow"))
        : null,
    ];
  }
  container.replaceChildren(h("h2", { class: "sb-heading", id: "recent-h" }, "Recent"),
    ...[body].flat(Infinity).filter(Boolean));
}

let recentEl = null;
onHistory(() => { if (recentEl?.isConnected) renderRecent(recentEl); });

export function renderShell(route) {
  currentRoute = route;
  const user = state.user;
  mode = user ? "app" : "public";
  shellEl.classList.toggle("shell-app", mode === "app");
  shellEl.classList.toggle("shell-public", mode === "public");
  closeDrawer();

  if (mode === "public") {
    sidebarEl.hidden = true;
    recentEl = null;
    topbarEl.replaceChildren(h("div", { class: "topbar-inner" },
      wordmark("#/"),
      h("div", { class: "topbar-actions" },
        readingButton("btn-reading"),
        route.head ? h("a", { class: "btn btn-secondary", href: "#/" }, "Sign in") : null)));
    applyLayout();
    return;
  }

  sidebarEl.hidden = false;
  const { head } = route;
  topbarEl.replaceChildren(h("div", { class: "topbar-inner" },
    h("button", {
      type: "button", class: "icon-btn", id: "menu-btn", "aria-label": "Open navigation",
      "aria-controls": "sidebar", "aria-expanded": "false", onclick: () => setDrawer(true),
    }, icon("menu")),
    wordmark("#/new"),
    h("a", { class: "icon-btn", href: "#/new", "aria-label": "New research" }, icon("plus"))));

  recentEl = h("section", { class: "sb-recent", "aria-labelledby": "recent-h" });
  renderRecent(recentEl);
  sidebarEl.replaceChildren(
    h("div", { class: "sb-top" },
      wordmark("#/new"),
      h("button", { type: "button", class: "icon-btn sb-close", "aria-label": "Close navigation", onclick: () => setDrawer(false) }, icon("close"))),
    h("a", { class: "btn btn-primary sb-new", href: "#/new", "aria-current": head === "new" ? "page" : null }, icon("plus"), "New research"),
    recentEl,
    h("ul", { class: "sb-links" },
      navLink("#/runs", "My reports", "reports", head === "runs" && !route.arg),
      navLink("#/library", "Fact library", "library", head === "library"),
      navLink("#/team", "Team", "team", head === "team" || head === "join")),
    h("div", { class: "sb-bottom" },
      readingButton("sb-reading"),
      accountMenu(user)));
  applyLayout();
  if (historyItems == null) refreshHistory();
}

// Re-render only the account area after /me changes (free reports left).
export function refreshAccount() {
  const acct = sidebarEl.querySelector(".account");
  if (acct && state.user) acct.replaceWith(accountMenu(state.user));
}
