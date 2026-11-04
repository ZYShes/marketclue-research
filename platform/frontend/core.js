// Shared app state and page helpers used by every view module.
import { h, storage } from "./ui.js";

export const state = {
  user: null,
  bootError: null,
  convCache: new Map(), // conv_id → conversation just returned by POST /chat
};

export const KEYS = {
  conv: "mc_open_conv", // the conversation a reload returns to
  afterLogin: "mc_after_login",
  mode: "mc_mode",
  signedIn: "mc_signed_in", // hint for boot.js: preload the app rather than the landing page
};

export const main = document.getElementById("main");
const liveEl = document.getElementById("live");

let routerFn = () => {};
export function setRouter(fn) {
  routerFn = fn;
}

export function go(hash, replace = false) {
  if (replace) {
    history.replaceState(null, "", hash);
    routerFn();
  } else if (location.hash === hash) {
    routerFn();
  } else {
    location.hash = hash;
  }
}

export function rerender() {
  routerFn();
}

export function parseRoute() {
  const hash = location.hash || "#/";
  if (!hash.startsWith("#/")) return null; // in-page anchor, not a route
  return hash.slice(2).split("?")[0].split("/").filter(Boolean).map((p) => {
    try { return decodeURIComponent(p); } catch { return p; }
  });
}

export function routeQuery() {
  const hash = location.hash || "";
  const i = hash.indexOf("?");
  return new URLSearchParams(i >= 0 ? hash.slice(i + 1) : "");
}

// Updates the hash query without re-running the router (for tabs and toggles).
export function setRouteQuery(params) {
  const base = (location.hash || "#/").split("?")[0];
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "")).toString();
  history.replaceState(null, "", qs ? `${base}?${qs}` : base);
}

export function announce(text) {
  if (!liveEl) return;
  liveEl.textContent = "";
  // A fresh text node makes screen readers announce repeated messages too.
  setTimeout(() => { liveEl.textContent = text; }, 30);
}

export function openConvId() {
  return storage.get(KEYS.conv);
}
export function setOpenConv(id) {
  if (id) storage.set(KEYS.conv, id);
  else storage.remove(KEYS.conv);
}

export function loadingBlock(text = "Loading…") {
  return h("div", { class: "page" },
    h("p", { class: "loading", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), text));
}

// Page header with a focusable h1 so route changes can move focus to it.
export function pageHeader({ eyebrow = null, title, lede = null, actions = null, extra = null }) {
  return h("header", { class: "page-head" },
    h("div", { class: "page-head-text" },
      eyebrow ? h("p", { class: "eyebrow" }, eyebrow) : null,
      h("h1", { tabindex: "-1" }, title),
      lede ? h("p", { class: "lede" }, lede) : null,
      extra),
    actions ? h("div", { class: "page-head-actions" }, actions) : null);
}

export function page(...children) {
  return h("div", { class: "page" }, ...children);
}

export function isOwner() {
  return !!(state.user && state.user.is_owner);
}

export function runsLeftText(user) {
  if (!user) return "";
  if (user.free_runs_left == null) return "Unlimited reports";
  const n = Number(user.free_runs_left) || 0;
  return n > 0 ? `${n} free report${n === 1 ? "" : "s"} left` : "Free reports used";
}
