import { expect, test, type Page } from "@playwright/test";
import { accessibilityProblems, watchErrors } from "./check";

/**
 * Design "Quotations: one way, any number" (17 Nov 2026), done in a browser: a deal's quotations are made from
 * its offers, lettered A, B, C…; a draft's Send window includes the deal's other drafts that are ready (ticked),
 * and they go together.
 */

/** A deal of its own (through the API, as the signed-in person): a customer, one item, two factories' offers, three quotations (A and B priced, C own prices still at 0). */
async function dealWithDrafts(page: Page) {
  const tag = Date.now().toString(36);
  const send = async (url: string, data: object) => {
    const r = await page.request.post(`/api${url}`, { data });
    expect(r.ok(), `${url}: ${await r.text()}`).toBe(true);
    return r.json();
  };
  const me = await (await page.request.get("/api/auth/me")).json();
  const customer = await send("/customers", { name: `Many Pharma ${tag}`, country: "PK", contacts: [{ name: "Imran Ali", email: `imran-${tag}@many.test` }] });
  const inquiry = await send("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me.id, items: [{ description: "Blister packing machine", quantity: 1, unit: "set" }] });
  const item = (await (await page.request.get(`/api/inquiries/${inquiry.id}`)).json()).items[0].id;
  const received = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  const offer = async (factory: string, price: number, tax: object = {}) =>
    (
      await send(`/inquiries/${inquiry.id}/factory-quotes`, {
        newFactoryName: `${factory} ${tag}`,
        receivedOn: received,
        currency: "USD",
        lines: [{ requestedItemId: item, description: "Blister packing machine", quantity: 1, unit: "set", unitPrice: price }],
        ...tax,
      })
    ).id as string;
  // Shenjing's prices have 13% tax in them.
  const offers = [await offer("Jinan", 24000), await offer("Shenjing", 22500, { taxIncluded: true, taxRate: 13 }), null];
  const validUntil = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  const made = (await send(`/inquiries/${inquiry.id}/quotations`, { offers, currency: "USD", validUntil, margin: 15 })).quotations as { id: string; refNo: string }[];
  return { id: inquiry.id as string, customer: customer.name as string, made };
}

test("a draft's Send window includes the deal's other ready drafts, and marks them sent together", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const deal = await dealWithDrafts(page);
  const [a, b, c] = deal.made;

  await page.goto(`/inquiries/${deal.id}/quotations/${a!.id}`);
  await page.getByRole("button", { name: "Send R1" }).click();
  const send = page.getByRole("dialog", { name: `Send ${a!.refNo} R1 to ${deal.customer}` });
  const include = send.getByRole("group", { name: "Include" });
  // This one always goes; B is ready and ticked; C (own prices, still 0) is not offered.
  await expect(include.getByRole("checkbox", { name: new RegExp(`${a!.refNo} R1`) })).toBeChecked();
  await expect(include.getByRole("checkbox", { name: new RegExp(`${a!.refNo} R1`) })).toBeDisabled();
  await expect(include.getByRole("checkbox", { name: new RegExp(`${b!.refNo} R1`) })).toBeChecked();
  await expect(include.getByText(`${c!.refNo} R1`)).toHaveCount(0);
  const subject = send.getByLabel("Subject");
  await expect(subject).toHaveValue(new RegExp(`^Quotations ${a!.refNo} and B — `));
  await expect(send.getByRole("button", { name: "Send 2" })).toBeVisible();
  expect(await accessibilityProblems(page), "the Send window meets WCAG 2.2 AA").toEqual([]);

  // Unticked, it is one quotation again; ticked, two.
  await include.getByRole("checkbox", { name: new RegExp(`${b!.refNo} R1`) }).uncheck();
  await expect(subject).toHaveValue(new RegExp(`^Quotation ${a!.refNo} R1 — `));
  await expect(send.getByRole("button", { name: "Send email" })).toBeVisible();
  await include.getByRole("checkbox", { name: new RegExp(`${b!.refNo} R1`) }).check();

  // Sent another way: both are marked sent, by WhatsApp.
  await send.getByText("I sent it myself").click();
  await expect(send.getByText(new RegExp(`${a!.refNo} R1 and B R1 become Sent: by WhatsApp`))).toBeVisible();
  await send.getByRole("button", { name: "Mark 2 as sent" }).click();
  await expect(send).toBeHidden();
  await expect(page.getByText("2 quotations marked as sent")).toBeVisible();

  const q = await (await page.request.get(`/api/inquiries/${deal.id}/quotation`)).json();
  const status = (refNo: string) => q.quotations.find((x: { refNo: string }) => x.refNo === refNo).revisions[0];
  expect(status(a!.refNo)).toMatchObject({ status: "sent", sentVia: "whatsapp" });
  expect(status(b!.refNo)).toMatchObject({ status: "sent", sentVia: "whatsapp" });
  expect(status(c!.refNo)).toMatchObject({ status: "draft" });
  expect(errors).toEqual([]);
});

test("each quotation and each offer has its own page: the lists open them, ‹ › moves between them, Edit says what it edits", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const deal = await dealWithDrafts(page);
  const [a, b] = deal.made;

  // The Quotations tab is a list; a row opens the quotation's own page, without the inquiry's tabs.
  await page.goto(`/inquiries/${deal.id}/quotation`);
  await page.getByRole("link", { name: new RegExp(`^${b!.refNo}`) }).click();
  await expect(page).toHaveURL((u) => u.pathname === `/inquiries/${deal.id}/quotations/${b!.id}`);
  await expect(page.getByRole("heading", { level: 1, name: b!.refNo })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Inquiry" })).toHaveCount(0);
  // Every Edit has its word and says what it edits.
  await expect(page.getByRole("button", { name: "Edit lines" })).toBeVisible();
  for (const part of ["delivery", "payment", "warranty and conditions"]) await expect(page.getByRole("button", { name: `Edit ${part}` })).toBeVisible();
  // Beside it: its revisions, the offer it came from, who it goes to.
  await expect(page.getByRole("region", { name: "Revisions" }).getByRole("link", { name: /R1/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "Goes to" })).toContainText(deal.customer);
  expect(await accessibilityProblems(page), "a quotation's page meets WCAG 2.2 AA").toEqual([]);
  // ‹ › through the inquiry's quotations.
  await page.getByRole("link", { name: `Previous quotation, ${a!.refNo}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: a!.refNo })).toBeVisible();
  await page.getByRole("link", { name: `Next quotation, ${b!.refNo}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: b!.refNo })).toBeVisible();

  // Its offer has its own page too: the tax, and the quotations made from it.
  await page.getByRole("region", { name: "From the offer" }).getByRole("link", { name: /Open the offer/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Shenjing/ })).toBeVisible();
  // Its tax, said once: in Details beside the lines.
  await expect(page.getByRole("region", { name: "Details" })).toContainText(/13% · included in the prices/);
  await expect(page.getByRole("region", { name: "Quoted in" }).getByRole("link", { name: new RegExp(b!.refNo) })).toBeVisible();
  expect(await accessibilityProblems(page), "an offer's page meets WCAG 2.2 AA").toEqual([]);
  // The offers tab shows each offer's tax, and opens its page.
  await page.getByRole("link", { name: /Factory offers/ }).last().click();
  await expect(page).toHaveURL((u) => u.pathname === `/inquiries/${deal.id}/sourcing`);
  await expect(page.getByText("tax incl. 13%", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  // An old link to an offer opened in place lands on its page.
  await page.goto(`/inquiries/${deal.id}/quotation?q=${a!.id}`);
  await expect(page).toHaveURL((u) => u.pathname === `/inquiries/${deal.id}/quotations/${a!.id}`);
  expect(errors).toEqual([]);
});
