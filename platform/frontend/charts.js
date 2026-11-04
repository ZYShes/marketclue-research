// Accessible inline SVG charts for result.charts (SPEC v3). No chart library.
// Each chart: title, one-sentence caption, data labels, a kind badge (Sourced / Estimate),
// the method for estimates, and a "Show data" table toggle. Drawn at the container's real
// width so text stays legible on phones and under page zoom.
import { h, kindBadge, fmtMoney } from "./ui.js";

const NS = "http://www.w3.org/2000/svg";
const list = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (v == null || v === "" ? NaN : Number(v));
const finite = (v) => Number.isFinite(num(v));
let seq = 0;

const TYPE_WORDS = { bar: "Bar chart", stacked_bar: "Stacked bar chart", range: "Range chart" };

export function fmtValue(v, unit) {
  const n = num(v);
  if (!Number.isFinite(n)) return "";
  if (unit === "USD") return fmtMoney(n, "USD");
  const s = n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return unit === "%" ? `${s}%` : s;
}

function valueText(s, unit) {
  if (finite(s.low) && finite(s.high)) {
    const range = `${fmtValue(s.low, unit)}–${fmtValue(s.high, unit)}`;
    return finite(s.value) && num(s.value) !== num(s.low) && num(s.value) !== num(s.high)
      ? `${range} (point ${fmtValue(s.value, unit)})` : range;
  }
  return fmtValue(s.value, unit);
}

function el(tag, attrs = {}, text = null) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, String(v));
  if (text != null) node.textContent = text;
  return node;
}

let measureCtx = null;
function measure(text, font) {
  measureCtx = measureCtx || document.createElement("canvas").getContext("2d");
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

// Shortens text with "…" to fit maxWidth; the full label stays in <desc> and the data table.
function fit(text, font, maxWidth) {
  const full = String(text || "");
  if (measure(full, font) <= maxWidth) return full;
  let lo = 0;
  let hi = full.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${full.slice(0, mid)}…`, font) <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return `${full.slice(0, lo).trimEnd()}…`;
}

function niceMax(v) {
  if (!(v > 0)) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

export function validSeries(spec) {
  return list(spec && spec.series).filter((s) => s && (finite(s.value) || (finite(s.low) && finite(s.high))));
}

// spec → <figure> or null when there is nothing to draw.
export function renderChart(spec, { chip = () => null } = {}) {
  const series = validSeries(spec);
  if (!series.length) return null;
  const id = `chart-${++seq}`;
  const type = ["bar", "stacked_bar", "range"].includes(spec.type) ? spec.type : "bar";
  const kind = spec.kind === "estimate" ? "estimate" : "sourced";
  const unit = spec.unit || "count";
  const title = spec.title || "Chart";
  const canvas = h("div", { class: "chart-canvas" });
  const tableId = `${id}-data`;

  const hasSources = series.some((s) => list(s.card_ids).length);
  // SPEC v4: a stacked chart whose items carry segments draws one stacked bar per item
  // (e.g. eBay costs per ad-rate scenario); without segments it is the v3 single stacked bar.
  const segLabels = type === "stacked_bar" ? segmentLabels(series) : [];
  const segmented = segLabels.length > 0;
  const table = segmented ? segmentTable(series, segLabels, unit, title, hasSources, chip) : h("table", { class: "data-table" },
    h("caption", { class: "visually-hidden" }, `Data for ${title}`),
    h("thead", {}, h("tr", {},
      h("th", { scope: "col" }, "Item"),
      h("th", { scope: "col", class: "num" }, type === "range" ? "Range" : unit === "USD" ? "Amount" : unit === "%" ? "Share" : "Count"),
      type === "stacked_bar" ? h("th", { scope: "col", class: "num" }, "Share of total") : null,
      hasSources ? h("th", { scope: "col" }, "Sources") : null)),
    h("tbody", {}, series.map((s) => {
      const total = series.reduce((sum, x) => sum + Math.max(0, num(x.value) || 0), 0);
      return h("tr", {},
        h("th", { scope: "row" }, String(s.label || "")),
        h("td", { class: "num" }, valueText(s, unit)),
        type === "stacked_bar" ? h("td", { class: "num" }, total ? `${Math.round((num(s.value) / total) * 100)}%` : "") : null,
        hasSources ? h("td", { class: "chips-cell" }, list(s.card_ids).map(chip).filter(Boolean)) : null);
    })));
  const tableWrap = h("div", { class: "chart-data table-scroll", id: tableId, hidden: true, role: "region", "aria-label": `Data for ${title}`, tabindex: "0" }, table);
  const toggle = h("button", { type: "button", class: "btn btn-ghost btn-sm chart-toggle", "aria-expanded": "false", "aria-controls": tableId }, "Show data");
  toggle.addEventListener("click", () => {
    const open = tableWrap.hidden;
    tableWrap.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Hide data" : "Show data";
  });

  const figure = h("figure", { class: `chart chart-${kind} chart-type-${type}`, "aria-labelledby": `${id}-title` },
    h("figcaption", { class: "chart-head" },
      h("div", { class: "chart-title-row" },
        h("h3", { class: "chart-title", id: `${id}-title` }, title),
        kindBadge(kind)),
      spec.caption ? h("p", { class: "chart-caption" }, String(spec.caption)) : null),
    canvas,
    kind === "estimate" && spec.method
      ? h("p", { class: "method" }, h("span", { class: "method-label" }, "Method: "), String(spec.method))
      : null,
    h("div", { class: "chart-foot" }, toggle),
    tableWrap);

  const desc = `${TYPE_WORDS[type]}${kind === "estimate" ? ", estimate" : ""}. ` +
    (segmented
      ? series.map((s) => `${s.label}: ${list(s.segments).map((g) => `${g.label} ${fmtValue(g.value, unit)}`).join(", ")}; total ${fmtValue(s.value, unit)}`).join(". ")
      : series.map((s) => `${s.label}: ${valueText(s, unit)}`).join("; ")) + ".";
  let lastKey = "";
  const draw = () => {
    if (!canvas.isConnected) return;
    const width = Math.floor(canvas.clientWidth);
    const fs = parseFloat(getComputedStyle(canvas).fontSize) || 14;
    const key = `${width}:${fs}`;
    if (!width || key === lastKey) return;
    lastKey = key;
    const font = getComputedStyle(canvas).fontFamily;
    const drawFn = segmented ? drawSegmented : type === "stacked_bar" ? drawStacked : drawBars;
    const svgEl = drawFn({ series, unit, width, fs, font, id, kind, type, title, desc, segLabels });
    canvas.replaceChildren(svgEl);
  };
  if (typeof ResizeObserver === "function") new ResizeObserver(draw).observe(canvas);
  const onLayout = () => {
    if (!figure.isConnected && figure.dataset.mounted) window.removeEventListener("mc:layout", onLayout);
    else { lastKey = ""; draw(); }
  };
  window.addEventListener("mc:layout", onLayout);
  requestAnimationFrame(() => { figure.dataset.mounted = "1"; draw(); });
  return figure;
}

// Segment labels in first-seen order; the order fixes each segment's colour across bars.
function segmentLabels(series) {
  const labels = [];
  for (const s of series) {
    for (const g of list(s.segments)) {
      const label = String((g && g.label) || "");
      if (label && finite(g.value) && !labels.includes(label)) labels.push(label);
    }
  }
  return labels;
}

function segmentValue(s, label) {
  const g = list(s.segments).find((x) => x && String(x.label) === label);
  return g && finite(g.value) ? num(g.value) : null;
}

function segmentTable(series, labels, unit, title, hasSources, chip) {
  return h("table", { class: "data-table" },
    h("caption", { class: "visually-hidden" }, `Data for ${title}`),
    h("thead", {}, h("tr", {},
      h("th", { scope: "col" }, "Item"),
      labels.map((label) => h("th", { scope: "col", class: "num" }, label)),
      h("th", { scope: "col", class: "num" }, "Total"),
      hasSources ? h("th", { scope: "col" }, "Sources") : null)),
    h("tbody", {}, series.map((s) => h("tr", {},
      h("th", { scope: "row" }, String(s.label || "")),
      labels.map((label) => {
        const v = segmentValue(s, label);
        return h("td", { class: "num" }, v == null ? "—" : fmtValue(v, unit));
      }),
      h("td", { class: "num" }, fmtValue(s.value, unit)),
      hasSources ? h("td", { class: "chips-cell" }, list(s.card_ids).map(chip).filter(Boolean)) : null))));
}

function svgRoot(width, height, id, title, desc) {
  const root = el("svg", {
    width, height, viewBox: `0 0 ${width} ${height}`, role: "img",
    "aria-labelledby": `${id}-svg-title ${id}-svg-desc`, class: "chart-svg",
  });
  root.append(el("title", { id: `${id}-svg-title` }, title), el("desc", { id: `${id}-svg-desc` }, desc));
  const defs = el("defs");
  const pattern = el("pattern", { id: `${id}-hatch`, width: 7, height: 7, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
  pattern.append(el("rect", { width: 7, height: 7, class: "hatch-bg" }), el("line", { x1: 0, y1: 0, x2: 0, y2: 7, class: "hatch-line" }));
  defs.append(pattern);
  root.append(defs);
  return root;
}

function drawBars({ series, unit, width, fs, font, id, kind, type, title, desc }) {
  const labelFont = `600 ${fs}px ${font}`;
  const valueFont = `600 ${fs}px ${font}`;
  const labels = series.map((s) => valueText(s, unit));
  const maxLabelW = Math.max(...labels.map((t) => measure(t, valueFont)));
  const maxVal = niceMax(Math.max(...series.map((s) => Math.max(num(s.value) || 0, num(s.high) || 0))));
  const barH = Math.max(18, Math.round(fs * 1.35));
  const nameH = Math.round(fs * 1.4);
  const rowGap = Math.round(fs * 0.9);
  const rowH = nameH + barH + rowGap;
  const plotW = Math.max(60, width - maxLabelW - 12);
  const axisH = type === "range" ? Math.round(fs * 2) : 0;
  const height = series.length * rowH - rowGap + axisH + 4;
  const x = (v) => Math.max(0, Math.min(plotW, (num(v) / maxVal) * plotW));
  const root = svgRoot(width, height, id, title, desc);
  // Inline style so the hatch wins over the stylesheet fill (presentation attributes would not).
  const style = kind === "estimate" ? `fill: url(#${id}-hatch)` : null;

  if (type === "range") {
    // Light gridlines with tick labels so range positions can be read.
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * maxVal);
    const gridBottom = height - axisH + 2;
    ticks.forEach((t) => {
      const tx = Math.round(x(t)) + 0.5;
      root.append(el("line", { x1: tx, x2: tx, y1: 0, y2: gridBottom, class: "chart-grid" }));
      const label = fmtValue(t, unit);
      const lw = measure(label, `${fs * 0.85}px ${font}`);
      root.append(el("text", {
        x: Math.min(Math.max(tx, lw / 2), width - lw / 2), y: height - Math.round(fs * 0.4),
        "text-anchor": "middle", class: "chart-tick", "font-size": fs * 0.85,
      }, label));
    });
  }

  series.forEach((s, i) => {
    const y0 = i * rowH;
    const barY = y0 + nameH;
    root.append(el("text", { x: 0, y: y0 + fs, class: "chart-label", "font-size": fs }, fit(s.label, labelFont, width)));
    let endX;
    if (finite(s.low) && finite(s.high)) {
      const x1 = x(Math.min(num(s.low), num(s.high)));
      const x2 = x(Math.max(num(s.low), num(s.high)));
      const w = Math.max(4, x2 - x1);
      root.append(el("rect", { x: x1, y: barY, width: w, height: barH, rx: barH / 2, class: "chart-bar", style }));
      endX = x1 + w;
      if (finite(s.value)) {
        const vx = Math.min(Math.max(x(s.value), x1 + 3), x1 + w - 3);
        root.append(el("circle", { cx: vx, cy: barY + barH / 2, r: Math.max(4, barH * 0.28), class: "chart-point" }));
      }
    } else if (type === "range") {
      // A single value in a range chart is a point, not a bar from zero.
      const vx = x(s.value);
      const r = Math.max(6, barH * 0.38);
      root.append(el("line", { x1: 0, x2: vx, y1: barY + barH / 2, y2: barY + barH / 2, class: "chart-track" }));
      root.append(el("circle", { cx: vx, cy: barY + barH / 2, r, class: "chart-dot" }));
      endX = vx + r;
    } else {
      const w = Math.max(3, x(s.value));
      root.append(el("rect", { x: 0, y: barY, width: w, height: barH, rx: 3, class: "chart-bar", style }));
      endX = w;
    }
    root.append(el("text", {
      x: endX + 8, y: barY + barH / 2 + fs * 0.35, class: "chart-value", "font-size": fs,
    }, labels[i]));
  });
  return root;
}

// One horizontal stacked bar per series item, all on one scale, with one legend for the segments.
function drawSegmented({ series, unit, width, fs, font, id, title, desc, segLabels }) {
  const segTotal = (s) => list(s.segments).reduce((sum, g) => sum + Math.max(0, num(g && g.value) || 0), 0);
  const maxTotal = Math.max(...series.map((s) => Math.max(segTotal(s), num(s.value) || 0))) || 1;
  const valueFont = `600 ${fs}px ${font}`;
  const totals = series.map((s) => fmtValue(s.value, unit));
  const maxLabelW = Math.max(...totals.map((t) => measure(t, valueFont)));
  const plotW = Math.max(60, width - maxLabelW - 12);
  const barH = Math.max(24, Math.round(fs * 1.9));
  const nameH = Math.round(fs * 1.4);
  const rowGap = Math.round(fs * 0.9);
  const rowH = nameH + barH + rowGap;
  const gap = 2;
  const swatch = Math.round(fs * 0.9);
  const legendFont = `${fs}px ${font}`;
  const items = segLabels.map((label, i) => ({ i, text: label, w: swatch + 8 + measure(label, legendFont) + 20 }));
  const rows = [];
  let row = [];
  let rowW = 0;
  for (const it of items) {
    if (row.length && rowW + it.w > width) { rows.push(row); row = []; rowW = 0; }
    row.push(it);
    rowW += it.w;
  }
  if (row.length) rows.push(row);
  const lineH = Math.round(fs * 1.7);
  const barsH = series.length * rowH - rowGap;
  const height = barsH + 14 + rows.length * lineH;
  const root = svgRoot(width, height, id, title, desc);
  const scale = plotW / maxTotal;

  series.forEach((s, si) => {
    const y0 = si * rowH;
    const barY = y0 + nameH;
    root.append(el("text", { x: 0, y: y0 + fs, class: "chart-label", "font-size": fs }, String(s.label || "")));
    let cx = 0;
    segLabels.forEach((label, i) => {
      const v = segmentValue(s, label);
      if (v == null || v <= 0) return;
      const w = Math.max(2, v * scale - gap);
      root.append(el("rect", { x: cx, y: barY, width: w, height: barH, class: `chart-seg chart-seg-${i % 5}` }));
      const text = fmtValue(v, unit);
      if (measure(text, valueFont) + 10 < w) {
        root.append(el("text", { x: cx + w / 2, y: barY + barH / 2 + fs * 0.35, "text-anchor": "middle", class: "chart-seg-label", "font-size": fs }, text));
      }
      cx += w + gap;
    });
    root.append(el("text", { x: Math.max(cx, 0) + 6, y: barY + barH / 2 + fs * 0.35, class: "chart-value", "font-size": fs }, totals[si]));
  });
  rows.forEach((r, ri) => {
    let lx = 0;
    const ly = barsH + 14 + ri * lineH;
    for (const it of r) {
      root.append(el("rect", { x: lx, y: ly + (lineH - swatch) / 2 - 2, width: swatch, height: swatch, rx: 2, class: `chart-seg chart-seg-${it.i % 5}` }));
      root.append(el("text", { x: lx + swatch + 8, y: ly + lineH / 2 + fs * 0.3, class: "chart-legend", "font-size": fs }, it.text));
      lx += it.w;
    }
  });
  return root;
}

function drawStacked({ series, unit, width, fs, font, id, title, desc }) {
  const total = series.reduce((sum, s) => sum + Math.max(0, num(s.value) || 0), 0) || 1;
  const barH = Math.max(28, Math.round(fs * 2.2));
  const gap = 2;
  const usable = width - gap * (series.length - 1);
  const swatch = Math.round(fs * 0.9);
  const legendFont = `${fs}px ${font}`;
  // Legend items flow into rows.
  const items = series.map((s, i) => {
    const pct = Math.round(((num(s.value) || 0) / total) * 100);
    const text = fit(`${s.label} · ${fmtValue(s.value, unit)} (${pct}%)`, legendFont, width - swatch - 28);
    return { i, text, w: swatch + 8 + measure(text, legendFont) + 20 };
  });
  const rows = [];
  let row = [];
  let rowW = 0;
  for (const it of items) {
    if (row.length && rowW + it.w > width) { rows.push(row); row = []; rowW = 0; }
    row.push(it);
    rowW += it.w;
  }
  if (row.length) rows.push(row);
  const lineH = Math.round(fs * 1.7);
  const height = barH + 12 + rows.length * lineH;
  const root = svgRoot(width, height, id, title, desc);

  let cx = 0;
  series.forEach((s, i) => {
    const w = Math.max(2, ((Math.max(0, num(s.value) || 0)) / total) * usable);
    const cls = `chart-seg chart-seg-${i % 4}`;
    root.append(el("rect", { x: cx, y: 0, width: w, height: barH, class: cls }));
    const label = fmtValue(s.value, unit);
    if (measure(label, `600 ${fs}px ${font}`) + 12 < w) {
      root.append(el("text", { x: cx + w / 2, y: barH / 2 + fs * 0.35, "text-anchor": "middle", class: "chart-seg-label", "font-size": fs }, label));
    }
    cx += w + gap;
  });
  rows.forEach((r, ri) => {
    let lx = 0;
    const ly = barH + 12 + ri * lineH;
    for (const it of r) {
      root.append(el("rect", { x: lx, y: ly + (lineH - swatch) / 2 - 2, width: swatch, height: swatch, rx: 2, class: `chart-seg chart-seg-${it.i % 4}` }));
      root.append(el("text", { x: lx + swatch + 8, y: ly + lineH / 2 + fs * 0.3, class: "chart-legend", "font-size": fs }, it.text));
      lx += it.w;
    }
  });
  return root;
}
