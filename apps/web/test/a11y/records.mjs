// Record pages (design system: Record frame) and their side panels, in a real browser: old URLs
// (/customers/:id/edit, /factories/new, /factories/:id/edit, /users/new, ?tab=history) land on the
// page with the panel open; New / Edit save in the panel and the page updates in place; and axe
// finds no serious problem on each record page and each create/edit panel, at desktop and phone
// widths. Needs the app running (BASE, default http://localhost:3000) with demo data, and Playwright:
//   NODE_PATH=$(npm root -g) node apps/web/test/a11y/records.mjs
// SHOTS=<dir> also saves a screenshot of each page and panel there.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { AxeBuilder } = require("@axe-core/playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
let failures = 0;

function fail(what) {
  console.log(`  FAIL ${what}`);
  failures++;
}
function ok(cond, what) {
  if (cond) console.log(`  ok   ${what}`);
  else fail(what);
}

async function axe(page, what, include) {
  let builder = new AxeBuilder({ page }).withTags(TAGS).exclude("nextjs-portal");
  if (include) builder = builder.include(include);
  const r = await builder.analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  console.log(`${what}: ${r.passes.length} rules pass, ${r.violations.length} violations (${bad.length} serious/critical)`);
  for (const v of r.violations) console.log(`  - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(" ")}`);
  failures += bad.length;
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => page.waitForTimeout(1000));
}
async function go(page, path) {
  await page.goto(`${BASE}${path}`, { timeout: 90_000 });
  await settle(page);
}
async function shot(page, name, full = true) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
}
/** The first record of a list: its id. */
async function firstId(page, list) {
  await go(page, `/${list}`);
  const href = await page.locator(`main a[href^="/${list}/"]`).first().getAttribute("href");
  return href.split("/")[2].split("?")[0];
}
async function dialogTitle(page) {
  const d = page.locator("[role=dialog]");
  await d.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);
  const id = await d.getAttribute("aria-labelledby");
  return page.locator(`[id="${id}"]`).innerText();
}

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const stamp = Date.now().toString(36);
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  const w = viewport.width;
  console.log(`\n# ${w}px`);
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", process.env.EMAIL ?? "admin@example.com");
  await page.fill("#password", process.env.PASSWORD ?? "Admin@12345");
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));

  const customer = await firstId(page, "customers");
  const factory = await firstId(page, "factories");
  const user = await firstId(page, "users");

  // Record pages: the frame, and axe.
  for (const [name, path, h1] of [
    ["customer", `/customers/${customer}`, "Details"],
    ["factory", `/factories/${factory}`, "Details"],
    ["user", `/users/${user}`, "Details"],
  ]) {
    await go(page, path);
    ok(await page.getByRole("heading", { name: h1, exact: true }).isVisible(), `${name}: Details card`);
    ok((await page.locator("main [role=tablist], main nav[aria-label$='sections'] a[role=tab]").count()) === 0, `${name}: no tabs`);
    if (w < 768) ok(await page.locator("nav[aria-label$='sections'] a[aria-current]").first().isVisible(), `${name}: sections as chips on a phone`);
    await axe(page, `${name} page ${w}`, "main");
    await shot(page, `${name}-${w}`);
  }

  // Old URLs → the page with its panel open.
  for (const [what, path, url, title] of [
    ["/customers/:id/edit", `/customers/${customer}/edit`, /\/customers\/[^/?]+\?panel=edit-customer/, /^Edit customer · /],
    ["/customers/new", "/customers/new", /\/customers\?panel=new-customer/, /^New customer$/],
    ["/factories/new", "/factories/new", /\/factories\?panel=new-factory/, /^New factory$/],
    ["/factories/:id/edit", `/factories/${factory}/edit`, /\/factories\/[^/?]+\?panel=edit-factory/, /^Edit factory · /],
    ["/users/new", "/users/new", /\/users\?panel=new-user/, /^Add a person$/],
    ["?tab=history", `/customers/${customer}?tab=history`, /panel=history/, /^History · /],
    ["user ?panel=edit-user", `/users/${user}?panel=edit-user&id=${user}`, /panel=edit-user/, /^Edit person · /],
  ]) {
    await go(page, path);
    ok(url.test(page.url()), `${what} → ${page.url().replace(BASE, "")}`);
    const t = await dialogTitle(page);
    ok(title.test(t), `${what}: panel "${t}"`);
    if (!what.includes("history")) {
      ok(await page.evaluate(() => document.activeElement?.matches("[role=dialog] input, [role=dialog] select, [role=dialog] textarea")), `${what}: focus on the first field`);
      await axe(page, `${what} panel ${w}`, "[role=dialog]");
    }
    await shot(page, `panel-${what.replace(/[^a-z]+/gi, "-").replace(/^-|-$/g, "")}-${w}`, false);
  }

  // Old tab links land on their section.
  await go(page, `/customers/${customer}?tab=orders`);
  ok(await page.locator("#orders").isVisible(), "?tab=orders shows the Orders section");

  // Edit in the panel from Details ✎ Edit: Esc with changes asks first; saving updates the card in place.
  await go(page, `/factories/${factory}`);
  await page.getByRole("link", { name: /^Edit / }).first().click();
  await dialogTitle(page);
  const contact = `Mr Wang ${stamp}${w}`;
  await page.fill("#contactPerson", contact);
  await page.keyboard.press("Escape");
  ok(await page.getByRole("alertdialog").isVisible(), "Esc with changes asks “Discard changes?”");
  await page.getByRole("button", { name: "Keep editing" }).click();
  await page.keyboard.press("Control+Enter");
  await page.locator("[role=dialog]").waitFor({ state: "detached", timeout: 30_000 });
  await settle(page);
  ok(await page.getByText(contact).locator("visible=true").first().isVisible(), "factory saved from the panel: Details shows the new contact");
  ok(!page.url().includes("panel="), "panel closed after saving");

  // New factory from the list's primary.
  await go(page, "/factories");
  await page.getByRole("link", { name: "New factory" }).click();
  await dialogTitle(page);
  const fname = `Test Works ${stamp}${w}`;
  await page.fill("#name", fname);
  await page.getByRole("button", { name: "Add the factory" }).click();
  await page.locator("[role=dialog]").waitFor({ state: "detached", timeout: 30_000 });
  await settle(page);
  ok(page.url().includes("saved="), "new factory: the list lights its row");

  // A field error shows next to the field and the panel stays open.
  await go(page, "/users?panel=new-user");
  await dialogTitle(page);
  await page.fill("#name", `Tester ${w}`);
  await page.fill("#email", "not-an-email");
  await page.fill("#password", "short");
  await page.getByRole("button", { name: "Add the person" }).click();
  await page.waitForTimeout(1500);
  ok(await page.locator("[role=dialog] [aria-invalid=true]").first().isVisible(), "new person: errors next to the fields, the panel stays");
  const email = `tester-${stamp}-${w}@example.com`;
  await page.fill("#email", email);
  await page.fill("#password", "Testing12345");
  await page.getByRole("button", { name: "Add the person" }).click();
  await page.locator("[role=dialog]").waitFor({ state: "detached", timeout: 30_000 });
  await settle(page);
  ok(await page.getByText(email).locator("visible=true").first().isVisible(), "new person added from the panel");

  // Edit the customer from Details (no change needed: Save closes the panel).
  await go(page, `/customers/${customer}`);
  await page.getByRole("link", { name: /^Edit / }).first().click();
  await dialogTitle(page);
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.locator("[role=dialog]").waitFor({ state: "detached", timeout: 30_000 });
  ok(true, "customer saved from the panel");

  await context.close();
}
await browser.close();
console.log(failures ? `\n${failures} failure(s)` : "\nall good");
process.exit(failures ? 1 : 0);
