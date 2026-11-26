import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** The accessibility rules a page must meet: WCAG 2.2 A and AA (axe-core's rules for them). */
export const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Errors in the browser while a page is open: thrown and not caught, or written to the console as errors. */
export function watchErrors(page: Page, { allow = [] }: { allow?: RegExp[] } = {}) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`thrown: ${e.message.slice(0, 300)}`));
  page.on("console", (m) => {
    // `allow`: what a check brings about on purpose (the browser's own line when the connection is cut).
    if (m.type() === "error" && !allow.some((a) => a.test(m.text()))) errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  return errors;
}

/**
 * Waits (3 s at most) until nothing on the page is fading or sliding: axe reads a colour half way through a
 * fade as too faint (the sign-in page's welcome failed "color-contrast" now and then while it faded out).
 * The page counts as still when nothing moved twice running; endless animations (a spinner) are not waited for.
 */
async function settled(page: Page) {
  // The sign-in page's welcome (the first visit) shows for 1.2 s and then fades out: the page is the form under it.
  await page.waitForFunction(() => !document.querySelector("[data-splash]"), null, { timeout: 4000 }).catch(() => undefined);
  await page
    .evaluate(async () => {
      const until = Date.now() + 3000;
      let quiet = 0;
      while (quiet < 2 && Date.now() < until) {
        const moving = document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getComputedTiming().endTime !== Infinity);
        if (moving.length) {
          quiet = 0;
          await Promise.race([Promise.all(moving.map((a) => a.finished.catch(() => undefined))), new Promise((done) => setTimeout(done, 1000))]);
        } else {
          quiet += 1;
          await new Promise((done) => setTimeout(done, 120));
        }
      }
    })
    .catch(() => undefined);
}

/**
 * One line per rule broken: "color-contrast (serious) ×3 at .badge: <span class=…>". `within`: only that part
 * (an open window: the page behind it is partly covered by it, which is not a problem of the page).
 */
export async function accessibilityProblems(page: Page, within?: string): Promise<string[]> {
  await settled(page);
  // A record's top stays at the top as the page scrolls (RecordFrame): a button that has scrolled under it is
  // scrolled past, not too small, so the page is read with the top in its own place (where it sits anyway).
  const unstick = await page.addStyleTag({ content: "[data-record-top]{position:static!important}" });
  const axe = new AxeBuilder({ page }).withTags(WCAG);
  const result = await (within ? axe.include(within) : axe).analyze();
  await unstick.evaluate((tag) => (tag as Element).remove());
  return result.violations.map((v) => {
    const first = v.nodes[0];
    return `${v.id} (${v.impact}) ×${v.nodes.length} at ${first?.target.join(" ")}: ${first?.html.slice(0, 160)} — ${v.help}`;
  });
}

/** Wider than the screen: the page scrolls sideways (a table or a long word that does not wrap). */
export async function sidewaysBy(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/**
 * On a phone, what is cut off at the screen's edge (review 26 Nov: a window slid sideways, facts and table columns
 * cut): a table still wider than its box (it should be one card per row, usePhoneStack), and anything poking past
 * the screen's edge that is not inside a row made to slide (tabs, chips, a comparison marked data-slides). One line
 * each: "table wider than the screen: Customer Orders…".
 */
export async function cutOffOnPhone(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const words = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 50);
    const hidden = (el: Element) =>
      !!el.closest('[aria-hidden="true"],[inert],[hidden],.sr-only,table[data-stack] > thead') || getComputedStyle(el).visibility === "hidden";
    const slides = (el: Element) => {
      const cs = getComputedStyle(el);
      return (cs.overflowX === "auto" || cs.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 2;
    };
    const out: string[] = [];
    for (const table of document.querySelectorAll("table")) {
      const r = table.getBoundingClientRect();
      if (!r.width || hidden(table)) continue;
      const box = table.parentElement;
      // data-slides: a table that slides on purpose (the site's plans, compared side by side).
      if (box && slides(box) && !box.closest("[data-slides]")) out.push(`table wider than the screen: ${words(table.querySelector("thead") ?? table)}`);
    }
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || (r.right <= vw + 1 && r.left >= -1) || hidden(el)) continue;
      let p = el.parentElement;
      let inSlider = false;
      while (p && p !== document.documentElement) {
        if (slides(p)) {
          inSlider = true;
          break;
        }
        p = p.parentElement;
      }
      if (inSlider) continue;
      const pr = el.parentElement?.getBoundingClientRect();
      if (pr && (pr.right > vw + 1 || pr.left < -1)) continue;
      if (getComputedStyle(el).position === "fixed" && (r.left >= vw || r.right <= 0)) continue;
      out.push(`past the edge: ${el.tagName.toLowerCase()} "${words(el)}"`);
    }
    return out.slice(0, 10);
  });
}

/** The checks every page passes: it opened, nothing went wrong in the browser, nobody needs to scroll sideways, and it meets WCAG AA. */
export async function expectSoundPage(page: Page, errors: string[]) {
  await expect(page.getByRole("heading", { name: "This page could not load" })).toHaveCount(0);
  expect(errors, "errors in the browser").toEqual([]);
  expect(await sidewaysBy(page), "pixels wider than the screen").toBeLessThanOrEqual(1);
  expect(await accessibilityProblems(page), "accessibility (WCAG 2.2 AA)").toEqual([]);
}

/**
 * "Why the change?" asked once at Save (canvas board "Why the change? at Save"): picks the reason in the sheet (with
 * the words for Other…) and saves from it.
 */
export async function answerWhy(page: Page, reason: string, words?: string) {
  const sheet = page.getByRole("dialog", { name: /^Why (the change|these changes)\?$/ });
  await sheet.getByRole("radiogroup").getByRole("radio", { name: reason }).click();
  if (words) await sheet.getByRole("textbox", { name: "Why, in your words" }).fill(words);
  await sheet.getByRole("button", { name: /^Save/ }).click();
}
