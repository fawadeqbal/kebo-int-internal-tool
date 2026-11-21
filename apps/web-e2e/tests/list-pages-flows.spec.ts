import { expect, test, type Page } from "@playwright/test";
import { watchErrors } from "./check";

/**
 * Design "RFQ Desk — list pages" (18 Nov 2026), drawn on the inquiries list: one strong button, the stages as tabs
 * with counts, filters in one row (Responsible person first), each row in the record's words; Select brings a light
 * bar for the ticked rows; on a phone one Filters button opens a sheet; the Board is the same list in columns.
 */

async function twoInquiries(page: Page) {
  const tag = Date.now().toString(36);
  const send = async (url: string, data: object) => {
    const r = await page.request.post(`/api${url}`, { data });
    expect(r.ok(), `${url}: ${await r.text()}`).toBe(true);
    return r.json();
  };
  const me = await (await page.request.get("/api/auth/me")).json();
  const customer = await send("/customers", { name: `List Pharma ${tag}`, country: "PK", contacts: [{ name: "Sana", email: `sana-${tag}@list.test` }] });
  const a = await send("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me.id, priority: "urgent", title: `Tablet press ${tag}`, items: [{ description: "Tablet press", quantity: 1, unit: "set" }] });
  const b = await send("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me.id, title: `Capsule filler ${tag}`, items: [{ description: "Capsule filler", quantity: 1, unit: "set" }] });
  return { tag, a: a as { id: string; refNo: string }, b: b as { id: string; refNo: string } };
}

test("the inquiries list: New inquiry, the stages as tabs, Responsible person, the row's facts; Select sets a follow-up on the ticked ones", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  const { tag, a, b } = await twoInquiries(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/inquiries?q=${tag}`);

  // One strong button; Board is a view, Export is in ⋯; no help line and no big number cards.
  await expect(page.getByRole("main").getByRole("link", { name: "New inquiry" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "View" }).getByRole("link", { name: "Board" })).toBeVisible();
  await expect(page.getByText("Every request for a price")).toHaveCount(0);
  await expect(page.locator("dl[aria-label=Facts]")).toBeVisible();

  // The stages are tabs with counts; Mine is the first choice in Responsible person.
  const tabs = page.getByRole("navigation", { name: "Which inquiries" });
  for (const t of ["Open", "New", "Sourcing", "Quoted", "On hold", "Won", "Lost", "All"]) await expect(tabs.getByRole("link", { name: new RegExp(`^${t}`) })).toBeVisible();
  await expect(tabs.getByRole("link", { name: /^Mine/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Responsible person" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Handles" })).toHaveCount(0);

  // The row: number, what and who for, Responsible person, where it stands; Urgent beside the title.
  for (const h of ["No.", "Inquiry", "Received", "Responsible person", "Where it stands", "Next follow-up"]) await expect(page.getByRole("columnheader", { name: h, exact: true })).toBeVisible();
  const rowA = page.locator(`tr[data-href="/inquiries/${a.id}"]`);
  await expect(rowA).toContainText(a.refNo);
  await expect(rowA).toContainText("Urgent");
  await expect(rowA).toContainText(/New|Sourcing/);
  await expect(page.locator(`tr[data-href="/inquiries/${b.id}"]`)).not.toContainText("Normal");

  // Select: a light bar takes the filter row's place; a follow-up for both ticked ones.
  await page.getByRole("button", { name: "Select" }).click();
  await page.getByRole("checkbox", { name: `Tick ${a.refNo}` }).click();
  await page.getByRole("checkbox", { name: `Tick ${b.refNo}` }).click();
  const bar = page.getByRole("toolbar", { name: "Ticked rows" });
  await expect(bar).toContainText("2 selected");
  await expect(page.getByRole("search", { name: "Filter the list" })).toHaveCount(0);
  await bar.getByRole("button", { name: /Next follow-up/ }).click();
  await page.getByRole("button", { name: "Set on 2 inquiries" }).click();
  await expect(page.locator("[data-note=done]")).toContainText("Follow-up set on 2 inquiries");
  await expect(rowA).toContainText("Tomorrow");
  expect(errors).toEqual([]);
});

test("the inquiries list on a phone: chips, one Filters button with a sheet, rows of two lines; the Board's columns", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  const { tag, a } = await twoInquiries(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/inquiries?q=${tag}`);
  // The list's own button is the + in the middle of the bottom bar (the app's + steps aside under it): one New.
  const plus = page.getByRole("main").getByRole("link", { name: "New inquiry" });
  await expect(plus).toBeVisible();
  const box = (await plus.boundingBox())!;
  expect(box.width).toBe(56);
  expect(box.y).toBeGreaterThan(700);
  await expect(page.getByRole("navigation", { name: "Quick" }).getByRole("link", { name: "New inquiry" })).toBeHidden();
  const row = page.locator(`main ul > li > a[href="/inquiries/${a.id}"]`);
  await expect(row).toContainText(a.refNo);
  await expect(row).toContainText("Urgent");
  await page.getByRole("button", { name: /^Filters/ }).click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  // A chip, or a row once there are many people.
  await sheet.getByText("Me", { exact: true }).click();
  await expect(page).toHaveURL(/assignee=me/);
  await expect(sheet.getByRole("button", { name: /^Show 2 inquiries$/ })).toBeVisible();
  await sheet.getByRole("button", { name: /^Show/ }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: "Filters, 1 on" })).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/inquiries/board?q=${tag}`);
  const column = (name: string) => page.getByRole("region", { name, exact: true }).filter({ visible: true });
  for (const c of ["New", "Sourcing", "Quoted", "On hold", "Closed"]) await expect(column(c)).toBeVisible();
  // Given to someone at once, it starts in Sourcing.
  await expect(column("Sourcing")).toContainText(a.refNo);
  expect(errors).toEqual([]);
});

test("an inquiry's supplier offers: asked and answered in one list, the Amount with tax, Waiting, then Compare with Lowest and Fastest", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  const tag = Date.now().toString(36);
  const send = async (url: string, data: object, method: "post" | "patch" = "post") => {
    const r = await page.request[method](`/api${url}`, { data });
    expect(r.ok(), `${url}: ${await r.text()}`).toBe(true);
    return r.json();
  };
  const me = await (await page.request.get("/api/auth/me")).json();
  const customer = await send("/customers", { name: `Offers Pharma ${tag}`, country: "PK", contacts: [{ name: "Imran", email: `imran-${tag}@offers.test` }] });
  const deal = await send("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me.id, items: [{ description: "Blister packing machine", quantity: 1, unit: "set" }] });
  const item = (await (await page.request.get(`/api/inquiries/${deal.id}`)).json()).items[0];
  const offer = (name: string, price: number, lead: number, included: boolean) =>
    send(`/inquiries/${deal.id}/factory-quotes`, {
      newFactoryName: `${name} ${tag}`,
      receivedOn: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
      currency: "CNY",
      taxIncluded: included,
      taxRate: 13,
      basis: "FOB",
      basisPlace: "Qingdao",
      leadDays: lead,
      leadFrom: "after_payment",
      lines: [{ description: "Blister packing machine", quantity: 1, unit: "set", unitPrice: price, requestedItemId: item.id }],
    });
  await offer("Jinan Scroll", 86_000, 35, false);
  await offer("Ruian Scroll", 91_500, 25, true);
  const suppliers = await (await page.request.get("/api/factories", { params: { pageSize: 1 } })).json();
  await send(`/inquiries/${deal.id}/factory-requests`, { factoryIds: [suppliers.rows[0].id] });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/inquiries/${deal.id}/sourcing`);
  const table = page.getByRole("table", { name: "Supplier offers" });
  for (const h of ["Supplier", "Amount", "Covers", "Lead time", "Incoterm", "Deposit", "Status"]) await expect(table.getByRole("columnheader", { name: h })).toBeVisible();
  // The Amount is with tax, and says how.
  await expect(table.getByRole("row", { name: /Jinan Scroll/ })).toContainText("CNY 97,180.00");
  await expect(table.getByRole("row", { name: /Jinan Scroll/ })).toContainText("with 13% tax added");
  await expect(table.getByRole("row", { name: /Ruian Scroll/ })).toContainText("13% tax included");
  await expect(table.getByRole("row", { name: new RegExp(suppliers.rows[0].name) })).toContainText("Waiting");
  // The card's buttons are plain (the page's strong one is the header's).
  await expect(page.getByRole("button", { name: "New supplier offer" })).toBeVisible();

  await page.getByRole("navigation", { name: "Show the offers as" }).getByRole("link", { name: "Compare" }).click();
  const grid = page.getByRole("group", { name: "Offers side by side" });
  await expect(grid).toContainText("Total with tax");
  await expect(grid).toContainText("Lowest");
  await expect(grid).toContainText("Fastest");
  await expect(page.getByText(/has not answered yet/)).toBeVisible();
  expect(errors).toEqual([]);
});
