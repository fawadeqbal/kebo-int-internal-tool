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
  // In steps (design 17 Nov, Review added 18 Nov): Customer · Items · Details · Files · Review, the rail beside them.
  const rail = window.getByRole("navigation", { name: "Steps" });
  for (const step of ["Customer", "Items", "Details", "Files", "Review"]) await expect(rail.getByRole("button", { name: new RegExp(`: ${step}`) })).toBeVisible();
  // One strong button, at the end; Cancel beside it (canvas row "Cancel, not ✕"); no save before Review.
  await expect(window.getByRole("button", { name: "Cancel" })).toHaveCount(1);
  await expect(window.getByRole("button", { name: "Add the inquiry" })).toHaveCount(0);
  await expect(rail.getByRole("button", { name: /Customer/ })).toHaveAttribute("aria-current", "step");
  await window.getByRole("button", { name: /^Next/ }).click();
  // Items: typed in the sheet (the first one, then its quantity), saved with the inquiry.
  await expect(rail.getByRole("button", { name: /: Items/ })).toHaveAttribute("aria-current", "step");
  await window.getByRole("textbox", { name: "New item: Description" }).fill("Bottle filling machine, 2,000 bph");
  await window.getByRole("textbox", { name: "New item: Quantity" }).fill("1");
  await window.getByRole("textbox", { name: "New item: Quantity" }).press("Enter");
  await expect(window.getByRole("grid").getByRole("row", { name: "Item 1" })).toContainText("Bottle filling machine");
  await expect(rail.getByRole("button", { name: /: Items/ })).toContainText("1 item");
  await window.getByRole("button", { name: /^Next/ }).click();
  await window.locator("#category").selectOption({ index: 1 });
  await window.locator("#title").fill(title);
  // With an item listed, what they need may stay empty.
  await window.getByRole("button", { name: /^Next/ }).click();
  await expect(window.getByText("Add files")).toBeVisible();
  // Review: the request in its page's boxes, each with Edit; then Add the inquiry. The step before says Review.
  await window.getByRole("button", { name: /^Review/ }).click();
  await expect(rail.getByRole("button", { name: /: Review/ })).toHaveAttribute("aria-current", "step");
  const items = window.getByRole("region", { name: "Items" });
  await expect(items).toContainText("Bottle filling machine, 2,000 bph");
  await expect(items).toContainText("1 item");
  await expect(window.getByRole("region", { name: "Customer" })).toContainText("Al-Shifa Pharma Ltd");
  await expect(window.getByRole("region", { name: "Details" })).toContainText(title);
  await window.getByRole("button", { name: "Add the inquiry" }).click();

  await expect(page).toHaveURL(/\/inquiries\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
  await expect(page.locator("#items")).toContainText("Bottle filling machine, 2,000 bph");
  // The note names it: its number, what it is and for whom.
  const note = page.locator("[data-note=done]");
  await expect(note).toContainText(/Inquiry RFQ-\d{4}-\d{4} added/);
  await expect(note).toContainText(`${title} · Al-Shifa Pharma Ltd`);
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
  // The note names the payment, says how much and what is still to come, with its receipt.
  const note = page.locator("[data-note=done]");
  await expect(note).toContainText("Payment recorded");
  await expect(note).toContainText(/still to come|nothing more is due/);
  await expect(note.getByRole("link", { name: "Receipt" })).toBeVisible();

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

test("Back on a phone: a record's top bar is ← and its number; the bottom bar stays (or its next step takes its place)", async ({ page }) => {
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
  // The bottom bar stays, unless the record's one strong button is pinned in its place (canvas row "Every page's
  // top on a phone"): which one depends on the inquiry that is first in the list.
  const quick = page.getByRole("navigation", { name: "Quick" });
  const dock = page.locator("[data-record-dock]").filter({ has: page.locator("a, button") });
  if (await dock.count()) {
    await expect(dock).toBeVisible();
    await expect(quick).toBeHidden();
  } else await expect(quick).toBeVisible();
  await bar.getByRole("link", { name: "Back to Inquiries" }).click();
  await expect(page).toHaveURL((u) => u.pathname === "/inquiries");
  await expect(page.locator("[data-shell-top]")).toBeVisible();
  await expect(quick).toBeVisible();
  expect(errors).toEqual([]);
});

test("a form on a phone: ✕ at the top left; the phone's Back asks before throwing away what was typed", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/customers");
  await page.getByRole("link", { name: "Add customer" }).click();
  const form = page.getByRole("dialog", { name: "New customer" });
  await expect(form).toBeVisible();
  await form.getByRole("textbox", { name: "Name", exact: true }).fill("Kabul Medical Supplies");
  // The phone's Back is held while something is typed (the browser lets the page ask first).
  await page.goBack({ timeout: 1500 }).catch(() => {});
  await expect(page.getByRole("alertdialog", { name: "Discard your change?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(form.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Kabul Medical Supplies");
  // Cancel asks the same; Discard closes the form, back on Customers.
  await form.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(form).toBeHidden();
  await expect(page).toHaveURL((u) => u.pathname === "/customers" && !u.searchParams.has("panel"));
  expect(errors).toEqual([]);
});

test("a form's mistake: what to fix at the top, each a way to its field, the cursor on the first; nothing typed lost", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/customers");
  await page.getByRole("link", { name: "Add customer" }).click();
  const form = page.getByRole("dialog", { name: "New customer" });
  // In steps (who they are · address and tax · contacts): the tax number on the second, then save from the last.
  await form.getByRole("button", { name: /^Next/ }).click();
  await form.getByRole("textbox", { name: "Tax no." }).fill("TX-7781");
  await form.getByRole("button", { name: /^Next/ }).click();
  await form.getByRole("button", { name: "Add the customer" }).click();
  const fix = form.getByRole("alert").filter({ hasText: "to fix before saving" });
  await expect(fix).toBeVisible();
  // The window goes to the step with the first mistake, the cursor in its field.
  const name = form.getByRole("textbox", { name: "Name", exact: true });
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await form.getByRole("button", { name: /^Next/ }).click();
  await expect(form.getByRole("textbox", { name: "Tax no." })).toHaveValue("TX-7781");
  await expect(form).toBeVisible();
  expect(errors).toEqual([]);
});

test("no connection: the save says so with Try again, the form stays with what was typed", async ({ page, context }) => {
  const errors = watchErrors(page, { allow: [/Failed to fetch|ERR_INTERNET_DISCONNECTED|net::ERR/] });
  await page.goto("/customers");
  await page.getByRole("link", { name: "Add customer" }).click();
  const form = page.getByRole("dialog", { name: "New customer" });
  await form.getByRole("textbox", { name: "Name", exact: true }).fill("Kabul Medical Supplies");
  await form.getByRole("button", { name: /^Next/ }).click();
  await form.getByRole("button", { name: /^Next/ }).click();
  await context.setOffline(true);
  await form.getByRole("button", { name: "Add the customer" }).click();
  const note = page.locator("[data-note=fail]");
  await expect(note).toContainText("Not saved: no connection");
  await expect(note.getByRole("button", { name: "Try again" })).toBeVisible();
  await form.getByRole("navigation", { name: "Steps" }).getByRole("button", { name: /Who they are/ }).click();
  await expect(form.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Kabul Medical Supplies");
  await context.setOffline(false);
  expect(errors).toEqual([]);
});

test("Mark as lost has Undo: the note takes it back, the inquiry is as it was", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/inquiries?stage=new");
  const row = page.locator("tr[data-href]").first();
  const href = (await row.getAttribute("data-href"))!;
  await page.goto(href);
  // The decisions are in the header's ⋯ (design "the record page").
  const more = page.getByRole("button", { name: /^More for RFQ-/ });
  await more.click();
  await page.getByRole("menuitem", { name: "Mark lost…" }).click();
  const form = page.getByRole("dialog", { name: /as lost$/ });
  await form.getByRole("radio", { name: "No reply from customer" }).check();
  await form.getByRole("button", { name: "Mark lost" }).click();
  const note = page.locator("[data-note=done]");
  await expect(note).toContainText(/RFQ-\d{4}-\d{4} marked lost/);
  await expect(note).toContainText("Why: No reply from customer");
  await note.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("[data-note]")).toContainText("Undone");
  // Back to its stage: open again, with Mark lost offered again.
  await expect(form).toBeHidden();
  await more.click();
  await expect(page.getByRole("menuitem", { name: "Mark lost…" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Orders: a status tab filters the list and stays the list (never jumps to the board)", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/orders");
  for (const name of ["In production", "Confirmed", "Shipped", "Done"]) {
    await page.getByRole("navigation", { name: "Which orders" }).getByRole("link", { name: new RegExp(`^${name}`) }).click();
    await expect(page).toHaveURL((u) => u.pathname === "/orders" && u.searchParams.has("stage"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sales orders");
  }
  // The tiles above go to the list too.
  await page.goto("/orders");
  await page.getByRole("link", { name: /^In production/ }).first().click();
  await expect(page).toHaveURL((u) => u.pathname === "/orders");
  expect(errors).toEqual([]);
});
