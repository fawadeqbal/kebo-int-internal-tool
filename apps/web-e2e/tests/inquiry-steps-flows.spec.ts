import { expect, test, type Page } from "@playwright/test";
import { accessibilityProblems, watchErrors } from "./check";

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

test("the Items card's Edit opens only the items; a changed list asks why, a wrong item says which, then it is saved", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const deal = await newInquiry(page);
  await page.goto(`/inquiries/${deal.id}`);
  await page.locator("#items").getByRole("link", { name: "Edit items" }).click();
  // Only the items (design 17 Nov): no steps; All steps is there for the rest of the request.
  const win = page.getByRole("dialog", { name: `Items · ${deal.refNo}` });
  await expect(win.getByRole("navigation", { name: "Steps" })).toHaveCount(0);
  await expect(win.getByRole("button", { name: "All steps" })).toBeVisible();
  const sheet = win.getByRole("grid");
  await expect(sheet.getByRole("row", { name: "Item 2" })).toContainText("Punches and dies");
  expect(await accessibilityProblems(page), "the inquiry's items, on their own, meet WCAG 2.2 AA").toEqual([]);

  // A wrong quantity: Save asks why (a saved list changed), then the save is refused and says which item.
  await sheet.getByRole("row", { name: "Item 2" }).getByRole("gridcell").nth(2).click();
  await page.keyboard.press("Enter");
  await page.getByLabel("Item 2: Qty").fill("0");
  await page.keyboard.press("Enter");
  await expect(win.getByText(/1 change to the items, saved with the rest · Save asks why/)).toBeVisible();
  await win.getByRole("button", { name: "Save changes" }).click();
  const why = page.getByRole("dialog", { name: "Why are you changing the items?" });
  await expect(why).toContainText("Qty 2 → 0");
  await why.getByRole("textbox").first().fill("The customer wants three sets");
  await why.getByRole("button", { name: "Save changes" }).click();
  await expect(win.getByRole("alert").filter({ hasText: "Fix this item" })).toContainText("Item 2:");
  const before = await (await page.request.get(`/api/inquiries/${deal.id}`)).json();
  expect(before.items.map((i: { quantity: string }) => Number(i.quantity))).toEqual([1, 2]);

  // Fixed: saved with the reason already given; the window closes and the card shows it.
  await sheet.getByRole("row", { name: "Item 2" }).getByRole("gridcell").nth(2).click();
  await page.keyboard.press("Enter");
  await page.getByLabel("Item 2: Qty").fill("3");
  await page.keyboard.press("Enter");
  await win.getByRole("button", { name: "Save changes" }).click();
  await expect(win).toBeHidden();
  await expect(page.getByText(`Request saved · ${deal.refNo}`)).toBeVisible();
  await expect(page.locator("#items")).toContainText("3 sets");
  const after = await (await page.request.get(`/api/inquiries/${deal.id}`)).json();
  expect(after.items.map((i: { quantity: string }) => Number(i.quantity))).toEqual([1, 3]);
  // Kept as an edit of the items, with its reason.
  await expect(page.locator("#items").getByRole("button", { name: /Edited 1×/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the Overview is the client's request in its window's parts, each part's Edit opens only it; the panel is the same on every tab and a sheet on a phone", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const deal = await newInquiry(page);
  await page.goto(`/inquiries/${deal.id}`);
  // The request in the parts of Edit the request (design "the record page"); no "Where it stands" list.
  await expect(page.getByRole("heading", { name: "Where it stands" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Who asked" })).toContainText("Omar");
  await expect(page.getByRole("region", { name: "Details" })).toContainText("Machinery");
  await expect(page.locator("#items")).toContainText("Punches and dies");
  expect(await accessibilityProblems(page), "the Overview meets WCAG 2.2 AA").toEqual([]);

  // Details' Edit: only the details (Needed by is one of them now), saved on their own.
  await page.getByRole("link", { name: "Edit the details" }).click();
  const win = page.getByRole("dialog", { name: `Details · ${deal.refNo}` });
  await expect(win.getByRole("navigation", { name: "Steps" })).toHaveCount(0);
  await win.locator("#requiredBy").fill("2026-12-24");
  await win.getByRole("button", { name: "Save changes" }).click();
  await expect(win).toBeHidden();
  await expect(page.getByRole("region", { name: "Details" })).toContainText("24 Dec 2026");

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
