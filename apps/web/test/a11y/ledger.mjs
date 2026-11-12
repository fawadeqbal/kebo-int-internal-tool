// Finance › Ledger (approved page 34), in a real browser:
//   - All entries, an entry in the side panel, By account, Customers, a customer's, a factory's and a person's
//     ledger: axe (WCAG 2.2 A/AA and best practice) at 1440 and 390, no sideways scroll at 390;
//   - the keyboard: a row's reference opens the entry (Enter), Esc closes it; every focused control shows a ring;
//   - one primary action per page (Share statement on a party, none on the ledger itself);
//   - Statement PDF gives the statement its number and opens the paper; Share statement opens its panel;
//   - Excel answers with a spreadsheet; staff without ledger.view are refused; To receive / To pay show ageing.
//
// Needs the app running (BASE, default http://localhost:3000) on a demo database, and Playwright:
//   NODE_PATH=$(npm root -g) node apps/web/test/a11y/ledger.mjs
// SHOTS=<dir> saves the screenshots there.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { AxeBuilder } = require("@axe-core/playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const fail = (where, what) => {
  failures++;
  console.log(`  FAIL ${where}: ${what}`);
};
const ok = (what) => console.log(`  ok   ${what}`);
async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(200);
}
async function axe(page, where) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).exclude("nextjs-portal").analyze();
  const bad = r.violations.filter((v) => v.nodes.length);
  for (const v of bad)
    fail(
      where,
      `axe [${v.impact}] ${v.id}: ${v.help} e.g. ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(" "))
        .join(" | ")}`,
    );
  if (!bad.length) ok(`${where}: axe clean`);
}
async function noSideways(page, where) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  if (w[0] > w[1] + 1) fail(where, `scrolls sideways (${w[0]} in ${w[1]})`);
  else ok(`${where}: no sideways scroll`);
}
async function primaries(page, where, n) {
  const count = await page.locator("main header").first().locator("a.bg-action-solid, button.bg-action-solid").count();
  if (count > n) fail(where, `${count} primary buttons in the header (want at most ${n})`);
  else ok(`${where}: ${count} primary`);
}
async function signIn(browser, email, password, viewport) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return { context, page };
}
const shot = async (page, name, opts = {}) => SHOTS && page.screenshot({ path: join(SHOTS, name), ...opts });
const ringed = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return false;
    const s = getComputedStyle(a);
    return (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== "none");
  });

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });

/* ------------------------------------------------------------------ the manager at 1440 */
console.log("Desktop (1440)");
const { context, page } = await signIn(browser, "manager@example.com", "Manager@12345", { width: 1440, height: 1000 });
await page.goto(`${BASE}/finance/ledger`);
await settle(page);
if (!(await page.getByRole("link", { name: "Ledger", exact: true }).first().isVisible())) fail("sidebar", "no Ledger under Finance");
else ok("sidebar: Finance › Ledger");
const order = await page.evaluate(() => [...document.querySelectorAll("aside a")].map((a) => a.textContent.trim()));
if (order.indexOf("Ledger") !== order.indexOf("To receive") + 1)
  fail("sidebar", `Ledger is not right after To receive: ${order.join(", ")}`);
await shot(page, "01-all-entries.png", { fullPage: true });
await axe(page, "All entries");
await primaries(page, "All entries", 0);
const footer = await page
  .getByText(/every debit has its credit/)
  .first()
  .isVisible();
footer ? ok("All entries: debits equal credits") : fail("All entries", "no 'every debit has its credit'");
if (await page.locator("tbody s").count()) ok("All entries: a removed entry is struck through");
else fail("All entries", "no removed entry struck through");

// The keyboard: Tab to a reference, Enter opens the entry, Esc closes it.
const first = page.locator("tbody tr td:nth-child(3) a").first();
await first.focus();
if (!(await ringed(page))) fail("keyboard", "the reference link shows no focus ring");
await page.keyboard.press("Enter");
await page.getByRole("dialog").waitFor({ timeout: 15_000 });
await settle(page);
ok("keyboard: Enter on a reference opens the entry");
await shot(page, "02-entry.png");
await axe(page, "Entry panel");
await page.keyboard.press("Escape");
await page
  .getByRole("dialog")
  .waitFor({ state: "detached", timeout: 15_000 })
  .then(
    () => ok("keyboard: Esc closes the entry"),
    () => fail("keyboard", "Esc did not close the entry"),
  );

for (const [view, name] of [
  ["accounts", "03-by-account.png"],
  ["customers", "04-customers.png"],
  ["factories", "05-factories.png"],
  ["staff", "06-staff.png"],
]) {
  await page.goto(`${BASE}/finance/ledger?view=${view}`);
  await settle(page);
  await shot(page, name, { fullPage: true });
  await axe(page, `view ${view}`);
}

// A customer's ledger, a factory's, a person's.
await page.goto(`${BASE}/finance/ledger?view=customers`);
await settle(page);
const customerHref = await page.locator("tbody tr td a").first().getAttribute("href");
await page.goto(`${BASE}${customerHref}`);
await settle(page);
await shot(page, "07-customer-ledger.png", { fullPage: true });
await axe(page, "Customer ledger");
await primaries(page, "Customer ledger", 1);
const tiles = await page.getByRole("region", { name: /by how late/ }).count();
tiles ? ok("Customer ledger: ageing tiles") : fail("Customer ledger", "no ageing tiles");

await page.goto(`${BASE}/finance/ledger?view=factories`);
await settle(page);
const factoryHref = await page.locator("tbody tr td a").first().getAttribute("href");
await page.goto(`${BASE}${factoryHref}`);
await settle(page);
await shot(page, "08-factory-ledger.png", { fullPage: true });
await axe(page, "Factory ledger");

// Share statement: its panel with a ready message.
await page.getByRole("button", { name: "Share statement" }).click();
await page.getByRole("dialog").waitFor({ timeout: 20_000 });
await settle(page);
const message = await page.getByLabel("Message").inputValue();
/ST-F-\d{4}-\d{4}/.test(message)
  ? ok(`Share statement: "${message.slice(0, 60)}…"`)
  : fail("Share statement", `no statement number in "${message}"`);
await shot(page, "09-share-statement.png");
await axe(page, "Share statement panel");
await page.keyboard.press("Escape");
await settle(page);

// Statement PDF: numbered, on the paper.
await page.getByRole("button", { name: "Statement PDF" }).click();
await page.waitForURL(/\/print\/ledger\/factory\//, { timeout: 30_000 });
await settle(page);
const number = await page
  .getByText(/ST-F-\d{4}-\d{4}/)
  .first()
  .textContent();
number ? ok(`Statement PDF: the paper ${number.trim()}`) : fail("Statement PDF", "no number on the paper");
await shot(page, "10-factory-statement.png", { fullPage: true });
const pdf = await page.getByRole("link", { name: /Download PDF/ }).getAttribute("href");
const res = await page.request.get(`${BASE}${pdf}`);
res.status() === 200 && (res.headers()["content-type"] ?? "").includes("pdf")
  ? ok("Statement PDF: downloads")
  : fail("Statement PDF", `download answered ${res.status()} ${await res.text().catch(() => "")}`.slice(0, 200));

await page.goto(`${BASE}/finance/ledger?view=staff`);
await settle(page);
const sHref = await page
  .locator("tbody tr td a")
  .first()
  .getAttribute("href")
  .catch(() => null);
if (sHref) {
  await page.goto(`${BASE}${sHref}`);
  await settle(page);
  await shot(page, "11-staff-ledger.png", { fullPage: true });
  await axe(page, "Staff ledger");
}

// Excel.
for (const what of ["ledger", `ledger-party?kind=customer&id=${customerHref.split("/").pop()}`]) {
  const x = await page.request.get(`${BASE}/sheets/export/${what}`);
  (x.headers()["content-type"] ?? "").includes("spreadsheet")
    ? ok(`Excel ${what.split("?")[0]}`)
    : fail("Excel", `${what} answered ${x.status()}`);
}

// To receive and To pay factories: ageing from the ledger, the lists as they were.
for (const [path, name] of [
  ["/finance/to-receive", "12-to-receive.png"],
  ["/purchasing/to-pay", "13-to-pay.png"],
]) {
  await page.goto(`${BASE}${path}`);
  await settle(page);
  (await page.getByRole("region", { name: /by how late/ }).count()) ? ok(`${path}: ageing`) : fail(path, "no ageing");
  await shot(page, name, { fullPage: true });
  await axe(page, path);
}
// The record pages link to the ledger.
await page.goto(`${BASE}${customerHref.replace("/finance/ledger/customers/", "/customers/")}`);
await settle(page);
(await page.getByRole("link", { name: "Ledger", exact: true }).count())
  ? ok("customer page: Ledger link")
  : fail("customer page", "no Ledger link");
await context.close();

/* ------------------------------------------------------------------ the phone */
console.log("Phone (390)");
const phone = await signIn(browser, "manager@example.com", "Manager@12345", { width: 390, height: 844 });
for (const [path, name] of [
  ["/finance/ledger", "20-phone-all.png"],
  [customerHref, "21-phone-customer.png"],
  ["/finance/ledger?view=accounts", "22-phone-accounts.png"],
]) {
  await phone.page.goto(`${BASE}${path}`);
  await settle(phone.page);
  await shot(phone.page, name, { fullPage: true });
  await axe(phone.page, `phone ${path}`);
  await noSideways(phone.page, `phone ${path}`);
}
await phone.context.close();

/* ------------------------------------------------------------------ staff: refused */
console.log("Staff");
const staff = await signIn(browser, "bilal@example.com", "Demo@12345", { width: 1440, height: 900 });
await staff.page.goto(`${BASE}/finance/ledger`);
await settle(staff.page);
/forbidden|login/.test(staff.page.url()) || (await staff.page.getByText(/not allowed|can.t open|do not have/i).count())
  ? ok("staff: the ledger is refused")
  : fail("staff", `opened ${staff.page.url()}`);
const nav = await staff.page.evaluate(() => [...document.querySelectorAll("aside a")].map((a) => a.textContent.trim()));
nav.includes("Ledger") ? fail("staff", "sees Ledger in the sidebar") : ok("staff: no Ledger in the sidebar");
await staff.context.close();

await browser.close();
console.log(failures ? `\n${failures} problem(s)` : "\nAll good");
process.exit(failures ? 1 : 0);
