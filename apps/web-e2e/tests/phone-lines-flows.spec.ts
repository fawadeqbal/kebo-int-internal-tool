import { expect, test, type Page } from "@playwright/test";
import { accessibilityProblems, watchErrors } from "./check";

/**
 * Design "Lines on the phone" (16 Nov 2026), asked for everywhere on 17 Nov: on a phone a lines sheet is a
 * list (one line per row, what it still needs marked), a line is typed or changed in a window of its own
 * (Add & next, Save & next), ⋯ is a sheet of what can be done to it, and a removed line comes back with Undo.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const tag = () => Date.now().toString(36);
async function post(page: Page, url: string, data: object) {
  const r = await page.request.post(`/api${url}`, { data });
  expect(r.ok(), `${url}: ${await r.text()}`).toBe(true);
  return r.json();
}
async function newInquiry(page: Page, t: string) {
  const me = await (await page.request.get("/api/auth/me")).json();
  const customer = await post(page, "/customers", { name: `Phone Pharma ${t}`, country: "PK", contacts: [{ name: "Hina", email: `hina-${t}@phone.test` }] });
  return post(page, "/inquiries", {
    customerId: customer.id,
    category: "Machinery",
    assigneeId: me.id,
    items: [{ description: "Tablet press", quantity: 1, unit: "set" }],
  }) as Promise<{ id: string; refNo: string }>;
}

test("inquiry items on a phone: a list, Add & next, a line in its own window, ⋯ and Undo, saved with the inquiry", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const deal = await newInquiry(page, tag());
  await page.goto(`/inquiries/${deal.id}?panel=edit-request&id=items`);
  const win = page.getByRole("dialog", { name: "Edit the request" });
  const list = win.getByRole("list", { name: "Items" });
  await expect(list.getByRole("button", { name: /^Item 1 Tablet press/ })).toContainText("1 set");
  expect(await accessibilityProblems(page), "the items list on a phone meets WCAG 2.2 AA").toEqual([]);

  // Add & next: the window stays for the next one and says what was added.
  await win.getByRole("button", { name: "Add item", exact: true }).click();
  const line = page.getByRole("dialog", { name: "New item" });
  await expect(line.getByLabel("Description")).toBeFocused();
  await line.getByLabel("Description").fill("Blister packing machine");
  await line.getByLabel("Qty").fill("2");
  await line.getByRole("button", { name: "sets", exact: true }).click();
  expect(await accessibilityProblems(page), "a line's window meets WCAG 2.2 AA").toEqual([]);
  await line.getByRole("button", { name: /Add & next/ }).click();
  await expect(line.getByRole("status")).toContainText("Added “Blister packing machine”");
  await expect(line.getByLabel("Description")).toHaveValue("");
  await line.getByRole("button", { name: "Done" }).click();
  await expect(line).toBeHidden();
  await expect(list.getByRole("button", { name: /^Item 2 Blister packing machine/ })).toContainText("2 sets");

  // A saved line opens in its window; Save & next goes on to the next one.
  await list.getByRole("button", { name: /^Item 1 Tablet press/ }).click();
  const one = page.getByRole("dialog", { name: "Item 1" });
  await expect(one).toContainText("1 of 2");
  await one.getByLabel("Qty").fill("3");
  await one.getByRole("button", { name: "Save & next" }).click();
  const two = page.getByRole("dialog", { name: "Item 2" });
  await expect(two.getByLabel("Description")).toHaveValue("Blister packing machine");
  await two.getByRole("button", { name: "Close" }).click();
  await expect(list.getByRole("button", { name: /^Item 1 Tablet press/ })).toContainText("3 set");

  // ⋯: what can be done to a line, as a sheet; Delete, then Undo puts it back.
  await list.getByRole("button", { name: "More for Item 2" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(list.getByRole("button", { name: /^Item 2/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(list.getByRole("button", { name: /^Item 2 Blister packing machine/ })).toBeVisible();

  // Saved with the inquiry (a saved list changed: it asks why first).
  await win.getByRole("button", { name: "Save changes" }).click();
  const why = page.getByRole("dialog", { name: "Why are you changing the items?" });
  await why.getByRole("textbox").first().fill("The customer sent two more");
  await why.getByRole("button", { name: "Save changes" }).click();
  await expect(win).toBeHidden();
  const saved = await (await page.request.get(`/api/inquiries/${deal.id}`)).json();
  expect(saved.items.map((i: { description: string; quantity: string; unit: string }) => [i.description, Number(i.quantity), i.unit])).toEqual([
    ["Tablet press", 3, "set"],
    ["Blister packing machine", 2, "sets"],
  ]);
  expect(errors).toEqual([]);
});

test("offer lines on a phone: what a line still needs is marked and can be shown alone; the price typed in its window", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const t = tag();
  const deal = await newInquiry(page, t);
  const offer = await post(page, `/inquiries/${deal.id}/factory-quotes`, {
    newFactoryName: `Phone Works ${t}`,
    receivedOn: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    currency: "CNY",
    lines: [
      { description: "Tablet press", quantity: 1, unit: "set", unitPrice: 98000 },
      { description: "Punches and dies", quantity: 2, unit: "sets", unitPrice: 0 },
    ],
  });
  await page.goto(`/inquiries/${deal.id}/offers/${offer.id}`);
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const win = page.getByRole("dialog", { name: /Edit · Phone Works .*’s offer/ });
  const list = win.getByRole("list", { name: "Lines" });
  await expect(list.getByRole("button", { name: /^Line 2 Punches and dies/ })).toContainText("No price");
  await win.getByRole("button", { name: /Needs something/ }).click();
  await expect(list.getByRole("button")).toHaveCount(2); // the line and its ⋯
  await list.getByRole("button", { name: /^Line 2 Punches and dies/ }).click();
  const line = page.getByRole("dialog", { name: "Line 2" });
  await line.getByLabel("Price CNY").fill("4500");
  await line.getByRole("button", { name: "Save", exact: true }).click();
  await expect(line).toBeHidden();
  // Nothing needs anything now: the filter goes, every line shows.
  await expect(win.getByRole("button", { name: /Needs something/ })).toHaveCount(0);
  await expect(list.getByRole("button", { name: /^Line 2 Punches and dies/ })).toContainText(/4,?500/);
  await win.getByRole("button", { name: "Save", exact: true }).click();
  await expect(win).toBeHidden();
  const saved = (await (await page.request.get(`/api/inquiries/${deal.id}/sourcing`)).json()).quotes.find((q: { id: string }) => q.id === offer.id);
  expect(saved.lines.map((l: { unitPrice: string }) => Number(l.unitPrice))).toEqual([98000, 4500]);
  expect(errors).toEqual([]);
});
