import { expect, test, type Locator } from "@playwright/test";
import { watchErrors } from "./check";
import { newOrder } from "./orders";

/**
 * A phone (review 26 Nov, Fawad's screenshot): a window keeps to the screen however long a name in it is. The Email
 * window's Include list had a long paper ("Payment request · Balance before shipment PR-2026-0005-6"): the list took
 * the name's width, the window slid sideways and To, Copy and Subject lost their left edge.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** Boxes in it that scroll sideways, and how far past the screen's right edge it reaches. */
const sideways = (win: Locator) =>
  win.evaluate((w) => ({
    slides: [...w.querySelectorAll("*")].filter((e) => {
      const cs = getComputedStyle(e);
      return /(auto|scroll)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1 && !e.querySelector('[role="tab"]');
    }).length,
    past: Math.max(0, Math.round(w.getBoundingClientRect().right - document.documentElement.clientWidth)),
  }));

test("on a phone the Email window keeps to the screen, with a long name under Include", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const id = await newOrder(page);
  await page.goto(`/orders/${id}/papers/quotation?back=/orders/${id}/documents`);
  await page.getByRole("button", { name: /^Email Ali$/ }).click();
  const win = page.getByRole("dialog", { name: /^Email the quotation/ });
  await expect(win.getByRole("group", { name: "Include" })).toBeVisible();

  // The longest paper name there can be, and longer.
  await win.getByRole("group", { name: "Include" }).evaluate((g) => {
    const name = g.querySelector("label .font-semibold");
    if (name) name.textContent = "Payment request · Balance before shipment PR-2026-0005-6 · Balance before shipment PR-2026-0005-6";
  });
  expect(await sideways(win)).toEqual({ slides: 0, past: 0 });
  await expect(win.locator("#send-to")).toBeInViewport();
  await expect(win.getByRole("button", { name: "Send email" })).toBeInViewport();
  expect(errors).toEqual([]);
});
