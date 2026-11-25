import { expect, test, type Page } from "@playwright/test";
import { accessibilityProblems, watchErrors } from "./check";

/**
 * Packing for machines (25 Nov 2026), done in a browser: each package says what is in it and which shipment takes
 * it (the machine by sea, the spare parts by air); each shipment's box has a Packing line with its packages,
 * volume and weight and its own packing list; the Shipping tab warns, never blocks, when a package is too big for
 * a container.
 */

async function newOrder(page: Page) {
  const tag = Date.now().toString(36);
  const send = async (method: "post" | "put" | "patch", url: string, data: object) => {
    const r = await page.request[method](`/api${url}`, { data });
    expect(r.ok(), `${url}: ${await r.text()}`).toBe(true);
    return r.json();
  };
  const me = await (await page.request.get("/api/auth/me")).json();
  const customer = await send("post", "/customers", {
    name: `Al Noor Pharma ${tag}`,
    country: "PK",
    contacts: [{ name: "Omar", email: `omar-${tag}@alnoor.test` }],
  });
  const inquiry = await send("post", "/inquiries", {
    customerId: customer.id,
    category: "Machinery",
    assigneeId: me.id,
    items: [{ description: "Tablet press line ZP-35D", quantity: 1, unit: "set" }],
  });
  const item = (await (await page.request.get(`/api/inquiries/${inquiry.id}`)).json()).items[0].id;
  await send("post", `/inquiries/${inquiry.id}/factory-quotes`, {
    newFactoryName: `Jinan Pharma Machinery ${tag}`,
    receivedOn: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10),
    currency: "CNY",
    lines: [{ requestedItemId: item, description: "Tablet press line ZP-35D", quantity: 1, unit: "set", unitPrice: 900000 }],
  });
  const draft = await (await page.request.get(`/api/inquiries/${inquiry.id}/quotation/draft`)).json();
  const rev = await send("post", `/inquiries/${inquiry.id}/quotation/revisions`, draft);
  await send("post", `/revisions/${rev.id}/status`, { to: "sent" });
  await send("post", `/revisions/${rev.id}/status`, { to: "accepted" });
  const id = (await (await page.request.get(`/api/inquiries/${inquiry.id}`)).json()).orders[0].id as string;
  await send("post", `/orders/${id}/shipments`, {
    mode: "sea",
    status: "planned",
    portOfLoading: "Qingdao, China",
    portOfDischarge: "Karachi Port, Pakistan",
  });
  await send("post", `/orders/${id}/shipments`, { mode: "air", status: "planned" });
  return id;
}

test("packages by shipment: what is in each, the machine by sea and the spare parts by air, each shipment's packing list", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  const id = await newOrder(page);

  await page.goto(`/orders/${id}/shipping`);
  await page.getByRole("button", { name: "Edit items" }).click();
  const w = page.getByRole("dialog", { name: "Edit packing list" });
  await w.getByRole("button", { name: "Add a package" }).click();
  await w.getByRole("button", { name: "Add a package" }).click();
  const rows = w.getByRole("row").filter({ has: page.getByRole("textbox") });
  const fill = async (
    n: number,
    v: { no: string; count: string; type: string; what: string; size: string[]; net: string; gross: string; shipment: RegExp },
  ) => {
    const row = rows.nth(n);
    await row.getByLabel(/^Package No\./).fill(v.no);
    await row.getByLabel(/^Packages/).fill(v.count);
    await row.getByLabel(/^Packed in/).fill(v.type);
    await row.getByLabel(/^What is in it/).fill(v.what);
    await row.getByLabel(/^L \(mm\)/).fill(v.size[0]!);
    await row.getByLabel(/^W \(mm\)/).fill(v.size[1]!);
    await row.getByLabel(/^H \(mm\)/).fill(v.size[2]!);
    await row.getByLabel(/^Net kg/).fill(v.net);
    await row.getByLabel(/^Gross kg/).fill(v.gross);
    await row.getByLabel(/^Shipment/).selectOption({
      label: (
        await row
          .getByLabel(/^Shipment/)
          .locator("option")
          .allTextContents()
      ).find((t) => v.shipment.test(t))!,
    });
  };
  await fill(0, {
    no: "1",
    count: "1",
    type: "Crate",
    what: "Compression unit",
    size: ["6100", "2650", "3100"],
    net: "5100",
    gross: "5600",
    shipment: /^1 · /,
  });
  await fill(1, {
    no: "2-5",
    count: "4",
    type: "Carton",
    what: "Punches and dies",
    size: ["600", "400", "400"],
    net: "72",
    gross: "88",
    shipment: /^2 · /,
  });
  await expect(w).toContainText("5 packages");
  expect(await accessibilityProblems(page, '[role="dialog"]'), "the packages editor meets WCAG 2.2 AA").toEqual([]);
  await w.getByRole("button", { name: "Save the packing" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // A warning, not a block: the crate needs a flat rack. Each shipment's Packing line says what it takes.
  await expect(page.getByRole("status").filter({ hasText: "1 package too big for a container" })).toBeVisible();
  await expect(page.getByText("1 package for a flat rack")).toBeVisible();
  await expect(page.getByText("4 packages", { exact: true }).first()).toBeVisible();
  expect(await accessibilityProblems(page), "the Shipping tab meets WCAG 2.2 AA").toEqual([]);

  // The air shipment's packing list: only its cartons, numbered after the order's.
  const href = await page.getByRole("link", { name: "Packing list" }).nth(1).getAttribute("href");
  expect(href).toMatch(/packing-list\?shipment=/);
  await page.goto(href!);
  const paper = page.locator("article.kebo-doc");
  await expect(paper).toContainText("Punches and dies");
  await expect(paper).not.toContainText("Compression unit");
  await expect(paper.locator("tbody tr").last()).toContainText("4");
  expect(errors).toEqual([]);
});
