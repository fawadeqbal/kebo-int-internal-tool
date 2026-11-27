import { expect, test, type Page } from "@playwright/test";
import { accessibilityProblems, watchErrors, answerWhy } from "./check";

/**
 * Design "RFQ Desk — supplier offer" (18 Nov 2026, the inquiry's rules): a supplier's offer is typed in one steps
 * window — Supplier · Prices · Delivery & payment · Conditions, then Review and Add the offer. A new offer's lines
 * go in the same save (a wrong line saves nothing and says which). Its page has a box per part, each with its own
 * Edit (that part only) and history; an edit marks each change, counts them, and asks why once.
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

test("a new offer: Factory, Prices, Delivery & payment, Warranty & conditions, Review; a wrong line says which and saves nothing", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const deal = await newInquiry(page);
  await page.goto(`/inquiries/${deal.id}/sourcing`);
  await page.getByRole("button", { name: "New supplier offer" }).first().click();
  const win = page.getByRole("dialog", { name: "New supplier offer" });
  const rail = win.getByRole("navigation", { name: "Steps" });
  for (const step of ["Supplier", "Prices", "Delivery & payment", "Warranty & conditions", "Review"]) await expect(rail.getByRole("button", { name: new RegExp(step) })).toBeVisible();
  await expect(rail.getByRole("button", { name: /Supplier/ })).toHaveAttribute("aria-current", "step");

  // Who: a supplier not on the list yet.
  const supplier = `Wuxi Steps ${deal.tag}`;
  await win.getByRole("combobox", { name: /Supplier/ }).fill(supplier);
  await win.getByRole("option", { name: `New supplier “${supplier}”` }).click();
  // The New supplier form, as a new customer on an inquiry: the name typed, how to reach them; Add and use adds it now.
  const form = win.getByRole("region", { name: "New supplier" });
  await expect(form.getByLabel("Name")).toHaveValue(supplier);
  await form.getByLabel("Contact person").fill("Mr Chen");
  await form.getByLabel("WeChat").fill(`chen-${deal.tag}`);
  expect(await accessibilityProblems(page), "the New supplier form meets WCAG 2.2 AA").toEqual([]);
  await win.getByRole("button", { name: "Add and use" }).click();
  await expect(form).toHaveCount(0);
  await expect(win.getByText(supplier)).toBeVisible();
  await expect(win.getByText("Mr Chen")).toBeVisible();
  await win.getByRole("button", { name: /^Next/ }).click();

  // Prices: a new offer starts with the customer's items already in the sheet (design 24 Nov); prices typed in it.
  await expect(rail.getByRole("button", { name: /Prices/ })).toHaveAttribute("aria-current", "step");
  const sheet = win.getByRole("grid");
  await expect(sheet.getByRole("row", { name: "Item 1" })).toContainText("Capsule filling machine");
  await expect(sheet.getByRole("row", { name: "Item 2" })).toContainText("Change parts");
  await expect(sheet.getByRole("columnheader", { name: "For item" })).toHaveCount(0);
  await sheet.getByRole("row", { name: "Item 1" }).getByRole("gridcell").nth(4).click();
  await page.keyboard.press("Enter");
  await page.getByLabel("Item 1: Unit price CNY").fill("120000");
  await page.keyboard.press("Enter");
  const totals = win.getByRole("group", { name: "Totals" });
  await expect(totals).toContainText("120,000.00");
  // Tax: included, added or none, and its %. With tax, every line shows its % and the totals show the tax (design 18 Nov).
  const tax = win.getByRole("radiogroup", { name: "Tax" });
  await tax.getByRole("radio", { name: "Included" }).click();
  await win.getByLabel("Tax %", { exact: true }).fill("13");
  await expect(tax.getByRole("radio", { name: "Included" })).toHaveAttribute("aria-checked", "true");
  await expect(sheet.getByRole("columnheader", { name: "Tax", exact: true })).toBeVisible();
  await expect(sheet.getByRole("row", { name: "Item 1" })).toContainText("13%");
  await expect(totals).toContainText("Before tax");
  await expect(totals).toContainText("Tax 13% · included");
  await expect(totals).toContainText("13,805.31");
  await expect(totals).toContainText(/Total with tax\s*CNY 120,000\.00/);
  expect(await accessibilityProblems(page), "the offer's Prices step meets WCAG 2.2 AA").toEqual([]);

  // A wrong line: the quantity of line 2 is 0. Nothing is saved; the window opens Prices and says which line.
  await sheet.getByRole("row", { name: "Item 2" }).getByRole("gridcell").nth(2).click();
  await page.keyboard.press("Enter");
  await page.getByLabel("Item 2: Quantity").fill("0");
  await page.keyboard.press("Enter");
  await win.getByRole("button", { name: "Review", exact: true }).click();
  await expect(win.getByRole("region", { name: "Prices" })).toContainText("Capsule filling machine");
  expect(await accessibilityProblems(page), "the offer's Review step meets WCAG 2.2 AA").toEqual([]);
  await win.getByRole("button", { name: "Add the offer" }).click();
  await expect(rail.getByRole("button", { name: /Prices/ })).toHaveAttribute("aria-current", "step");
  await expect(win.getByRole("alert").filter({ hasText: "Nothing was saved yet" })).toContainText("Item 2:");
  const before = await (await page.request.get(`/api/inquiries/${deal.id}/sourcing`)).json();
  expect(before.quotes, "nothing was saved").toHaveLength(0);

  // Fixed, saved from Review: the offer opens on its own page with both lines.
  await sheet.getByRole("row", { name: "Item 2" }).getByRole("gridcell").nth(2).click();
  await page.keyboard.press("Enter");
  await page.getByLabel("Item 2: Quantity").fill("2");
  await page.keyboard.press("Enter");
  await rail.getByRole("button", { name: /Review/ }).click();
  await win.getByRole("button", { name: "Add the offer" }).click();
  await expect(win).toBeHidden();
  await expect(page).toHaveURL(/\/offers\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: supplier })).toBeVisible();
  await expect(page.getByText(`Offer from ${supplier} added`)).toBeVisible();
  // The page: the same boxes as the steps.
  for (const box of ["Supplier", "Delivery & payment", "Prices", "Warranty & conditions"]) await expect(page.getByRole("region", { name: box, exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Prices", exact: true })).toContainText("Change parts");
  await expect(page.getByRole("region", { name: "Prices", exact: true })).toContainText("120,000.00");
  const saved = (await (await page.request.get(`/api/inquiries/${deal.id}/sourcing`)).json()).quotes[0];
  expect([saved.taxIncluded, Number(saved.taxRate)]).toEqual([true, 13]);
  expect(errors).toEqual([]);
});

test("a box's Edit opens only that part and asks why once something changed; Edit offer counts the changes; each box keeps its history", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  const deal = await newInquiry(page);
  const send = async (url: string, data: object) => {
    const r = await page.request.post(`/api${url}`, { data });
    expect(r.ok(), `${url}: ${await r.text()}`).toBe(true);
    return r.json();
  };
  const items = (await (await page.request.get(`/api/inquiries/${deal.id}`)).json()).items;
  const offer = await send(`/inquiries/${deal.id}/factory-quotes`, {
    newSupplierName: `Hefei Steps ${deal.tag}`,
    receivedOn: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    currency: "CNY",
    // A lead time already saved, so typing another one is a change (an empty one filled is only Added).
    leadDays: 30,
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
  // A box's Edit opens only that part: its fields and Save, no steps; nothing changed is nothing to save.
  await page.getByRole("button", { name: "Edit delivery and payment" }).click();
  let win = page.getByRole("dialog", { name: "Edit delivery & payment" });
  await expect(win.getByRole("combobox", { name: "Apply template" })).toBeVisible();
  await expect(win.getByRole("navigation", { name: "Steps" })).toHaveCount(0);
  await expect(win.getByRole("button", { name: /^Next/ })).toHaveCount(0);
  await expect(win.getByRole("button", { name: "No changes" })).toBeDisabled();
  await expect(win.getByRole("radiogroup", { name: /Why the change/ })).toHaveCount(0);
  expect(await accessibilityProblems(page), "one part of the offer meets WCAG 2.2 AA").toEqual([]);
  // A change: marked, counted, and why is asked before it can be saved.
  await win.locator("#leadDays").fill("45");
  await expect(win.getByText(/Changed · was/)).toBeVisible();
  await expect(win.getByRole("button", { name: "Save 1 change" })).toBeEnabled();
  await win.getByRole("button", { name: "Save 1 change" }).click();
  await answerWhy(page, "Supplier changed its terms");
  await expect(win).toBeHidden();
  await expect(page.getByRole("region", { name: "Delivery & payment", exact: true })).toContainText("45 days");

  // Prices on their own (wide): the lines only; the quotation keeps its own copy. Why is a strip above Save.
  await page.getByRole("button", { name: "Edit prices" }).click();
  win = page.getByRole("dialog", { name: "Edit prices" });
  await expect(win.getByRole("grid")).toBeVisible();
  await expect(win.getByRole("textbox", { name: "Their reference" })).toHaveCount(0);
  await expect(win.getByText(/A quotation is priced from this offer/)).toBeVisible();
  const sheet = win.getByRole("grid");
  await sheet.getByRole("row", { name: "Item 2" }).getByRole("gridcell").nth(4).click();
  await page.keyboard.press("Enter");
  await page.getByLabel("Item 2: Unit price CNY").fill("4500");
  await page.keyboard.press("Enter");
  await win.getByRole("button", { name: "Save 1 change" }).click();
  await answerWhy(page, "Supplier changed its price");
  await expect(win).toBeHidden();
  await expect(page.getByRole("region", { name: "Prices", exact: true })).toContainText("9,000.00");

  // Edit offer: only moving between its steps changes nothing, so Cancel just closes it (no "Discard?").
  await page.getByRole("button", { name: /^More for .*offer/ }).click();
  await page.getByRole("menuitem", { name: "Edit offer" }).click();
  win = page.getByRole("dialog", { name: "Edit offer" });
  let rail = win.getByRole("navigation", { name: "Steps" });
  await rail.getByRole("button", { name: /Prices/ }).click();
  await expect(rail.getByRole("button", { name: /Prices/ })).toHaveAttribute("aria-current", "step");
  await rail.getByRole("button", { name: /Warranty/ }).click();
  await win.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alertdialog", { name: "Discard your change?" })).toHaveCount(0);
  await expect(win).toBeHidden();

  // Every part; the side bar counts the changes; Changes lists them with Undo; why once.
  await page.getByRole("button", { name: /^More for .*offer/ }).click();
  await page.getByRole("menuitem", { name: "Edit offer" }).click();
  win = page.getByRole("dialog", { name: "Edit offer" });
  rail = win.getByRole("navigation", { name: "Steps" });
  await expect(rail.getByRole("button", { name: /Supplier/ })).toHaveAttribute("aria-current", "step");
  await win.getByRole("textbox", { name: "Their reference" }).fill(`HS-${deal.tag}`);
  await expect(rail.getByRole("button", { name: /Supplier/ })).toContainText("1");
  // Something typed (an empty reference filled): Cancel asks first; Keep editing keeps it.
  await win.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alertdialog", { name: "Discard your change?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(win.getByRole("textbox", { name: "Their reference" })).toHaveValue(`HS-${deal.tag}`);
  await win.getByRole("button", { name: /^Changes · 1/ }).click();
  const list = win.getByRole("table", { name: "What changed" });
  await expect(list.getByRole("row").filter({ hasText: "Their reference" }).getByRole("cell").nth(2)).toHaveText("Added");
  await expect(list.getByRole("row").filter({ hasText: "Their reference" }).getByRole("cell").nth(3)).toHaveText(`HS-${deal.tag}`);
  expect(await accessibilityProblems(page), "the offer's Changes step meets WCAG 2.2 AA").toEqual([]);
  // It was empty: Added is not a change (canvas group 9), so the button just says Save and no reason is asked.
  await win.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("radiogroup", { name: /Why the change/ })).toHaveCount(0);
  await expect(win).toBeHidden();
  await expect(page.getByRole("region", { name: "Supplier", exact: true })).toContainText(`HS-${deal.tag}`);

  // Each box's clock: only its own changes, with why.
  await page.getByRole("button", { name: "History of delivery & payment" }).click();
  const hist = page.getByRole("dialog", { name: "Delivery & payment · history" });
  await expect(hist).toContainText("Lead time");
  await expect(hist).toContainText("Supplier changed its terms");
  await expect(hist).not.toContainText("Their reference");

  const saved = await (await page.request.get(`/api/inquiries/${deal.id}/sourcing`)).json();
  const q = saved.quotes.find((x: { id: string }) => x.id === offer.id);
  expect(q.reference).toBe(`HS-${deal.tag}`);
  expect(q.lines.map((l: { unitPrice: string }) => Number(l.unitPrice))).toEqual([98000, 4500]);

  // The quotation made before the price changed says so, with the price then and now; Keep these prices takes the
  // offer as it is now and keeps the customer's prices, and the note goes.
  const made = (await (await page.request.get(`/api/inquiries/${deal.id}/quotation`)).json()).quotations[0];
  await page.goto(`/inquiries/${deal.id}/quotations/${made.id}`);
  const note = page.getByRole("status").filter({ hasText: /changed its offer after this quotation was made/ });
  await expect(note).toContainText(/4,000\.00 → .*4,500\.00/);
  expect(await accessibilityProblems(page), "the quotation with its offer changed meets WCAG 2.2 AA").toEqual([]);
  const before = (await (await page.request.get(`/api/revisions/${made.revisions[0].id}`)).json()).options[0].lines.map((l: { unitPrice: string }) => l.unitPrice);
  await note.getByRole("button", { name: "Keep these prices" }).click();
  await expect(note).toHaveCount(0);
  const after = (await (await page.request.get(`/api/revisions/${made.revisions[0].id}`)).json()).options[0].lines.map((l: { unitPrice: string }) => l.unitPrice);
  expect(after).toEqual(before);
  expect(errors).toEqual([]);
});
