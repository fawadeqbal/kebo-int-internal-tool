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

test("the inquiries list on a phone: chips, one Filters button with a sheet, rows of three lines; the Board's columns", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  const { tag, a } = await twoInquiries(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/inquiries?q=${tag}`);
  // The + in the bottom bar is the one New.
  await expect(page.getByRole("main").getByRole("link", { name: "New inquiry" })).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Quick" }).getByRole("link", { name: "New inquiry" })).toBeVisible();
  const row = page.locator(`main ul > li > a[href="/inquiries/${a.id}"]`);
  await expect(row).toContainText(a.refNo);
  await expect(row).toContainText("Urgent");
  await page.getByRole("button", { name: /^Filters/ }).click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await sheet.getByRole("button", { name: "Me", exact: true }).click();
  await expect(page).toHaveURL(/assignee=me/);
  await expect(sheet.getByRole("button", { name: /^Show 2 inquiries$/ })).toBeVisible();
  await sheet.getByRole("button", { name: /^Show/ }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: /^Filters 1$/ })).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/inquiries/board?q=${tag}`);
  const column = (name: string) => page.getByRole("region", { name, exact: true }).filter({ visible: true });
  for (const c of ["New", "Sourcing", "Quoted", "On hold", "Closed"]) await expect(column(c)).toBeVisible();
  // Given to someone at once, it starts in Sourcing.
  await expect(column("Sourcing")).toContainText(a.refNo);
  expect(errors).toEqual([]);
});
