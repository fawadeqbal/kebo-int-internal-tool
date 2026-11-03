// Accessibility check of the design system's proof page (Customers list and the
// New customer side panel) with axe, at desktop and phone widths. Needs the app
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

const browser = await chromium.launch();
let failures = 0;
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  const page = await (await browser.newContext({ viewport })).newPage();
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
}
await browser.close();
process.exit(failures ? 1 : 0);
