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
  const offer = async (factory: string, price: number) =>
    (
      await send(`/inquiries/${inquiry.id}/factory-quotes`, {
        newFactoryName: `${factory} ${tag}`,
        receivedOn: received,
        currency: "USD",
        lines: [{ requestedItemId: item, description: "Blister packing machine", quantity: 1, unit: "set", unitPrice: price }],
      })
    ).id as string;
  const offers = [await offer("Jinan", 24000), await offer("Shenjing", 22500), null];
  const validUntil = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  const made = (await send(`/inquiries/${inquiry.id}/quotations`, { offers, currency: "USD", validUntil, margin: 15 })).quotations as { id: string; refNo: string }[];
  return { id: inquiry.id as string, customer: customer.name as string, made };
}

test("a draft's Send window includes the deal's other ready drafts, and marks them sent together", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const deal = await dealWithDrafts(page);
  const [a, b, c] = deal.made;

  await page.goto(`/inquiries/${deal.id}/quotation?q=${a!.id}`);
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
