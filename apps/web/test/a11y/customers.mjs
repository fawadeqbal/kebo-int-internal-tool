// Accessibility check of the design system's list pages with axe, at desktop and
// phone widths: Customers and its New customer side panel (the proof page), then
// every other list on the same frame, filtered-empty states and an open row menu. Needs the app
// running (BASE, default http://localhost:3000) and Playwright:
//   NODE_PATH=$(npm root -g) node apps/web/test/a11y/customers.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { AxeBuilder } = require("@axe-core/playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function check(page, what, include) {
  let builder = new AxeBuilder({ page }).withTags(TAGS).exclude("nextjs-portal");
  if (include) builder = builder.include(include);
  const r = await builder.analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  console.log(`${what}: ${r.passes.length} rules pass, ${r.violations.length} violations (${bad.length} serious/critical)`);
  for (const v of r.violations) console.log(`  - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(" ")}`);
  return bad.length;
}

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
let failures = 0;
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  const context = await browser.newContext({ viewport });
  let page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", process.env.EMAIL ?? "admin@example.com");
  await page.fill("#password", process.env.PASSWORD ?? "Admin@12345");
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto(`${BASE}/customers`);
  await page.waitForLoadState("networkidle");
  failures += await check(page, `Customers list ${viewport.width}`, "main");
  await page.getByRole("link", { name: "New customer" }).click();
  await page.waitForSelector("[role=dialog]");
  await page.waitForTimeout(400);
  failures += await check(page, `New customer panel ${viewport.width}`, "[role=dialog]");
  for (const path of [
    "/inquiries",
    "/inquiries?q=zz-nothing-zz",
    "/orders",
    "/orders?status=all&q=zz-nothing-zz",
    "/orders?view=board",
    "/factories",
    "/users",
    "/notifications",
    "/audit",
  ]) {
    // A fresh tab for each list keeps the browser's memory small.
    await page.close();
    page = await context.newPage();
    await page.goto(`${BASE}${path}`, { timeout: 90_000 });
    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => page.waitForTimeout(1000));
    failures += await check(page, `${path} ${viewport.width}`, "main");
  }
  if (viewport.width > 640) {
    await page.goto(`${BASE}/inquiries`);
    await page.waitForLoadState("networkidle");
    await page.locator("tbody button[aria-haspopup=menu]").first().click();
    await page.waitForSelector("[role=menu]");
    failures += await check(page, `Row menu ${viewport.width}`, "[role=menu]");
    await page.keyboard.press("Escape");
  }
}
await browser.close();
process.exit(failures ? 1 : 0);
