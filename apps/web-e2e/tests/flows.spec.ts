import { expect, test } from "@playwright/test";
import { watchErrors } from "./check";
import { MANAGER } from "./people";

/** The few things everyone does every day, done in a browser the way a person does them. */

test.describe("signing in", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a wrong password is refused, the right one opens Home, and Sign out ends the session", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);

    await page.locator("#email").fill(MANAGER.email);
    await page.locator("#password").fill("not-the-password-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "do not match" })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    await page.locator("#password").fill(MANAGER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(MANAGER.name);

    await page.getByRole("button", { name: /account menu/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    expect(errors).toEqual([]);
  });
});

test("a new inquiry: New › Inquiry, the customer, what they need, saved", async ({ page }) => {
  const errors = watchErrors(page);
  const title = `Browser check ${Date.now()}`;
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "Inquiry" }).click();

  const window = page.getByRole("dialog");
  await expect(window.getByRole("heading", { name: "New inquiry" })).toBeVisible();
  await window.locator("#customer").fill("Al-Shifa");
  await window
    .getByText(/^Al-Shifa Pharma Ltd/)
    .first()
    .click();
  await window.locator("#category").selectOption({ index: 1 });
  await window.locator("#title").fill(title);
  await window.locator("#requirements").fill("A filling line, 2,000 bottles an hour.");
  await window.getByRole("button", { name: "Save inquiry" }).click();

  await expect(page).toHaveURL(/\/inquiries\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
  expect(errors).toEqual([]);
});

test("a payment received: New › Payment received, the order, the amount, recorded on the order", async ({ page }) => {
  const errors = watchErrors(page);
  const reference = `E2E-${Date.now()}`;
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "Payment received" }).click();

  const order = page.getByRole("combobox", { name: "Order" });
  await order.selectOption({ index: 1 });
  const orderId = await order.inputValue();
  await expect(page.locator("#r-amount")).toBeVisible();
  await page.locator("#r-amount").fill("10");
  await page.locator("#r-account").selectOption({ index: 1 });
  await page.locator("#r-reference").fill(reference);
  await page.getByRole("button", { name: "Record the payment" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Payment recorded." })).toBeVisible();

  // On the order, as the API keeps it.
  const res = await page.request.get(`/api/orders/${orderId}/payments`);
  expect(res.ok()).toBe(true);
  const view = (await res.json()) as { payments: { reference: string | null; receivedAmount: string }[] };
  expect(view.payments.find((p) => p.reference === reference)?.receivedAmount).toBe("10.00");
  expect(errors).toEqual([]);
});

test("a figure says how it is made: its ⓘ opens the rule, Esc closes it", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "How Sold this month is worked out" }).click();
  const note = page.getByRole("dialog", { name: "Sold this month" });
  await expect(note).toBeVisible();
  await expect(note).toContainText("order date");
  await page.keyboard.press("Escape");
  await expect(note).toBeHidden();
  // Every figure on Reports has one too.
  await page.goto("/reports/profit");
  await expect(page.getByRole("button", { name: /is worked out$/ })).toHaveCount(4);
  expect(errors).toEqual([]);
});

test("a list's search: typing on while it looks loses no letter, and it looks once the typing stops", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/inquiries");
  const box = page.getByRole("searchbox", { name: "Search number, title, customer" });
  await box.click();
  await box.pressSequentially("bott", { delay: 100 });
  // A pause while thinking: the search for "bott" starts as it ends, and typing goes on while the page comes back.
  await page.waitForTimeout(650);
  await box.pressSequentially("ling line", { delay: 120 });
  await expect(page).toHaveURL(/q=bottling\+line$/);
  await expect(box).toHaveValue("bottling line");
  await expect(box).toBeFocused();
  expect(errors).toEqual([]);
});
