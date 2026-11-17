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

test("the Items card's Edit opens the inquiry's window on Items; a changed list asks why, a wrong item says which, then all is saved together", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const deal = await newInquiry(page);
  await page.goto(`/inquiries/${deal.id}`);
  await page.locator("#items").getByRole("link", { name: "Edit items" }).click();
  const win = page.getByRole("dialog", { name: "Edit the request" });
  const rail = win.getByRole("navigation", { name: "Steps" });
  await expect(rail.getByRole("button", { name: /: Items/ })).toHaveAttribute("aria-current", "step");
  await expect(rail.getByRole("button", { name: /: Items/ })).toContainText("2 items");
  const sheet = win.getByRole("grid");
  await expect(sheet.getByRole("row", { name: "Item 2" })).toContainText("Punches and dies");
  expect(await accessibilityProblems(page), "the inquiry's Items step meets WCAG 2.2 AA").toEqual([]);

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
