import { expect, test, type Page } from "@playwright/test";
import { watchErrors } from "./check";

/**
 * A big screen is filled (review 26 Nov, a 1920px screen: "much empty space, it looks dummy"): a settings page's
 * cards stand in two columns there, three on a 2560px screen, and stay one 720px column on a small laptop. The columns
 * follow the page's own width (a 1280px screen with the side menu folded has room for two).
 */

/** Where each card of the page starts across, and how wide the page's cards reach. */
const cards = (page: Page) =>
  page.locator("#main").evaluate((main) => {
    const list = [...main.querySelectorAll<HTMLElement>("[data-settings-cards] > *")];
    const lefts = [...new Set(list.map((c) => Math.round(c.getBoundingClientRect().left)))];
    const right = Math.max(...list.map((c) => c.getBoundingClientRect().right));
    const frame = main.getBoundingClientRect().right - parseFloat(getComputedStyle(main).paddingRight);
    return { columns: lefts.length, gap: Math.round(frame - right), widest: Math.round(Math.max(...list.map((c) => c.getBoundingClientRect().width))) };
  });

for (const [width, columns] of [
  [1024, 1],
  [1920, 2],
  [2560, 3],
] as const) {
  test(`settings at ${width}px: ${columns} column${columns > 1 ? "s" : ""} of cards`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width, height: Math.round(width * 0.5625) });
    await page.goto("/settings/company");
    await expect(page.getByRole("heading", { level: 1, name: "Company" })).toBeVisible();
    const c = await cards(page);
    expect(c.columns).toBe(columns);
    if (columns === 1) expect(c.widest).toBeLessThanOrEqual(720);
    // Filled to the page's edge: no strip of nothing beside the cards.
    else expect(c.gap).toBeLessThanOrEqual(2);
    expect(errors).toEqual([]);
  });
}
