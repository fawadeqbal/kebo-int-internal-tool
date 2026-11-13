// The sidebar in modules (design page 33), in a real browser:
//   - every old address (/money?tab=…, /insights?section=…, /security/…, /settings?tab=…, /reports/money,
//     /orders?view=board) lands on its new page, with its filters;
//   - the new pages: breadcrumb above the title, the title is the sidebar item's name, no row of tabs;
//   - axe (WCAG 2.2 A/AA and best practice) on the sidebar expanded and collapsed at 1440, the rail's
//     menu open, and the phone drawer at 390, with no sideways scroll;
//   - the keyboard: modules open and close with Enter; in the rail, focus opens a module's menu,
//     ↓ goes in, Esc closes it back on the icon, every focused control shows a focus ring;
//   - the phone drawer's rows are at least 44 px tall;
//   - Excel exports and the printable report still answer;
//   - a manager and a staff member see only their modules.
//
// Needs the app running (BASE, default http://localhost:3000) on a fresh demo database, and Playwright:
//   NODE_PATH=$(npm root -g) node apps/web/test/a11y/erp-nav.mjs
// SHOTS=<dir> saves the screenshots (and erp-built.png, the key ones side by side) there.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { AxeBuilder } = require("@axe-core/playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const problems = [];
const fail = (where, what) => {
  failures++;
  problems.push(`${where}: ${what}`);
  console.log(`  FAIL ${where}: ${what}`);
};
const ok = (what) => console.log(`  ok   ${what}`);

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(150);
}
async function axe(page, where, include) {
  let b = new AxeBuilder({ page }).withTags(TAGS).exclude("nextjs-portal").exclude("iframe");
  if (include) b = b.include(include);
  const r = await b.analyze();
  const bad = r.violations.filter((v) => v.nodes.length);
  for (const v of bad) fail(where, `axe [${v.impact}] ${v.id}: ${v.help} e.g. ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  if (!bad.length) ok(`${where}: axe clean`);
}
async function noSideways(page, where) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  if (w[0] > w[1] + 1) fail(where, `scrolls sideways (${w[0]} in ${w[1]})`);
}
async function signIn(browser, email, password, viewport = { width: 1440, height: 900 }, cookies = []) {
  const context = await browser.newContext({ viewport });
  if (cookies.length) await context.addCookies(cookies.map((c) => ({ ...c, url: BASE })));
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { context, page };
}
const shot = async (page, name, opts = {}) => SHOTS && page.screenshot({ path: join(SHOTS, name), ...opts });
const here = (page) => {
  const u = new URL(page.url());
  return u.pathname + u.search;
};
/** Is the focused element showing a focus ring (outline or box-shadow ring)? */
const ringed = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return false;
    const s = getComputedStyle(a);
    return (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== "none");
  });

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });

/* ------------------------------------------------------------------ 1. old addresses */
{
  console.log("\n# old addresses → new pages");
  const { context, page } = await signIn(browser, process.env.EMAIL ?? "admin@example.com", process.env.PASSWORD ?? "Admin@12345");
  const cases = [
    ["/money", "/finance/cash-book"],
    ["/money?tab=cash", "/finance/cash-book"],
    ["/money?tab=cash&acct=none", "/finance/cash-book?acct=none"],
    ["/money?tab=expenses", "/money/company-costs"],
    ["/money?tab=expenses&p=2026", "/money/company-costs?p=2026"],
    ["/money?tab=receive", "/money/due"],
    ["/money?tab=owe", "/money/due?side=suppliers"],
    ["/money?tab=owe&mine=1", "/money/due?side=suppliers&mine=1"],
    ["/money?tab=pnl", "/reports/profit"],
    ["/insights", "/reports"],
    ["/insights?period=month", "/reports?period=month"],
    ["/insights?section=overview", "/reports"],
    ["/insights?section=money", "/reports/profit"],
    ["/insights?section=money&view=pnl", "/reports/profit"],
    ["/insights?section=money&view=pnl&year=2025&pl=cash", "/reports/profit"],
    ["/insights?section=money&view=leaks", "/reports/profit"],
    ["/insights?section=customers", "/reports/customers"],
    ["/insights?section=customers&period=year", "/reports/customers?period=year"],
    ["/insights?section=factories", "/reports/factories"],
    ["/insights?section=people", "/reports/people"],
    ["/insights?section=people&view=targets", "/reports/people/targets"],
    ["/insights?section=funnel", "/reports/funnel"],
    ["/insights?tab=sales", "/reports/funnel"],
    ["/insights?tab=customers", "/reports/customers"],
    ["/insights?tab=profit", "/reports/profit"],
    ["/insights?tab=profit&sub=pnl", "/reports/profit"],
    ["/insights?tab=profit&sub=orders", "/reports/profit"],
    ["/insights?tab=targets", "/reports/people/targets"],
    ["/reports/money", "/reports/profit"],
    ["/reports/money?view=customers", "/reports/profit"],
    ["/security", "/access/roles"],
    ["/security/sessions", "/access/sessions"],
    ["/security/sign-ins", "/access/sign-ins"],
    ["/security/sign-ins?failed=1", "/access/sign-ins?failed=1"],
    ["/security/roles/manager", "/access/roles/manager"],
    ["/security/roles/new", "/access/roles?panel=new-role"],
    ["/access", "/access/roles"],
    ["/settings", "/settings/company"],
    ["/settings?tab=company", "/settings/company"],
    ["/settings?tab=sales", "/settings/sales"],
    ["/settings?tab=reminders", "/settings/reminders"],
    ["/settings?tab=notifications", "/settings/emails"],
    ["/settings?tab=order-checklist", "/settings/company"],
    ["/settings?tab=papers", "/settings/papers"],
    ["/settings?tab=website-form", "/settings/website-form"],
    ["/settings?section=reminders", "/settings/reminders"],
    ["/orders?view=board", "/orders/board"],
    ["/orders?view=board&mine=1", "/orders/board?mine=1"],
    ["/orders?mine=1&stage=payment", "/orders/board?mine=1&stage=payment"],
    ["/orders?view=mine", "/orders?view=mine"],
  ];
  for (const [from, to] of cases) {
    await page.goto(`${BASE}${from}`);
    const at = here(page);
    if (at !== to) fail(`redirect ${from}`, `landed on ${at}, not ${to}`);
    else ok(`${from} → ${to}`);
  }

  console.log("\n# the new pages: breadcrumb, title, no tab row");
  const pages = [
    ["/follow-ups", "My work", "Follow-ups"],
    ["/approvals", "My work", "Approvals"],
    ["/notifications", "My work", "Notifications"],
    ["/inquiries", "Sales", "Inquiries"],
    ["/customers", "Sales", "Customers"],
    ["/orders", "Orders", "Orders"],
    ["/orders/board", "Orders", "Order board"],
    ["/factories", "Purchasing", "Factories"],
    ["/purchasing/to-pay", "Purchasing", "To pay factories"],
    ["/finance/to-receive", "Finance", "To receive"],
    ["/finance/cash-book", "Finance", "Cash book"],
    ["/finance/expenses", "Finance", "Expenses"],
    ["/finance/profit", "Finance", "Profit & loss"],
    ["/finance/leaks", "Finance", "Leaks"],
    ["/reports", "Reports", "Overview"],
    ["/reports/customers", "Reports", "Customers"],
    ["/reports/factories", "Reports", "Factories"],
    ["/reports/people", "Reports", "People & targets"],
    ["/reports/funnel", "Reports", "Sales funnel"],
    ["/reports/print", "Reports", "Printable reports"],
    ["/settings/company", "Settings", "Company"],
    ["/settings/sales", "Settings", "Sales & quotations"],
    ["/settings/reminders", "Settings", "Reminders"],
    ["/settings/emails", "Settings", "Emails"],
    ["/settings/papers", "Settings", "Papers"],
    ["/settings/website-form", "Settings", "Website form"],
    ["/users", "People & access", "Users"],
    ["/access/roles", "People & access", "Roles"],
    ["/access/sessions", "People & access", "Sessions"],
    ["/access/sign-ins", "People & access", "Sign-ins"],
    ["/audit", "People & access", "Audit log"],
  ];
  for (const [path, module, title] of pages) {
    const res = await page.goto(`${BASE}${path}`);
    await settle(page);
    const where = `page ${path}`;
    if (!res || res.status() >= 400) fail(where, `HTTP ${res?.status()}`);
    const crumbs = await page.locator("main nav[aria-label=Breadcrumb] li").allInnerTexts().catch(() => []);
    const h1 = (await page.locator("main h1").first().innerText().catch(() => "")).trim();
    const want = [module, title];
    const got = crumbs.map((c) => c.replace("›", "").trim());
    if (JSON.stringify(got) !== JSON.stringify(want)) fail(where, `breadcrumb ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
    if (h1 !== title) fail(where, `title "${h1}", not "${title}"`);
    // The sidebar's own tab rows are gone: no section list or tab row naming the module's other pages.
    // (A page's own filters and views stay: month/year, chips, Leaks' views.)
    const tabs = await page.locator('main [aria-label="Money sections"], main [aria-label="Insights sections"], main [aria-label="Security sections"], main [aria-label="Settings sections"]').count();
    if (tabs) fail(where, "still has a row of tabs / sections");
    const current = await page.locator("aside[aria-label=Sidebar] [aria-current=page]").allInnerTexts();
    if (current.length !== 1 || current[0].trim() !== title) fail(where, `sidebar marks ${JSON.stringify(current)}`);
    if (JSON.stringify(got) === JSON.stringify(want) && h1 === title) ok(`${path}: ${module} › ${title}`);
  }

  console.log("\n# Excel and the printable report");
  await page.goto(`${BASE}/finance/cash-book`);
  await settle(page);
  for (const [path, what] of [
    ["/finance/cash-book", "cash book"],
    ["/finance/expenses", "expenses"],
    ["/finance/to-receive", "receivables"],
    ["/purchasing/to-pay", "payables"],
    ["/orders", "orders"],
    ["/reports/customers", "insights"],
  ]) {
    await page.goto(`${BASE}${path}`);
    await settle(page);
    const href = await page.locator("main a[download]").first().getAttribute("href").catch(() => null);
    if (!href) {
      fail(`Excel on ${path}`, "no Excel link");
      continue;
    }
    const r = await page.request.get(`${BASE}${href}`);
    const type = r.headers()["content-type"] ?? "";
    if (r.status() !== 200 || !/spreadsheet|excel|octet/.test(type)) fail(`Excel on ${path}`, `${href}: HTTP ${r.status()} ${type}`);
    else ok(`Excel on ${path} (${what}): ${href.split("?")[0]} → ${type.split(";")[0]}`);
  }
  await page.goto(`${BASE}/reports/print`);
  await settle(page);
  const view = await page.locator("main a", { hasText: "View / Print" }).first().getAttribute("href");
  const pdf = await page.locator("main a", { hasText: "Download PDF" }).first().getAttribute("href");
  const printPage = await context.newPage();
  const pr = await printPage.goto(`${BASE}${view}`);
  await settle(printPage);
  const printText = await printPage.locator("body").innerText();
  if (pr?.status() !== 200 || !/report/i.test(printText)) fail("printable report", `${view}: HTTP ${pr?.status()}`);
  else ok(`printable report ${view.split("?")[0]} answers`);
  const back = await printPage.locator("a", { hasText: /Back|←/ }).first().getAttribute("href").catch(() => null);
  if (back && !back.startsWith("/reports/print")) fail("printable report", `its back link goes to ${back}`);
  await printPage.close();
  const pdfRes = await page.request.get(`${BASE}${pdf}`, { timeout: 120_000 }).catch((e) => ({ status: () => `error ${e.message}`, headers: () => ({}) }));
  if (pdfRes.status() === 200 && /pdf/.test(pdfRes.headers()["content-type"] ?? "")) ok(`printable report PDF ${pdf.split("?")[0]} answers`);
  else console.log(`  note printable report PDF: ${pdfRes.status()} (needs Chromium for PDFs on this machine)`);
  await context.close();
}

/* ------------------------------------------------------------------ 2. the sidebar expanded, at 1440 */
{
  console.log("\n# expanded at 1440");
  const { context, page } = await signIn(browser, "admin@example.com", "Admin@12345");
  for (const path of ["/finance/cash-book", "/reports/customers", "/settings/company", "/access/roles", "/orders/board", "/finance/profit", "/reports/print"]) {
    await page.goto(`${BASE}${path}`);
    await settle(page);
    await axe(page, `1440 ${path}`);
    await noSideways(page, `1440 ${path}`);
  }
  await page.goto(`${BASE}/finance/cash-book`);
  await settle(page);
  await shot(page, "erp-cashbook-1440.png");
  await page.goto(`${BASE}/reports/customers`);
  await settle(page);
  await shot(page, "erp-reports-customers-1440.png");
  await page.goto(`${BASE}/settings/company`);
  await settle(page);
  await shot(page, "erp-settings-company-1440.png");

  // Modules open and close with the keyboard, with a focus ring.
  const sales = page.locator("aside[aria-label=Sidebar] button", { hasText: "Sales" });
  await sales.focus();
  if (!(await ringed(page))) fail("1440 keyboard", "the module button shows no focus ring");
  const was = await sales.getAttribute("aria-expanded");
  await page.keyboard.press("Enter");
  const now = await sales.getAttribute("aria-expanded");
  if (was === now) fail("1440 keyboard", "Enter does not open/close a module");
  else ok(`Enter on Sales: aria-expanded ${was} → ${now}`);
  await page.keyboard.press("Tab");
  const next = await page.evaluate(() => document.activeElement?.textContent?.trim());
  if (now === "true" && next !== "Inquiries") fail("1440 keyboard", `Tab after opening Sales lands on "${next}"`);
  else ok(`Tab goes into the open module (${next})`);
  // Remembered per browser: a reload keeps it.
  await page.reload();
  await settle(page);
  const after = await page.locator("aside[aria-label=Sidebar] button", { hasText: "Sales" }).getAttribute("aria-expanded");
  if (after !== now) fail("1440 remember", `Sales was ${now}, after a reload ${after}`);
  else ok("open modules are remembered across a reload");
  // The rail's keyboard: collapse with the button at the top.
  await page.locator("button[aria-label='Collapse the sidebar']").click();
  await settle(page);
  const width = await page.locator("aside[aria-label=Sidebar]").evaluate((el) => el.getBoundingClientRect().width);
  if (width !== 64) fail("collapse", `the rail is ${width}px wide`);
  else ok("collapsed to a 64px rail");
  await context.close();
}

/* ------------------------------------------------------------------ 3. collapsed: the rail and its menus */
{
  console.log("\n# collapsed rail at 1440");
  const { context, page } = await signIn(browser, "admin@example.com", "Admin@12345", { width: 1440, height: 900 }, [{ name: "nav-rail", value: "1" }]);
  // No jump on load: the first paint is already the rail (the server read the cookie).
  const res = await page.goto(`${BASE}/settings/company`);
  const html = await res.text();
  if (!/data-sidebar="rail"/.test(html) || !/lg:pl-16/.test(html)) fail("rail on load", "the server's HTML is not the rail (layout would jump)");
  else ok("the server draws the rail (no jump on load)");
  await settle(page);
  await axe(page, "1440 rail /settings/company");
  await noSideways(page, "1440 rail");
  const main = await page.locator("main").evaluate((el) => el.getBoundingClientRect().left);
  if (main > 64 + 40) fail("rail", `the page starts at ${main}px`);

  // Hover opens Finance's menu.
  const finance = page.locator("aside[aria-label=Sidebar] button[aria-haspopup=menu][aria-label^=Finance]");
  await finance.hover();
  const menu = page.locator("[role=menu]");
  await menu.waitFor({ timeout: 3000 }).catch(() => fail("rail hover", "hovering Finance opens no menu"));
  const items = await menu.locator("[role=menuitem]").allInnerTexts();
  if (JSON.stringify(items.map((t) => t.trim())) !== JSON.stringify(["To receive", "Cash book", "Expenses", "Profit & loss", "Leaks"])) fail("rail hover", `menu has ${JSON.stringify(items)}`);
  else ok(`hover Finance: ${items.join(" · ")}`);
  await axe(page, "1440 rail menu open");
  await shot(page, "erp-rail-flyout-1440.png");
  await page.mouse.move(900, 600);
  await page.waitForTimeout(400);
  if (await menu.count()) fail("rail hover", "the menu stays after the mouse leaves");

  // Keyboard: Tab to the Reports icon (focus opens it), ↓ in, ↓, Esc back on the icon.
  await page.locator("button[aria-label='Expand the sidebar']").focus();
  let guard = 0;
  while (!/^Reports/.test((await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) ?? "") && guard++ < 20) {
    await page.keyboard.press("Tab");
    if (!(await ringed(page))) fail("rail keyboard", `no focus ring on ${await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))}`);
  }
  if (!(await menu.count())) fail("rail keyboard", "focusing the Reports icon opens no menu");
  else ok("focus on the Reports icon opens its menu");
  await page.keyboard.press("ArrowDown");
  let focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
  if (focused !== "Overview") fail("rail keyboard", `↓ lands on "${focused}"`);
  await page.keyboard.press("ArrowDown");
  focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
  if (focused !== "Customers") fail("rail keyboard", `↓↓ lands on "${focused}"`);
  if (!(await ringed(page))) fail("rail keyboard", "no focus ring in the menu");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  const back = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  if ((await menu.count()) || !/^Reports/.test(back ?? "")) fail("rail keyboard", `Esc: menu ${await menu.count()} open, focus on ${back}`);
  else ok("↓ ↓ Esc: in the menu, then closed with focus back on the icon");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => u.pathname === "/reports/customers", { timeout: 15_000 }).catch(() => fail("rail keyboard", `Enter on Customers went to ${page.url()}`));
  if (new URL(page.url()).pathname === "/reports/customers") ok("Enter on a menu item opens the page");
  await settle(page);
  await axe(page, "1440 rail /reports/customers");
  await context.close();
}

/* ------------------------------------------------------------------ 4. the phone drawer, at 390 */
{
  console.log("\n# phone at 390");
  const { context, page } = await signIn(browser, "admin@example.com", "Admin@12345", { width: 390, height: 844 });
  for (const path of ["/finance/cash-book", "/reports/customers", "/settings/company", "/access/roles"]) {
    await page.goto(`${BASE}${path}`);
    await settle(page);
    await axe(page, `390 ${path}`);
    await noSideways(page, `390 ${path}`);
  }
  await page.goto(`${BASE}/finance/cash-book`);
  await settle(page);
  await page.locator("header button[aria-label='Open menu']").click();
  const drawer = page.locator("aside[aria-label=Menu]");
  await drawer.waitFor();
  await page.waitForTimeout(300);
  const small = await drawer.evaluate((d) =>
    [...d.querySelectorAll("nav a, nav button")]
      .filter((el) => el.checkVisibility())
      .map((el) => [el.textContent.trim(), Math.round(el.getBoundingClientRect().height)])
      .filter(([, h]) => h < 44),
  );
  if (small.length) fail("390 drawer", `rows under 44px: ${JSON.stringify(small)}`);
  else ok("every drawer row is at least 44px tall");
  const current = await drawer.locator("[aria-current=page]").innerText();
  if (current.trim() !== "Cash book") fail("390 drawer", `marks "${current}"`);
  await axe(page, "390 drawer open");
  await shot(page, "erp-phone-drawer-390.png");
  await page.keyboard.press("Escape");
  await context.close();
}

/* ------------------------------------------------------------------ 5. a manager and a staff member */
{
  console.log("\n# who sees what");
  const want = {
    "manager@example.com": ["My work", "Sales", "Orders", "Purchasing", "Finance", "Reports", "People & access"],
    "sana@example.com": ["My work", "Sales", "Orders", "Purchasing"],
  };
  const pw = { "manager@example.com": "Manager@12345", "sana@example.com": "Demo@12345" };
  for (const [email, modules] of Object.entries(want)) {
    const { context, page } = await signIn(browser, email, pw[email]);
    await page.goto(`${BASE}/dashboard`);
    await settle(page);
    const got = await page.locator("aside[aria-label=Sidebar] nav > ul > li > button").allInnerTexts();
    const names = got.map((t) => t.replace(/\d+/g, "").trim());
    if (JSON.stringify(names) !== JSON.stringify(modules)) fail(email, `sees ${JSON.stringify(names)} (expected ${JSON.stringify(modules)})`);
    else ok(`${email}: ${names.join(" · ")}`);
    // Every module open, to show all their pages.
    const closed = page.locator("aside[aria-label=Sidebar] nav button[aria-expanded=false]");
    while (await closed.count()) await closed.first().click();
    await page.waitForTimeout(200);
    await axe(page, `1440 ${email} sidebar`, "aside[aria-label=Sidebar]");
    // Just the sidebar, every module open, so the two compare side by side.
    await shot(page, `erp-${email.split("@")[0] === "sana" ? "staff" : "manager"}-1440.png`, { clip: { x: 0, y: 0, width: 240, height: 900 } });
    // A page they may not open is not in the sidebar, and the page itself still refuses.
    if (email.startsWith("sana")) {
      const r = await page.goto(`${BASE}/finance/cash-book`);
      if (!new URL(page.url()).pathname.startsWith("/forbidden")) fail("staff", `/finance/cash-book opened (${page.url()}, ${r?.status()})`);
      else ok("staff: /finance/cash-book → forbidden");
    }
    // Close them again for the next run.
    await context.close();
  }
}

await browser.close();

/* ------------------------------------------------------------------ the screenshots side by side */
if (SHOTS) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 2400, height: 1000 } });
  const img = (f) => `data:image/png;base64,${readFileSync(join(SHOTS, f)).toString("base64")}`;
  const fig = (f, caption, w) => `<figure style="margin:0;width:${w}px"><figcaption>${caption}</figcaption><img src="${img(f)}" style="width:100%;border:1px solid #ddd;border-radius:8px"></figure>`;
  await p.setContent(`<!doctype html><body style="margin:24px;font:600 16px system-ui;background:#f4f4f6;color:#18181b">
<h1 style="font-size:22px;margin:0 0 16px">Sidebar in modules (built): expanded, collapsed with a menu, phone, manager and staff</h1>
<div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap">
${fig("erp-cashbook-1440.png", "Finance › Cash book (expanded)", 1100)}
${fig("erp-rail-flyout-1440.png", "Collapsed rail, Finance menu open", 1100)}
${fig("erp-phone-drawer-390.png", "Phone drawer (390)", 300)}
${fig("erp-reports-customers-1440.png", "Reports › Customers", 760)}
${fig("erp-settings-company-1440.png", "Settings › Company", 760)}
${fig("erp-manager-1440.png", "Manager's sidebar", 300)}
${fig("erp-staff-1440.png", "Staff's sidebar", 300)}
</div></body>`);
  await p.waitForTimeout(300);
  await p.screenshot({ path: join(SHOTS, "erp-built.png"), fullPage: true });
  await b.close();
  console.log(`\nScreenshots in ${SHOTS}, side by side in erp-built.png`);
}

console.log(failures ? `\n${failures} problem(s):\n${problems.map((x) => `  - ${x}`).join("\n")}` : "\nall erp sidebar checks pass");
process.exit(failures ? 1 : 0);
