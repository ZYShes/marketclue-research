// Functional checks in mock mode: resume after reload, new conversation → brief → run → report,
// join after sign-in, keyboard basics. Exits non-zero on the first failure.
// Usage: serve platform/frontend on :8765, then node platform/qa/frontend-v3/flows.js
const { chromium } = require("playwright");

const BASE = process.env.BASE || "http://localhost:8765/index.html?mock=1";
const PREFS = { largerText: false, extraSpacing: false, reduceMotion: true, zoom: 100 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(cond, label) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures += 1;
}

async function context(browser, width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: 860 } });
  await ctx.addInitScript((p) => { try { localStorage.setItem("mc_reading_preferences_v1", JSON.stringify(p)); } catch { /* ignore */ } }, PREFS);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { console.log("  pageerror:", e.message); failures += 1; });
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch();

  // 1. Resume: the open conversation survives a reload and a visit to #/.
  {
    const { ctx, page } = await context(browser);
    await page.goto(`${BASE}#/`);
    await wait(400);
    await page.click("text=Continue as demo owner");
    await wait(700);
    await page.goto(`${BASE}#/c/conv-draft-01`);
    await wait(600);
    await page.goto(`${BASE}#/`);
    await wait(900);
    check(page.url().endsWith("#/c/conv-draft-01"), "reload of #/ returns to the open conversation");
    check((await page.locator("main h1").textContent()).includes("wheel-throwing"), "conversation messages and brief restored");
    await page.goto(`${BASE}#/new`);
    await wait(700);
    check(await page.locator(".resume").isVisible(), "#/new offers 'Continue where you left off'");

    // 2. New conversation → three answers → ready → Quick run → live progress → report.
    await page.check("#tool-competitor_scan", { force: true });
    await page.fill("#first-message", "Handmade planters, Seattle and online.");
    await page.keyboard.press("Enter");
    await wait(1200);
    check(/#\/c\/[0-9a-f]{12}$/.test(page.url()), "first message creates a conversation and opens #/c/<id>");
    for (const text of ["6-inch, with saucer.", "Both pickup and delivered prices."]) {
      await page.fill("#chat-input", text);
      await page.keyboard.press("Enter");
      await wait(1100);
    }
    check(await page.locator(".brief-panel .status-ready").isVisible(), "brief becomes Ready after the questions");
    const items = await page.locator(".sb-recent .history-row").count();
    check(items >= 8, `sidebar Recent lists the new conversation (${items} items)`);
    await page.click("button:has-text('Start research')");
    await wait(1500);
    check(/#\/runs\/[0-9a-f]{12}$/.test(page.url()), "Start research opens the live run");
    check(await page.locator(".stepper").isVisible(), "run view shows the stage list");
    await page.waitForSelector(".report-title", { timeout: 30000 });
    check(true, "run turns into the report when done");
    check(await page.locator(".chart svg[role=img]").count() >= 2, "report renders accessible SVG charts");
    const desc = await page.locator(".chart svg desc").first().textContent();
    check(/\$/.test(desc), "chart <desc> lists the data values");
    await page.click(".chart-toggle >> nth=0");
    check(await page.locator(".chart-data table").first().isVisible(), "Show data reveals the data table");
    await ctx.close();
  }

  // 3. Join after sign-in: a signed-out invitee returns to the join page and joins.
  {
    const { ctx, page } = await context(browser, 375);
    await page.goto(`${BASE}#/join/sample-invite`);
    await wait(600);
    await page.click("text=Continue as demo member");
    await wait(900);
    check(page.url().endsWith("#/join/sample-invite"), "after sign-in the invitee is back on #/join/<token>");
    await page.click("text=Join team");
    await wait(900);
    check(page.url().endsWith("#/team"), "joining opens the Team page");
    check(await page.locator("text=Leave team").first().isVisible(), "member view offers Leave team");
    await page.goto(`${BASE}#/library?scope=team`);
    await wait(900);
    check(await page.locator(".fact").count() > 0, "team fact cards visible after joining");
    await ctx.close();
  }

  // 4. Keyboard: skip link, tabs with arrow keys, hover card on focus, Escape closes.
  {
    const { ctx, page } = await context(browser);
    await page.goto(`${BASE}#/`);
    await wait(400);
    await page.click("text=Continue as demo owner");
    await wait(800);
    await page.reload(); // fresh load: focus starts at the top of the document
    await wait(900);
    await page.keyboard.press("Tab");
    check(await page.evaluate(() => document.activeElement.classList.contains("skip-link")), "first Tab reaches the skip link");
    await page.keyboard.press("Enter");
    check(await page.evaluate(() => document.activeElement.tagName === "H1"), "skip link moves focus to the page heading");
    await page.focus("#new-tab-new");
    await page.keyboard.press("ArrowRight");
    check(await page.evaluate(() => document.activeElement.id === "new-tab-existing" && !document.getElementById("new-panel-existing").hidden), "ArrowRight moves to and opens the Existing tab");
    await page.goto(`${BASE}#/runs/c1d2e3f4a5b6`);
    await wait(900);
    await page.locator(".takeaway .chip").first().focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await wait(200);
    check(await page.locator("#hovercard").isVisible(), "keyboard focus on a source chip shows the hover card");
    await page.keyboard.press("Escape");
    check(await page.locator("#hovercard").isHidden(), "Escape dismisses the hover card");
    await page.keyboard.press("Enter");
    await wait(300);
    check(await page.locator("#card-panel[open]").count() === 1, "Enter on a chip opens the fact card sheet");
    await page.keyboard.press("Escape");
    await wait(200);
    check(await page.evaluate(() => document.activeElement.classList.contains("chip")), "closing the sheet returns focus to the chip");
    await ctx.close();
  }

  // 5. Mock-ups disabled: button hidden on 503.
  {
    const { ctx, page } = await context(browser);
    await page.goto(`${BASE}&mockups=off#/`);
    await wait(400);
    await page.click("text=Continue as demo owner");
    await wait(700);
    await page.goto(`${BASE}&mockups=off#/runs/c1d2e3f4a5b6`);
    await wait(1000);
    check(await page.locator("button:has-text('Show a mock-up')").isHidden(), "mock-up button hidden when the endpoint answers 503");
    await ctx.close();
  }

  // 6. Research depth slider: keyboard, mouse drag, stop names, Balanced run, Smarter cap fallback.
  {
    const { ctx, page } = await context(browser);
    await page.goto(`${BASE}&smarter=limit#/`);
    await wait(400);
    await page.click("text=Continue as demo member");
    await wait(700);
    await page.goto(`${BASE}&smarter=limit#/new`);
    await wait(600);
    await page.fill("#first-message", "Handmade planters for Seattle plant owners.");
    await page.keyboard.press("Enter");
    await wait(1200);
    for (const text of ["Market shoppers.", "$600 for four weeks."]) {
      await page.fill("#chat-input", text);
      await page.keyboard.press("Enter");
      await wait(1100);
    }
    const valueText = () => page.getAttribute("#depth", "aria-valuetext");
    check((await page.locator("#depth").getAttribute("max")) === "2", "slider has three stops (min 0, max 2)");
    check(/^Quick/.test(await valueText()), "slider starts at Quick");
    check(await page.locator("#depth").isEnabled(), "a non-owner can move the slider (effort belongs to the starter)");
    await page.focus("#depth");
    await page.keyboard.press("ArrowRight");
    check(/^Balanced: about 2 min/.test(await valueText()), "ArrowRight moves to Balanced and announces time and cost");
    check((await page.locator(".depth-current").textContent()) === "Balanced", "visible label follows the slider");
    const box = await page.locator("#depth").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    check(/^Smarter/.test(await valueText()), "dragging the thumb to the end selects Smarter");
    await page.click(".depth-stop >> text=Quick");
    check(/^Quick/.test(await valueText()), "clicking a stop name jumps to it");
    await page.keyboard.press("End");
    await page.click("button:has-text('Start research')");
    await wait(600);
    check((await page.locator("#start-error").textContent()).includes("today's limit"), "Smarter at the daily cap shows the limit message");
    await page.click("#start-error button:has-text('Switch to Quick')");
    check(/^Quick/.test(await valueText()), "Switch to Quick moves the slider back to Quick");
    check(await page.evaluate(() => document.activeElement.id === "depth"), "focus returns to the slider");
    await page.keyboard.press("ArrowRight");
    await page.click("button:has-text('Start research')");
    await wait(1500);
    check((await page.locator(".run-mode").textContent()).includes("Balanced research"), "a Balanced run starts and shows its depth");
    await page.goto(`${BASE}&smarter=limit#/c/conv-sam-01`);
    await wait(700);
    check(/^Balanced/.test(await valueText()), "the last depth choice is remembered");
    await ctx.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})();
