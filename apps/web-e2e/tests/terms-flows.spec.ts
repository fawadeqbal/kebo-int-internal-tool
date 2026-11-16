import { expect, test, type Page } from "@playwright/test";
import { accessibilityProblems, watchErrors } from "./check";

/**
 * Design "RFQ Desk — terms that travel" (16 Nov 2026), step 1, done in a browser: the factory offer and the
 * quotation are typed in the same four groups (Delivery · Payment · Warranty · Conditions); the quotation shows
 * each option's lead time beside what its factory gives and says where we promise more; the paper prints the parts.
 */

/** A deal of its own (through the API, as the signed-in person): a customer, one item, one factory's offer with its words only. */
async function newDeal(page: Page) {
  const tag = Date.now().toString(36);
  const send = async (url: string, data: object) => {
    const r = await page.request.post(`/api${url}`, { data });
    expect(r.ok(), `${url}: ${await r.text()}`).toBe(true);
    return r.json();
  };
  const me = await (await page.request.get("/api/auth/me")).json();
  const customer = await send("/customers", { name: `Terms Pharma ${tag}`, country: "PK", contacts: [{ name: "Imran", email: `imran-${tag}@terms.test` }] });
  const inquiry = await send("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me.id, items: [{ description: "Blister packing machine", quantity: 1, unit: "set" }] });
  const item = (await (await page.request.get(`/api/inquiries/${inquiry.id}`)).json()).items[0].id;
  const received = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  const offer = await send(`/inquiries/${inquiry.id}/factory-quotes`, {
    newFactoryName: `Jinan Terms ${tag}`,
    receivedOn: received,
    currency: "CNY",
    basis: "FOB",
    basisPlace: "Qingdao",
    lines: [{ requestedItemId: item, description: "Blister packing machine", model: "DPP-260", quantity: 1, unit: "set", unitPrice: 186000 }],
  });
  return { id: inquiry.id as string, offer: offer.id as string };
}

test("the offer and the quotation in four groups; the quotation checked against the factory; the paper prints the parts", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const deal = await newDeal(page);

  // The factory's offer: its lead time as days from a moment, its payment as parts, its warranty as months.
  await page.goto(`/inquiries/${deal.id}/sourcing?offer=${deal.offer}#offer`);
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const offer = page.getByRole("dialog");
  for (const group of ["Who and when", "Price", "Delivery", "Payment", "Warranty", "Conditions and their quotation"])
    await expect(offer.locator("legend", { hasText: group }).first()).toBeVisible();
  await offer.getByLabel("Lead time").fill("30");
  await offer.getByRole("button", { name: "50 / 50" }).click();
  await expect(offer.getByText("Adds up: 100%")).toBeVisible();
  await offer.getByLabel("Months").fill("12");
  expect(await accessibilityProblems(page), "the offer's form meets WCAG 2.2 AA").toEqual([]);
  await offer.getByRole("button", { name: /Save/ }).click();
  await expect(offer).toBeHidden();
  // The offer's card, in the same groups.
  await expect(page.locator("dd", { hasText: "30 days after the advance" })).toBeVisible();
  await expect(page.locator("dd", { hasText: "50% when we order · 50% when ready" })).toBeVisible();
  await expect(page.locator("dd", { hasText: "12 months from shipment." })).toBeVisible();

  // The quotation: the factory's lead time beside ours, a usual payment in one tap, the warranty checked.
  await page.goto(`/inquiries/${deal.id}/quotation`);
  await page.getByRole("button", { name: /Make the quotation/ }).first().click();
  const form = page.getByRole("dialog", { name: /New quotation R1/ });
  const leads = form.getByRole("table", { name: "Lead time of each option" });
  await expect(leads.getByLabel("Option A lead time", { exact: true })).toHaveValue("30");
  // (On a wide screen the check is in its own column; on a phone under the boxes.)
  await expect(leads.getByText(/gives 30 days after the advance · nothing to spare/).filter({ visible: true })).toBeVisible();
  await leads.getByLabel("Option A lead time", { exact: true }).fill("25");
  await expect(leads.getByText(/needs 30 days after the advance: 5 days more than we promise/).filter({ visible: true })).toBeVisible();
  await leads.getByLabel("Option A lead time", { exact: true }).fill("45");
  await form.getByRole("button", { name: "30 · 60 · 10 after the site test" }).click();
  await form.getByLabel("Counted from").selectOption("sat");
  await expect(form.getByText(/the last 2 months of ours are not covered by the factory/)).toBeVisible();
  expect(await accessibilityProblems(page), "the quotation's form meets WCAG 2.2 AA").toEqual([]);
  await form.getByRole("button", { name: /Save draft/ }).click();
  await expect(form).toBeHidden();

  // Before it is sent, the quotation says what to look at; its card has the parts.
  await expect(page.getByText(/Before you send R1/)).toBeVisible();
  await expect(page.getByText(/the last 2 months of ours are not covered/).filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator("dd", { hasText: "30% with the order · 60% before shipment · 10% after the site acceptance test (SAT)" })).toBeVisible();

  // The paper prints the parts and the warranty.
  const quotation = await (await page.request.get(`/api/inquiries/${deal.id}/quotation`)).json();
  await page.goto(`/print/revisions/${quotation.revisions[0].id}`);
  await expect(page.getByText("Our usual payment is made by 30% Advance deposit, 60% before shipment and 10% after the site acceptance test (SAT).")).toBeVisible();
  await expect(page.getByText(/Warranty: 12 months from the site acceptance test \(SAT\)/)).toBeVisible();
  await expect(page.getByText("Delivery: 45 days after the deposit")).toBeVisible();
  expect(errors).toEqual([]);
});
