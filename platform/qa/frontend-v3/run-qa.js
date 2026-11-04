// QA for the v3 frontend in mock mode: screenshots of every page at 1280 and 375 px,
// axe-core (WCAG 2.2 AA rules), horizontal-scroll and 44 px target checks.
//
// Usage: serve platform/frontend on :8765 (python3 -m http.server 8765), then
//   AXE_PATH=/path/to/axe.min.js OUT=platform/qa/frontend-v3 node platform/qa/frontend-v3/run-qa.js
// axe-core is loaded from the CDN first and from AXE_PATH when the CDN is unreachable.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:8765/index.html";
const OUT = process.env.OUT || __dirname;
const SHOTS = path.join(OUT, "screenshots");
const AXE_CDN = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js";
const AXE_PATH = process.env.AXE_PATH;
const WIDTHS = (process.env.WIDTHS || "1280,375").split(",").map(Number);
const PREFS = { largerText: false, extraSpacing: false, reduceMotion: true, zoom: 100 };
fs.mkdirSync(SHOTS, { recursive: true });

const report = { generated_at: new Date().toISOString(), axe_source: null, pages: [] };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function injectAxe(page) {
  if (await page.evaluate(() => !!window.axe)) return;
  try {
    await page.addScriptTag({ url: AXE_CDN });
    report.axe_source = report.axe_source || "cdn";
  } catch {
    if (!AXE_PATH) throw new Error("axe-core CDN unreachable and AXE_PATH not set");
    await page.addScriptTag({ path: AXE_PATH });
    report.axe_source = report.axe_source || "local npm copy (CDN blocked)";
  }
}

async function checks(page, width) {
  await injectAxe(page);
  const axe = await page.evaluate(async () => {
    const r = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
    });
    return r.violations.map((v) => ({
      id: v.id, impact: v.impact, help: v.help, tags: v.tags.filter((t) => t.startsWith("wcag")),
      nodes: v.nodes.slice(0, 6).map((n) => ({ target: n.target.join(" "), summary: (n.failureSummary || "").split("\n").slice(0, 3).join(" ") })),
      count: v.nodes.length,
    }));
  });
  const layout = await page.evaluate(() => {
    const doc = document.documentElement;
    const zoom = Number(doc.style.zoom || 1) || 1;
    const small = [];
    const seen = new Set();
    for (const el of document.querySelectorAll("a[href], button, input, select, textarea, summary, [role=tab], [tabindex='0']")) {
      if (el.closest("[hidden], [inert]") || el.disabled) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || (el.type === "radio" || el.type === "checkbox") && el.closest("label")) continue;
      // Inline links inside running text are exempt (WCAG 2.5.8 inline exception).
      const inline = el.tagName === "A" && style.display === "inline" && el.parentElement && /^(P|LI|DD|SPAN|TD)$/.test(el.parentElement.tagName);
      if (inline) continue;
      // Chips expand their hit area with ::after (44 px tall).
      let h = r.height / zoom;
      let w = r.width / zoom;
      const after = getComputedStyle(el, "::after");
      if (el.classList.contains("chip") && after.content !== "none") { h += 20; w += 12; }
      if (h < 43.5 || w < 23.5) {
        const label = (el.getAttribute("aria-label") || el.textContent || el.name || el.id || el.tagName).trim().slice(0, 40);
        const key = `${el.tagName}:${label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        small.push({ el: el.tagName.toLowerCase() + (el.className ? `.${String(el.className).split(" ")[0]}` : ""), label, w: Math.round(w), h: Math.round(h) });
      }
    }
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, horizontalScroll: doc.scrollWidth > doc.clientWidth + 1, small };
  });
  return { axe, layout, width };
}

async function snap(page, name, width, { fullPage = true } = {}) {
  await wait(250);
  const file = `${name}-${width}.jpg`;
  await page.screenshot({ path: path.join(SHOTS, file), fullPage, type: "jpeg", quality: 82 });
  const res = await checks(page, width);
  report.pages.push({ name, file, url: page.url().replace(/^.*index\.html/, ""), ...res });
  const flags = [
    res.axe.length ? `axe:${res.axe.map((v) => `${v.id}(${v.count})`).join(",")}` : "axe:ok",
    res.layout.horizontalScroll ? `HSCROLL ${res.layout.scrollWidth}/${res.layout.clientWidth}` : "",
    res.layout.small.length ? `small:${res.layout.small.length}` : "",
  ].filter(Boolean).join(" ");
  console.log(`${name.padEnd(34)} ${String(width).padEnd(5)} ${flags}`);
}

async function newContext(browser, width, { prefs = PREFS } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height: width < 600 ? 812 : 860 },
    deviceScaleFactor: 2,
    hasTouch: width < 600,
    isMobile: width < 600,
    reducedMotion: "reduce",
  });
  if (prefs) {
    await ctx.addInitScript((p) => { try { localStorage.setItem("mc_reading_preferences_v1", JSON.stringify(p)); } catch { /* ignore */ } }, prefs);
  }
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  pageerror:", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.log("  console error:", m.text()); });
  return { ctx, page };
}

async function go(page, hash, extra = "", ms = 700) {
  await page.goto(`${BASE}?mock=1${extra}#${hash}`);
  await wait(ms);
}

async function signIn(page, who, extra = "") {
  await go(page, "/", extra, 500);
  await page.click(`text=Continue as demo ${who}`);
  await wait(700);
}

async function run(width) {
  const browser = await chromium.launch();
  const mobile = width < 600;

  // Signed out, first visit.
  {
    const { ctx, page } = await newContext(browser, width, { prefs: null });
    await go(page, "/");
    await snap(page, "01-welcome", width);
    await page.click("text=Skip — use defaults");
    await wait(600);
    await snap(page, "02-landing", width);
    await go(page, "/shared/sample-share", "", 900);
    await snap(page, "03-shared-signed-out", width);
    await go(page, "/join/sample-invite");
    await snap(page, "04-join-signed-out", width);
    await ctx.close();
  }

  // Demo owner.
  {
    const { ctx, page } = await newContext(browser, width);
    await signIn(page, "owner");
    await snap(page, "05-new-research", width);
    await page.click("role=tab[name='Existing']");
    await wait(300);
    await snap(page, "06-new-existing-history", width);
    await go(page, "/c/conv-draft-01");
    await snap(page, "07-conversation-draft", width);
    await go(page, "/c/conv-ready-01");
    await snap(page, "08-conversation-ready", width);
    await page.click("label[for=mode-smarter]");
    await page.click("text=Start research");
    await wait(4500);
    await snap(page, "09-run-progress", width);

    await go(page, "/runs/a1b2c3d4e5f6", "", 1000);
    await snap(page, "10-report-grow", width);
    if (!mobile) {
      const chip = page.locator(".takeaway .chip").first();
      await chip.hover();
      await wait(600);
      await snap(page, "11-source-hovercard", width, { fullPage: false });
    }
    await page.locator(".takeaway .chip").first().click();
    await wait(400);
    await snap(page, "12-fact-card-sheet", width, { fullPage: false });
    await page.keyboard.press("Escape");
    await wait(200);
    const toggle = page.locator(".chart-toggle").first();
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    await wait(300);
    await page.locator(".chart").first().scrollIntoViewIfNeeded();
    await snap(page, "13-chart-show-data", width, { fullPage: false });
    await page.locator("button:has-text('Show a mock-up')").click();
    await wait(300);
    await snap(page, "14-mockup-dialog", width, { fullPage: false });
    await page.click("text=Create mock-up");
    await wait(2200);
    await page.locator("#r-mockups").scrollIntoViewIfNeeded();
    await snap(page, "15-report-with-mockup", width, { fullPage: false });

    await go(page, "/runs/c1d2e3f4a5b6", "", 1000);
    await snap(page, "16-report-compare", width);
    await go(page, "/runs/d1e2f3a4b5c6", "", 1000);
    await snap(page, "17-report-prepare", width);
    await go(page, "/runs/b1c2d3e4f5a6", "", 1000);
    await snap(page, "18-report-discover", width);
    await go(page, "/runs/e9f8a7b6c5d4", "", 900);
    await snap(page, "19-run-failed", width);
    await go(page, "/runs/aa11bb22cc33", "", 1000);
    await snap(page, "20-report-teammate", width);
    await go(page, "/runs");
    await snap(page, "21-reports-mine", width);
    await page.click("button:has-text('Team')");
    await wait(500);
    await snap(page, "22-reports-team", width);
    await go(page, "/library");
    await snap(page, "23-library-mine", width);
    await page.click(".toggle-btn:has-text('Team')");
    await wait(500);
    await snap(page, "24-library-team", width);
    await go(page, "/team");
    await snap(page, "25-team-owner", width);
    await page.fill("#invite-email", "jo.park@example.com");
    await page.click("text=Create invite");
    await wait(500);
    await snap(page, "26-team-invite-created", width);
    if (mobile) {
      await page.click("#menu-btn");
      await wait(400);
      await snap(page, "27-mobile-navigation", width, { fullPage: false });
      await page.keyboard.press("Escape");
      await wait(300);
      await page.click("#menu-btn");
      await wait(300);
      await page.click(".sb-reading");
    } else {
      await page.click(".sb-reading");
    }
    await wait(400);
    await snap(page, "28-reading-dialog", width, { fullPage: false });
    await page.keyboard.press("Escape");
    await go(page, "/does-not-exist");
    await snap(page, "29-not-found", width);
    await ctx.close();
  }

  // Demo member (non-owner): Smarter and mock-ups disabled, no team, accepts an invite.
  {
    const { ctx, page } = await newContext(browser, width);
    await signIn(page, "member");
    await go(page, "/c/conv-sam-01");
    await snap(page, "30-conversation-member", width);
    await go(page, "/runs/dd44ee55ff66", "", 1000);
    await snap(page, "31-report-member", width);
    await go(page, "/team");
    await snap(page, "32-team-none", width);
    await go(page, "/runs?scope=team");
    await snap(page, "33-reports-team-none", width);
    await go(page, "/join/sample-invite");
    await snap(page, "34-join-signed-in", width);
    await page.click("text=Join team");
    await wait(900);
    await snap(page, "35-team-member", width);
    await ctx.close();
  }

  // Mock-ups disabled (503): button and section hidden.
  {
    const { ctx, page } = await newContext(browser, width);
    await signIn(page, "owner", "&mockups=off");
    await go(page, "/runs/c1d2e3f4a5b6", "&mockups=off", 1000);
    await snap(page, "36-report-mockups-off", width, { fullPage: false });
    await ctx.close();
  }

  // Reading preferences: larger text + spacing, and 200% zoom.
  {
    const { ctx, page } = await newContext(browser, width, { prefs: { largerText: true, extraSpacing: true, reduceMotion: true, zoom: 100 } });
    await signIn(page, "owner");
    await go(page, "/c/conv-ready-01");
    await snap(page, "37-larger-text-spacing", width);
    await ctx.close();
  }
  if (!mobile) {
    const { ctx, page } = await newContext(browser, width, { prefs: { ...PREFS, zoom: 200 } });
    await signIn(page, "owner");
    await go(page, "/runs/c1d2e3f4a5b6", "", 1000);
    await snap(page, "38-zoom-200", width);
    await ctx.close();
  }
  await browser.close();
}

(async () => {
  for (const w of WIDTHS) await run(w);
  fs.writeFileSync(path.join(OUT, "qa-report.json"), JSON.stringify(report, null, 2));
  const axeTotal = report.pages.reduce((n, p) => n + p.axe.length, 0);
  const hs = report.pages.filter((p) => p.layout.horizontalScroll).length;
  console.log(`\npages: ${report.pages.length}, axe violations (rule × page): ${axeTotal}, horizontal scroll: ${hs}, axe source: ${report.axe_source}`);
})();
