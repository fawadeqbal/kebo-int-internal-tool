import { expect, test } from "@playwright/test";
import { watchErrors } from "./check";

/**
 * Finance › Expenses is a list like every other (review 26 Nov, "why it looks so unfamiliar"): a table with the
 * cost's number, a row that opens the cost's page, the removed costs under Removed; Change, Add again and Remove on
 * the cost's page (⋯), not in a row that folds open.
 */
test("an expense: in the list with its number, opened on its page, added again and removed from its ⋯", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const tag = Date.now().toString(36);
  const what = `Water dispenser ${tag}`;

  await page.goto("/money/company-costs");
  await page.getByRole("button", { name: "Add company cost" }).click();
  const add = page.getByRole("dialog", { name: "New cost" });
  await add.getByRole("button", { name: "Office", exact: true }).click();
  await add.getByLabel("Description").fill(what);
  await add.getByLabel("Amount").fill("42");
  await add.getByRole("button", { name: "Add the cost" }).click();
  await expect(add).toBeHidden();

  // One row like Payments': its number (as the ledger posted it), what for, the amount, Recorded (the cost page's word).
  const list = page.getByRole("table", { name: "Expenses" });
  await expect(list.getByRole("columnheader")).toHaveText(["Number", "Date", "What · for", "Paid by · from", "Amount", "Status"]);
  const row = list.getByRole("row").filter({ hasText: what });
  await expect(row).toContainText(/EX-\d{4}-\d+/);
  await expect(row).toContainText("Office · The company");
  await expect(row).toContainText("USD 42.00");
  await expect(row.getByText("Recorded")).toBeVisible();
  // Nothing folds open in the list: the row opens the cost's own page.
  await expect(page.getByRole("button", { name: /^Expense of/ })).toHaveCount(0);
  await row.getByRole("link", { name: what }).click();
  await expect(page).toHaveURL(/\/payments\/expense\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: what })).toBeVisible();
  // A company's cost is reached from Expenses: its crumbs lead back there.
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Expenses" })).toHaveAttribute("href", "/money/company-costs");

  // Add again: a new cost filled in like this one.
  await page.getByRole("button", { name: /^More for EX-/ }).click();
  await page.getByRole("menuitem", { name: "Add again" }).click();
  const again = page.getByRole("dialog", { name: "New cost" });
  await expect(again.getByLabel("Description")).toHaveValue(what);
  await expect(again.getByLabel("Amount")).toHaveValue(/42/);
  await page.keyboard.press("Escape");
  await expect(again).toBeHidden();

  // Remove it: it leaves All and shows under Removed, crossed out.
  await page.getByRole("button", { name: /^More for EX-/ }).click();
  await page.getByRole("menuitem", { name: "Remove this payment" }).click();
  const remove = page.getByRole("dialog").last();
  await remove.getByRole("textbox").first().fill("Entered by mistake");
  await remove.getByRole("button", { name: /^Remove/ }).last().click();
  await expect(page.getByText("Removed", { exact: true }).first()).toBeVisible();

  await page.goto("/money/company-costs");
  await expect(page.getByRole("table", { name: "Expenses" }).getByRole("row").filter({ hasText: what })).toHaveCount(0);
  await page.getByRole("link", { name: /^Removed/ }).click();
  const removed = page.getByRole("table", { name: "Removed costs" }).getByRole("row").filter({ hasText: what });
  await expect(removed).toContainText("Removed");
  expect(errors).toEqual([]);
});
