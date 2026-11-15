import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** The accessibility rules a page must meet: WCAG 2.2 A and AA (axe-core's rules for them). */
export const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Errors in the browser while a page is open: thrown and not caught, or written to the console as errors. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`thrown: ${e.message.slice(0, 300)}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  return errors;
}

/** One line per rule broken: "color-contrast (serious) ×3 at .badge: <span class=…>". */
export async function accessibilityProblems(page: Page): Promise<string[]> {
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
