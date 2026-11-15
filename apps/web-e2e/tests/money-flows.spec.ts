import { expect, test, type Locator, type Page } from "@playwright/test";
import { watchErrors } from "./check";

/** Money on an order, done in a browser: paying the supplier looks and works like being paid. */

/** The first order whose tab has what the check needs (other checks change orders too). */
async function orderWith(page: Page, tab: string, has: (page: Page) => Locator, stages = ["in_production", "shipped", "confirmed"]) {
  for (const stage of stages) {
    await page.goto(`/orders?stage=${stage}`);
    const hrefs = await page.locator("tr[data-href]").evaluateAll((rows) => rows.slice(0, 10).map((r) => r.getAttribute("data-href")));
    for (const href of hrefs) {
      await page.goto(`${href}/${tab}`);
      if (await has(page).count()) return;
    }
  }
  throw new Error(`No order has what this check needs on ${tab}`);
}

test("Factory order: how we pay them, the plan with Pay on the next part, and the payments made, as the customer's are", async ({ page }) => {
  const errors = watchErrors(page);
  // A part paid (its Receipt) and one still to pay (its Pay).
  await orderWith(page, "factory", (p) => p.getByRole("region", { name: /^Payment plan/ }).filter({ has: p.getByRole("link", { name: /^Receipt/ }) }).getByRole("button", { name: "Pay", exact: true }));

  const how = page.getByRole("region", { name: "How we pay them" });
  await expect(how).toContainText("when we order");
  await expect(how).toContainText("Their invoices");

  const plan = page.getByRole("region", { name: /^Payment plan/ }).first();
  await expect(plan.getByRole("columnheader", { name: "Status" })).toBeVisible();
  // The paid advance has its receipt: the payment's own page.
  const receipt = plan.getByRole("link", { name: /^Receipt/ }).first();
  await expect(receipt).toHaveAttribute("href", /^\/payments\/supplier\//);
  await expect(plan).toContainText(/The customer has paid|Nothing from the customer|The customer has not paid/);

  // Pay is on the part that is next, and opens the payment with what is left on it.
  await plan.getByRole("button", { name: "Pay", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Pay the factory" });
  await expect(form.getByRole("textbox", { name: "Amount" })).not.toHaveValue("");
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toBeHidden();

  const made = page.getByRole("region", { name: "Payments made" });
  await expect(made.getByRole("columnheader", { name: "For" })).toBeVisible();
  await expect(made.getByRole("link", { name: "Receipt" }).first()).toHaveAttribute("href", /^\/payments\/supplier\//);

  // On a phone each part and each payment is a card with its buttons.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(plan.getByRole("list", { name: /^Parts to pay/ })).toBeVisible();
  await expect(plan.getByRole("button", { name: "Pay", exact: true })).toBeVisible();
  await expect(made.getByRole("list", { name: "Payments made" })).toBeVisible();

  // The receipt opens the payment.
  await page.setViewportSize({ width: 1280, height: 900 });
  await made.getByRole("link", { name: "Receipt" }).first().click();
  await expect(page).toHaveURL(/\/payments\/supplier\//);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Supplier payment");
  expect(errors).toEqual([]);
});

test("Payment: the payments received are the same list, cards on a phone", async ({ page }) => {
  const errors = watchErrors(page);
  await orderWith(page, "payment", (p) => p.getByRole("region", { name: "Payments received" }).getByRole("columnheader", { name: "Into" }));
  const got = page.getByRole("region", { name: "Payments received" });
  await expect(got.getByRole("columnheader", { name: "Into" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(got.getByRole("list", { name: "Payments received" })).toBeVisible();
  await expect(got.getByRole("link", { name: "Receipt" }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
