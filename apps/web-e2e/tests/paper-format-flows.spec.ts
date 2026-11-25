import { expect, test, type Page } from "@playwright/test";
import { accessibilityProblems, watchErrors } from "./check";

/**
 * Papers in the customer's format (25 Nov 2026), done in a browser: the LC's bank reference and address on the
 * LC card; the packing case by case on Shipping (each case's size and weights, the volume worked out); the
 * packing list in the customer's own columns with the Notify bank under the title; and every paper in English or
 * English with Chinese.
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
    name: `Vision Pharma ${tag}`,
    country: "PK",
    address: "Plot No. 22-23, Industrial Triangle, Kahuta Road, Islamabad",
    taxNo: "8890224-6",
    contacts: [{ name: "Ali", email: `ali-${tag}@vision.test` }],
  });
  const inquiry = await send("post", "/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me.id, items: [{ description: "Vial capping machine RHZ-8", quantity: 1, unit: "set" }] });
  const item = (await (await page.request.get(`/api/inquiries/${inquiry.id}`)).json()).items[0].id;
  await send("post", `/inquiries/${inquiry.id}/factory-quotes`, {
    newFactoryName: `Jining Capping ${tag}`,
    receivedOn: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10),
    currency: "CNY",
    lines: [{ requestedItemId: item, description: "Vial capping machine RHZ-8", quantity: 1, unit: "set", unitPrice: 200000 }],
  });
  const draft = await (await page.request.get(`/api/inquiries/${inquiry.id}/quotation/draft`)).json();
  const rev = await send("post", `/inquiries/${inquiry.id}/quotation/revisions`, draft);
  await send("post", `/revisions/${rev.id}/status`, { to: "sent" });
  await send("post", `/revisions/${rev.id}/status`, { to: "accepted" });
  const id = (await (await page.request.get(`/api/inquiries/${inquiry.id}`)).json()).orders[0].id as string;
  await send("patch", `/orders/${id}/route`, { route: "letter_of_credit" });
  await send("post", `/orders/${id}/shipments`, { mode: "sea", status: "booked", portOfLoading: "Qingdao, China", portOfDischarge: "Karachi Port, Pakistan" });
  return id;
}

test("the LC's reference and bank, the packing case by case, and the packing list in the customer's format, in English and Chinese", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  const id = await newOrder(page);

  // The LC card: its number, the bank's reference, the bank and its address.
  await page.goto(`/orders/${id}/payment`);
  await page.getByRole("button", { name: /^(Add|Edit)$/ }).first().click();
  const lc = page.getByRole("dialog");
  await lc.getByLabel("LC number").fill("LCS/4/76/823");
  await lc.getByLabel(/^Bank reference/).fill("AD1090926000595");
  await lc.getByLabel(/^Customer's bank(?! address)/).fill("Habib Metropolitan Bank Limited");
  await lc.getByLabel(/^Customer's bank address/).fill("CPU Import, 1st Floor, Spencer Building, I.I. Chundrigar Road, Karachi 74200");
  await lc.getByLabel("Opened on").fill("2026-09-02");
  await lc.getByRole("button", { name: "Save the LC" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("AD1090926000595")).toBeVisible();

  // Shipping: the item packed in two cases, each with its size and weights; the volume is worked out.
  await page.goto(`/orders/${id}/shipping`);
  await page.getByRole("button", { name: "Edit items" }).click();
  const w = page.getByRole("dialog", { name: "Edit packing list" });
  await w.getByRole("button", { name: "Add a case" }).click();
  await w.getByRole("button", { name: "Add a case" }).click();
  const rows = w.getByRole("row").filter({ has: page.getByRole("textbox") });
  const fill = async (n: number, [l, wd, h, net, gross]: string[]) => {
    const row = rows.nth(n);
    await row.getByLabel(/^Case No\./).fill("1");
    await row.getByLabel(/^Packed in/).fill("Fumigated solid wooden case (IPPC)");
    await row.getByLabel(/^L \(mm\)/).fill(l!);
    await row.getByLabel(/^W \(mm\)/).fill(wd!);
    await row.getByLabel(/^H \(mm\)/).fill(h!);
    await row.getByLabel(/^Net kg/).fill(net!);
    await row.getByLabel(/^Gross kg/).fill(gross!);
  };
  await fill(0, ["2400", "1190", "1960", "600", "700"]);
  await fill(1, ["1430", "1130", "690", "100", "150"]);
  await expect(rows.nth(0)).toContainText("5.598");
  await expect(w).toContainText("2 cases · 6.713 m³ · net 700 kg · gross 850 kg");
  expect(await accessibilityProblems(page, '[role="dialog"]'), "the case editor meets WCAG 2.2 AA").toEqual([]);
  await w.getByRole("button", { name: "Save the packing" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The packing list: the Notify bank and the shipping under the title, a row per case, the totals.
  await page.goto(`/print/orders/${id}/packing-list`);
  const paper = page.locator("article.kebo-doc");
  for (const t of ["Shipper", "Buyer", "N.T.N No.", "8890224-6", "Notify bank", "LCS/4/76/823", "AD1090926000595", "Habib Metropolitan Bank Limited", "Qingdao, China", "Karachi Port, Pakistan"])
    await expect(paper).toContainText(t);
  for (const h of ["Case No.", "Description of goods", "Package", "L (mm)", "W (mm)", "H (mm)", "CBM", "N.W. (kg)", "G.W. (kg)"])
    await expect(paper.getByRole("columnheader", { name: h })).toBeVisible();
  await expect(paper.locator("tbody tr").first()).toContainText("2400");
  await expect(paper.locator("tbody tr").last()).toContainText("2 cases");
  await expect(paper.locator("tbody tr").last()).toContainText("6.713");
  await expect(paper).toContainText("irrevocable LC at sight (LC No. LCS/4/76/823) Ref. No. AD1090926000595");

  // English with Chinese: the switch in the toolbar; the PDF follows it.
  await page.getByRole("group", { name: "Language" }).getByRole("link", { name: "English + 中文" }).click();
  await expect(page).toHaveURL(/lang=zh/);
  await expect(paper).toContainText("装箱单");
  await expect(paper.getByRole("columnheader", { name: /箱号/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", /lang=zh/);
  await page.getByRole("group", { name: "Language" }).getByRole("link", { name: "English", exact: true }).click();
  await expect(paper).not.toContainText("装箱单");
  expect(errors).toEqual([]);
});
