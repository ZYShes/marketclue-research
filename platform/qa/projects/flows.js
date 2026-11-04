// Project flows in mock mode (SPEC v5): sidebar projects, the project page (journey strip, Reports and
// Fact cards tabs, project brief), starting a stage from a project (tool and project preselected, "We
// already know", fewer questions) through to the report breadcrumb, creating a project inline, moving a
// report into a project, archived projects, several teams with the team picker, visibility that follows
// the project, and keyboard paths. Also screenshots the new pages at 1280 and 375 px with axe-core
// (WCAG 2.2 AA rules) and horizontal-scroll checks, into qa/projects/screenshots and qa-report.json.
//
// Usage: serve platform/frontend (python3 -m http.server 8765), then
//   AXE_PATH=/path/to/axe.min.js node platform/qa/projects/flows.js
// Set BASE when the server is elsewhere. Exits non-zero when any check fails.
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
    viewport: { width, height: mobile ? 812 : 900 }, hasTouch: mobile, isMobile: mobile, reducedMotion: "reduce",
  });
  await ctx.addInitScript((p) => { try { localStorage.setItem("mc_reading_preferences_v1", JSON.stringify(p)); } catch { /* ignore */ } }, prefs);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { console.log("  pageerror:", e.message); failures += 1; });
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) console.log("  console error:", m.text()); });
  return { ctx, page };
}

const url = (hash, extra = "") => `${BASE}?mock=1${extra}#${hash}`;
async function go(page, hash, extra = "", ms = 900) {
  await page.goto(url(hash, extra));
  await wait(ms);
}
async function signIn(page, who = "owner") {
  await go(page, "/", "", 500);
  await page.click(`text=Continue as demo ${who}`);
  await wait(800);
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
  // Targets smaller than 44 px among visible links, buttons and form controls (inline text links excepted).
  const small = await page.evaluate(() => [...document.querySelectorAll("a, button, select, input:not([type=hidden]), summary")]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || el.closest("[hidden], .visually-hidden, p, li.msg, blockquote, .chips, .chip, td, .report-toc")) return false;
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

const text = (page, sel) => page.locator(sel).first().innerText();

(async () => {
  const browser = await chromium.launch();

  // 1. Sidebar projects → project page: journey strip, Reports with stage filter, Fact cards search, brief.
  {
    const { ctx, page } = await context(browser);
    await signIn(page);
    await go(page, "/new");
    const sidebar = await text(page, ".sb-projects");
    check(sidebar.includes("Handmade ceramic planters") && sidebar.includes("Personal"), "sidebar lists the personal project");
    check(sidebar.includes("Planters on eBay") && sidebar.includes("Team · Clay & Leaf Studio"), "sidebar lists the team project with its team tag");
    check(!sidebar.includes("Wheel-throwing classes"), "archived projects are hidden from the sidebar");
    const recent = await text(page, ".sb-recent");
    check(recent.includes("Handmade ceramic planters"), "Recent rows show their project name");
    await page.click(".sb-projects a:has-text('Handmade ceramic planters')");
    await wait(1000);
    check(page.url().endsWith("#/p/proj-planters"), "a sidebar project opens #/p/<id>");
    check((await page.getAttribute(".sb-projects a[href='#/p/proj-planters']", "aria-current")) === "page", "the open project is marked current in the sidebar");
    check((await text(page, "h1")) === "Handmade ceramic planters", "project page shows the project name");
    check((await text(page, ".project-owner")).includes("Personal"), "project page says Personal");
    check(await page.locator(".journey-strip > li").count() === 4, "journey strip has four stage cards");
    const stages = await page.locator(".stage-label").allInnerTexts();
    check(["Discover", "Compare", "Prepare", "Grow"].every((s, i) => stages[i].includes(s)), "stage cards are Discover, Compare, Prepare, Grow");
    const discover = page.locator(".stage-card").nth(0);
    check((await discover.innerText()).includes("Not started") && await discover.locator("a:has-text('Start')").count() === 1, "an empty stage says Not started with a Start link");
    const grow = page.locator(".stage-card").nth(3);
    check((await grow.locator(".stage-title").innerText()).includes("First customers"), "a started stage shows its latest report title");
    check((await grow.locator(".stage-takeaway").innerText()).length > 20, "a started stage shows the one-line takeaway");
    check(await page.locator("#project-panel-reports .row-list > li").count() === 4, "Reports tab lists the project's reports (done + own running)");
    await page.selectOption("#project-stage", "competitor_scan");
    check(await page.locator("#project-panel-reports .row-list > li").count() === 2, "stage filter narrows Reports to Compare");
    check((await text(page, "#project-panel-reports")).includes("Running"), "the viewer's own unfinished run shows its status");
    const brief = await text(page, ".project-brief");
    check(brief.includes("Project brief") && brief.includes("Seattle, WA") && brief.includes("$600"), "project brief box shows the five fields");
    // Fact cards tab by keyboard: ArrowRight from Reports.
    await page.focus("#project-tab-reports");
    await page.keyboard.press("ArrowRight");
    await wait(300);
    check(await page.evaluate(() => document.activeElement.id === "project-tab-cards" && !document.getElementById("project-panel-cards").hidden),
      "ArrowRight moves to the Fact cards tab");
    const allCards = await page.locator("#project-panel-cards .card-grid > li").count();
    check(allCards >= 6, `Fact cards tab lists the project's knowledge base (${allCards})`);
    await page.fill("#project-cards-q", "saucer");
    await wait(700);
    const found = await page.locator("#project-panel-cards .card-grid > li").count();
    check(found > 0 && found < allCards, `fact card search narrows the list (${found} of ${allCards})`);
    // Edit the brief.
    await page.click(".project-brief button:has-text('Edit')");
    await page.fill("#pb-stage", "Selling at two weekend markets");
    await page.click(".project-brief button:has-text('Save brief')");
    await wait(600);
    check((await text(page, ".project-brief")).includes("Selling at two weekend markets"), "editing the project brief saves the new stage");
    await ctx.close();
  }

  // 2. Start a stage from a team project → New research preselected → fewer questions → run → breadcrumb.
  {
    const { ctx, page } = await context(browser);
    await signIn(page);
    await go(page, "/p/proj-ebay", "", 1200);
    check((await text(page, ".project-owner")).includes("Team · Clay & Leaf Studio"), "team project shows its team");
    const start = page.locator(".stage-card").nth(0).locator("a:has-text('Start')");
    await start.focus();
    await page.keyboard.press("Enter");
    await wait(1300);
    check(page.url().includes("#/new/market_check?project=proj-ebay"), "Start (keyboard) opens New research for that stage and project");
    check(await page.locator("#tool-market_check").isChecked(), "the stage's tool is preselected");
    check((await page.inputValue("#project-select")) === "proj-ebay", "the project is preselected");
    check(await page.locator("#known-brief").isVisible() && (await text(page, "#known-brief")).startsWith("We already know:"), "the first message box says “We already know: …”");
    check(await page.locator("#template-ebay").isChecked(), "the project's default template (eBay seller) is chosen");
    await page.fill("#first-message", "Planters for eBay buyers, continuing the project.");
    await page.keyboard.press("Enter");
    await wait(1400);
    check(/#\/c\/[0-9a-f]{12}$/.test(page.url()), "first message opens the conversation");
    check((await text(page, ".conv-head .crumbs")).includes("Planters on eBay"), "conversation shows the project breadcrumb");
    check((await text(page, ".messages")).includes("one question fewer"), "the research lead uses the project brief and asks fewer questions");
    await page.fill("#chat-input", "$48, buyer pays shipping; not on eBay yet.");
    await page.keyboard.press("Enter");
    await wait(1300);
    check(await page.locator(".brief-panel .status-ready").isVisible(), "brief is Ready after two answers instead of three");
    await page.click("button:has-text('Start research')");
    await wait(1500);
    check(/#\/runs\/[0-9a-f]{12}$/.test(page.url()), "Start research opens the live run");
    const crumb = await text(page, ".page-head .crumbs");
    check(crumb.includes("Planters on eBay") && crumb.includes("Discover"), "run page breadcrumb reads Project › Discover");
    await page.waitForSelector(".report-title", { timeout: 40000 });
    check((await text(page, ".report-head .crumbs")).includes("Planters on eBay"), "report keeps the breadcrumb");
    check(await page.locator(".report-head .project-note").isVisible(), "report says it builds on the project");
    await page.click("#r-cards > summary");
    check(await page.locator("#r-cards .badge-earlier").count() >= 1, "an earlier project card is labelled in All fact cards");
    check((await page.locator("#r-cards .badge-earlier").first().innerText()).includes("From an earlier report in this project"), "earlier-card label reads “From an earlier report in this project”");
    await page.click(".report-head .crumbs a");
    await wait(1200);
    check((await page.locator(".stage-card").nth(0).innerText()).includes("Research again"), "the project's Discover stage now shows the new report");
    await ctx.close();
  }

  // 3. Create a project inline, then move an unfiled report into it.
  {
    const { ctx, page } = await context(browser);
    await signIn(page);
    await go(page, "/new");
    await page.click(".project-picker button:has-text('New project')");
    check((await page.getAttribute(".project-picker button:has-text('New project')", "aria-expanded")) === "true", "+ New project expands the inline form");
    await page.waitForFunction(() => document.querySelectorAll("#npi-owner option").length >= 3, null, { timeout: 3000 }).catch(() => {});
    check(await page.locator("#npi-owner option").count() === 3, "Belongs to offers Personal and both teams");
    await page.fill("#npi-name", "Glaze workshops");
    await page.click("#new-project-inline button:has-text('Create project')");
    await wait(900);
    check(await page.locator("#new-project-inline").isHidden(), "the inline form closes after creating");
    const selected = await page.locator("#project-select option:checked").innerText();
    check(selected.includes("Glaze workshops"), "the new project is chosen in the Project select");
    check((await text(page, ".sb-projects")).includes("Glaze workshops"), "the new project appears in the sidebar");
    await go(page, "/runs/b1c2d3e4f5a6", "", 1200);
    check(await page.locator(".report-head .crumbs").count() === 0, "an unfiled report has no breadcrumb");
    await page.click("button:has-text('Move to project')");
    await wait(500);
    check(await page.locator("#move-dialog[open]").isVisible(), "Move to project opens a dialog");
    await page.selectOption("#move-project", "proj-planters");
    check((await text(page, "#move-hint")).includes("private"), "moving into a personal project says it stays private");
    await page.selectOption("#move-project", "proj-ebay");
    check((await text(page, "#move-hint")).includes("Clay & Leaf Studio"), "moving into a team project says the team can read it");
    await page.selectOption("#move-project", "proj-planters");
    await page.click("#move-dialog button:has-text('Move')");
    await wait(1400);
    check(await page.locator("#move-dialog").isHidden(), "the move dialog is gone after moving");
    const crumb = await text(page, ".report-head .crumbs");
    check(crumb.includes("Handmade ceramic planters") && crumb.includes("Discover"), "after moving, the report breadcrumb shows Project › Discover");
    await go(page, "/p/proj-planters", "", 1200);
    check(!(await page.locator(".stage-card").nth(0).innerText()).includes("Not started"), "the project's Discover stage now has the moved report");
    // Archived projects come back with Show archived.
    await page.click(".sb-archived");
    await wait(600);
    check((await text(page, ".sb-projects")).includes("Wheel-throwing classes"), "Show archived lists the archived project");
    await page.click(".sb-projects a:has-text('Wheel-throwing classes')");
    await wait(1100);
    check(await page.locator(".callout-warn:has-text('archived')").isVisible(), "an archived project page says it is archived");
    await ctx.close();
  }

  // 4. Several teams: picker, team projects, member view.
  {
    const { ctx, page } = await context(browser);
    await signIn(page);
    await go(page, "/team", "", 1200);
    check(await page.locator("#team-select option").count() === 2, "team picker lists both teams");
    check((await text(page, "#team-projects-h")) === "Team projects" && (await text(page, "section:has(#team-projects-h)")).includes("Planters on eBay"), "the team page lists the team's projects");
    await page.selectOption("#team-select", "team-north");
    await wait(1200);
    check(page.url().includes("?team=team-north"), "choosing a team keeps it in the address");
    check((await text(page, "h1")) === "North Market Makers" && (await text(page, ".eyebrow")).includes("member"), "the picker opens the other team as a member");
    check(await page.locator("button:has-text('Leave team')").count() === 1, "a member can leave that team");
    await ctx.close();
  }

  // 5. Visibility follows the project: a non-member cannot open the team project or its report; after joining, can.
  {
    const { ctx, page } = await context(browser);
    await signIn(page, "member");
    await go(page, "/p/proj-ebay", "", 1100);
    check((await text(page, "h1")) === "Project not found", "a non-member cannot open the team project");
    await go(page, "/runs/eb01c0ffee01", "", 1100);
    check((await text(page, "h1")) === "Report not found", "a non-member cannot open a report filed in the team project");
    await go(page, "/join/sample-invite", "", 1100);
    await page.click("button:has-text('Join team')");
    await wait(1300);
    check(page.url().includes("#/team?team=team-clay"), "joining opens that team");
    check((await text(page, ".sb-projects")).includes("Planters on eBay"), "after joining, the team project appears in the sidebar");
    await go(page, "/runs/eb01c0ffee01", "", 1300);
    const crumb = await text(page, ".report-head .crumbs");
    check(crumb.includes("Planters on eBay"), "after joining, the member can read the team project's finished report");
    check(await page.locator("button:has-text('Move to project')").count() === 0, "Move to project is only for the report's author");
    await go(page, "/p/proj-ebay", "", 1200);
    check(await page.locator("button:has-text('Project settings')").count() === 0, "a member cannot manage the team project");
    check(await page.locator(".project-brief button:has-text('Edit')").count() === 0, "a member cannot edit the project brief");
    await ctx.close();
  }

  // 7. My reports: one scope picker — Mine, each team, each project; remembered; stale scopes fall back to Mine.
  {
    const { ctx, page } = await context(browser);
    await signIn(page);
    await go(page, "/runs", "", 1200);
    const label = await page.locator("label[for='reports-scope']").innerText();
    check(label === "Show reports from", "My reports has a labelled scope picker");
    const options = await page.locator("#reports-scope option").allInnerTexts();
    check(options[0] === "Mine" && options.includes("Team · Clay & Leaf Studio") && options.includes("Team · North Market Makers"),
      "scope picker offers Mine and both teams");
    check(options.includes("Project · Handmade ceramic planters") && options.includes("Project · Market stall planters")
      && !options.some((o) => o.includes("Wheel-throwing")), "scope picker offers visible live projects, not archived ones");
    check(await page.locator(".toggle-btn").count() === 0, "the old Mine | Team toggle is gone");
    const mineList = await text(page, ".list-body");
    check(mineList.includes("Who buys glaze workshops") && mineList.includes("First customers for handmade planters")
      && !mineList.includes("(Sam)"), "Mine lists your own reports, filed or not, and nobody else's");
    await page.selectOption("#reports-scope", "team:team-clay");
    await wait(800);
    check(page.url().includes("scope=team%3Ateam-clay"), "the chosen team is kept in the address");
    const teamList = await text(page, ".list-body");
    check(teamList.includes("by Riley Chen") && teamList.includes("comparable listings"), "a team scope lists finished reports in that team's projects, with their author");
    check(!teamList.includes("Who buys glaze workshops"), "a team scope leaves out unfiled reports");
    check(!teamList.includes("by Demo Founder"), "your own reports in a team scope are not labelled “by” you");
    check((await text(page, ".scope-picker .field-hint")).includes("Clay & Leaf Studio"), "the hint says whose reports are shown");
    await page.selectOption("#reports-scope", "project:proj-planters");
    await wait(800);
    check(await page.locator(".list-body .row-list > li").count() === 4, "a project scope lists that project's reports (done + your own running)");
    await go(page, "/runs", "", 1200);
    check((await page.inputValue("#reports-scope")) === "project:proj-planters", "the last scope is remembered after leaving the page");
    await go(page, "/runs?scope=project:nope", "", 1200);
    check((await page.inputValue("#reports-scope")) === "mine", "a scope that no longer exists falls back to Mine");
    await page.focus("#reports-scope");
    await page.keyboard.press("ArrowDown");
    await wait(800);
    check((await page.inputValue("#reports-scope")) !== "mine", "the scope picker works from the keyboard");
    await ctx.close();
  }

  // 8. Fact library: the same picker; filters work inside the chosen scope.
  {
    const { ctx, page } = await context(browser);
    await signIn(page);
    await go(page, "/library", "", 1200);
    check((await page.locator("label[for='lib-scope']").innerText()) === "Show fact cards from", "Fact library has a labelled scope picker");
    await page.selectOption("#lib-scope", "project:proj-ebay");
    await wait(900);
    const all = await page.locator(".card-grid > li").count();
    check(all > 0 && (await text(page, ".library-results")).includes("Added by"), `a project scope lists the project's fact cards with who added them (${all})`);
    await page.selectOption("#lib-type", "unverified");
    await wait(700);
    const unverified = await page.locator(".card-grid > li").count();
    check(unverified < all, `the type filter narrows cards inside the project (${unverified} of ${all})`);
    await page.selectOption("#lib-scope", "team:team-north");
    await wait(900);
    check((await text(page, ".library-results")).includes("No fact cards in this team's projects yet"), "a team without finished reports says so");
    check((await page.inputValue("#lib-type")) === "", "changing the scope clears the filters");
    await ctx.close();
  }

  // 9. Leaving a team: a project owner picks who takes over; 429 when that member already has 10 live projects.
  {
    const { ctx, page } = await context(browser);
    await signIn(page);
    await go(page, "/team?team=team-north", "&limit=riley", 1300);
    await page.click("button:has-text('Leave team')");
    await wait(500);
    check(await page.locator("#leave-dialog[open]").isVisible(), "Leave team opens a dialog");
    check(await page.evaluate(() => document.activeElement?.id === "leave-heir"), "focus starts on Who takes over?");
    check((await page.locator("label[for='leave-heir']").innerText()) === "Who takes over?", "the member select is labelled “Who takes over?”");
    const heirs = await page.locator("#leave-heir option").allInnerTexts();
    check(heirs.length === 3 && heirs.some((t) => t.startsWith("Riley Chen")) && heirs.some((t) => t.startsWith("Jordan Lee")), "it offers the other members");
    check((await text(page, ".leave-moves")).includes("Market stall planters"), "it lists the projects that move");
    await page.click("#leave-dialog button:has-text('Leave team')");
    await wait(300);
    check((await text(page, "#leave-error")).includes("Choose who takes over"), "leaving without choosing asks who takes over");
    await page.selectOption("#leave-heir", "demo-riley");
    await page.click("#leave-dialog button:has-text('Leave team')");
    await wait(600);
    const limitError = await text(page, "#leave-error");
    check(limitError.includes("Riley Chen already has 10 live projects") && limitError.includes("Choose someone else"),
      "a member at 10 live projects is refused, with a hint to pick someone else");
    check(await page.locator("#leave-dialog[open]").isVisible() && (await page.getAttribute("#leave-heir", "aria-invalid")) === "true",
      "the dialog stays open on the refusal");
    await page.selectOption("#leave-heir", "demo-jordan");
    await page.click("#leave-dialog button:has-text('Leave team')");
    await wait(1200);
    check(await page.locator("#leave-dialog").isHidden(), "the dialog closes after leaving");
    check((await text(page, "#toast")).includes("Jordan Lee takes over"), "a toast says who took over");
    check(await page.locator("#team-select").count() === 0 && (await text(page, "h1")) === "Clay & Leaf Studio", "the person is now in one team");
    check(!(await text(page, ".sb-projects")).includes("Market stall planters"), "the handed-over project leaves the sidebar");
    await ctx.close();
  }
  {
    const { ctx, page } = await context(browser);
    await signIn(page);
    await go(page, "/team?team=team-clay", "", 1300);
    const remove = page.locator(".member-row button:has-text('Remove')").first();
    await remove.click();
    await wait(400);
    check((await text(page, "#confirm-body")).includes("move to you"), "removing a member says their projects move to the team owner");
    await page.keyboard.press("Escape");
    await page.click("button:has-text('Leave team')");
    await wait(500);
    const moves = await text(page, ".leave-moves");
    check(moves.includes("Ownership of the team") && moves.includes("Planters on eBay"), "a team owner hands over the team and their projects in it");
    await page.selectOption("#leave-heir", "demo-riley");
    await page.click("#leave-dialog button:has-text('Leave team')");
    await wait(1200);
    check((await text(page, "h1")) === "North Market Makers", "after handing over, the former owner sees their other team");
    check(!(await text(page, ".sb-projects")).includes("Planters on eBay"), "the former owner no longer sees the handed-over team project");
    await ctx.close();
  }

  // 10. 10 live projects: creating or restoring one at the limit is refused with a hint to archive.
  {
    const { ctx, page } = await context(browser);
    await signIn(page);
    await go(page, "/new", "&projects=limit", 1000);
    await page.click(".sb-add");
    await wait(400);
    await page.fill("#npd-name", "An eleventh idea");
    await page.click("#new-project-dialog button:has-text('Create project')");
    await wait(600);
    const createError = await text(page, "#new-project-dialog .form-error");
    check(createError.includes("10 live projects") && /archive/i.test(createError), "creating an 11th live project is refused with a hint to archive one");
    await page.keyboard.press("Escape");
    await go(page, "/p/proj-classes", "&projects=limit", 1200);
    await page.click("button:has-text('Project settings')");
    await wait(400);
    await page.click("#project-settings button:has-text('Restore project')");
    await wait(600);
    const restoreError = await text(page, "#project-settings .form-error");
    check(restoreError.includes("10 live projects"), "restoring an archived project at the limit is refused");
    await ctx.close();
  }

  // 6. Screenshots with axe, horizontal scroll and target-size checks at both widths.
  for (const width of [1280, 375]) {
    const { ctx, page } = await context(browser, width);
    await signIn(page);
    await go(page, "/p/proj-planters", "", 1200);
    await snap(page, "01-project-page", width);
    await page.click("#project-tab-cards");
    await wait(600);
    await snap(page, "02-project-fact-cards", width);
    await go(page, "/new/marketing_plan?project=proj-planters", "", 1200);
    await page.click(".project-picker button:has-text('New project')");
    await wait(400);
    await snap(page, "03-new-research-project", width);
    await go(page, "/runs/a1b2c3d4e5f6", "", 1300);
    await snap(page, "04-report-in-project", width);
    await page.click("button:has-text('Move to project')");
    await wait(600);
    await snap(page, "05-move-dialog", width, { fullPage: false });
    await page.keyboard.press("Escape");
    await go(page, "/team", "", 1200);
    await snap(page, "06-team-picker", width);
    await go(page, "/p/proj-ebay", "", 1200);
    await page.click("button:has-text('Project settings')");
    await wait(600);
    await snap(page, "07-project-settings", width, { fullPage: false });
    await page.keyboard.press("Escape");
    await go(page, "/runs?scope=team:team-clay", "", 1200);
    await snap(page, "10-reports-scope-team", width);
    await go(page, "/library?scope=project:proj-ebay", "", 1300);
    await snap(page, "11-library-scope-project", width);
    await go(page, "/team?team=team-north", "&limit=riley", 1200);
    await page.click("button:has-text('Leave team')");
    await page.selectOption("#leave-heir", "demo-riley");
    await page.click("#leave-dialog button:has-text('Leave team')");
    await wait(700);
    await snap(page, "12-leave-dialog-handover", width, { fullPage: false });
    await page.keyboard.press("Escape");
    if (width < 600) {
      await go(page, "/new", "", 900);
      await page.click("#menu-btn");
      await wait(400);
      await snap(page, "08-sidebar-projects-drawer", width, { fullPage: false });
    } else {
      await go(page, "/new", "", 900);
      await snap(page, "08-sidebar-projects", width, { fullPage: false });
    }
    await ctx.close();
  }
  {
    const { ctx, page } = await context(browser, 1280, { ...PREFS, zoom: 200 });
    await signIn(page);
    await go(page, "/p/proj-planters", "", 1200);
    await snap(page, "09-project-page-zoom-200", 1280);
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, "qa-report.json"), JSON.stringify(report, null, 2));
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})();
