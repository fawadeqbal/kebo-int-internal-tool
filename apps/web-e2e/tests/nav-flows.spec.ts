import { expect, test } from "@playwright/test";
import { watchErrors } from "./check";

/** Getting around: Back always gets out, never round in a loop. */

test("Back never loops: an order, its inquiry, Back, Back: the orders list", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/orders");
  await page.locator("tr[data-href]").first().click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  const back = page.locator("#main [data-back]:visible").first();
  await expect(back).toHaveAccessibleName("Back to Orders");
  // The order's inquiry, from the line under its title: its Back goes to the order.
  await page.locator("#main a[href^='/inquiries/']").first().click();
  await expect(page).toHaveURL(/\/inquiries\/[0-9a-f-]{36}/);
  // Back says the order by its name (a record's title is never its number).
  await expect(back).toHaveAccessibleName(/^Back to (?![A-Z]+-\d{4}-)\S/);
  await back.click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  // Back on the order still goes to the orders list, not to the inquiry again.
  await expect(back).toHaveAccessibleName("Back to Orders");
  await back.click();
  await expect(page).toHaveURL(/\/orders(\?|$)/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sales orders");
  expect(errors).toEqual([]);
});
