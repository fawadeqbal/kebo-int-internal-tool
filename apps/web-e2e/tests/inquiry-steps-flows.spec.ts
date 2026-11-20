import { expect, test, type Page } from "@playwright/test";
import { accessibilityProblems, watchErrors, answerWhy } from "./check";

/**
 * Design "RFQ Desk — quote options" (17 Nov 2026): the inquiry's window in steps, Customer · Items ·
 * Details · Files. The Items card's Edit opens it on Items; the items are saved with the rest in one save;
 * changing a saved list asks why first; a wrong item saves nothing and says which.
 */

async function newInquiry(page: Page) {
  const tag = Date.now().toString(36);
  const send = async (url: string, data: object) => {
    const r = await page.request.post(`/api${url}`, { data });
    expect(r.ok(), `${url}: ${await r.text()}`).toBe(true);
    return r.json();
  };
  const me = await (await page.request.get("/api/auth/me")).json();
  const customer = await send("/customers", { name: `Items Pharma ${tag}`, country: "PK", contacts: [{ name: "Omar", email: `omar-${tag}@items.test` }] });
  const inquiry = await send("/inquiries", {
    customerId: customer.id,
    category: "Machinery",
    assigneeId: me.id,
    items: [
      { description: "Tablet press", quantity: 1, unit: "set" },
      { description: "Punches and dies", quantity: 2, unit: "sets" },
    ],
  });
  return { id: inquiry.id as string, refNo: inquiry.refNo as string };
}

test("the Items card's Edit opens only the items; nothing changed is nothing to save, a change asks why, a wrong item says which, then it is saved", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const deal = await newInquiry(page);
  await page.goto(`/inquiries/${deal.id}`);
  await page.locator("#items").getByRole("link", { name: "Edit items" }).click();
  // Only the items (design rules 18 Nov): "Edit items", no steps; nothing changed yet is nothing to save, no reason asked.
  const win = page.getByRole("dialog", { name: "Edit items" });
  await expect(win).toContainText(deal.refNo);
  await expect(win.getByRole("navigation", { name: "Steps" })).toHaveCount(0);
  await expect(win.getByRole("button", { name: "No changes" })).toBeDisabled();
  await expect(win.getByRole("radiogroup", { name: "Why the change?" })).toHaveCount(0);
  const sheet = win.getByRole("grid");
  await expect(sheet.getByRole("row", { name: "Item 2" })).toContainText("Punches and dies");
  expect(await accessibilityProblems(page), "the inquiry's items, on their own, meet WCAG 2.2 AA").toEqual([]);

  // A wrong quantity: one change, and why is asked in the window (Save waits for it); then the save is refused and says which item.
  await sheet.getByRole("row", { name: "Item 2" }).getByRole("gridcell").nth(2).click();
  await page.keyboard.press("Enter");
  await page.getByLabel("Item 2: Quantity").fill("0");
  await page.keyboard.press("Enter");
  await expect(win.getByRole("button", { name: "Save 1 change" })).toBeEnabled();
  await win.getByRole("button", { name: "Save 1 change" }).click();
  await answerWhy(page, "Other…", "The customer wants three sets");
  await expect(win.getByRole("alert").filter({ hasText: "Fix this item" })).toContainText("Item 2:");
  const before = await (await page.request.get(`/api/inquiries/${deal.id}`)).json();
  expect(before.items.map((i: { quantity: string }) => Number(i.quantity))).toEqual([1, 2]);

  // Fixed: saved with the reason already given; the window closes and the card shows it.
  await sheet.getByRole("row", { name: "Item 2" }).getByRole("gridcell").nth(2).click();
  await page.keyboard.press("Enter");
  await page.getByLabel("Item 2: Quantity").fill("3");
  await page.keyboard.press("Enter");
  await win.getByRole("button", { name: "Save 1 change" }).click();
  await expect(win).toBeHidden();
  await expect(page.getByText(`Request saved · ${deal.refNo}`)).toBeVisible();
  await expect(page.locator("#items")).toContainText("3 sets");
  const after = await (await page.request.get(`/api/inquiries/${deal.id}`)).json();
  expect(after.items.map((i: { quantity: string }) => Number(i.quantity))).toEqual([1, 3]);
  // Kept as an edit of the items, with its reason: on the Items box's clock, like every box's.
  await page.locator("#items").getByRole("button", { name: "History of items" }).click();
  await expect(page.getByRole("dialog", { name: "Items · history" })).toContainText("The customer wants three sets");
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("the Overview is the client's request in its window's parts, each part's Edit opens only it; the panel is the same on every tab and a sheet on a phone", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const deal = await newInquiry(page);
  await page.goto(`/inquiries/${deal.id}`);
  // The request in the boxes of its steps (design rules 18 Nov): Customer · Details, Items, Files; each fact once.
  await expect(page.getByRole("heading", { name: "Where it stands" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Customer" })).toContainText("Omar");
  await expect(page.getByRole("region", { name: "Customer" })).toContainText("Came by");
  await expect(page.getByRole("region", { name: "Details" })).toContainText("Machinery");
  await expect(page.locator("#items")).toContainText("Punches and dies");
  await expect(page.getByRole("region", { name: "Files" })).toContainText("Drop files here");
  // The header: status · customer · country (the category is in Details only).
  await expect(page.locator("header, [data-page-header]").first()).not.toContainText("Machinery");
  expect(await accessibilityProblems(page), "the Overview meets WCAG 2.2 AA").toEqual([]);

  // Details' Edit: only the details, saved on their own.
  await page.getByRole("link", { name: "Edit the details" }).click();
  const win = page.getByRole("dialog", { name: "Edit details" });
  await expect(win.getByRole("navigation", { name: "Steps" })).toHaveCount(0);
  await win.locator("#title").fill("Tablet press line");
  // The change is marked, and why is asked once.
  await expect(win.getByText(/Changed · was/)).toBeVisible();
  await win.getByRole("button", { name: "Save 1 change" }).click();
  await answerWhy(page, "Typed wrong");
  await expect(win).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Tablet press line");

  // The same panel beside every tab: who handles it, the next follow-up, the notes.
  for (const tab of ["", "/quotation", "/history"]) {
    await page.goto(`/inquiries/${deal.id}${tab}`);
    const side = page.getByRole("complementary", { name: "Beside the inquiry" });
    await expect(side.getByRole("region", { name: "Notes" })).toBeVisible();
  }

  // On a phone it folds into one bar that opens it as a sheet; Escape puts it away.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/inquiries/${deal.id}`);
  await expect(page.getByRole("region", { name: "Notes" })).toBeHidden();
  await page.getByRole("button", { name: /^Inquiry/ }).click();
  const sheet = page.getByRole("dialog", { name: "Inquiry" });
  await expect(sheet.getByRole("region", { name: "Notes" })).toBeVisible();
  expect(await accessibilityProblems(page), "the sheet meets WCAG 2.2 AA").toEqual([]);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  // Nothing past the screen's edge.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test("the Customer step: recent customers, Came by as buttons, and a customer not in the list added right there", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  const tag = Date.now().toString(36);
  await page.goto("/inquiries?panel=new-inquiry");
  const win = page.getByRole("dialog", { name: "New inquiry" });
  // Before anything is typed: the recent customers, each with its contact and country.
  await win.locator("#customer").click();
  const list = win.getByRole("listbox", { name: "Customers" });
  await expect(list.getByText("Recent")).toBeVisible();
  // Not found: "+ New customer" carries what was typed.
  await win.locator("#customer").fill(`Medipharm ${tag}`);
  await expect(list.getByText(`No customer matches “Medipharm ${tag}”`)).toBeVisible();
  await list.getByRole("option", { name: `New customer “Medipharm ${tag}”` }).click();
  const form = win.getByRole("region", { name: "New customer" });
  await expect(form.locator("#qc-name")).toHaveValue(`Medipharm ${tag}`);
  // Country: typed to find it in the list (the one list chooser), then taken.
  await form.locator("#qc-country").fill("Ken");
  await page.getByRole("option", { name: "Kenya" }).click();
  await expect(form.locator("#qc-country")).toHaveValue("Kenya");
  await form.locator("#qc-contact").fill("Joseph Mwangi");
  await form.locator("#qc-phone").fill(`+2547${String(Date.now()).slice(-8)}`);
  await win.getByRole("button", { name: "Add and use" }).click();
  // Added and chosen: its card, the main contact filled in and tagged.
  await expect(win.getByText(`Medipharm ${tag}`, { exact: true })).toBeVisible();
  await expect(win.locator("#contactId")).toContainText("Joseph Mwangi");
  await expect(win.getByText("Main contact", { exact: true })).toBeVisible();
  // Came by: buttons, one chosen.
  const came = win.getByRole("radiogroup", { name: "Came by" });
  await came.getByRole("radio", { name: "WhatsApp" }).click();
  await expect(came.getByRole("radio", { name: "WhatsApp" })).toHaveAttribute("aria-checked", "true");
  await expect(came.getByRole("radio", { name: "Email" })).toHaveAttribute("aria-checked", "false");
  // The one making it is the responsible person until someone else is chosen.
  await expect(win.locator("#assigneeId")).not.toHaveValue("");
  expect(await accessibilityProblems(page), "the Customer step meets WCAG 2.2 AA").toEqual([]);
  expect(errors).toEqual([]);
});

test("the Items step: Add item first, + Part under an item, a possible duplicate tagged, ticked items acted on together", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await page.goto("/inquiries?panel=new-inquiry");
  const win = page.getByRole("dialog", { name: "New inquiry" });
  await win.locator("#customer").fill("Al-Shifa");
  await win.getByText(/^Al-Shifa Pharma Ltd/).first().click();
  await win.getByRole("button", { name: /^Next/ }).click();
  const desc = win.getByRole("textbox", { name: "New item: Description" });
  const model = win.getByRole("textbox", { name: "New item: Model / part no." });
  const qty = win.getByRole("textbox", { name: "New item: Quantity" });
  await expect(win.getByRole("button", { name: "Add item", exact: true })).toBeVisible();
  await desc.fill("Tablet press machine");
  await model.fill("ZP-35D");
  await qty.fill("1");
  await qty.press("Enter");
  await desc.fill("Punches and dies");
  await qty.fill("2");
  await qty.press("Enter");
  // + Part on line 2: the line being typed goes under it (no Item/Part label to pick) and becomes 2.1.
  await win.getByRole("button", { name: "Add a part to Item 2" }).click();
  await expect(win.getByRole("row", { name: /^New part of/ })).toBeVisible();
  await expect(win.getByRole("combobox", { name: "New item: Item or part" })).toHaveCount(0);
  await desc.fill("Upper punch, 12 mm round");
  await qty.fill("35");
  await qty.press("Enter");
  await expect(win.getByRole("row", { name: "Part 2.1" })).toContainText("Upper punch");
  // Back to items (its number turns it back): the same machine again is tagged, not removed.
  await win.getByRole("button", { name: /make it an item of its own/ }).click();
  await desc.fill("Tablet press machine");
  await qty.fill("1");
  await qty.press("Enter");
  await expect(win.getByRole("row", { name: "Item 3" })).toContainText("Same as 1?");
  // A clean table: no tick boxes until Select; tick 3 and delete it with the bar (asked first); the rest stays.
  await expect(win.getByRole("checkbox", { name: "Select Item 3" })).toHaveCount(0);
  await win.getByRole("button", { name: "Select", exact: true }).click();
  await expect(win.getByRole("toolbar", { name: "Select items" })).toContainText("Tick the items to work on");
  await win.getByRole("checkbox", { name: "Select Item 3" }).check();
  const bar = win.getByRole("toolbar", { name: "1 selected" });
  await bar.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog", { name: "Delete 1 item?" }).getByRole("button", { name: "Delete" }).click();
  await expect(win.getByRole("row", { name: "Item 3" })).toHaveCount(0);
  // After the delete the tick boxes go; Select again, then Done, turns them off too.
  await expect(win.getByRole("checkbox", { name: "Select Item 1" })).toHaveCount(0);
  await win.getByRole("button", { name: "Select", exact: true }).click();
  await expect(win.getByRole("checkbox", { name: "Select Item 1" })).toBeVisible();
  await win.getByRole("button", { name: "Done", exact: true }).click();
  await expect(win.getByRole("checkbox", { name: "Select Item 1" })).toHaveCount(0);
  await expect(win.getByRole("navigation", { name: "Steps" }).getByRole("button", { name: /: Items/ })).toContainText("2 items, 1 part");
  expect(await accessibilityProblems(page), "the Items step meets WCAG 2.2 AA").toEqual([]);
  expect(errors).toEqual([]);
});

test("the Details step: a title offered from the items, Priority as buttons, one Other; Files: a big drop area", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await page.goto("/inquiries?panel=new-inquiry");
  const win = page.getByRole("dialog", { name: "New inquiry" });
  await win.locator("#customer").fill("Al-Shifa");
  await win.getByText(/^Al-Shifa Pharma Ltd/).first().click();
  await win.getByRole("button", { name: /^Next/ }).click();
  const desc = win.getByRole("textbox", { name: "New item: Description" });
  const qty = win.getByRole("textbox", { name: "New item: Quantity" });
  for (const x of ["Tablet press machine", "Punches and dies", "Dust extractor"]) {
    await desc.fill(x);
    await qty.fill("1");
    await qty.press("Enter");
    await expect(win.getByRole("row", { name: /^Item \d/ }).filter({ hasText: x })).toBeVisible();
  }
  await win.getByRole("button", { name: /^Next/ }).click();
  // Offered, never typed in for you.
  await expect(win.locator("#title")).toHaveValue("");
  await win.getByRole("button", { name: "Use “Tablet press machine + 2 more”" }).click();
  await expect(win.locator("#title")).toHaveValue("Tablet press machine + 2 more");
  const priority = win.getByRole("radiogroup", { name: "Priority" });
  await priority.getByRole("radio", { name: "High" }).click();
  await expect(priority.getByRole("radio", { name: "High" })).toHaveAttribute("aria-checked", "true");
  await expect(win.locator("#category option").filter({ hasText: /^Other/ })).toHaveCount(1);
  await win.getByRole("button", { name: /^Next/ }).click();
  await expect(win.getByText("Drop files here")).toBeVisible();
  expect(await accessibilityProblems(page), "Details and Files meet WCAG 2.2 AA").toEqual([]);
  expect(errors).toEqual([]);
});

test("Edit inquiry (⋯): every part, then Changes — old → new with Undo — and why once; Save counts the changes", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  const deal = await newInquiry(page);
  await page.goto(`/inquiries/${deal.id}?panel=edit-request`);
  const win = page.getByRole("dialog", { name: "Edit inquiry" });
  const rail = win.getByRole("navigation", { name: "Steps" });
  await expect(rail.getByRole("button", { name: /: Changes/ })).toBeVisible();
  // Came by and Priority changed: each marked where it is.
  await win.getByRole("radiogroup", { name: "Came by" }).getByRole("radio", { name: "WhatsApp" }).click();
  await expect(win.getByText("Changed · was Email")).toBeVisible();
  await rail.getByRole("button", { name: /: Details/ }).click();
  await win.getByRole("radiogroup", { name: "Priority" }).getByRole("radio", { name: "High" }).click();
  await win.getByRole("button", { name: /^Changes/ }).click();
  // A table on fixed columns: Part · What · Was · Now · Undo.
  const list = win.getByRole("table", { name: "What changed" });
  const cameBy = list.getByRole("row").filter({ hasText: "Came by" });
  await expect(cameBy.getByRole("cell").nth(0)).toHaveText("Customer");
  await expect(cameBy.getByRole("cell").nth(2)).toHaveText("Email");
  await expect(cameBy.getByRole("cell").nth(3)).toHaveText("WhatsApp");
  await expect(list.getByRole("row").filter({ hasText: "Priority" }).getByRole("cell").nth(3)).toHaveText("High");
  // The side bar counts them per part.
  await expect(rail.getByRole("button", { name: /: Customer/ })).toContainText("1 change");
  // Undo one: it is as it was, and the count follows.
  await list.getByRole("button", { name: "Undo: Priority" }).click();
  await expect(list).not.toContainText("Priority");
  await expect(win.getByRole("button", { name: "Save 1 change" })).toBeEnabled();
  await win.getByRole("button", { name: "Save 1 change" }).click();
  await answerWhy(page, "Customer asked for it");
  await expect(win).toBeHidden();
  const saved = await (await page.request.get(`/api/inquiries/${deal.id}`)).json();
  expect([saved.channel, saved.priority]).toEqual(["whatsapp", "normal"]);
  expect(errors).toEqual([]);
});

test("history: each box's clock shows only its changes with who, when and why; a changed line has its own", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  const deal = await newInquiry(page);
  // Came by changed, with a reason.
  await page.goto(`/inquiries/${deal.id}?panel=edit-request&id=customer`);
  const win = page.getByRole("dialog", { name: "Edit customer" });
  await win.getByRole("radiogroup", { name: "Came by" }).getByRole("radio", { name: "WhatsApp" }).click();
  await win.getByRole("button", { name: "Save 1 change" }).click();
  await answerWhy(page, "Customer asked for it");
  await expect(win).toBeHidden();
  // Customer's clock: the change, old → new, why; then where it started. Details' clock: only its start.
  await page.getByRole("region", { name: "Customer" }).getByRole("button", { name: "History of customer" }).click();
  const hist = page.getByRole("dialog", { name: "Customer · history" });
  await expect(hist).toContainText("Came by: Email → WhatsApp");
  await expect(hist).toContainText("Why: Customer asked for it");
  await expect(hist).toContainText("Added with the inquiry");
  await page.keyboard.press("Escape");
  await page.getByRole("region", { name: "Details" }).getByRole("button", { name: "History of details" }).click();
  await expect(page.getByRole("dialog", { name: "Details · history" })).not.toContainText("Came by");
  await page.keyboard.press("Escape");
  // A line's quantity changed: that line's clock says so.
  await page.locator("#items").getByRole("link", { name: "Edit items" }).click();
  const items = page.getByRole("dialog", { name: "Edit items" });
  await items.getByRole("grid").getByRole("row", { name: "Item 2" }).getByRole("gridcell").nth(2).click();
  await page.keyboard.press("Enter");
  await page.getByLabel("Item 2: Quantity").fill("3");
  await page.keyboard.press("Enter");
  await items.getByRole("button", { name: "Save 1 change" }).click();
  await answerWhy(page, "Customer changed the quantity");
  await expect(items).toBeHidden();
  await page.locator("#items").getByRole("button", { name: "History of item 2" }).click();
  await expect(page.getByRole("dialog", { name: "Item 2 · history" })).toContainText("Quantity 2 → 3");
  expect(errors).toEqual([]);
});
