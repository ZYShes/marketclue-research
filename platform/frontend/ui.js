// Small DOM and formatting helpers shared by every view.
// All text goes in through textContent; links are restricted to http(s) and in-app hashes.

export const STALE_DAYS = Number((window.MC_CONFIG || {}).staleDays) || 90;

export function safeUrl(value) {
  if (typeof value !== "string" || !value) return null;
  if (value.startsWith("#")) return value;
  try {
    const url = new URL(value, location.href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

// h("a", {class: "x", href: "#/", onclick: fn}, "text", otherNode)
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "text") el.textContent = value;
      else if (key === "dataset") Object.assign(el.dataset, value);
      else if (key.startsWith("on") && typeof value === "function") {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === "href" || key === "src") {
        const safe = safeUrl(value);
        if (safe) el.setAttribute(key, safe);
      } else if (value === true) el.setAttribute(key, "");
      else el.setAttribute(key, String(value));
    }
  }
  appendChildren(el, children);
  return el;
}

// Trusted, static SVG markup only (icons and the logo mark).
export function svg(markup) {
  const tpl = document.createElement("template");
  tpl.innerHTML = markup.trim();
  return tpl.content.firstElementChild;
}

export const ICONS = {
  mark: `<svg class="mark" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M12 2.75 A9.25 9.25 0 0 0 12 21.25 Z" fill="var(--rust)"/></svg>`,
  check: `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
    <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  close: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  external: `<svg class="ext" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
    <path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

export function icon(name) {
  return svg(ICONS[name]);
}

export function externalLink(href, text, className = "") {
  const safe = safeUrl(href);
  if (!safe) return h("span", { class: className }, text);
  const words = String(text).split(" ");
  const last = words.pop();
  return h(
    "a",
    { class: className, href: safe, target: "_blank", rel: "noopener noreferrer" },
    words.length ? `${words.join(" ")} ` : "",
    h("span", { class: "nowrap" }, `${last}\u00a0`, icon("external")),
    h("span", { class: "visually-hidden" }, " (opens in a new tab)")
  );
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function fmtAgo(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 90) return "a minute ago";
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 5400) return "an hour ago";
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  return fmtDate(iso);
}

export function fmtMoney(amount, currency = "USD") {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
      minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    }).format(n);
  } catch {
    return `${n} ${currency}`;
  }
}

export function fmtCost(usd) {
  const n = Number(usd);
  if (!Number.isFinite(n)) return "";
  if (n > 0 && n < 0.01) return "less than $0.01";
  return `$${n.toFixed(2)}`;
}

export function fmtSeconds(sec) {
  const s = Math.round(Number(sec) || 0);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

export function daysSince(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

export function isStale(card) {
  if (typeof card.stale === "boolean") return card.stale;
  const days = daysSince(card.captured_at);
  return days != null && days > STALE_DAYS;
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

// localStorage that never throws (private windows, blocked storage).
export const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

export function setTitle(page) {
  document.title = page ? `${page} · MarketClue` : "MarketClue · Market research you can check";
}

let toastTimer = null;
export function toast(message) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("is-visible");
  }, 4200);
}

export function hideToast() {
  const el = document.getElementById("toast");
  if (el) el.classList.remove("is-visible");
  clearTimeout(toastTimer);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = h("textarea", { class: "visually-hidden", "aria-hidden": "true" });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// ---- Badges ---------------------------------------------------------------

const KIND_LABELS = { sourced: "Sourced", assumption: "Assumption", estimate: "Estimate" };

export function kindBadge(kind) {
  const key = KIND_LABELS[kind] ? kind : "assumption";
  return h("span", { class: `badge badge-${key}` }, KIND_LABELS[key]);
}

export function typeBadge(type) {
  return type === "sourced"
    ? h("span", { class: "badge badge-sourced" }, "Sourced")
    : h("span", { class: "badge badge-unverified" }, "Unverified");
}

export function staleBadge() {
  return h(
    "span",
    { class: "badge badge-stale", title: `Captured more than ${STALE_DAYS} days ago` },
    "Stale"
  );
}

const STATUS_LABELS = { queued: "Queued", running: "Running", done: "Done", failed: "Failed" };

export function statusPill(status) {
  const key = STATUS_LABELS[status] ? status : "queued";
  return h("span", { class: `status status-${key}` }, STATUS_LABELS[key]);
}

export function initials(user) {
  const src = (user && (user.name || user.email)) || "?";
  const parts = src.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0] || "?")[0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}
