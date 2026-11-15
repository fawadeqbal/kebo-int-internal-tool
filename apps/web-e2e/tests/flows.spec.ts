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

test("Back: ← beside a record's title returns to its list as it was left, the row lit; tabs do not pile up", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/inquiries?stage=all");
  const row = page.locator("tr[data-href]").nth(5);
  const href = (await row.getAttribute("data-href"))!;
  await row.locator("a").first().click();
  await expect(page).toHaveURL((u) => u.pathname === href);
  // ← says where it goes, with the list's filter kept.
  const back = page.getByRole("link", { name: "Back to Inquiries" });
  await expect(back).toBeVisible();
  await expect(back).toHaveAttribute("href", "/inquiries?stage=all");
  // Looking at tabs is not a step back: from History, ← and the browser's Back both go to the list.
  await page.getByRole("navigation", { name: "Inquiry" }).getByRole("link", { name: "History" }).click();
  await expect(page).toHaveURL((u) => u.pathname === `${href}/history`);
  await back.click();
  await expect(page).toHaveURL((u) => u.pathname === "/inquiries" && u.search === "?stage=all");
  await expect(page.locator(`tr[data-href="${href}"]`)).toHaveClass(/animate-flash/);
  await page.locator(`tr[data-href="${href}"] a`).first().click();
  await page.getByRole("navigation", { name: "Inquiry" }).getByRole("link", { name: "Quotations" }).click();
  await expect(page).toHaveURL((u) => u.pathname === `${href}/quotation`);
  await page.goBack();
  await expect(page).toHaveURL((u) => u.pathname === "/inquiries" && u.search === "?stage=all");
  expect(errors).toEqual([]);
});

test("Back on a phone: a record's top bar is ← and its number; the bottom bar stays", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/inquiries");
  const row = page.locator("main ul > li > a[href^='/inquiries/']").first();
  const href = (await row.getAttribute("href"))!;
  await row.click();
  await expect(page).toHaveURL((u) => u.pathname === href);
  const bar = page.locator("[data-record-bar]");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText(/RFQ-\d{4}-\d{4}/);
  await expect(page.locator("[data-shell-top]")).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Quick" })).toBeVisible();
  await bar.getByRole("link", { name: "Back to Inquiries" }).click();
  await expect(page).toHaveURL((u) => u.pathname === "/inquiries");
  await expect(page.locator("[data-shell-top]")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a form on a phone: ← at the top left; the phone's Back asks before throwing away what was typed", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/customers");
  await page.getByRole("link", { name: "Add customer" }).click();
  const form = page.getByRole("dialog", { name: "New customer" });
  await expect(form).toBeVisible();
  await form.getByRole("textbox", { name: "Name", exact: true }).fill("Kabul Medical Supplies");
  // The phone's Back is held while something is typed (the browser lets the page ask first).
  await page.goBack({ timeout: 1500 }).catch(() => {});
  await expect(page.getByRole("alertdialog", { name: "Throw away your changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(form.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Kabul Medical Supplies");
  // ← (Close) asks the same; Throw away closes the form, back on Customers.
  await form.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Throw away" }).click();
  await expect(form).toBeHidden();
  await expect(page).toHaveURL((u) => u.pathname === "/customers" && !u.searchParams.has("panel"));
  expect(errors).toEqual([]);
});
