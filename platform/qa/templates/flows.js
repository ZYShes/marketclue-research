// Template flows in mock mode (SPEC v4, eBay seller): pick the template, chat, run, see the listings
// and both charts; fee breakdown and ad budget; partial fees; eBay not connected; keyboard selection.
// Also screenshots the new pages at 1280 and 375 px with axe-core (WCAG 2.2 AA rules) and
// horizontal-scroll checks, written to qa/templates/screenshots and qa/templates/qa-report.json.
//
// Usage: serve platform/frontend (python3 -m http.server 8765), then
//   AXE_PATH=/path/to/axe.min.js node platform/qa/templates/flows.js
// Exits non-zero when any check fails.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:8765/index.html";
const OUT = process.env.OUT || __dirname;
const SHOTS = path.join(OUT, "screenshots");
const AXE_CDN = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js";
const AXE_PATH = process.env.AXE_PATH;
const PREFS = { largerText: false, extraSpacing: false, reduceMotion: true, zoom: 100 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { generated_at: new Date().toISOString(), axe_source: null, checks: [], pages: [] };
let failures = 0;
fs.mkdirSync(SHOTS, { recursive: true });

function check(cond, label) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  report.checks.push({ ok: !!cond, label });
  if (!cond) failures += 1;
}

async function context(browser, width = 1280, prefs = PREFS) {
  const mobile = width < 600;
  const ctx = await browser.newContext({
    viewport: { width, height: mobile ? 812 : 860 }, hasTouch: mobile, isMobile: mobile, reducedMotion: "reduce",
  });
  await ctx.addInitScript((p) => { try { localStorage.setItem("mc_reading_preferences_v1", JSON.stringify(p)); } catch { /* ignore */ } }, prefs);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { console.log("  pageerror:", e.message); failures += 1; });
  page.on("console", (m) => { if (m.type() === "error") console.log("  console error:", m.text()); });
  return { ctx, page };
}

const url = (hash, extra = "") => `${BASE}?mock=1${extra}#${hash}`;
async function go(page, hash, extra = "", ms = 800) {
  await page.goto(url(hash, extra));
  await wait(ms);
}
async function signIn(page, who = "owner", extra = "") {
  await go(page, "/", extra, 500);
  await page.click(`text=Continue as demo ${who}`);
  await wait(700);
}

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

// Screenshot + axe + horizontal scroll for one page state.
async function snap(page, name, width, { fullPage = true } = {}) {
  await wait(300);
  const file = `${name}-${width}.jpg`;
  await page.screenshot({ path: path.join(SHOTS, file), fullPage, type: "jpeg", quality: 82 });
  await injectAxe(page);
  const axe = await page.evaluate(async () => {
    const r = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
    });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, count: v.nodes.length, targets: v.nodes.slice(0, 4).map((n) => n.target.join(" ")) }));
  });
  const layout = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, horizontalScroll: doc.scrollWidth > doc.clientWidth + 1 };
  });
  report.pages.push({ name, file, width, axe, layout });
  const flags = [axe.length ? `axe:${axe.map((v) => `${v.id}(${v.count})`).join(",")}` : "axe:ok",
    layout.horizontalScroll ? `HSCROLL ${layout.scrollWidth}/${layout.clientWidth}` : ""].filter(Boolean).join(" ");
  console.log(`      ${name.padEnd(30)} ${String(width).padEnd(5)} ${flags}`);
  check(!axe.length, `${name} @${width}: no axe violations`);
  check(!layout.horizontalScroll, `${name} @${width}: no horizontal scroll`);
}

const bodyText = (page) => page.evaluate(() => document.body.innerText);

(async () => {
  const browser = await chromium.launch();

  // 1. Template picker: cards, badges, keyboard, remembered choice.
  {
    const { ctx, page } = await context(browser);
    await signIn(page);
    await go(page, "/new");
    check(await page.locator(".template-card").count() === 2, "#/new shows two template cards");
    check(await page.locator("#template-general").isChecked(), "General is the default template");
    const caps = await page.locator(".template-card:has(#template-ebay) .badge-cap").allTextContents();
    check(caps.includes("Searches live eBay listings") && caps.includes("Estimates eBay fees and ad costs"), "eBay card shows its capability badges");
    check((await page.locator(".tool-picker legend").first().textContent()).includes("Choose a template"), "template choice comes before the tools");
    await page.focus("#template-general");
    await page.keyboard.press("ArrowRight");
    check(await page.evaluate(() => document.activeElement.id === "template-ebay" && document.getElementById("template-ebay").checked),
      "ArrowRight selects eBay seller from the keyboard");
    check((await page.locator("#first-message-hint").textContent()).includes("target price"), "composer hint mentions the eBay questions");
    await page.reload();
    await wait(900);
    check(await page.locator("#template-ebay").isChecked(), "the template choice is remembered after a reload");

    // 2. eBay conversation → brief → run → report with listings and the asking-price chart.
    await page.check("#tool-competitor_scan", { force: true });
    await page.fill("#first-message", "Handmade 6-inch planters, to sell on eBay.");
    await page.keyboard.press("Enter");
    await wait(1300);
    check(/#\/c\/[0-9a-f]{12}$/.test(page.url()), "first message opens the eBay conversation");
    check((await page.locator(".conv-template").textContent()).includes("eBay seller template"), "conversation shows the template badge");
    for (const text of ["Home & Garden, new.", "$48, buyer pays shipping; not on eBay yet."]) {
      await page.fill("#chat-input", text);
      await page.keyboard.press("Enter");
      await wait(1200);
    }
    check(await page.locator(".brief-panel .status-ready").isVisible(), "eBay brief becomes Ready");
    check(await page.locator(".brief-ebay").isVisible(), "brief panel lists the eBay details");
    check((await page.locator(".brief-ebay").textContent()).includes("$48"), "eBay details include the target price");
    await page.click("button:has-text('Start research')");
    await wait(1500);
    check(/#\/runs\/[0-9a-f]{12}$/.test(page.url()), "Start research opens the live run");
    const runMode = await page.locator(".run-mode").textContent();
    check(runMode.includes("Quick research") && runMode.includes("eBay seller template"), "run page shows the template badge next to the depth badge");
    await page.waitForSelector(".report-title", { timeout: 30000 });
    check(await page.locator(".report-meta .badge-template").isVisible(), "report header shows the template badge");
    check(await page.locator("#r-listings-h").isVisible(), "report has the Comparable eBay listings section");
    check(await page.locator(".listings-table tbody tr").count() >= 5, "listings table lists the comparable listings");
    check((await page.locator(".listing-note").textContent()).includes("not sold prices"), "listings note says asking prices, not sold prices");
    const asking = page.locator("#r-listings .chart");
    check(await asking.locator("svg[role=img]").count() === 1, "asking-price chart is an accessible SVG");
    check((await asking.locator(".chart-caption").textContent()).includes("not sold prices"), "asking-price caption says not sold prices");
    check(!/\bsells? for\b|\bsold for\b/i.test(await bodyText(page)), "the report never says 'sells for'");
    await page.locator(".listings-table .chip").first().click();
    await wait(300);
    const sheet = await page.locator("#card-panel").textContent();
    check(sheet.includes("eBay listing (asking price") && sheet.includes("Retrieved"), "a listing's fact card shows its label and retrieval date");
    await page.keyboard.press("Escape");
    await ctx.close();
  }

  // 3. Fees, ad scenarios, ad budget and the per-scenario stacked chart.
  {
    const { ctx, page } = await context(browser);
    await signIn(page);
    await go(page, "/runs/eb02c0ffee02", "", 1100);
    check(await page.locator("#r-ebay-costs-h").isVisible(), "marketing report has the eBay fees & ad costs section");
    const fees = await page.locator(".fees-table").textContent();
    check(fees.includes("Final value fee") && fees.includes("13.6%") && fees.includes("What is left before ads"), "fee breakdown lists rates and what is left");
    check(await page.locator(".scenarios-table tbody tr").count() === 3, "three ad-rate scenarios");
    const box = await page.locator(".ad-budget").textContent();
    check(box.includes("Break-even ad rate") && box.includes("66.4%") && box.includes("Suggestion"), "ad budget shows the break-even rate and a labelled suggestion");
    check(box.includes("Priority"), "ad budget has the Priority line");
    const costs = page.locator("#r-ebay-costs .chart");
    check(await costs.locator("svg[role=img]").count() === 1, "eBay costs chart is an accessible SVG");
    check(await costs.locator("rect.chart-seg-4").count() >= 3, "one stacked bar per scenario (What is left segment in each)");
    check((await costs.locator("svg desc").textContent()).includes("Ad rate 5%: Final value fee"), "chart <desc> lists every segment per bar");
    await costs.locator(".chart-toggle").click();
    const head = await costs.locator(".chart-data thead").textContent();
    check(head.includes("What is left") && head.includes("Total"), "Show data gives a table with one column per segment");
    await ctx.close();
  }

  // 4. Partial fees: incomplete note, no ad budget, no costs chart.
  {
    const { ctx, page } = await context(browser);
    await signIn(page, "owner", "&fees=partial");
    await go(page, "/runs/eb02c0ffee02", "&fees=partial", 1100);
    check(await page.locator("#r-ebay-costs .callout-warn").isVisible(), "partial fees show the incomplete note");
    check(await page.locator(".ad-budget").count() === 0, "no ad budget when fees are incomplete");
    check(await page.locator("#r-ebay-costs .chart").count() === 0, "no eBay costs chart when fees are incomplete");
    check(!(await page.locator(".fees-table").textContent()).includes("Per-order fee"), "the unsourced per-order fee is left out");
    await ctx.close();
  }

  // 5. eBay not connected: disabled card with its reason; keyboard skips it; server refusal explained.
  {
    const { ctx, page } = await context(browser);
    await signIn(page, "owner", "&ebay=off");
    await page.evaluate(() => { try { localStorage.setItem("mc_last_template_demo-owner", "ebay"); } catch { /* ignore */ } });
    await go(page, "/new", "&ebay=off");
    check(await page.locator("#template-ebay").isDisabled(), "eBay template is disabled when not connected");
    check((await page.locator("#template-ebay-reason").textContent()).includes("eBay is not connected yet"), "disabled card shows the reason");
    check(await page.locator("#template-general").isChecked(), "a remembered but unavailable template falls back to General");
    await page.focus("#template-general");
    await page.keyboard.press("ArrowRight");
    check(await page.evaluate(() => document.getElementById("template-general").checked), "arrow keys do not select the disabled template");
    const described = await page.getAttribute("#template-ebay", "aria-describedby");
    check(described.includes("template-ebay-reason"), "the reason is announced with the disabled card");
    await ctx.close();
  }

  // 6. Screenshots, axe and horizontal scroll at both widths.
  for (const width of [1280, 375]) {
    const { ctx, page } = await context(browser, width);
    await signIn(page);
    await go(page, "/new");
    await snap(page, "01-new-templates", width);
    await go(page, "/c/conv-ebay-ready");
    await snap(page, "02-conversation-ebay-ready", width);
    await go(page, "/runs/eb01c0ffee01", "", 1100);
    await snap(page, "03-report-ebay-listings", width);
    await go(page, "/runs/eb02c0ffee02", "", 1100);
    await snap(page, "04-report-ebay-fees", width);
    const toggle = page.locator("#r-ebay-costs .chart-toggle");
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    await page.locator("#r-ebay-costs .chart").scrollIntoViewIfNeeded();
    await snap(page, "05-ebay-costs-show-data", width, { fullPage: false });
    await ctx.close();
    const off = await context(browser, width);
    await signIn(off.page, "owner", "&ebay=off");
    await go(off.page, "/new", "&ebay=off");
    await off.page.locator(".template-picker").scrollIntoViewIfNeeded();
    await snap(off.page, "06-new-ebay-not-connected", width, { fullPage: false });
    await go(off.page, "/runs/eb02c0ffee02", "&ebay=off&fees=partial", 1100);
    await snap(off.page, "07-report-ebay-fees-partial", width);
    await off.ctx.close();
  }
  // Reading preference: 200% zoom on a desktop window (narrow layouts must still fit).
  {
    const { ctx, page } = await context(browser, 1280, { ...PREFS, zoom: 200 });
    await signIn(page);
    await go(page, "/new");
    await snap(page, "08-new-templates-zoom-200", 1280);
    await go(page, "/runs/eb02c0ffee02", "", 1100);
    await snap(page, "09-report-ebay-fees-zoom-200", 1280);
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, "qa-report.json"), JSON.stringify(report, null, 2));
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})();
