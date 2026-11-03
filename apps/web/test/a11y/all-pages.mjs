// Every page of the app, in a real browser (design system principles 1, 9 and 10). It signs in,
// walks the app from the sidebar (each kind of page once, plus every order and an inquiry in
// each stage of the demo data), and checks each page at 1440, 1100 and 390 px:
//   - axe (WCAG 2.2 A/AA and best practice): no violation of any impact;
//   - no sideways page scroll (the page itself never scrolls sideways; tables may, in their box);
//   - at most one primary (purple) button visible on the page (side panels have their own Save);
//   - at 1440 and 390: every control can be reached with Tab, in turn, with a visible focus ring;
//   - at 1440 and 390: each side panel / dialog a page opens is named, takes focus, keeps Tab
//     inside, passes axe and closes on Escape with focus back on its button; each ⋯ menu closes
//     on Escape with focus back on its button.
// The pages a signed-out visitor sees are checked the same way, and the platform admin's pages
// when a platform admin is given (PLATFORM_EMAIL + PLATFORM_PASSWORD, and PLATFORM_LINK, the
// set-password link from `platform-admin add`, the first time; two-step sign-in is set up on the
// way and its key kept in PLATFORM_TOTP_SECRET or $SHOTS/.platform-totp).
// Every page.tsx under src/app must be visited or listed in NOT_VISITED with the reason.
//
// Needs the app running (BASE, default http://localhost:3000) on a fresh demo database
// (`pnpm db:seed --demo`), and Playwright:
//   NODE_PATH=$(npm root -g) node apps/web/test/a11y/all-pages.mjs
// SHOTS=<dir> saves a screenshot of every page at 1440 and 390 there, with an index.html
// contact sheet. PAGES=<file> keeps the list of pages found for the next run. ONLY=<regex> checks just the pages whose path matches; WIDTHS=1440,390 picks widths.
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { AxeBuilder } = require("@axe-core/playwright");

const BASE = process.env.BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS;
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const WIDTHS = (process.env.WIDTHS ?? "1440,1100,390").split(",").map(Number);
const DEEP = new Set([1440, 390]); // keyboard, dialogs and menus at these widths
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, "../../src/app");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/** Pages that are not visited, with the reason (each is covered another way or is not a page people use). */
const NOT_VISITED = {
  "/print/orders/:id/:kind": "the paper itself (PDF layout, unchanged by design); its page in the app is checked",
  "/print/report": "a report's PDF layout",
  "/print/revisions/:id": "a quotation revision's PDF layout",
  "/login/two-step": "needs a pending two-step sign-in (the platform's two-step page is checked on the way in)",
  "/login/set-up-two-step": "needs a role that requires two-step (the platform's set-up page is checked on the way in)",
  "/platform/two-step": "needs a pending two-step sign-in; when the platform admin signs in again it is checked",
  "/notifications/open": "a redirect to the notification's record",
  "/security/roles/new": "opens the New role panel on /security (checked there); without custom roles in the plan it shows the plan's note",
};

let failures = 0;
const problems = [];
function fail(where, what) {
  failures++;
  problems.push(`${where}: ${what}`);
  console.log(`  FAIL ${what}`);
}

/* ------------------------------------------------------------------ page helpers */

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  // Fonts and the first client render.
  await page.waitForTimeout(150);
}

/**
 * Known and left on purpose (each one a follow-up in the PR that added this check): the rule, which
 * nodes (a test on axe's html of the node), and why.
 */
const KNOWN = [
  {
    rule: "scrollable-region-focusable",
    html: /^<div tabindex="-1" class="relative overflow-x-auto outline-none" aria-label="[^"]+" role="region">/,
    why: "LineTable's grid scrolls sideways but is focused through its cells (LineTable is not changed in this pass)",
  },
];
const known = [];

async function axe(page, where, include) {
  // A paper's preview (an iframe of the print page) is the paper itself: its layout is not the app's.
  let b = new AxeBuilder({ page }).withTags(TAGS).exclude("nextjs-portal").exclude("iframe");
  if (include) b = b.include(include);
  const r = await b.analyze();
  for (const v of r.violations) {
    v.nodes = v.nodes.filter((n) => {
      const k = KNOWN.find((x) => x.rule === v.id && x.html.test(n.html));
      if (k && !known.includes(k)) known.push(k);
      return !k;
    });
  }
  for (const v of r.violations.filter((x) => x.nodes.length))
    fail(where, `axe [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  return r.violations.length;
}

/** The page scrolls sideways: what sticks out (the outermost boxes past the right edge). */
async function overflow(page) {
  return page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= W + 1) return null;
    const out = [];
    const scrolls = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && p !== document.documentElement && p !== document.body) return true;
      }
      return false;
    };
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.right <= W + 1 || !r.width || scrolls(el)) continue;
      if (el.parentElement && el.parentElement.getBoundingClientRect().right > W + 1 && !scrolls(el.parentElement) && el.parentElement !== document.body) continue;
      const name = el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "") + (typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 4).join(".")}` : "");
      out.push(`${name} (right ${Math.round(r.right)}px)`);
      if (out.length > 4) break;
    }
    return { width: document.documentElement.scrollWidth, of: W, out };
  });
}

/** Primary buttons and links visible on the page, outside dialogs and menus. */
async function primaries(page) {
  return page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    const seen = [];
    for (const el of main.querySelectorAll("a, button, [role=button]")) {
      if (typeof el.className !== "string" || !el.className.split(/\s+/).includes("bg-primary-solid")) continue;
      if (el.getAttribute("role") === "switch" || el.closest("[role=dialog],[role=alertdialog],[role=menu]")) continue;
      // A table row's own confirm (LineTable's ✓ on its new-item row) belongs to the row, as a side panel's Save does.
      if (el.closest("tr")) continue;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (!r.width || !r.height || s.visibility === "hidden" || s.display === "none" || !el.checkVisibility({ contentVisibilityAuto: true })) continue;
      seen.push((el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60));
    }
    return seen;
  });
}

/** Marks every control Tab should reach (in a box, or the page) and returns their names. */
async function markFocusables(page, scope) {
  return page.evaluate((scope) => {
    const root = scope ? document.querySelector(scope) : document.body;
    const SEL = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,[tabindex],[contenteditable="true"]';
    const list = [];
    let i = 0;
    const radioGroups = new Set();
    for (const el of root.querySelectorAll(SEL)) {
      if (el.closest("nextjs-portal,[inert],[hidden]") || el.matches(":disabled") || el.getAttribute("tabindex") === "-1") continue;
      if (!scope && el.closest("[role=dialog],[role=alertdialog],[role=menu],[data-layer]")) continue;
      if (el.closest("[aria-hidden=true]") && !el.closest("[role=dialog]")) continue;
      if (!el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })) continue;
      // A group of radio buttons is one stop for Tab (arrow keys move inside it).
      if (el.matches("input[type=radio]")) {
        const g = `${el.form?.id ?? ""}|${el.name}`;
        el.dataset.a11yGroup = g;
        if (radioGroups.has(g)) continue;
        radioGroups.add(g);
      }
      el.dataset.a11y = String(i++);
      list.push((el.getAttribute("aria-label") || el.textContent || el.getAttribute("name") || el.id || el.tagName).trim().replace(/\s+/g, " ").slice(0, 50));
    }
    return list;
  }, scope ?? null);
}

/** The focused control: its mark, and whether a focus ring shows (outline or shadow differs from unfocused). */
async function focusedInfo(page, last) {
  return page.evaluate((last) => {
    const el = document.activeElement;
    if (!el || el === document.body) return { id: null };
    let id = el.dataset?.a11y ?? null;
    if (id == null && el.matches?.("input[type=radio]")) {
      const g = `${el.form?.id ?? ""}|${el.name}`;
      const first = [...document.querySelectorAll("input[type=radio]")].find((r) => r.dataset.a11yGroup === g && r.dataset.a11y != null);
      id = first?.dataset.a11y ?? null;
    }
    // Still on the same control (a date input takes a Tab per part): it was looked at already, and
    // blurring it again would put focus back on its first part, so Tab would never leave it.
    if (id != null && id === last) return { id, ring: true, same: true };
    const chain = [el, el.parentElement, el.parentElement?.parentElement].filter(Boolean);
    const look = () =>
      chain.map((c) => {
        const s = getComputedStyle(c);
        const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0 && !/,\s*0\)$|transparent/.test(s.outlineColor) ? `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}` : "";
        return { outline, shadow: s.boxShadow === "none" ? "" : s.boxShadow, border: s.borderColor, bg: s.backgroundColor };
      });
    const on = look();
    const label = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("name") || el.id || el.tagName).trim().replace(/\s+/g, " ").slice(0, 50);
    // The same control, unfocused (blur, look, focus again: keyboard focus stays "focus-visible").
    el.blur();
    const off = look();
    el.focus({ preventScroll: true });
    const ring = on.some((o, i) => (o.outline && o.outline !== off[i].outline) || (o.shadow && o.shadow !== off[i].shadow));
    const other = on.some((o, i) => o.border !== off[i].border || o.bg !== off[i].bg);
    const r = el.getBoundingClientRect();
    return { id, ring, other, label, tag: el.tagName.toLowerCase(), inView: r.width > 0 && r.height > 0 };
  }, last ?? null);
}

/** Tab through the page from the top: every marked control is reached and shows a focus ring. */
async function keyboard(page, where) {
  const names = await markFocusables(page);
  if (!names.length) return;
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    window.scrollTo(0, 0);
  });
  // Start before the first element of the page.
  await page.locator("body").evaluate((b) => {
    const s = document.createElement("span");
    s.tabIndex = -1;
    s.id = "a11y-start";
    b.prepend(s);
    s.focus();
  });
  const reached = new Set();
  const noRing = new Map();
  let firstId;
  let last = null;
  // A paper preview (iframe) takes Tab through its own page too.
  const budget = names.length * 2 + 60;
  for (let n = 0; n < budget; n++) {
    await page.keyboard.press("Tab");
    const f = await focusedInfo(page, last);
    last = f.id;
    if (f.same) continue;
    if (f.id == null) {
      if (n > names.length && reached.size >= names.length) break;
      continue;
    }
    if (f.id === firstId && reached.size > 1) break; // round again
    firstId ??= f.id;
    reached.add(f.id);
    if (!f.ring && !noRing.has(f.label)) noRing.set(f.label, f.other ? `${f.tag} "${f.label}" (only its colour changes)` : `${f.tag} "${f.label}"`);
    if (reached.size >= names.length && n >= names.length) break;
  }
  await page.evaluate(() => document.getElementById("a11y-start")?.remove());
  const missed = names.map((nm, i) => [String(i), nm]).filter(([i]) => !reached.has(i));
  if (missed.length) fail(where, `Tab does not reach ${missed.length} of ${names.length}: ${missed.slice(0, 6).map(([, n]) => `"${n}"`).join(", ")}`);
  if (noRing.size) fail(where, `no visible focus ring on ${noRing.size}: ${[...noRing.values()].slice(0, 6).join(", ")}`);
}

/** The open dialog (side panel, confirm), if any. */
const DIALOG = "[role=dialog]:not([hidden]), [role=alertdialog]";

async function dialogCheck(page, where, opener, label) {
  const w = `${where} › "${label}"`;
  const d = page.locator(DIALOG).last();
  try {
    await d.waitFor({ timeout: 10_000 });
  } catch {
    return false; // it did not open a dialog after all (it navigated, or opened something else)
  }
  await page.waitForTimeout(400);
  const info = await d.evaluate((el) => {
    const ids = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    const name = (el.getAttribute("aria-label") || ids.map((i) => document.getElementById(i)?.textContent ?? "").join(" ")).trim();
    return { modal: el.getAttribute("aria-modal"), name, focusInside: el.contains(document.activeElement) };
  });
  console.log(`    dialog "${info.name}"`);
  if (info.modal !== "true") fail(w, "dialog without aria-modal=true");
  if (!info.name) fail(w, "dialog without a name (aria-labelledby its title)");
  if (!info.focusInside) fail(w, "focus did not move into the dialog");
  await axe(page, `${w} (dialog)`, DIALOG);
  // Tab and Shift+Tab stay inside (a menu or confirm drawn over it counts as inside).
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press(key);
      const inside = await page.evaluate(() => {
        const a = document.activeElement;
        const ds = document.querySelectorAll("[role=dialog]:not([hidden]),[role=alertdialog]");
        return [...ds].some((x) => x.contains(a)) || !!a?.closest("[data-layer],[role=menu],[role=listbox],[role=alertdialog],[role=status]");
      });
      if (!inside) {
        fail(w, `${key} leaves the dialog`);
        break;
      }
    }
  }
  // Escape closes it (no changes were made), and focus goes back to its button.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  if (await page.locator("[role=alertdialog]").count()) {
    // "Discard changes?" because Tab passed a field that marks itself changed: the way back is fine.
    await page.keyboard.press("Escape");
  }
  try {
    await page.locator(DIALOG).first().waitFor({ state: "detached", timeout: 10_000 });
  } catch {
    fail(w, "Escape does not close the dialog");
    return true;
  }
  await page.waitForTimeout(300);
  if (opener) {
    const back = await opener.evaluate((el) => el === document.activeElement || el.contains(document.activeElement), null, { timeout: 2000 }).catch(() => null);
    if (back === false) {
      const at = await page.evaluate(() => {
        const a = document.activeElement;
        return a && a !== document.body ? (a.getAttribute("aria-label") || a.textContent || a.tagName).trim().slice(0, 40) : "nothing";
      });
      // A link-opened panel (?panel=) is a new page state: focus may land back on the page's first item; only buttons must get it back.
      if (await opener.evaluate((el) => el.tagName === "BUTTON", null, { timeout: 2000 }).catch(() => false)) fail(w, `focus not back on the button that opened it (on ${at})`);
    }
  }
  return true;
}

const doneDialogs = new Set();
const doneMenus = new Set();

/** Each side panel / dialog this page opens (once per kind of page), and its first ⋯ menu. */
async function layers(page, where, kind, path) {
  const openers = await page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    const out = [];
    for (const el of main.querySelectorAll('[aria-haspopup=dialog], a[href*="panel="]')) {
      if (el.closest("[role=dialog],[role=menu]") || !el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true }) || el.matches(":disabled")) continue;
      const label = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50);
      el.dataset.a11yOpener = String(out.length);
      out.push(label);
    }
    return out;
  });
  const seen = new Set();
  let n = 0;
  for (const [i, label] of openers.entries()) {
    const key = `${kind}|${label.replace(/\d+/g, "#")}`;
    if (seen.has(label) || doneDialogs.has(key) || n >= 4) continue;
    seen.add(label);
    doneDialogs.add(key);
    n++;
    const opener = page.locator(`[data-a11y-opener="${i}"]`);
    if (!(await opener.count())) continue;
    await opener.focus().catch(() => {});
    await page.keyboard.press("Enter");
    const was = await dialogCheck(page, where, opener, label);
    if (!was) {
      // Not a dialog: back to the page as it was.
      if (!page.url().startsWith(`${BASE}${path.split("?")[0]}`)) await page.goto(`${BASE}${path}`);
    } else if (new URL(page.url()).searchParams.get("panel")) {
      fail(`${where} › "${label}"`, "the panel closed but its ?panel= stayed in the address");
    }
    await settle(page);
    // The page may have been drawn again: mark the openers again for the next one.
    await page.evaluate(() => {
      const main = document.querySelector("main") ?? document.body;
      let k = 0;
      for (const el of main.querySelectorAll('[aria-haspopup=dialog], a[href*="panel="]')) {
        if (el.closest("[role=dialog],[role=menu]") || !el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true }) || el.matches(":disabled")) continue;
        el.dataset.a11yOpener = String(k++);
      }
    });
  }
  // The first ⋯ / menu button of the page.
  const menu = page.locator("main [aria-haspopup=menu]:visible").first();
  if ((await menu.count()) && !doneMenus.has(kind)) {
    doneMenus.add(kind);
    const label = ((await menu.getAttribute("aria-label")) || (await menu.innerText()).trim()).slice(0, 40);
    await menu.focus();
    await page.keyboard.press("Enter");
    const m = page.locator("[role=menu]");
    if (!(await m.waitFor({ timeout: 5000 }).then(() => true, () => false))) fail(`${where} › "${label}"`, "the menu button opens no role=menu");
    else {
      await axe(page, `${where} › menu "${label}"`, "[role=menu]");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      if (await m.count()) fail(`${where} › "${label}"`, "Escape does not close the menu");
      else if (!(await menu.evaluate((el) => el === document.activeElement).catch(() => true))) fail(`${where} › "${label}"`, "focus not back on the menu button");
    }
  }
}

function shotName(path) {
  return (path.replace(/^\//, "").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "id").replace(/[/?=&]+/g, "_") || "root");
}
const shots = [];

async function check(page, path, width, label) {
  const where = `${width} ${label ?? path}`;
  console.log(`${where}`);
  let res;
  try {
    res = await page.goto(`${BASE}${path}`, { timeout: 90_000 });
  } catch (e) {
    fail(where, `did not load: ${String(e.message).split("\n")[0]}`);
    return;
  }
  await settle(page);
  if (res && res.status() >= 400 && res.status() !== 404) fail(where, `HTTP ${res.status()}`);
  if (await page.locator("text=/^(Application error|Unhandled Runtime Error)/").count()) fail(where, "the page crashed");
  await axe(page, where);
  const o = await overflow(page);
  if (o) fail(where, `scrolls sideways: ${o.width}px wide in ${o.of}px — ${o.out.join(", ")}`);
  const p = await primaries(page);
  if (p.length > 1) fail(where, `${p.length} primary buttons: ${p.join(" | ")}`);
  if (SHOTS && (width === 1440 || width === 390)) {
    const name = `${shotName(path)}@${width}.png`;
    const height = Math.min(4000, await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 900));
    await page.screenshot({ path: join(SHOTS, name), fullPage: true, clip: { x: 0, y: 0, width, height } }).catch(() => {});
    shots.push({ path, width, name });
  }
  if (DEEP.has(width)) {
    // Opened with its panel (?panel=…): the panel first, then the page under it.
    if (await page.locator(DIALOG).count()) {
      await dialogCheck(page, where, null, "opened by its address");
      await settle(page);
    }
    await keyboard(page, where);
    await layers(page, where, `${width}|${templateOf(path)}`, path);
  }
}

/* ------------------------------------------------------------------ the pages */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
/** The kind of page: ids become :id, and the query keys that choose a section stay. */
function templateOf(path) {
  const u = new URL(path, BASE);
  let t = u.pathname.replace(UUID, ":id");
  t = t.replace(/^\/security\/roles\/(?!new$)[^/]+$/, "/security/roles/:key").replace(/^\/orders\/:id\/papers\/[^/]+$/, "/orders/:id/papers/:kind");
  const keep = ["tab", "section", "view", "panel"].filter((k) => u.searchParams.has(k)).map((k) => `${k}=${u.searchParams.get(k)}`);
  return keep.length ? `${t}?${keep.join("&")}` : t;
}

/** Same-site links on the page that lead to another page (not a file, a PDF, a panel or signing out). */
async function links(page) {
  const hrefs = await page.$$eval("a[href]", (as) => as.filter((a) => !a.hasAttribute("download") && a.target !== "_blank").map((a) => a.getAttribute("href")));
  return hrefs.filter((h) => h && h.startsWith("/") && !h.startsWith("//") && !/^\/(api|print|files|logout)\b|\/pdf\b|panel=|\.(pdf|xlsx|csv|zip)\b/.test(h));
}

/** Walk the signed-in app from its start page: each kind of page once (and the `extra` ones). PAGES=<file> keeps the list for the next run. */
async function crawl(page, starts, extra, max = 220) {
  const cache = process.env.PAGES ? `${process.env.PAGES}.${starts[0].replace(/\W/g, "")}.json` : null;
  if (cache && existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8"));
  const list = await walk(page, starts, extra, max);
  if (cache) writeFileSync(cache, JSON.stringify(list, null, 1));
  return list;
}
async function walk(page, starts, extra, max) {
  const byTemplate = new Map();
  const queue = [...starts, ...extra];
  const forced = new Set(extra);
  while (queue.length && byTemplate.size < max) {
    const path = queue.shift();
    const t = templateOf(path);
    if (!forced.has(path) && [...byTemplate.values()].some((v) => templateOf(v) === t)) continue;
    if ([...byTemplate.values()].includes(path)) continue;
    await page.goto(`${BASE}${path}`, { timeout: 90_000 }).catch(() => null);
    await settle(page);
    const landed = new URL(page.url());
    if (landed.pathname.startsWith("/login") || landed.pathname.startsWith("/platform/login")) continue;
    const final = landed.pathname + landed.search;
    const ft = templateOf(final);
    if (![...byTemplate.values()].includes(final) && (forced.has(path) || !byTemplate.has(ft))) byTemplate.set(forced.has(path) ? `${ft}#${final}` : ft, final);
    for (const h of await links(page)) if (!byTemplate.has(templateOf(h))) queue.push(h);
  }
  return [...new Set(byTemplate.values())];
}

/** Records of the demo data, found through their lists. */
async function hrefs(page, list, pattern, max) {
  await page.goto(`${BASE}${list}`);
  await settle(page);
  const all = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
  return [...new Set(all.filter((h) => pattern.test(h ?? "")))].slice(0, max);
}

/** Every page.tsx as a route template (groups dropped, [x] → :x). */
function appRoutes(dir = APP_DIR) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...appRoutes(p));
    else if (name === "page.tsx") {
      // An old address that only sends on (redirect, nothing rendered): the page it opens is checked.
      const src = readFileSync(p, "utf8");
      if (/\bredirect\(/.test(src) && !/\breturn\b/.test(src)) continue;
      const r = "/" + relative(APP_DIR, dirname(p)).split("/").filter((s) => s && !/^\(.*\)$/.test(s)).map((s) => s.replace(/^\[(.+)\]$/, ":$1")).join("/");
      out.push(r === "/" ? "/" : r.replace(/\/$/, ""));
    }
  }
  return out;
}

function totp(secret) {
  const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of secret.replace(/\s/g, "").toUpperCase()) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const mac = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const o = mac[mac.length - 1] & 15;
  return String((((mac[o] & 127) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3]) % 1e6).padStart(6, "0");
}

/* ------------------------------------------------------------------ run */

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const visited = new Set();

async function run(page, list, title) {
  console.log(`\n## ${title}: ${list.length} pages`);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    console.log(`\n# ${title} at ${width}px`);
    for (const path of list) {
      if (ONLY && !ONLY.test(path)) continue;
      visited.add(templateOf(path).split("?")[0]);
      try {
        await check(page, path, width);
      } catch (e) {
        fail(`${width} ${path}`, `check stopped: ${String(e.message).split("\n")[0]}`);
      }
    }
  }
}

// 1. Signed out.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const list = ["/login", "/sign-up", "/sign-up/confirm", "/request-a-demo", "/set-password?token=x", "/site", "/site/sign-in", "/", "/forbidden", "/no-company", "/platform/login", "/platform/set-password?token=x", "/platform/preview"];
  const landed = [];
  for (const p of list) {
    await page.goto(`${BASE}${p}`).catch(() => null);
    const u = new URL(page.url());
    visited.add(templateOf(p).split("?")[0]);
    landed.push(u.pathname + u.search);
  }
  await run(page, [...new Set(landed)], "signed out");
  await context.close();
}

// 2. The company app, as its admin.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", process.env.EMAIL ?? "admin@example.com");
  await page.fill("#password", process.env.PASSWORD ?? "Admin@12345");
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });

  // Every order of the demo (each at another step), and an inquiry in each stage.
  const orders = await hrefs(page, "/orders?status=all", /^\/orders\/[0-9a-f-]{36}$/, 6);
  const inquiries = [];
  for (const stage of ["new", "sourcing", "quoted", "won", "lost"]) inquiries.push(...(await hrefs(page, `/inquiries?stage=${stage}`, /^\/inquiries\/[0-9a-f-]{36}$/, 1)));
  const steps = ["", "/payment", "/factory", "/production", "/shipping", "/documents", "/delivery", "/costs", "/history"];
  const extra = [
    ...orders.flatMap((o) => steps.map((s) => o + s)),
    ...inquiries.flatMap((d) => ["", "/needs", "/sourcing", "/quotation", "/costs", "/files", "/history"].map((s) => d + s)),
    ...(orders[0] ? ["/goods", "/money", "/packing", "/papers/sales-contract", "/papers/commercial-invoice", "/papers/payment-request"].map((s) => orders.at(-1) + s) : []),
    "/settings?tab=sales",
    "/settings?tab=reminders",
    "/settings?tab=notifications",
    "/settings?tab=order-checklist",
    "/settings?tab=papers",
    "/settings?tab=website-form",
    "/security/roles/manager",
    "/security/roles/new",
    "/customers/new",
    "/factories/new",
    "/users/new",
    "/inquiries/new",
    "/notifications",
    "/reports/money",
    ...(inquiries[0] ? [`${inquiries[0]}/edit`] : []),
  ];
  for (const [list, re] of [
    ["/customers", /^\/customers\/[0-9a-f-]{36}$/],
    ["/factories", /^\/factories\/[0-9a-f-]{36}$/],
    ["/users", /^\/users\/[0-9a-f-]{36}$/],
  ]) {
    const [first] = await hrefs(page, list, re, 1);
    if (first) extra.push(first, `${first}/edit`);
  }
  const lists = ["/customers", "/factories", "/users", "/security", "/account", "/reports", "/insights"];
  const list = (await crawl(page, ["/dashboard", ...lists], extra.filter((p) => !/^\/users\/[^/]+\/edit$/.test(p)))).filter((p) => !p.startsWith("/platform"));
  await run(page, list, "company app");
  await context.close();
}

// 3. The platform, as a platform admin.
if (process.env.PLATFORM_EMAIL) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const keyFile = SHOTS ? join(SHOTS, ".platform-totp") : null;
  let secret = process.env.PLATFORM_TOTP_SECRET ?? (keyFile && existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : "");
  const password = process.env.PLATFORM_PASSWORD;
  const early = [];
  if (process.env.PLATFORM_LINK) {
    await page.goto(process.env.PLATFORM_LINK.replace(/^https?:\/\/[^/]+/, BASE));
    await settle(page);
    early.push(new URL(page.url()).pathname + new URL(page.url()).search);
    await page.fill("#password", password);
    await page.fill("#confirm", password);
    await page.click("button[type=submit]");
    await page.waitForTimeout(2000);
  }
  await page.goto(`${BASE}/platform/login`);
  await page.fill("#email", process.env.PLATFORM_EMAIL);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.endsWith("/platform/login"), { timeout: 60_000 });
  await settle(page);
  if (page.url().includes("set-up-two-step")) {
    early.push("/platform/set-up-two-step");
    await page.getByRole("button", { name: /turn on|set up/i }).first().click();
    const key = page.locator("p.font-mono.select-all");
    await key.waitFor();
    secret = (await key.innerText()).replace(/\s/g, "");
    if (keyFile) writeFileSync(keyFile, secret);
    await page.fill("#confirm-code", totp(secret));
    await page.getByRole("button", { name: /turn on two-step/i }).click();
    await page.getByText(/recovery codes/i).first().waitFor();
  } else if (page.url().includes("two-step")) {
    early.push("/platform/two-step");
    visited.add("/platform/two-step");
    await page.fill("#code", totp(secret));
    await page.click("button[type=submit]");
    await page.waitForURL((u) => !u.pathname.includes("two-step"), { timeout: 60_000 });
  }
  const [company] = await hrefs(page, "/platform/companies", /^\/platform\/companies\/[0-9a-f-]{36}$/, 1);
  const [lead] = await hrefs(page, "/platform/leads", /^\/platform\/leads\/[0-9a-f-]{36}$/, 1);
  const extra = ["/platform/companies/new", "/platform/leads/new", "/platform/plans", "/platform/website", "/platform/log", "/platform/account", ...(company ? [company] : []), ...(lead ? [lead] : [])];
  const list = (await crawl(page, ["/platform"], extra)).filter((p) => p.startsWith("/platform"));
  for (const p of early) visited.add(templateOf(p).split("?")[0]);
  await run(page, list, "platform");
  await context.close();
} else console.log("\n(no PLATFORM_EMAIL: the platform admin's pages are not checked)");

await browser.close();

/* ------------------------------------------------------------------ coverage and report */

if (!ONLY) {
  const missing = appRoutes().filter((r) => !visited.has(r) && !NOT_VISITED[r] && !(r.startsWith("/platform") && !process.env.PLATFORM_EMAIL));
  for (const r of missing) fail("coverage", `${r} was not visited (add it, or to NOT_VISITED with the reason)`);
  console.log("\nNot visited, on purpose:");
  for (const [r, why] of Object.entries(NOT_VISITED)) console.log(`  ${r}: ${why}`);
}

if (SHOTS && shots.length) {
  const rows = new Map();
  for (const s of shots) {
    const r = rows.get(s.path) ?? {};
    r[s.width] = s.name;
    rows.set(s.path, r);
  }
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Every page · 1440 and 390</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;background:#f4f4f6;color:#18181b}h1{font-size:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(520px,1fr));gap:20px}
figure{margin:0;background:#fff;border:1px solid #e4e4e7;border-radius:10px;padding:12px}
figcaption{font-weight:600;margin-bottom:8px;word-break:break-all}.pair{display:flex;gap:10px;align-items:flex-start}
.pair a{display:block;max-height:420px;overflow:hidden;border:1px solid #e4e4e7;border-radius:6px}
.pair a:first-child{flex:3.7}.pair a:last-child{flex:1}img{width:100%;display:block}</style>
<h1>Every page at 1440 and 390 px (${rows.size} pages)</h1><p>Click a picture for the whole page.</p><div class="grid">
${[...rows]
  .map(([p, r]) => `<figure><figcaption>${esc(p.replace(UUID, ":id"))}</figcaption><div class="pair">${[1440, 390].filter((w) => r[w]).map((w) => `<a href="${r[w]}"><img loading="lazy" src="${r[w]}" alt="${esc(p)} at ${w}px"></a>`).join("")}</div></figure>`)
  .join("\n")}
</div></html>`;
  writeFileSync(join(SHOTS, "index.html"), html);
  console.log(`\nContact sheet: ${join(SHOTS, "index.html")}`);
}

for (const k of known) console.log(`\nKnown, left on purpose: ${k.rule} — ${k.why}`);
console.log(failures ? `\n${failures} problem(s):\n${problems.map((p) => `  - ${p}`).join("\n")}` : "\nevery page passes");
process.exit(failures ? 1 : 0);
