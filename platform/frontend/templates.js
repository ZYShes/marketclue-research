// Templates (SPEC v4): shared helpers for the picker on #/new and the #/templates page, which lists
// every template the server offers, paginated in the browser (GET /api/templates returns one array).
import { h, icon, svg, storage, setTitle, toggleGroup, emptyState, plural } from "./ui.js";
import { api } from "./api.js";
import { state, main, page, pageHeader, loadingBlock, routeQuery, setRouteQuery } from "./core.js";
import { FEATURES, DEFAULT_TEMPLATE, TEMPLATE_NAMES, templateName } from "./features.js";

export const PAGE_SIZE = 6;

const TEMPLATE_ICONS = {
  general: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5s1.2-6.1 3.6-8.5z"/>',
  ebay: '<path d="M4.5 8h15l-1.3 10.2a2 2 0 0 1-2 1.8H7.8a2 2 0 0 1-2-1.8z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  food_truck: '<path d="M2.5 6.5h11.5v10H2.5z"/><path d="M14 9.5h3.8l3.2 3.5v3.5H14"/><path d="M5 9.5h6"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  restaurant: '<path d="M4 9.5h12v4a5.5 5.5 0 0 1-5.5 5.5h-1A5.5 5.5 0 0 1 4 13.5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5c0 1.4 1.5 1.6 1.5 3.2M11.5 3.5c0 1.4 1.5 1.6 1.5 3.2"/>',
  daycare: '<path d="M3.5 11.5 12 4.5l8.5 7"/><path d="M6 9.8v9.7h12V9.8"/><path d="M12 17.3 9.8 15.2a1.5 1.5 0 0 1 2.2-2 1.5 1.5 0 0 1 2.2 2z"/>',
  etsy: '<path d="M3.5 12.6V5a1.5 1.5 0 0 1 1.5-1.5h7.6l8 8-9.1 9.1z"/><circle cx="8" cy="8" r="1.5"/>',
  // Any other template: a stacked-cards glyph.
  other: '<rect x="4" y="7" width="13" height="13" rx="2"/><path d="M8 4h10a2 2 0 0 1 2 2v10"/>',
};

export const GENERAL_FALLBACK = {
  id: DEFAULT_TEMPLATE, name: TEMPLATE_NAMES.general, description: "Public web pages only.",
  tools: FEATURES.map((f) => f.id), capabilities: [], available: true, unavailable_reason: null,
};

export function templateIcon(id, size = 22) {
  const paths = TEMPLATE_ICONS[id] || TEMPLATE_ICONS.other;
  return svg(`<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`);
}

// GET /api/templates answers a JSON array (SPEC v4); tolerate {templates: [...]} too.
// Names are remembered so badges on reports show "Etsy seller" rather than a raw id.
export function normalizeTemplates(data) {
  const raw = Array.isArray(data) ? data : Array.isArray(data?.templates) ? data.templates : [];
  const items = raw.filter((t) => t && typeof t.id === "string").map((t) => ({
    id: t.id,
    name: t.name || templateName(t.id),
    description: t.description || "",
    tools: Array.isArray(t.tools) && t.tools.length ? t.tools : FEATURES.map((f) => f.id),
    capabilities: (Array.isArray(t.capabilities) ? t.capabilities : []).filter((c) => c && c.label),
    available: t.available !== false,
    unavailable_reason: t.unavailable_reason || null,
  }));
  if (!items.some((t) => t.id === DEFAULT_TEMPLATE)) items.unshift(GENERAL_FALLBACK);
  for (const t of items) if (t.name) TEMPLATE_NAMES[t.id] = t.name;
  return items;
}

export function fetchTemplates() {
  return api("/templates").then(normalizeTemplates).catch(() => [GENERAL_FALLBACK]);
}

export const templateKey = () => `mc_last_template_${(state.user && state.user.sub) || "anon"}`;

export function rememberTemplate(id) {
  storage.set(templateKey(), id);
}

export function lastTemplate() {
  return storage.get(templateKey()) || DEFAULT_TEMPLATE;
}

export function capabilityBadges(t, id) {
  return h("span", { class: "cap-badges", id },
    t.capabilities.length
      ? t.capabilities.map((c) => h("span", { class: "badge badge-cap" }, c.label))
      : h("span", { class: "badge badge-cap badge-cap-plain" }, "Web search and page reading"));
}

// ---- #/templates ------------------------------------------------------------------

export async function viewTemplates(isCurrent) {
  setTitle("Templates");
  main.replaceChildren(loadingBlock("Loading templates…"));
  const all = await fetchTemplates();
  if (!isCurrent()) return;

  const query = routeQuery();
  let q = query.get("q") || "";
  let show = query.get("show") === "available" ? "available" : "all";
  let pageNo = Math.max(1, parseInt(query.get("page"), 10) || 1);
  const last = lastTemplate();

  const search = h("input", { type: "search", id: "tpl-q", placeholder: "Name, description or source", autocomplete: "off", value: q });
  const toggle = toggleGroup({
    label: "Which templates", value: show,
    options: [["all", "All"], ["available", "Available now"]],
    onChange: (v) => { show = v; pageNo = 1; render(true); },
  });
  const count = h("p", { class: "result-count", id: "tpl-count", role: "status", tabindex: "-1" });
  const list = h("div", { class: "template-results" });
  const pager = h("div", { class: "pager-slot" });
  const toolbar = h("div", { class: "toolbar-row template-toolbar" },
    h("form", { class: "control control-grow", role: "search", onsubmit: (ev) => ev.preventDefault() },
      h("label", { for: "tpl-q" }, "Search templates"), search),
    h("div", { class: "control" }, h("span", { class: "control-label", "aria-hidden": "true" }, "Show"), toggle));

  main.replaceChildren(page(
    pageHeader({
      eyebrow: "New research",
      title: "Templates",
      lede: "A template adds questions, sources and report sections for one kind of business. General works for any business.",
      actions: h("a", { class: "btn btn-secondary btn-sm", href: "#/new" }, "Back to New research"),
    }),
    toolbar, count, list, pager));

  function matches(t) {
    if (show === "available" && !t.available) return false;
    if (!q) return true;
    const needle = q.toLowerCase();
    return [t.name, t.description, ...t.capabilities.map((c) => c.label)].some((v) => v && v.toLowerCase().includes(needle));
  }

  // Available first, then the server's order.
  const ordered = [...all].sort((a, b) => Number(b.available) - Number(a.available));

  function tile(t) {
    const base = `tpl-${t.id}`;
    const tools = FEATURES.filter((f) => t.tools.includes(f.id));
    return h("li", {},
      h("article", { class: `template-tile surface${t.available ? "" : " is-unavailable"}`, "aria-labelledby": `${base}-name` },
        h("div", { class: "template-tile-head" },
          h("span", { class: "tool-icon" }, templateIcon(t.id)),
          h("h2", { class: "template-tile-name", id: `${base}-name` }, t.name),
          t.available
            ? h("span", { class: "status status-done" }, h("span", { class: "status-dot", "aria-hidden": "true" }), "Available")
            : h("span", { class: "status" }, h("span", { class: "status-dot", "aria-hidden": "true" }), "Not available")),
        t.description ? h("p", { class: "template-tile-desc" }, t.description) : null,
        capabilityBadges(t, `${base}-caps`),
        h("p", { class: "template-tile-tools" },
          h("span", { class: "template-tile-label" }, "Tools: "),
          tools.length === FEATURES.length ? "All four tools" : tools.map((f) => f.name).join(", ")),
        h("div", { class: "template-tile-foot" },
          t.available
            ? [
                t.id === last ? h("span", { class: "badge badge-neutral" }, "Your current choice") : null,
                h("a", {
                  class: "btn btn-secondary btn-sm", href: `#/new?template=${encodeURIComponent(t.id)}`,
                  onclick: () => rememberTemplate(t.id),
                }, "Use this template", h("span", { class: "visually-hidden" }, `: ${t.name}`)),
              ]
            : h("p", { class: "template-reason" }, icon("info"), t.unavailable_reason || "Not set up yet"))));
  }

  function pageHref(n) {
    const params = new URLSearchParams(Object.entries({ q, show: show === "available" ? "available" : "", page: n > 1 ? String(n) : "" }).filter(([, v]) => v));
    const qs = params.toString();
    return `#/templates${qs ? `?${qs}` : ""}`;
  }

  function pagination(total) {
    if (total <= 1) return null;
    const link = (n, label, extra = {}) => h("a", {
      class: `pager-link${extra.current ? " is-current" : ""}`, href: pageHref(n), "aria-label": extra.aria || null,
      "aria-current": extra.current ? "page" : null,
      onclick: (ev) => { ev.preventDefault(); pageNo = n; render(true); },
    }, label);
    const disabled = (label) => h("span", { class: "pager-link is-disabled", "aria-disabled": "true" }, label);
    const items = [];
    items.push(pageNo > 1 ? link(pageNo - 1, [icon("chevronLeft"), h("span", {}, "Previous")], { aria: "Previous page" })
      : disabled([icon("chevronLeft"), h("span", {}, "Previous")]));
    for (let n = 1; n <= total; n += 1) {
      // Long lists: first, last and the pages next to the current one; gaps become "…".
      const near = n === 1 || n === total || Math.abs(n - pageNo) <= 1;
      if (near) items.push(link(n, String(n), { aria: `Page ${n}`, current: n === pageNo }));
      else if (items[items.length - 1]?.dataset?.gap !== "1") items.push(h("span", { class: "pager-gap", "aria-hidden": "true", dataset: { gap: "1" } }, "…"));
    }
    items.push(pageNo < total ? link(pageNo + 1, [h("span", {}, "Next"), icon("chevron")], { aria: "Next page" })
      : disabled([h("span", {}, "Next"), icon("chevron")]));
    return h("nav", { class: "pager", "aria-label": "Template pages" }, h("ul", {}, items.map((el) => h("li", {}, el))));
  }

  // fromUser: move focus to the result count so keyboard and screen-reader users land on the new page.
  function render(fromUser = false) {
    const filtered = ordered.filter(matches);
    const total = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (pageNo > total) pageNo = total;
    setRouteQuery({ q, show: show === "available" ? "available" : null, page: pageNo > 1 ? pageNo : null });
    const start = (pageNo - 1) * PAGE_SIZE;
    const slice = filtered.slice(start, start + PAGE_SIZE);
    if (!filtered.length) {
      count.textContent = "No templates match.";
      list.replaceChildren(emptyState({
        title: "No templates match",
        text: show === "available" ? "Try All to include templates that are not set up yet." : "Try another word.",
        action: h("button", {
          type: "button", class: "btn btn-secondary",
          onclick: () => { q = ""; search.value = ""; pageNo = 1; render(true); search.focus(); },
        }, "Clear search"),
      }));
      pager.replaceChildren();
      return;
    }
    count.textContent = total > 1
      ? `${plural(filtered.length, "template")} · showing ${start + 1}–${start + slice.length} · page ${pageNo} of ${total}`
      : plural(filtered.length, "template");
    list.replaceChildren(h("ul", { class: "template-list" }, slice.map(tile)));
    const nav = pagination(total);
    pager.replaceChildren(...(nav ? [nav] : []));
    if (fromUser) {
      count.focus({ preventScroll: true });
      // Bring the search and filter back into view with the count under them, clear of the phone's sticky top bar
      // (scroll-margin-top on the toolbar), instead of leaving the search box half under that bar.
      toolbar.scrollIntoView({ block: "nearest" });
    }
  }

  let debounce = null;
  search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { q = search.value.trim(); pageNo = 1; render(false); }, 200);
  });
  render(false);
  return () => clearTimeout(debounce);
}
