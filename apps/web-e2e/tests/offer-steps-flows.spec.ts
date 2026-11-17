import { expect, test, type Page } from "@playwright/test";
import { accessibilityProblems, watchErrors } from "./check";

/**
 * Design "RFQ Desk — quote options" (17 Nov 2026): a factory's offer is typed in one steps window,
 * Lines · Delivery · Payment · Warranty & conditions. The Lines step has who and when, the price and the
 * lines sheet; one Save keeps them together. A new offer's lines go in the same save (a wrong line saves
 * nothing and says which); changing the lines of an offer a quotation is priced from asks why.
 */

/** A customer and an inquiry with two items, through the API (as the signed-in person). */
async function newInquiry(page: Page) {
  const tag = Date.now().toString(36);
  const send = async (url: string, data: object) => {
    const r = await page.request.post(`/api${url}`, { data });
    expect(r.ok(), `${url}: ${await r.text()}`).toBe(true);
    return r.json();
  };
  const me = await (await page.request.get("/api/auth/me")).json();
  const customer = await send("/customers", { name: `Steps Pharma ${tag}`, country: "PK", contacts: [{ name: "Sana", email: `sana-${tag}@steps.test` }] });
  const inquiry = await send("/inquiries", {
    customerId: customer.id,
    category: "Machinery",
    assigneeId: me.id,
    items: [
      { description: "Capsule filling machine", quantity: 1, unit: "set" },
      { description: "Change parts", quantity: 2, unit: "sets" },
    ],
  });
  return { id: inquiry.id as string, tag };
}

test("a new offer: the lines in its Lines step, saved with it in one go; a wrong line says which and saves nothing", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const deal = await newInquiry(page);
  await page.goto(`/inquiries/${deal.id}/sourcing`);
  await page.getByRole("button", { name: "Enter an offer" }).first().click();
  const win = page.getByRole("dialog", { name: "Enter factory offer" });
  const rail = win.getByRole("navigation", { name: "Steps" });
  for (const step of ["Lines", "Delivery", "Payment", "Warranty & conditions"]) await expect(rail.getByRole("button", { name: new RegExp(step) })).toBeVisible();
  await expect(rail.getByRole("button", { name: /Lines/ })).toHaveAttribute("aria-current", "step");

  // Who: a factory not on the list yet.
  const factory = `Wuxi Steps ${deal.tag}`;
  await win.getByRole("combobox", { name: /Factory/ }).fill(factory);
  await win.getByRole("option", { name: `Add “${factory}” as a new factory` }).click();

  // The lines start from the customer's list; their prices are typed in the sheet.
  await win.getByRole("button", { name: /From the customer's list \(2\)/ }).click();
  const sheet = win.getByRole("grid");
  await expect(sheet.getByRole("row", { name: "Line 1" })).toContainText("Capsule filling machine");
  await expect(sheet.getByRole("row", { name: "Line 2" })).toContainText("Change parts");
  await sheet.getByRole("row", { name: "Line 1" }).getByRole("gridcell").nth(5).click();
  await page.keyboard.press("Enter");
  await page.getByLabel("Line 1: Price CNY").fill("120000");
  await page.keyboard.press("Enter");
  await expect(win.getByText(/Factory total/)).toContainText("120,000.00");
  // The rail says what the step has.
  await expect(rail.getByRole("button", { name: /Lines/ })).toContainText("2 lines");
  // The thin "+ Add line" under the sheet takes the cursor to the new line.
  await win.getByRole("button", { name: "Add line", exact: true }).click();
  await expect(win.getByRole("textbox", { name: /^New line: Description/ })).toBeFocused();
  // Tax: its % and one tick for "included in their prices".
  await win.getByLabel("Tax %", { exact: true }).fill("13");
  await win.getByLabel("Tax included in their prices").check();
  await expect(win.getByText("The price already has the tax in it")).toBeVisible();
  expect(await accessibilityProblems(page), "the offer's Lines step meets WCAG 2.2 AA").toEqual([]);

  // A wrong line: the quantity of line 2 is not a number. Nothing is saved; the window says which line.
  await sheet.getByRole("row", { name: "Line 2" }).getByRole("gridcell").nth(3).click();
  await page.keyboard.press("Enter");
  await page.getByLabel("Line 2: Qty").fill("0");
  await page.keyboard.press("Enter");
  await rail.getByRole("button", { name: /Warranty & conditions/ }).click();
  await win.getByRole("button", { name: "Save offer" }).click();
  await expect(rail.getByRole("button", { name: /Lines/ })).toHaveAttribute("aria-current", "step");
  await expect(win.getByRole("alert").filter({ hasText: "Nothing was saved yet" })).toContainText("Line 2:");
  const before = await (await page.request.get(`/api/inquiries/${deal.id}/sourcing`)).json();
  expect(before.quotes, "nothing was saved").toHaveLength(0);

  // Fixed, saved: the offer opens on its own page with both lines.
  await sheet.getByRole("row", { name: "Line 2" }).getByRole("gridcell").nth(3).click();
  await page.keyboard.press("Enter");
  await page.getByLabel("Line 2: Qty").fill("2");
  await page.keyboard.press("Enter");
  await win.getByRole("button", { name: "Save offer" }).click();
  await expect(win).toBeHidden();
  await expect(page).toHaveURL(/\/offers\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: factory })).toBeVisible();
  await expect(page.getByText(`Offer from ${factory} added`)).toBeVisible();
  await expect(page.locator("main")).toContainText("Capsule filling machine");
  await expect(page.locator("main")).toContainText("Change parts");
  await expect(page.locator("main")).toContainText("120,000.00");
  const saved = (await (await page.request.get(`/api/inquiries/${deal.id}/sourcing`)).json()).quotes[0];
  expect([saved.taxIncluded, Number(saved.taxRate)]).toEqual([true, 13]);
  expect(errors).toEqual([]);
});

test("a part's Edit opens only that part, All steps opens the rest; the top Edit opens the steps; changing the lines of a quoted offer asks why", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const deal = await newInquiry(page);
  const send = async (url: string, data: object) => {
    const r = await page.request.post(`/api${url}`, { data });
    expect(r.ok(), `${url}: ${await r.text()}`).toBe(true);
    return r.json();
  };
  const items = (await (await page.request.get(`/api/inquiries/${deal.id}`)).json()).items;
  const offer = await send(`/inquiries/${deal.id}/factory-quotes`, {
    newFactoryName: `Hefei Steps ${deal.tag}`,
    receivedOn: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    currency: "CNY",
    lines: [
      { requestedItemId: items[0].id, description: "Capsule filling machine", model: "NJP-800", quantity: 1, unit: "set", unitPrice: 98000 },
      { requestedItemId: items[1].id, description: "Change parts", quantity: 2, unit: "sets", unitPrice: 4000 },
    ],
  });
  // A quotation priced from it.
  await page.goto(`/inquiries/${deal.id}/quotation`);
  await page.getByRole("button", { name: "New quotations" }).first().click();
  await page.getByRole("dialog", { name: "New quotations" }).getByRole("button", { name: /Make the draft/ }).click();
  await expect(page.getByRole("dialog", { name: "New quotations" })).toBeHidden();

  await page.goto(`/inquiries/${deal.id}/offers/${offer.id}`);
  // A group's Edit opens only that part (design 17 Nov): its fields, Cancel and Save, no steps.
  await page.getByRole("button", { name: "Edit payment" }).click();
  let win = page.getByRole("dialog", { name: /^Payment · Hefei Steps .*’s offer/ });
  await expect(win.getByText("Start from")).toBeVisible();
  await expect(win.getByRole("navigation", { name: "Steps" })).toHaveCount(0);
  await expect(win.getByRole("button", { name: /^Next/ })).toHaveCount(0);
  expect(await accessibilityProblems(page), "one part of the offer meets WCAG 2.2 AA").toEqual([]);
  // All steps: the same window with every step, at this one, the cursor on its title.
  await win.getByRole("button", { name: "All steps" }).click();
  win = page.getByRole("dialog", { name: /Edit · Hefei Steps .*’s offer/ });
  await expect(win.getByRole("navigation", { name: "Steps" }).getByRole("button", { name: /Payment/ })).toHaveAttribute("aria-current", "step");
  await expect(win.getByRole("heading", { name: "Payment, step 3 of 4" })).toBeFocused();
  await win.getByRole("button", { name: "Cancel" }).click();
  await expect(win).toBeHidden();

  // One part saved on its own: Delivery's lead time.
  await page.getByRole("button", { name: "Edit delivery" }).click();
  win = page.getByRole("dialog", { name: /^Delivery · Hefei Steps .*’s offer/ });
  await win.locator("#leadDays").fill("45");
  await win.getByRole("button", { name: "Save", exact: true }).click();
  await expect(win).toBeHidden();
  await expect(page.getByRole("region", { name: "Delivery" })).toContainText("45 days");

  // Edit lines: the price and the lines only (who and when is not there).
  await page.getByRole("button", { name: "Edit lines" }).click();
  win = page.getByRole("dialog", { name: /^Lines · Hefei Steps .*’s offer/ });
  await expect(win.getByRole("grid")).toBeVisible();
  await expect(win.getByRole("textbox", { name: "Their reference" })).toHaveCount(0);
  await win.getByRole("button", { name: "Cancel" }).click();
  await expect(win).toBeHidden();

  // Edit: the Lines step, where it says the quotation keeps its own copy.
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  win = page.getByRole("dialog", { name: /Edit · Hefei Steps .*’s offer/ });
  await expect(win.getByText(/A quotation is priced from this offer/)).toBeVisible();
  await win.getByRole("textbox", { name: "Their reference" }).fill(`HS-${deal.tag}`);
  const sheet = win.getByRole("grid");
  await sheet.getByRole("row", { name: "Line 2" }).getByRole("gridcell").nth(5).click();
  await page.keyboard.press("Enter");
  await page.getByLabel("Line 2: Price CNY").fill("4500");
  await page.keyboard.press("Enter");
  await win.getByRole("button", { name: "Save", exact: true }).click();
  // Why (the lines were priced into a quotation).
  const why = page.getByRole("dialog", { name: /Why are you changing these lines/ });
  await expect(why).toBeVisible();
  // (The page under it is fetched again after the offer's details were saved: its title comes back with it.)
  await expect(page).toHaveTitle(/\S/);
  expect(await accessibilityProblems(page), "asking why meets WCAG 2.2 AA").toEqual([]);
  await why.getByRole("textbox").first().fill("The factory corrected the change parts price");
  await why.getByRole("button", { name: /Save/ }).click();
  await expect(win).toBeHidden();
  // Both saved: the reference and the new price.
  await expect(page.getByText(`their ref. HS-${deal.tag}`)).toBeVisible();
  await expect(page.locator("main")).toContainText("9,000.00");
  const saved = await (await page.request.get(`/api/inquiries/${deal.id}/sourcing`)).json();
  const q = saved.quotes.find((x: { id: string }) => x.id === offer.id);
  expect(q.reference).toBe(`HS-${deal.tag}`);
  expect(q.lines.map((l: { unitPrice: string }) => Number(l.unitPrice))).toEqual([98000, 4500]);
  expect(errors).toEqual([]);
});
