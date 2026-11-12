// The platform's other pages (approved page 30, items 2–6) in a real browser at 1440 and 390 px: the
// overview (dashboard), a client inquiry (record frame), Plans (list + side panel), Platform settings
// (each section) and the Platform log (list). Each page passes axe with no violation of any impact,
// shows exactly one primary (purple) button where it has a next step (none on Settings and the log),
// never scrolls sideways, and shows the menu; each side panel opened from the URL is named, takes
// focus on its first field, passes axe and closes on Escape. The old Website and account URLs land in
// Settings; a plan row opens its panel; the inquiry's Who saves in place; the log filters by kind and
// gives its Excel file.
// Needs the app running (BASE, default http://localhost:3000) with demo data and a platform admin:
//   PLATFORM_EMAIL=… PLATFORM_PASSWORD=… PLATFORM_TOTP_SECRET=… NODE_PATH=$(npm root -g) node apps/web/test/a11y/platform-rest.mjs
// SHOTS=<dir> saves a screenshot of each section and panel there.
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { AxeBuilder } = require("@axe-core/playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
let failures = 0;
const fail = (what) => {
  console.log(`  FAIL ${what}`);
  failures++;
};
const ok = (cond, what) => (cond ? console.log(`  ok   ${what}`) : fail(what));

/* ------------------------------------------------------------------ two-step codes (RFC 6238) */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const unbase32 = (t) => {
  let bits = 0;
  let v = 0;
  const out = [];
  for (const ch of t.replace(/[\s=-]/g, "").toUpperCase()) {
    v = (v << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((v >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};
const totp = (secret) => {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const m = createHmac("sha1", unbase32(secret)).update(c).digest();
  const o = m[m.length - 1] & 15;
  return String((((m[o] & 127) << 24) | (m[o + 1] << 16) | (m[o + 2] << 8) | m[o + 3]) % 1e6).padStart(6, "0");
};

/* ------------------------------------------------------------------ helpers */
async function axe(page, what, include) {
  let b = new AxeBuilder({ page }).withTags(TAGS).exclude("nextjs-portal");
  if (include) b = b.include(include);
  const r = await b.analyze();
  console.log(`${what}: ${r.passes.length} rules pass, ${r.violations.length} violations`);
  for (const v of r.violations) fail(`axe [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(" ")}`);
}
const settle = (page) => page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => page.waitForTimeout(800));
async function go(page, path) {
  await page.goto(`${BASE}${path}`, { timeout: 90_000 });
  await settle(page);
}
const shot = async (page, name, full = true) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
/** Primary buttons and links visible in the page itself (dialogs, menus and switches aside). */
const primaries = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("main a, main button")]
      .filter((el) => typeof el.className === "string" && el.className.split(/\s+/).includes("bg-action-solid"))
      .filter((el) => el.getAttribute("role") !== "switch" && !el.closest("[role=dialog],[role=alertdialog],[role=menu]"))
      .filter((el) => el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true }))
      .map((el) => (el.getAttribute("aria-label") || el.textContent || "").trim()),
  );
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
async function dialog(page) {
  const d = page.locator("[role=dialog]");
  await d.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);
  return d.evaluate((el) => ({
    name: (document.getElementById(el.getAttribute("aria-labelledby") ?? "")?.textContent ?? "").trim(),
    modal: el.getAttribute("aria-modal"),
    focusField: !!document.activeElement?.matches("[role=dialog] input, [role=dialog] select, [role=dialog] textarea"),
    focusInside: el.contains(document.activeElement),
  }));
}

/* ------------------------------------------------------------------ run */
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const signIn = async (context) => {
  const page = await context.newPage();
  await page.goto(`${BASE}/platform/login`);
  await page.fill("#email", process.env.PLATFORM_EMAIL);
  await page.fill("#password", process.env.PLATFORM_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/two-step/);
  for (let i = 0; i < 3; i++) {
    await page.fill("#code", totp(process.env.PLATFORM_TOTP_SECRET));
    await page.click("button[type=submit]");
    if (
      await page
        .waitForURL((u) => !u.pathname.includes("two-step"), { timeout: 8000 })
        .then(
          () => true,
          () => false,
        )
    )
      break;
    await page.waitForTimeout(31_000 - (Date.now() % 30_000)); // a code works once: the next one
  }
  return page;
};

const first = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p0 = await signIn(first);
const state = await first.storageState();
await go(p0, "/platform/leads");
const lead = (await p0.$$eval("main a[href^='/platform/leads/']", (as) => as.map((a) => a.getAttribute("href")))).find((h) =>
  /^\/platform\/leads\/[0-9a-f-]{36}$/.test(h),
);
await go(p0, "/platform/plans");
ok(!!lead, `a client inquiry to check: ${lead}`);
await first.close();

const PAGES = [
  ["overview", "/platform", 1],
  ["client inquiry", lead, 1],
  ["plans", "/platform/plans", 1],
  ["log", "/platform/log", 0],
  ["log (companies)", "/platform/log?kind=companies", 0],
  ...["", "?section=sign-up", "?section=emails", "?section=backups", "?section=account", "?section=admins"].map((s) => [
    `settings ${s || "website"}`,
    `/platform/settings${s}`,
    s ? 0 : null,
  ]),
];
const PANELS = [
  [`${lead}?panel=edit-who`, /^Edit who · /],
  [`${lead}?panel=edit-need`, /^Edit what they need$/],
  [`${lead}?panel=follow-up`, /^Next follow-up$/],
  [`${lead}?panel=lost`, /^Mark .+ as lost$/],
  ["/platform/plans?panel=new-plan", /^New plan$/],
  ["/platform/settings?section=account&panel=password", /^Change your password$/],
];

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  const w = viewport.width;
  console.log(`\n# ${w}px`);
  const context = await browser.newContext({ viewport, storageState: state, acceptDownloads: true });
  const page = await context.newPage();

  for (const [label, path, want] of PAGES) {
    await go(page, path);
    ok(await page.getByRole("heading", { level: 1 }).isVisible(), `${label}: page header`);
    const menu =
      w >= 1024 ? "nav[aria-label='Platform'] a[aria-current=page]" : "nav[aria-label='Platform (small screens)'] a[aria-current=page]";
    ok(await page.locator(menu).first().isVisible(), `${label}: the menu shows where you are`);
    const prim = await primaries(page);
    // Settings › Website: Save the draft / Publish take turns as its one primary (none when nothing waits).
    ok(
      want === null ? prim.length <= 1 : prim.length === want,
      `${label}: ${want === null ? "at most one" : want} primary (${prim.join(", ") || "none"})`,
    );
    ok(!(await sideways(page)), `${label}: no sideways scroll`);
    await axe(page, `${label} ${w}`, "main");
    await shot(page, `${label.replace(/[^a-z]+/gi, "-")}-${w}`);
  }

  for (const [path, title] of PANELS) {
    await go(page, path);
    const d = await dialog(page);
    ok(title.test(d.name) && d.modal === "true", `panel ${path.split("?")[1]}: "${d.name}"`);
    ok(d.focusField, `panel ${path.split("?")[1]}: focus on its first field`);
    await axe(page, `panel ${path.split("?")[1]} ${w}`, "[role=dialog]");
    await page.keyboard.press("Escape");
    await page
      .locator("[role=dialog]")
      .waitFor({ state: "detached", timeout: 10_000 })
      .then(
        () => ok(true, `panel ${path.split("?")[1]}: Escape closes it`),
        () => fail(`panel ${path.split("?")[1]}: Escape does not close it`),
      );
  }

  // Old URLs land in Settings.
  for (const [from, to] of [
    ["/platform/website", /\/platform\/settings\?section=website$/],
    ["/platform/account", /\/platform\/settings\?section=account$/],
    ["/platform/account?panel=password", /\/platform\/settings\?section=account&panel=password$/],
  ]) {
    await go(page, from);
    ok(to.test(page.url()), `${from} → ${page.url().replace(BASE, "")}`);
  }

  // A plan: its row (the phone's row on a phone) opens its side panel.
  await go(page, "/platform/plans");
  await page
    .locator(w < 640 ? "main ul a[href*='panel=edit-plan']" : "main table tbody tr")
    .first()
    .click();
  const plan = await dialog(page);
  ok(/^Edit plan · /.test(plan.name), `plans: a row opens "${plan.name}"`);
  await page.keyboard.press("Escape");
  await page.locator("[role=dialog]").waitFor({ state: "detached" });

  // The client inquiry: Who saves in place.
  await go(page, lead);
  await page.getByRole("button", { name: "Edit who" }).click();
  await dialog(page);
  const phone = `+233 24 ${Date.now().toString().slice(-6)}`;
  await page.fill("#w-phone", phone);
  await page.keyboard.press("Control+Enter");
  await page.locator("[role=dialog]").waitFor({ state: "detached", timeout: 30_000 });
  await settle(page);
  ok(await page.getByText(phone).first().isVisible(), "client inquiry: Who saved from the panel");

  // The log: a kind chip and the Excel file.
  await go(page, "/platform/log");
  await page.locator("nav[aria-label='Filter the log'] a", { hasText: "Client inquiries" }).first().click();
  await page.waitForURL(/kind=inquiries/);
  ok(/kind=inquiries/.test(page.url()), "log: kind filter in the URL");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Excel" }).click()]);
  ok(/\.xlsx$/.test(download.suggestedFilename()), `log: Excel file ${download.suggestedFilename()}`);

  await context.close();
}

await browser.close();
console.log(failures ? `\n${failures} failure(s)` : "\nall good");
process.exit(failures ? 1 : 0);
