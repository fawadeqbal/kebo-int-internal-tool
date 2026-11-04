// The platform admin's company page (record frame with a section list, approved page 30), in a real
// browser at 1440 and 390 px: each section (?section=…) passes axe with no violation of any impact,
// shows at most one primary (purple) button, never scrolls the page sideways, and shows its sections
// as chips on a phone; each side panel opened from the URL is named, takes focus on its first field,
// passes axe and closes on Escape; ✎ Edit saves in place; a module switch saves at once; History
// filters by kind and gives its Excel file; a switched-off company's Open is disabled with its reason.
// Needs the app running (BASE, default http://localhost:3000) with demo data and a platform admin:
//   PLATFORM_EMAIL=… PLATFORM_PASSWORD=… PLATFORM_TOTP_SECRET=… NODE_PATH=$(npm root -g) node apps/web/test/a11y/platform-company.mjs
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
      .filter((el) => typeof el.className === "string" && el.className.split(/\s+/).includes("bg-primary-solid"))
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
// A paying client and a demo, found through the list.
await go(p0, "/platform/companies");
const rows = await p0.$$eval("main a[href^='/platform/companies/']", (as) =>
  as.map((a) => ({ href: a.getAttribute("href"), text: a.textContent ?? "" })),
);
const companies = rows.filter((r) => /^\/platform\/companies\/[0-9a-f-]{36}$/.test(r.href));
const client = (companies.find((r) => /kebo/i.test(r.text)) ?? companies[0])?.href;
const demo = companies.find((r) => /demo|accra/i.test(r.text))?.href;
ok(!!client, `a company to check: ${client}`);
await first.close();

const SECTIONS = ["", "?section=people", "?section=plan", "?section=billing", "?section=details", "?section=history"];
const PANELS = [
  ["edit-company", /^Edit company · /],
  ["edit-contact", /^Edit main contact$/],
  ["edit-address", /^Edit web address$/],
  ["edit-notes", /^Edit notes$/],
  ["change-plan", /^Change plan · /],
  ["paid-until", /^Change the paid-until date$/],
  ["record-payment", /^Record payment$/],
  ["status&id=off", /^Switch off$/],
  ["status&id=read_only", /^Make read-only$/],
  ["delete", /^Delete .+\?$/],
];
const stamp = Date.now().toString(36);

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  const w = viewport.width;
  console.log(`\n# ${w}px`);
  const context = await browser.newContext({ viewport, storageState: state, acceptDownloads: true });
  const page = await context.newPage();

  for (const [path, label] of [
    ...SECTIONS.map((s) => [`${client}${s}`, `client ${s || "overview"}`]),
    ...(demo
      ? [
          [demo, "demo overview"],
          [`${demo}?section=plan`, "demo plan"],
        ]
      : []),
  ]) {
    await go(page, path);
    ok(await page.getByRole("heading", { level: 1 }).isVisible(), `${label}: page header`);
    const nav = page.locator("nav[aria-label='Company sections'] a[aria-current=page]");
    ok(await nav.first().isVisible(), `${label}: the current section is shown${w < 1024 ? " (chips)" : ""}`);
    const prim = await primaries(page);
    ok(prim.length === 1 && /Open company/.test(prim[0]), `${label}: one primary (${prim.join(", ") || "none"})`);
    ok(!(await sideways(page)), `${label}: no sideways scroll`);
    await axe(page, `${label} ${w}`, "main");
    await shot(page, `company-${label.replace(/[^a-z]+/gi, "-")}-${w}`);
  }

  // Every panel from its URL: named, modal, focus on the first field, axe, Escape closes.
  for (const [panel, title] of PANELS) {
    await go(page, `${client}?section=details&panel=${panel}`);
    const d = await dialog(page);
    ok(title.test(d.name) && d.modal === "true", `panel ${panel}: "${d.name}"`);
    ok(d.focusField, `panel ${panel}: focus on its first field`);
    await axe(page, `panel ${panel} ${w}`, "[role=dialog]");
    await shot(page, `panel-${panel.replace(/[^a-z]+/gi, "-")}-${w}`, false);
    await page.keyboard.press("Escape");
    await page
      .locator("[role=dialog]")
      .waitFor({ state: "detached", timeout: 10_000 })
      .then(
        () => ok(true, `panel ${panel}: Escape closes it`),
        () => fail(`panel ${panel}: Escape does not close it`),
      );
  }

  // The tenant admin's ⋯ → set-password link panel.
  await go(page, `${client}?section=people`);
  const menu = page.getByRole("button", { name: /^Actions for / }).first();
  if (await menu.count()) {
    await menu.click();
    await page.getByRole("menuitem", { name: "Send a link to set a new password" }).click();
    const d = await dialog(page);
    ok(d.name === "Send a link to set a new password" && d.focusInside, "people ⋯: the set-password panel opens, focus inside");
    await axe(page, `panel password-link ${w}`, "[role=dialog]");
    await page.keyboard.press("Escape");
    await page.locator("[role=dialog]").waitFor({ state: "detached" });
  } else fail("people: no ⋯ on a tenant admin");

  // ✎ Edit main contact: Escape with changes asks first; Ctrl+Enter saves; the card shows it and lights up.
  await go(page, `${client}?section=details`);
  const opener = page.getByRole("button", { name: "Edit main contact" });
  await opener.click();
  await dialog(page);
  const phone = `+92 300 ${stamp}${w}`.slice(0, 40);
  await page.fill("#ct-phone", phone);
  await page.keyboard.press("Escape");
  ok(await page.getByRole("alertdialog").isVisible(), "Esc with changes asks “Discard changes?”");
  await page.getByRole("button", { name: "Keep editing" }).click();
  await page.keyboard.press("Control+Enter");
  await page.locator("[role=dialog]").waitFor({ state: "detached", timeout: 30_000 });
  await settle(page);
  ok(await page.getByText(phone).first().isVisible(), "main contact saved from the panel: the card shows the new phone");
  ok(page.url().includes("saved=contact"), "the saved card is lit (?saved=contact)");

  // A module switch saves at once, and back.
  await go(page, `${client}?section=plan`);
  const sw = page
    .getByRole("switch")
    .filter({ hasNot: page.locator("[disabled]") })
    .first();
  const before = await sw.getAttribute("aria-checked");
  await sw.click();
  await page.waitForTimeout(1500);
  await go(page, `${client}?section=plan`);
  ok((await page.getByRole("switch").first().getAttribute("aria-checked")) !== before, "a module switch saves at once");
  await page.getByRole("switch").first().click();
  await page.waitForTimeout(1500);
  await go(page, `${client}?section=plan`);
  ok((await page.getByRole("switch").first().getAttribute("aria-checked")) === before, "and switches back");

  // History: the kind filter (in the URL) and the Excel file.
  await go(page, `${client}?section=history`);
  await page.locator("nav[aria-label='Kinds of history'] a", { hasText: "Changes" }).first().click();
  await page.waitForURL(/kind=changes/);
  ok(/kind=changes/.test(page.url()), "history: kind filter in the URL");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Excel" }).click()]);
  ok(/\.xlsx$/.test(download.suggestedFilename()), `history: Excel file ${download.suggestedFilename()}`);

  // Switched off: Open company is disabled and says why; on again, then back to the rules.
  if (w === 1440) {
    await go(page, `${client}?panel=status&id=off`);
    await dialog(page);
    await page.getByRole("button", { name: "Switch it off" }).click();
    await page.locator("[role=dialog]").waitFor({ state: "detached", timeout: 30_000 });
    await settle(page);
    const open = page.getByRole("button", { name: /Open company/ });
    ok(await open.isDisabled(), "switched off: Open company is disabled");
    const why = await open.getAttribute("aria-describedby");
    ok(!!why && (await page.locator(`[id="${why}"]`).isVisible()), "switched off: the reason is on the page and tied to the button");
    for (const [item, button] of [
      ["Switch on…", "Switch it on"],
      ["Back to the automatic rules…", "Back to the rules"],
    ]) {
      await page.getByRole("button", { name: /^More for / }).click();
      await page.getByRole("menuitem", { name: item }).click();
      await dialog(page);
      await page.getByRole("button", { name: button }).click();
      await page.locator("[role=dialog]").waitFor({ state: "detached", timeout: 30_000 });
      await settle(page);
    }
    ok(!(await page.getByRole("button", { name: /Open company/ }).isDisabled()), "switched on again: Open company works");
  }

  await context.close();
}

await browser.close();
console.log(failures ? `\n${failures} failure(s)` : "\nall good");
process.exit(failures ? 1 : 0);
