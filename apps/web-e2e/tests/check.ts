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

/** One line per rule broken: "color-contrast (serious) ×3 at .badge: <span class=…>". */
export async function accessibilityProblems(page: Page): Promise<string[]> {
  await settled(page);
  const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return result.violations.map((v) => {
    const first = v.nodes[0];
    return `${v.id} (${v.impact}) ×${v.nodes.length} at ${first?.target.join(" ")}: ${first?.html.slice(0, 160)} — ${v.help}`;
  });
}

/** Wider than the screen: the page scrolls sideways (a table or a long word that does not wrap). */
export async function sidewaysBy(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
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
