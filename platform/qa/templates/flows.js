// Template flows in mock mode (SPEC v4, eBay seller): pick the template, chat, run, see the listings
// and both charts; fee breakdown and ad budget; partial fees; eBay not connected; keyboard selection.
// SPEC v4.1 (Food truck, Restaurant / café, Daycare / childcare, Etsy seller): six cards that wrap, #/templates
// lists all six, a food truck conversation through to its Startup costs report, and the Prices nearby,
// Requirements to check and Etsy fees & ad costs sample reports.
// Also screenshots the new pages at 1280 and 375 px with axe-core (WCAG 2.2 AA rules), horizontal-scroll and
// 44 px target checks, written to qa/templates/screenshots and qa/templates/qa-report.json.
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
  // Targets smaller than 44 px among visible links, buttons and form controls (inline text links in running text,
  // table cells and definition lists excepted, as in qa/projects).
  const small = await page.evaluate(() => [...document.querySelectorAll("a, button, select, input:not([type=hidden]), summary")]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || el.closest("[hidden], .visually-hidden, p, li.msg, blockquote, .chips, .chip, td, th, dd, .report-toc")) return false;
      if (getComputedStyle(el).visibility === "hidden") return false;
      return r.height < 43.5 && !el.matches(".chip, .tool-card input, .template-card input");
    }).map((el) => `${el.tagName.toLowerCase()}.${(el.className && String(el.className).split(" ")[0]) || ""} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().height)}px`));
  report.pages.push({ name, file, width, axe, layout, small_targets: small });
  const flags = [axe.length ? `axe:${axe.map((v) => `${v.id}(${v.count})`).join(",")}` : "axe:ok",
    layout.horizontalScroll ? `HSCROLL ${layout.scrollWidth}/${layout.clientWidth}` : "",
    small.length ? `small:${small.length}` : ""].filter(Boolean).join(" ");
  console.log(`      ${name.padEnd(30)} ${String(width).padEnd(5)} ${flags}`);
  if (axe.length) console.log("        ", JSON.stringify(axe));
  if (small.length) console.log("         small targets:", small.join(" | "));
  check(!axe.length, `${name} @${width}: no axe violations`);
  check(!layout.horizontalScroll, `${name} @${width}: no horizontal scroll`);
  check(!small.length, `${name} @${width}: no targets under 44 px`);
}

const TEMPLATE_IDS = ["general", "ebay", "food_truck", "restaurant", "daycare", "etsy"];
const TEMPLATE_NAMES = ["General", "eBay seller", "Food truck", "Restaurant / café", "Daycare / childcare", "Etsy seller"];
const LEGAL_LINE = "A checklist built from official pages. Confirm each item with the agency; this is not legal advice.";
// Rows of template cards on #/new: distinct top offsets of the cards.
const cardRows = (page) => page.evaluate(() => new Set([...document.querySelectorAll(".template-card")]
  .map((el) => Math.round(el.getBoundingClientRect().top))).size);

const bodyText = (page) => page.evaluate(() => document.body.innerText);

(async () => {
  const browser = await chromium.launch();

  // 1. Template picker: cards, badges, keyboard, remembered choice.
  {
    const { ctx, page } = await context(browser);
    await signIn(page);
    await go(page, "/new");
    check(await page.locator(".template-card").count() === 6, "#/new shows six template cards");
    const names = await page.locator(".template-card .tool-name").allTextContents();
    check(JSON.stringify(names) === JSON.stringify(TEMPLATE_NAMES), "the six cards are General, eBay seller, Food truck, Restaurant / café, Daycare / childcare, Etsy seller");
    const parts = await page.evaluate(() => [...document.querySelectorAll(".template-card")].map((card) => ({
      icon: !!card.querySelector(".tool-icon svg"), desc: (card.querySelector(".tool-question")?.textContent || "").length,
      badges: card.querySelectorAll(".badge-cap").length })));
    check(parts.every((p) => p.icon && p.desc > 20 && p.badges >= 1), "every card has an icon, a one-line description and capability badges");
    for (const id of ["food_truck", "restaurant", "daycare"]) {
      const labels = await page.locator(`.template-card:has(#template-${id}) .badge-cap`).allTextContents();
      check(labels.join("|") === "Checks permits from official pages|Compares nearby businesses|Estimates startup costs", `${id} card shows its three capability badges`);
    }
    check((await page.locator(".template-card:has(#template-etsy) .badge-cap").allTextContents()).join("|") === "Estimates Etsy fees and ad costs", "Etsy card shows its capability badge");
    check(await cardRows(page) === 2, "at 1280 px the six cards wrap into two rows of three");
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
    check(await page.evaluate(() => !document.getElementById("template-ebay").checked && document.activeElement.id === "template-food_truck"),
      "arrow keys skip the disabled template (ArrowRight goes from General to Food truck)");
    const described = await page.getAttribute("#template-ebay", "aria-describedby");
    check(described.includes("template-ebay-reason"), "the reason is announced with the disabled card");
    await ctx.close();
  }

  // 6. v4.1 picker: cards wrap to one column on a phone; keyboard reaches every card; #/templates lists all six.
  {
    const { ctx, page } = await context(browser, 375);
    await signIn(page);
    await go(page, "/new");
    check(await page.locator(".template-card").count() === 6, "phone: #/new shows the six template cards");
    check(await cardRows(page) === 6, "phone: the cards wrap into one column");
    const widths = await page.evaluate(() => [...document.querySelectorAll(".template-card")].map((el) => el.getBoundingClientRect().right));
    check(widths.every((right) => right <= 375), "phone: no card runs past the screen edge");
    await ctx.close();
  }
  {
    const { ctx, page } = await context(browser);
    await signIn(page);
    await go(page, "/new");
    await page.focus("#template-general");
    for (let i = 0; i < 5; i += 1) await page.keyboard.press("ArrowRight");
    check(await page.evaluate(() => document.activeElement.id === "template-etsy" && document.getElementById("template-etsy").checked),
      "ArrowRight walks through all six cards to Etsy seller");
    check((await page.locator("#first-message-hint").textContent()).includes("who pays shipping"), "composer hint names the Etsy questions");
    await page.keyboard.press("ArrowLeft");
    check(await page.evaluate(() => document.getElementById("template-daycare").checked), "ArrowLeft goes back to Daycare / childcare");
    check((await page.locator("#first-message-hint").textContent()).includes("never asks about specific children or families"),
      "daycare hint says it never asks about specific children or families");
    await go(page, "/templates", "&templates=few");
    check(await page.locator(".template-tile").count() === 6 && await page.locator(".pager").count() === 0, "#/templates lists all six on one page");
    check(JSON.stringify(await page.locator(".template-tile-name").allTextContents()) === JSON.stringify(TEMPLATE_NAMES), "#/templates names all six in order");
    check(await page.locator(".template-tile .status-done").count() === 6, "all six are available");
    await go(page, "/templates");
    await page.click(".toggle-btn:has-text('Available now')");
    await wait(300);
    check(await page.locator(".template-tile").count() === 6, "with sample templates, Available now shows the six real ones");
    await page.locator(".template-tile", { hasText: "Restaurant / café" }).locator("a:has-text('Use this template')").click();
    await wait(1000);
    check(await page.locator("#template-restaurant").isChecked(), "Use this template preselects Restaurant / café on #/new");
    await ctx.close();
  }

  // 7. Food truck: chat, brief with the food truck details, run, Startup costs report.
  {
    const { ctx, page } = await context(browser);
    await signIn(page);
    await go(page, "/new");
    await page.check("#template-food_truck", { force: true });
    await page.check("#tool-marketing_plan", { force: true });
    check((await page.locator("#first-message-hint").textContent()).includes("own or rent the truck"), "composer hint names the food truck questions");
    await page.fill("#first-message", "A taco truck for Seattle office parks.");
    await page.keyboard.press("Enter");
    await wait(1300);
    check((await page.locator(".conv-template").textContent()).includes("Food truck template"), "conversation shows the Food truck badge");
    for (const text of ["Seattle, WA; tacos.", "Office parks; buying a used truck, $62,000 quote."]) {
      await page.fill("#chat-input", text);
      await page.keyboard.press("Enter");
      await wait(1200);
    }
    check(await page.locator(".brief-panel .status-ready").isVisible(), "food truck brief becomes Ready");
    const details = await page.locator(".brief-template-fields").textContent();
    check(details.includes("For the food truck") && details.includes("Office parks") && details.includes("Used truck quote: $62,000"),
      "brief panel lists the food truck details and the founder's own cost");
    await page.click("button:has-text('Start research')");
    await wait(1500);
    check((await page.locator(".run-mode").textContent()).includes("Food truck template"), "run page shows the Food truck badge");
    await page.waitForSelector(".report-title", { timeout: 30000 });
    check(await page.locator("#r-startup-h").isVisible(), "report has the Startup costs section");
    const startup = await page.locator(".startup-table").textContent();
    check(startup.includes("Used truck (your quote)") && startup.includes("Your figure") && startup.includes("Checked source"), "startup lines say whether they come from a checked source or your figure");
    check(startup.includes("$73,000 – $82,000"), "the total is a rounded range, not one number");
    check((await page.locator("#r-startup .callout-warn").textContent()).includes("First inventory"), "the missing cost line is named");
    const costChart = page.locator("#r-startup .chart");
    check(await costChart.locator("svg[role=img]").count() === 1 && (await costChart.locator(".chart-caption").textContent()).includes("$73,000 to $82,000"),
      "startup costs chart is an accessible SVG whose caption gives the total range");
    check(await page.locator("#r-plan-h").isVisible() && await page.locator("#r-budget-h").isVisible(), "the marketing plan and 4-week budget stay");
    await ctx.close();
  }

  // 8. Sample reports: Prices nearby, Requirements to check, Etsy fees & ad costs.
  {
    const { ctx, page } = await context(browser);
    await signIn(page);
    await go(page, "/runs/rs01c0ffee01", "", 1100);
    check(await page.locator("#r-benchmarks-h").textContent() === "Prices nearby", "restaurant report has Prices nearby");
    check(await page.locator("#r-prices").count() === 0, "no generic price table next to Prices nearby");
    check(await page.locator(".benchmarks-table tbody tr").count() === 9, "Prices nearby lists the checked menu prices");
    const bench = page.locator("#r-benchmarks .chart").first();
    check((await bench.locator(".chart-caption").textContent()).includes("retrieved"), "the benchmark caption says what the prices are and when they were retrieved");
    check(await page.locator("#r-benchmarks .chart").count() === 2, "the suggested price band sits with Prices nearby");
    check(!(await bodyText(page)).includes("2,300 reviews"), "an unchecked review count is not shown");

    await go(page, "/runs/dc01c0ffee01", "", 1100);
    check(await page.locator("#r-requirements-h").textContent() === "Requirements to check", "daycare report has Requirements to check");
    check((await page.locator("#r-requirements .legal-note").textContent()).trim() === LEGAL_LINE, "the section carries the not-legal-advice line");
    check(await page.locator("#r-checklist").count() === 0, "no generic launch checklist next to the requirements");
    check(await page.locator(".requirements-list > li").count() === 8, "eight requirements");
    check(await page.locator(".requirements-list .badge-official").count() === 6, "six are confirmed on an official page");
    const reqText = await page.locator(".requirements-list").textContent();
    check(reqText.includes("Check with Tacoma Fire Department") && reqText.includes("Check with DCYF and your insurer"), "assumptions say which agency to check with");
    check(reqText.includes("Working Connections Child Care") && reqText.includes("Department of Children, Youth, and Families"), "Washington: DCYF licence and Working Connections Child Care");
    check(reqText.includes("Fee$30") || reqText.includes("Fee $30"), "a fee is shown where a sourced card states it");
    check(await page.locator("#r-requirements .chart svg[role=img]").count() === 1, "requirements chart is an accessible SVG");

    await go(page, "/runs/et01c0ffee01", "", 1100);
    check(await page.locator("#r-etsy-costs-h").textContent() === "Etsy fees & ad costs", "Etsy report has Etsy fees & ad costs");
    const etsyFees = await page.locator("#r-etsy-costs .fees-table").textContent();
    check(etsyFees.includes("Transaction fee") && etsyFees.includes("6.5%") && etsyFees.includes("What is left before ads") && etsyFees.includes("$27.75"),
      "Etsy fee breakdown lists rates and what is left");
    check(await page.locator("#r-etsy-costs .scenarios-table tbody tr").count() === 3, "three Offsite Ads rows: none, 15% and 12%");
    const etsyChart = page.locator("#r-etsy-costs .chart");
    check(await etsyChart.locator("svg[role=img]").count() === 1 && await etsyChart.locator("rect.chart-seg-4").count() >= 3 && await etsyChart.locator("rect.chart-seg-5").count() >= 2,
      "Etsy costs chart draws one stacked bar per order type");
    await etsyChart.locator(".chart-toggle").click();
    check((await etsyChart.locator(".chart-data thead").textContent()).includes("Offsite Ads fee"), "Show data gives the Offsite Ads fee column");
    check((await page.locator(".etsy-ads").textContent()).includes("Etsy Ads (cost per click)"), "Etsy Ads box explains per-click costs");
    check(!/\bsells? for\b|\bsold for\b/i.test(await bodyText(page)), "the Etsy report never says 'sells for'");
    await page.locator("#r-etsy-costs .fees-table .chip").first().focus();
    await page.keyboard.press("Enter");
    await wait(300);
    check(await page.locator("#card-panel[open]").count() === 1, "keyboard: Enter on a fee source chip opens its fact card");
    await page.keyboard.press("Escape");
    await ctx.close();
  }

  // 9. Screenshots, axe, horizontal scroll and 44 px targets at both widths.
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
    // v4.1 pages.
    const more = await context(browser, width);
    await signIn(more.page);
    await go(more.page, "/templates", "&templates=few");
    await snap(more.page, "10-templates-page-six", width);
    await go(more.page, "/c/conv-truck-ready");
    await snap(more.page, "11-conversation-food-truck-ready", width);
    await go(more.page, "/runs/ft01c0ffee01", "", 1100);
    await snap(more.page, "12-report-food-truck-startup-costs", width);
    await go(more.page, "/runs/rs01c0ffee01", "", 1100);
    await snap(more.page, "13-report-restaurant-prices-nearby", width);
    await go(more.page, "/runs/dc01c0ffee01", "", 1100);
    await snap(more.page, "14-report-daycare-requirements", width);
    await go(more.page, "/runs/et01c0ffee01", "", 1100);
    await snap(more.page, "15-report-etsy-fees", width);
    const etsyToggle = more.page.locator("#r-etsy-costs .chart-toggle");
    await etsyToggle.scrollIntoViewIfNeeded();
    await etsyToggle.click();
    await more.page.locator("#r-etsy-costs .chart").scrollIntoViewIfNeeded();
    await snap(more.page, "16-etsy-costs-show-data", width, { fullPage: false });
    await more.ctx.close();
  }
  // Reading preference: 200% zoom on a desktop window (narrow layouts must still fit).
  {
    const { ctx, page } = await context(browser, 1280, { ...PREFS, zoom: 200 });
    await signIn(page);
    await go(page, "/new");
    await snap(page, "08-new-templates-zoom-200", 1280);
    await go(page, "/runs/eb02c0ffee02", "", 1100);
    await snap(page, "09-report-ebay-fees-zoom-200", 1280);
    await go(page, "/runs/dc01c0ffee01", "", 1100);
    await snap(page, "17-report-daycare-requirements-zoom-200", 1280);
    await go(page, "/runs/ft01c0ffee01", "", 1100);
    await snap(page, "18-report-food-truck-startup-zoom-200", 1280);
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, "qa-report.json"), JSON.stringify(report, null, 2));
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})();
