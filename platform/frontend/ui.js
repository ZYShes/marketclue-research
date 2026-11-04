// Small DOM and formatting helpers shared by every view.
// All text goes in through textContent; links are restricted to http(s), relative paths and in-app hashes.

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

const stroke = (paths, size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

export const ICONS = {
  mark: `<svg class="mark" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M12 2.75 A9.25 9.25 0 0 0 12 21.25 Z" fill="var(--accent)"/></svg>`,
  check: stroke('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 16),
  close: stroke('<path d="M6 6l12 12M18 6L6 18"/>'),
  external: `<svg class="ext" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
    <path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  plus: stroke('<path d="M12 5v14M5 12h14"/>'),
  menu: stroke('<path d="M4 7h16M4 12h16M4 17h16"/>', 20),
  search: stroke('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
  library: stroke('<path d="M5 4h4v16H5zM10 4h4v16h-4z"/><path d="M15.5 4.8l3.7-1 3.3 15.5-3.7.8z"/>'),
  reports: stroke('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>'),
  team: stroke('<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9.5" r="2.5"/><path d="M16.2 14.6c2.4.1 4 1.7 4.4 4.4"/>'),
  reading: stroke('<path d="M4 6h16M4 12h10M4 18h7"/><circle cx="18" cy="16" r="3"/>'),
  chevron: stroke('<path d="M9 6l6 6-6 6"/>', 16),
  chevronDown: stroke('<path d="M6 9l6 6 6-6"/>', 16),
  share: stroke('<path d="M12 4v11M7.5 8.5L12 4l4.5 4.5"/><path d="M5 13v6h14v-6"/>'),
  image: stroke('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5L5 19.5"/>'),
  chat: stroke('<path d="M5 5h14v10H10l-5 4z"/>'),
  copy: stroke('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5H4v12h4"/>'),
  logout: stroke('<path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/>'),
  arrow: stroke('<path d="M5 12h14M13 6l6 6-6 6"/>', 16),
  send: stroke('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  sparkle: stroke('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.5 6.5l2.5 2.5M15 15l2.5 2.5M17.5 6.5L15 9M9 15l-2.5 2.5"/>'),
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
    h("span", { class: "nowrap" }, `${last} `, icon("external")),
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
  if (s < 90) return "1 min ago";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 5400) return "1 hour ago";
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  if (s < 2 * 86400) return "yesterday";
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`;
  return fmtDate(iso);
}

// "Today", "This week" or "Earlier" for history grouping.
export function historyGroup(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Earlier";
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= startOfToday) return "Today";
  if (d.getTime() >= startOfToday - 6 * 86400000) return "This week";
  return "Earlier";
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

// ---- Reading preferences ----------------------------------------------------
// Stay usable in memory when browser storage is blocked.

const READING_KEY = "mc_reading_preferences_v1";
const READING_DEFAULTS = { largerText: false, extraSpacing: false, reduceMotion: false, zoom: 100 };
let readingPreferences = { ...READING_DEFAULTS };
let readingEntered = false;
let readingInitialized = false;
let welcomeForm = null;
let welcomeEnter = null;

function normalizeReading(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    largerText: value.largerText === true,
    extraSpacing: value.extraSpacing === true,
    reduceMotion: value.reduceMotion === true,
    zoom: [100, 150, 200].includes(value.zoom) ? value.zoom : 100,
  };
}

function applyReading(value) {
  const root = document.documentElement;
  root.classList.toggle("reading-large", value.largerText);
  root.classList.toggle("reading-spaced", value.extraSpacing);
  root.classList.toggle("reading-reduced-motion", value.reduceMotion);
  root.style.zoom = value.zoom === 100 ? "" : String(value.zoom / 100);
  window.dispatchEvent(new Event("mc:layout"));
}

export function currentZoom() {
  return Number(document.documentElement.style.zoom || 1) || 1;
}

export function prefersReducedMotion() {
  return document.documentElement.classList.contains("reading-reduced-motion") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function initializeReadingPreferences() {
  if (readingInitialized) return;
  readingInitialized = true;
  try {
    const saved = normalizeReading(JSON.parse(storage.get(READING_KEY)));
    if (saved) {
      readingPreferences = saved;
      readingEntered = true;
    }
  } catch { /* Invalid saved data uses the welcome defaults. */ }
  applyReading(readingPreferences);
}

export function hasReadingPreferences() {
  initializeReadingPreferences();
  return readingEntered;
}

function saveReading(value) {
  readingPreferences = { ...value };
  readingEntered = true;
  storage.set(READING_KEY, JSON.stringify(readingPreferences));
  applyReading(readingPreferences);
}

function readingForm({ prefix, welcome = false, onSave, onCancel, initial = readingPreferences }) {
  const draft = { ...initial };
  const preview = h("p", { class: "reading-preview", id: `${prefix}-preview` },
    "Your next idea deserves a clear view.");
  const status = h("span", { class: "visually-hidden", role: "status", "aria-live": "polite" });
  function update() {
    applyReading(draft);
    status.textContent = `Preview: ${draft.largerText ? "larger" : "standard"} text, ${draft.extraSpacing ? "extra" : "standard"} spacing, ${draft.reduceMotion ? "reduced" : "system"} motion, ${draft.zoom}% zoom.`;
  }
  const check = (key, label, hint) => h("label", { class: "option-row", for: `${prefix}-${key}` },
    h("input", {
      type: "checkbox", id: `${prefix}-${key}`, name: key, checked: draft[key],
      onchange: (event) => { draft[key] = event.target.checked; update(); },
    }),
    h("span", { class: "option-text" }, h("span", { class: "option-label" }, label), h("span", { class: "option-hint" }, hint)));
  const zoom = h("fieldset", { class: "reading-zoom" },
    h("legend", {}, "Page zoom"),
    h("div", { class: "segmented segmented-3" }, [100, 150, 200].map((value) =>
      h("label", { class: "segment", for: `${prefix}-zoom-${value}` },
        h("input", {
          type: "radio", id: `${prefix}-zoom-${value}`, name: `${prefix}-zoom`,
          value, checked: draft.zoom === value,
          onchange: () => { draft.zoom = value; update(); },
        }),
        h("span", { class: "segment-label" }, `${value}%`)))));
  return h("form", {
    class: "reading-form", "aria-describedby": `${prefix}-description`,
    onsubmit: (event) => { event.preventDefault(); saveReading(draft); onSave(); },
  },
  h("div", { class: "option-list" },
    check("largerText", "Larger text", "Text and controls at 125%"),
    check("extraSpacing", "Extra spacing", "More room between lines and words"),
    check("reduceMotion", "Reduce motion", "No animations or moving indicators")),
  zoom,
  h("div", { class: "reading-preview-wrap", "aria-label": "Live preview" }, preview, status),
  h("div", { class: "form-actions" },
    h("button", { type: "submit", class: "btn btn-primary" }, welcome ? "Save and continue" : "Save changes"),
    h("button", {
      type: "button", class: "btn btn-secondary",
      onclick: () => {
        if (welcome) { saveReading(READING_DEFAULTS); onSave(); }
        else onCancel();
      },
    }, welcome ? "Skip — use defaults" : "Cancel")));
}

export function renderWelcome(onEnter) {
  initializeReadingPreferences();
  setTitle("Welcome");
  welcomeEnter = () => { welcomeForm = null; welcomeEnter = null; onEnter(); };
  welcomeForm = readingForm({ prefix: "welcome", welcome: true, onSave: welcomeEnter });
  return h("div", { class: "welcome-page" },
    h("div", { class: "welcome-brand" }, svg(ICONS.mark), h("span", {}, "MarketClue")),
    h("section", { class: "welcome-card surface", "aria-labelledby": "welcome-title" },
      h("p", { class: "eyebrow" }, "Reading & motion"),
      h("h1", { id: "welcome-title", tabindex: "-1" }, "A little more your way."),
      h("p", { id: "welcome-description", class: "muted" }, "Choose how you like to read. You can change this any time from Reading & motion."),
      welcomeForm));
}

export function openReadingDialog() {
  initializeReadingPreferences();
  const dialog = document.getElementById("reading-dialog");
  if (!dialog || dialog.open) return;
  const opener = document.activeElement;
  const root = document.documentElement;
  const beforeOpen = {
    largerText: root.classList.contains("reading-large"),
    extraSpacing: root.classList.contains("reading-spaced"),
    reduceMotion: root.classList.contains("reading-reduced-motion"),
    zoom: Math.round(currentZoom() * 100),
  };
  let finished = false;
  function finish(saved = false) {
    if (finished) return;
    finished = true;
    if (!saved) applyReading(beforeOpen);
    dialog.removeEventListener("cancel", onCancel);
    dialog.removeEventListener("close", onClose);
    if (dialog.open) dialog.close();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }
  const close = () => finish(false);
  const onCancel = (event) => { event.preventDefault(); close(); };
  const onClose = () => close();
  dialog.replaceChildren(
    h("div", { class: "dialog-head" },
      h("h2", { id: "reading-dialog-title" }, "Reading & motion"),
      h("button", {
        type: "button", class: "icon-btn", "aria-label": "Close reading preferences", onclick: close,
      }, icon("close"))),
    h("p", { id: "settings-description", class: "muted" }, "Choose how you like to read. You can change this any time."),
    readingForm({
      prefix: "settings", initial: beforeOpen,
      onSave: () => {
        if (welcomeForm?.isConnected) {
          const nextForm = readingForm({ prefix: "welcome", welcome: true, onSave: welcomeEnter });
          welcomeForm.replaceWith(nextForm);
          welcomeForm = nextForm;
        }
        finish(true);
        toast("Reading preferences saved.");
      },
      onCancel: close,
    }));
  trapFocus(dialog);
  dialog.addEventListener("cancel", onCancel);
  dialog.addEventListener("close", onClose);
  dialog.showModal();
}

// Keeps Tab inside a modal dialog (native showModal already makes the page inert;
// this also wraps focus at the ends instead of escaping to the browser chrome).
export function trapFocus(dialog) {
  if (dialog.dataset.trap) return;
  dialog.dataset.trap = "1";
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const controls = [...dialog.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled && el.getClientRects().length);
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  });
}

// ---- Confirm dialog ----------------------------------------------------------

export function confirmDialog({ title, body, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    let dlg = document.getElementById("confirm-dialog");
    if (!dlg) {
      dlg = h("dialog", { id: "confirm-dialog", class: "dialog dialog-sm", "aria-labelledby": "confirm-title", "aria-describedby": "confirm-body" });
      document.body.append(dlg);
    }
    const opener = document.activeElement;
    const cancel = h("button", { type: "button", class: "btn btn-secondary", onclick: () => done(false) }, "Cancel");
    const ok = h("button", { type: "button", class: `btn ${danger ? "btn-danger" : "btn-primary"}`, onclick: () => done(true) }, confirmLabel);
    dlg.replaceChildren(
      h("h2", { id: "confirm-title" }, title),
      h("p", { id: "confirm-body", class: "muted" }, body),
      h("div", { class: "form-actions form-actions-end" }, cancel, ok));
    let settled = false;
    function done(value) {
      if (settled) return;
      settled = true;
      dlg.removeEventListener("cancel", onCancel);
      if (dlg.open) dlg.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      resolve(value);
    }
    const onCancel = (event) => { event.preventDefault(); done(false); };
    dlg.addEventListener("cancel", onCancel);
    trapFocus(dlg);
    dlg.showModal();
    cancel.focus();
  });
}

// ---- Small controls ----------------------------------------------------------

// Two or more mutually exclusive view options, e.g. Mine | Team. Buttons with aria-pressed.
export function toggleGroup({ label, options, value, onChange }) {
  const buttons = options.map(([key, text]) => h("button", {
    type: "button", class: "toggle-btn", "aria-pressed": String(key === value),
    onclick: () => {
      buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(options[i][0] === key)));
      onChange(key);
    },
  }, text));
  return h("div", { class: "toggle-group", role: "group", "aria-label": label }, buttons);
}

// Accessible tabs: arrow keys move between tabs, Home/End jump, panels are labelled by their tab.
export function tabs({ id, label, items, selected, onSelect }) {
  const tabEls = [];
  const panels = [];
  const list = h("div", { class: "tabs", role: "tablist", "aria-label": label });
  items.forEach((item, i) => {
    const isSel = item.key === selected;
    const tab = h("button", {
      type: "button", role: "tab", id: `${id}-tab-${item.key}`, class: "tab",
      "aria-selected": String(isSel), "aria-controls": `${id}-panel-${item.key}`, tabindex: isSel ? "0" : "-1",
      onclick: () => select(item.key, true),
      onkeydown: (event) => {
        let next = null;
        if (event.key === "ArrowRight") next = (i + 1) % items.length;
        else if (event.key === "ArrowLeft") next = (i - 1 + items.length) % items.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = items.length - 1;
        if (next == null) return;
        event.preventDefault();
        select(items[next].key, true);
        tabEls[next].focus();
      },
    }, item.label, item.count != null ? h("span", { class: "tab-count" }, String(item.count)) : null);
    tabEls.push(tab);
    list.append(tab);
    panels.push(h("div", {
      role: "tabpanel", id: `${id}-panel-${item.key}`, class: "tab-panel",
      "aria-labelledby": `${id}-tab-${item.key}`, hidden: !isSel, tabindex: "-1",
    }, item.render()));
  });
  function select(key, user) {
    items.forEach((item, i) => {
      const on = item.key === key;
      tabEls[i].setAttribute("aria-selected", String(on));
      tabEls[i].tabIndex = on ? 0 : -1;
      panels[i].hidden = !on;
    });
    if (user && onSelect) onSelect(key);
  }
  return { list, panels, select };
}

export function setTitle(page) {
  document.title = page ? `${page} · MarketClue` : "MarketClue · See the market differently";
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

// ---- Badges and chips -------------------------------------------------------

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

// Run status (queued/running/done/failed) and history status (draft/ready) share one chip style.
const STATUS_LABELS = {
  draft: "Draft", ready: "Ready", queued: "Queued", running: "Running", done: "Done", failed: "Failed",
};

export function statusChip(status) {
  const key = STATUS_LABELS[status] ? status : "draft";
  return h("span", { class: `status status-${key}` },
    h("span", { class: "status-dot", "aria-hidden": "true" }), STATUS_LABELS[key]);
}

export const statusPill = statusChip;

export function initials(user) {
  const src = (user && (user.name || user.email)) || "?";
  const parts = src.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0] || "?")[0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}

export function avatar(user, size = "") {
  const fallback = h("span", { class: `avatar avatar-initials ${size}`.trim(), "aria-hidden": "true" }, initials(user));
  if (!user || !user.picture) return fallback;
  const img = h("img", {
    class: `avatar ${size}`.trim(), src: user.picture, alt: "", width: 32, height: 32,
    referrerpolicy: "no-referrer", decoding: "async",
  });
  img.addEventListener("error", () => img.replaceWith(fallback), { once: true });
  return img;
}

export function emptyState({ title, text, action = null, headingLevel = 2 }) {
  return h("div", { class: "empty" },
    h(`h${headingLevel}`, { class: "empty-title" }, title),
    text ? h("p", { class: "muted" }, text) : null,
    action);
}
