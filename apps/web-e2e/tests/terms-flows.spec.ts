import { expect, test, type Page } from "@playwright/test";
import { accessibilityProblems, watchErrors } from "./check";

/**
 * Design "RFQ Desk — terms that travel" (16 Nov 2026), step 1, done in a browser: the factory offer and the
 * quotation are typed in the same four groups (Delivery · Payment · Warranty · Conditions); the quotation shows
 * each option's lead time beside what its factory gives and says where we promise more; the paper prints the parts.
 */

/** A deal of its own (through the API, as the signed-in person): a customer, one item, one factory's offer (its words only, unless more is given). */
async function newDeal(page: Page, more: object = {}) {
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
    ...more,
  });
  return { id: inquiry.id as string, offer: offer.id as string, customer: customer.name as string };
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

test("the order keeps what was agreed: their order, the agreed terms (a change asks why), the factory beside them; the shipping and paper settings in their tabs", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const deal = await newDeal(page, {
    leadDays: 30,
    leadFrom: "after_payment",
    paymentParts: [
      { label: "Advance 30%", percent: 30, rule: "on_order" },
      { label: "Balance 70%", percent: 70, rule: "on_ready" },
    ],
    warrantyMonths: 12,
    warrantyFrom: "shipment",
  });
  // Quoted with three parts, 12 months from the site test and 45 days after the deposit; accepted.
  const send = async (url: string, data: object) => {
    const r = await page.request.post(`/api${url}`, { data });
    expect(r.ok(), `${url}: ${await r.text()}`).toBe(true);
    return r.json();
  };
  const draft = await (await page.request.get(`/api/inquiries/${deal.id}/quotation/draft`)).json();
  const revision = await send(`/inquiries/${deal.id}/quotation/revisions`, {
    ...draft,
    incoterm: "FOB",
    incotermPlace: "Qingdao",
    paymentParts: [
      { label: "Deposit 30%", percent: 30, rule: "on_order" },
      { label: "Before shipment 60%", percent: 60, rule: "before_shipment" },
      { label: "After the site test 10%", percent: 10, rule: "after_sat" },
    ],
    warrantyMonths: 12,
    warrantyFrom: "sat",
    warranty: "parts and service",
    options: [{ ...draft.options[0], prices: [{ lineId: draft.options[0].prices[0].lineId, unitPrice: 30125 }], leadDays: 45, leadFrom: "after_payment" }],
  });
  await send(`/revisions/${revision.id}/status`, { to: "sent" });
  await send(`/revisions/${revision.id}/status`, { to: "accepted", route: "informal", customerRef: "AS/PO/2611" });
  const orderId = (await (await page.request.get(`/api/inquiries/${deal.id}`)).json()).orders[0].id as string;

  // The Overview: their order; what was agreed, copied from the quotation; the factory beside it.
  await page.goto(`/orders/${orderId}`);
  const theirs = page.getByRole("region", { name: "Their order" });
  await expect(theirs.locator("dd", { hasText: "AS/PO/2611" })).toBeVisible();
  const agreed = page.getByRole("region", { name: "Agreed with the customer" });
  await expect(agreed.getByText("FOB Qingdao")).toBeVisible();
  await expect(agreed.getByText("45 days after the deposit")).toBeVisible();
  await expect(agreed.getByText("Worked out once the deposit is in")).toBeVisible();
  await expect(agreed.getByText("12 months", { exact: true })).toBeVisible();
  const sides = page.getByRole("region", { name: "The customer and the factory, side by side" });
  await expect(sides.getByText("15 days to spare")).toBeVisible();
  await expect(sides.getByText("2 months not covered")).toBeVisible();
  await expect(sides.getByText(/ask Jinan Terms .* for 14 months/)).toBeVisible();
  expect(await accessibilityProblems(page), "the order's Overview meets WCAG 2.2 AA").toEqual([]);

  // Change: a new port differs from the quotation, so it asks why; the reason goes with it.
  await agreed.getByRole("button", { name: "Change", exact: true }).click();
  const form = page.getByRole("dialog", { name: `What we agreed with ${deal.customer}` });
  for (const group of ["Delivery", "Payment", "Warranty", "Conditions"]) await expect(form.locator("legend", { hasText: group }).first()).toBeVisible();
  await expect(form.getByRole("link", { name: "Open the payment plan" })).toBeVisible();
  expect(await accessibilityProblems(page), "the Change window meets WCAG 2.2 AA").toEqual([]);
  await form.locator("#agr-pod").fill("Karachi");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await form.getByRole("button", { name: "Agreed a new port" }).click();
  await form.getByRole("button", { name: "Save with this reason" }).click();
  await expect(form).toBeHidden();
  await expect(agreed.getByText("Karachi")).toBeVisible();
  await expect(agreed.getByRole("link", { name: "Changed 1×" })).toBeVisible();

  // Who the goods go to is on Shipping now; how the papers print, on Documents.
  await page.goto(`/orders/${orderId}/shipping`);
  const instructions = page.getByRole("region", { name: "Shipping instructions" });
  await expect(instructions.locator("dd", { hasText: deal.customer })).toBeVisible();
  await expect(instructions.getByText("Karachi")).toBeVisible();
  await page.goto(`/orders/${orderId}/documents`);
  await expect(page.getByRole("region", { name: "How the papers print" }).getByText("Agreed payment conditions")).toBeVisible();
  expect(errors).toEqual([]);
});
