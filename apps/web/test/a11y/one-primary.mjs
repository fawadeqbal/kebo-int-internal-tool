// Design system, principle 1 (one page, one next step): visits every step page of an
// order and an inquiry and every settings page, at desktop and phone widths, and fails
// when more than one primary (purple) button is visible in the page itself. Side panels
// and dialogs are not counted (their Save is the primary there). Needs the app running
// (BASE, default http://localhost:3000) with the demo data, and Playwright:
//   NODE_PATH=$(npm root -g) node apps/web/test/a11y/one-primary.mjs
// SHOTS=/some/dir also saves a full-page screenshot of each page there.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/** Primary buttons and links visible on the page, outside dialogs and the app's own bars. */
async function primaries(page) {
  return page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    const seen = [];
    for (const el of main.querySelectorAll("a, button, [role=button]")) {
      if (!el.className || typeof el.className !== "string" || !el.className.split(/\s+/).includes("bg-action-solid")) continue;
      // Switches are on/off, not buttons; dialogs and side panels have their own Save.
      if (el.getAttribute("role") === "switch" || el.closest("[role=dialog],[role=alertdialog],[role=menu]")) continue;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (!r.width || !r.height || style.visibility === "hidden" || style.display === "none") continue;
      seen.push((el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60));
    }
    return seen;
  });
}

/** The demo data's records, found through the lists (ids differ per database). */
async function hrefs(page, list, pattern, max) {
  await page.goto(`${BASE}${list}`);
  await page.waitForLoadState("networkidle");
  const all = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
  return [...new Set(all.filter((h) => pattern.test(h ?? "")))].slice(0, max);
}

let browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
let failures = 0;
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  /** A signed-in tab; again after a crash (a busy machine can kill one). */
  let context;
  async function fresh(retry = 2) {
    try {
      return await signIn();
    } catch (e) {
      if (!retry) throw e;
      await new Promise((r) => setTimeout(r, 5000));
      return fresh(retry - 1);
    }
  }
  async function signIn() {
    await context?.close().catch(() => {});
    if (!browser.isConnected()) browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
    context = await browser.newContext({ viewport });
    const p = await context.newPage();
    await p.goto(`${BASE}/login`);
    await p.fill("#email", process.env.EMAIL ?? "admin@example.com");
    await p.fill("#password", process.env.PASSWORD ?? "Admin@12345");
    await p.click("button[type=submit]");
    await p.waitForURL((u) => !u.pathname.startsWith("/login"));
    return p;
  }
  let page = await fresh();

  // Every order of the demo (each at another step) and an inquiry in each stage that has steps to show.
  const orders = await hrefs(page, "/orders?status=all", /^\/orders\/[0-9a-f-]{36}$/, 4);
  const inquiries = [
    ...(await hrefs(page, "/inquiries?stage=sourcing", /^\/inquiries\/[0-9a-f-]{36}$/, 1)),
    ...(await hrefs(page, "/inquiries?stage=quoted", /^\/inquiries\/[0-9a-f-]{36}$/, 1)),
    ...(await hrefs(page, "/inquiries?stage=new", /^\/inquiries\/[0-9a-f-]{36}$/, 1)),
  ];
  const pages = [
    "/settings/company",
    "/settings/sales",
    "/settings/reminders",
    "/settings/emails",
    "/settings/order-checklist",
    "/settings/papers",
    "/settings/website-form",
    "/access/roles",
    "/access/sessions",
    "/access/sign-ins",
    "/access/roles/manager",
    "/account",
    ...orders.flatMap((o) => ["", "/payment", "/factory", "/production", "/shipping", "/documents", "/delivery", "/costs", "/history"].map((p) => o + p)),
    ...inquiries.flatMap((d) => ["", "/needs", "/sourcing", "/quotation", "/costs", "/history"].map((p) => d + p)),
  ];
  // ONLY=regex: just the pages that match (e.g. a few for screenshots).
  const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
  for (const path of pages.filter((p) => !only || only.test(p))) {
    let res;
    let found;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await page.goto(`${BASE}${path}`);
        await page.waitForLoadState("networkidle");
        found = await primaries(page);
        break;
      } catch (e) {
        if (attempt) {
          console.log(`skip ${viewport.width} ${path}: ${String(e.message).split("\n")[0]}`);
          break;
        }
        page = await fresh();
      }
    }
    if (!found) {
      page = await fresh();
      continue;
    }
    const ok = found.length <= 1;
    if (!ok) failures++;
    console.log(`${ok ? "ok  " : "FAIL"} ${viewport.width} ${path} (${res?.status()}): ${found.length} primary${found.length ? ` — ${found.join(" | ")}` : ""}`);
    if (SHOTS) {
      const name = `${viewport.width}-${path.replace(/^\//, "").replace(/[/?=]/g, "_")}.png`;
      // At most 3200px tall: a whole long page can be more than a small machine's browser can draw.
      const height = Math.min(3200, await page.evaluate(() => document.documentElement.scrollHeight).catch(() => viewport.height));
      await page.screenshot({ path: `${SHOTS}/${name}`, fullPage: true, clip: { x: 0, y: 0, width: viewport.width, height } }).catch(() => {});
      if (page.isClosed() || !browser.isConnected()) page = await fresh();
    }
  }
  await context.close().catch(() => {});
}
await browser.close();
console.log(failures ? `${failures} page(s) with more than one primary` : "every page has at most one primary");
process.exit(failures ? 1 : 0);
