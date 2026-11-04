// Research depth slider: a native range input with one stop per mode (Quick → Balanced → Smarter).
// Drag, click the track or a stop name, or use arrow keys / Home / End. Screen readers hear the
// stop name, time and cost through aria-valuetext.
import { h } from "./ui.js";
import { MODES, MODE_ORDER } from "./features.js";

export function depthSlider({ value = "quick", onChange = () => {}, id = "depth", disabled = false } = {}) {
  const max = MODE_ORDER.length - 1;
  let index = Math.max(0, MODE_ORDER.indexOf(value));

  const input = h("input", {
    type: "range", id, class: "depth-range", min: "0", max: String(max), step: "1",
    value: String(index), disabled, "aria-describedby": `${id}-detail`,
  });
  const current = h("span", { class: "depth-current" });
  const meta = h("span", { class: "depth-meta" });
  const detail = h("p", { class: "depth-detail", id: `${id}-detail` });
  const ticks = MODE_ORDER.map(() => h("span", { class: "depth-tick" }));
  // Stop names are a mouse convenience; the range input is the keyboard and screen-reader control.
  const stops = MODE_ORDER.map((key, i) => h("span", {
    class: "depth-stop", onclick: () => { if (!input.disabled) { set(i, true); input.focus(); } },
  }, MODES[key].name));

  const el = h("div", { class: "depth" },
    h("div", { class: "depth-head" },
      h("label", { for: id, class: "depth-label" }, "Research depth"),
      current),
    h("div", { class: "depth-track" }, input, h("div", { class: "depth-ticks", "aria-hidden": "true" }, ticks)),
    h("div", { class: "depth-stops", "aria-hidden": "true", style: `--stops: ${MODE_ORDER.length}` }, stops),
    detail);

  function render() {
    const m = MODES[MODE_ORDER[index]];
    input.value = String(index);
    input.setAttribute("aria-valuetext", `${m.name}: about ${m.time}, ${m.cost}`);
    el.style.setProperty("--fill", `${(index / max) * 100}%`);
    el.dataset.mode = m.id;
    current.textContent = m.name;
    meta.textContent = `${m.time} · ${m.cost}`;
    detail.replaceChildren(meta, " ", m.detail);
    ticks.forEach((t, i) => {
      t.classList.toggle("is-filled", i < index);
      t.classList.toggle("is-current", i === index);
    });
    stops.forEach((s, i) => s.classList.toggle("is-active", i === index));
  }

  function set(i, fromUser) {
    const next = Math.min(max, Math.max(0, Math.round(Number(i) || 0)));
    const changed = next !== index;
    index = next;
    render();
    if (fromUser && changed) onChange(MODE_ORDER[index]);
  }

  input.addEventListener("input", () => set(input.value, true));
  render();

  return {
    el,
    get value() { return MODE_ORDER[index]; },
    set: (key) => set(MODE_ORDER.indexOf(key), false),
    focus: () => input.focus(),
  };
}
