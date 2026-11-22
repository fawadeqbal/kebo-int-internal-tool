import { expect, test } from "@playwright/test";
import { foundPages } from "./routes";

/**
 * A record's top folds once the page has scrolled, and keeps the room it gave up, so the page is exactly as tall
 * folded as unfolded. 16px went missing once (22 Nov 2026): a page that could scroll just past the fold got
 * shorter when it folded, unfolded, grew, folded again, many times a second (the flicker).
 */
test("folding a record's top never changes how tall the page is", async ({ page }) => {
  const address = foundPages()["/inquiries/[id]"];
  test.skip(!address, "no inquiry in the demo data");
  await page.setViewportSize({ width: 1366, height: 600 });
  await page.goto(address!);
  const top = page.locator("[data-record-top]");
  await expect(top).toBeVisible();
  const tall = () => page.evaluate(() => document.documentElement.scrollHeight);
  const before = await tall();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(top).toHaveAttribute("data-stuck");
  expect(await tall()).toBe(before);
  // And it stays folded: no flipping back and forth while the page sits still.
  const flips = await page.evaluate(
    () =>
      new Promise<number>((done) => {
        let n = 0;
        const mo = new MutationObserver(() => n++);
        mo.observe(document.querySelector("[data-record-top]")!, { attributes: true, attributeFilter: ["data-stuck"] });
        setTimeout(() => (mo.disconnect(), done(n)), 1000);
      }),
  );
  expect(flips).toBe(0);
});
