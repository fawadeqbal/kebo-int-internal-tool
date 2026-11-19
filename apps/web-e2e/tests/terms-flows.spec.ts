import { expect, test, type Page } from "@playwright/test";
import { accessibilityProblems, answerWhy, watchErrors } from "./check";

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

test("the offer and the quotation in four groups; the quotation checked against the supplier; the document prints the parts", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const deal = await newDeal(page);

  // The factory's offer: its lead time as days from a moment, its payment as parts, its warranty as months.
  // (The old link to the offer on the Factory offers tab opens the offer's own page.)
  await page.goto(`/inquiries/${deal.id}/sourcing?offer=${deal.offer}#offer`);
  await expect(page).toHaveURL(new RegExp(`/inquiries/${deal.id}/offers/${deal.offer}`));
  await page.getByRole("button", { name: /^More for .*offer/ }).click();
  await page.getByRole("menuitem", { name: "Edit offer" }).click();
  const offer = page.getByRole("dialog", { name: "Edit offer" });
  // The offer in steps (design 18 Nov): Factory · Prices · Delivery & payment · Warranty & conditions, then Changes.
  const rail = offer.getByRole("navigation", { name: "Steps" });
  for (const step of ["Supplier", "Prices", "Delivery & payment", "Warranty & conditions", "Changes"]) await expect(rail.getByRole("button", { name: new RegExp(step) })).toBeVisible();
  await expect(rail.getByRole("button", { name: /Supplier/ })).toHaveAttribute("aria-current", "step");
  await rail.getByRole("button", { name: /Prices/ }).click();
  await expect(offer.getByRole("grid")).toContainText("DPP-260");
  await offer.getByRole("button", { name: /^Next/ }).click();
  await offer.getByLabel("Lead time").fill("30");
  await offer.getByRole("button", { name: "50 / 50" }).click();
  await expect(offer.getByText("Adds up: 100%")).toBeVisible();
  await offer.getByRole("button", { name: /^Next/ }).click();
  await offer.getByLabel("Months").fill("12");
  expect(await accessibilityProblems(page), "the offer's form meets WCAG 2.2 AA").toEqual([]);
  await offer.getByRole("button", { name: /^Next/ }).click();
  await offer.getByRole("button", { name: /^Save \d+ changes/ }).click();
  await answerWhy(page, "Supplier changed its terms");
  await expect(offer).toBeHidden();
  // The offer's page: a box per part, the same as its steps.
  await expect(page.getByRole("region", { name: "Delivery & payment", exact: true })).toContainText("30 days after the deposit");
  await expect(page.getByRole("region", { name: "Delivery & payment", exact: true })).toContainText("50% when we order · 50% when ready");
  await expect(page.getByRole("region", { name: "Warranty & conditions", exact: true })).toContainText("12 months from shipment");

  // The quotation: New quotations makes its draft from the offer; a pencil opens the draft's steps window on its
  // step, where the factory's lead time is beside ours, a usual payment is one tap, and the warranty is checked.
  await page.goto(`/inquiries/${deal.id}/quotation`);
  await page.getByRole("button", { name: "New quotations" }).first().click();
  const make = page.getByRole("dialog", { name: "New quotations" });
  await expect(make.getByRole("checkbox").first()).toBeChecked();
  expect(await accessibilityProblems(page), "New quotations meets WCAG 2.2 AA").toEqual([]);
  await make.getByRole("button", { name: /Make the draft/ }).click();
  await expect(make).toBeHidden();
  // Edit on Delivery & payment opens only that box (design 17 Nov): no steps, no "All steps"; Edit all (⋯) has every step.
  await page.getByRole("button", { name: "Edit delivery and payment" }).click();
  const part = page.getByRole("dialog", { name: /^Delivery & payment · QUO-\d{4}-\d{4}-A R1/ });
  await expect(part.getByRole("navigation", { name: "Steps" })).toHaveCount(0);
  const leads = part.getByRole("table", { name: "Lead time of each option" });
  // The supplier's 30 days plus the company's 7 spare days (Settings), so a late supplier is not late for the customer.
  await expect(leads.getByLabel("Option A lead time", { exact: true })).toHaveValue("37");
  // (On a wide screen the check is in its own column; on a phone under the boxes.)
  await expect(leads.getByText(/gives 30 days after the deposit · 7 days to spare/).filter({ visible: true })).toBeVisible();
  await leads.getByLabel("Option A lead time", { exact: true }).fill("25");
  await expect(leads.getByText(/needs 30 days after the deposit: 5 days more than we promise/).filter({ visible: true })).toBeVisible();
  await leads.getByLabel("Option A lead time", { exact: true }).fill("45");
  expect(await accessibilityProblems(page), "one part of the quotation meets WCAG 2.2 AA").toEqual([]);
  await expect(part.getByRole("button", { name: "All steps" })).toHaveCount(0);
  await part.getByRole("button", { name: "Save", exact: true }).click();
  await expect(part).toBeHidden();
  await page.getByRole("button", { name: /^More for QUO-/ }).filter({ visible: true }).first().click();
  await page.getByRole("menuitem", { name: "Edit all" }).click();
  const form = page.getByRole("dialog", { name: /Edit · QUO-\d{4}-\d{4}-A R1/ });
  const steps = form.getByRole("navigation", { name: "Steps" });
  await steps.getByRole("button", { name: /Delivery/ }).click();
  await expect(steps.getByRole("button", { name: /Delivery/ })).toHaveAttribute("aria-current", "step");
  // What was saved in the part is there.
  await expect(form.getByLabel("Option A lead time", { exact: true })).toHaveValue("45");
  await steps.getByRole("button", { name: /Payment/ }).click();
  await form.getByRole("button", { name: "30 · 60 · 10 after the site test" }).click();
  await steps.getByRole("button", { name: /Warranty & conditions/ }).click();
  await form.getByLabel("Counted from").selectOption("sat");
  await expect(form.getByText(/the last 2 months of ours are not covered by the supplier/)).toBeVisible();
  expect(await accessibilityProblems(page), "the quotation's form meets WCAG 2.2 AA").toEqual([]);
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toBeHidden();

  // Before it is sent, the quotation says what to look at; its Delivery & payment box has the parts.
  await expect(page.getByText(/Before you send R1/)).toBeVisible();
  await expect(page.getByText(/the last 2 months of ours are not covered/).filter({ visible: true }).first()).toBeVisible();
  const payment = page.getByRole("region", { name: "Delivery & payment", exact: true });
  for (const part of ["30% with the order", "60% before shipment", "10% after the site acceptance test (SAT)"]) await expect(payment.getByText(part)).toBeVisible();
  expect(await accessibilityProblems(page), "the Quotations tab meets WCAG 2.2 AA").toEqual([]);

  // The paper prints the parts and the warranty.
  const quotation = await (await page.request.get(`/api/inquiries/${deal.id}/quotation`)).json();
  await page.goto(`/print/revisions/${quotation.revisions[0].id}`);
  await expect(page.getByText("Our usual payment is made by 30% deposit, 60% before shipment and 10% after the site acceptance test (SAT).")).toBeVisible();
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
      { label: "Deposit 30%", percent: 30, rule: "on_order" },
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

  // The Overview, on the pieces (canvas row "The order on the same pieces"): the quotation's boxes — Customer (their
  // order) | Delivery & payment, the items, Warranty & conditions — copied from the quotation when it was accepted.
  await page.goto(`/orders/${orderId}`);
  const theirs = page.getByRole("region", { name: "Customer", exact: true });
  await expect(theirs.locator("dd", { hasText: "AS/PO/2611" })).toBeVisible();
  const agreed = page.getByRole("region", { name: "Delivery & payment" });
  await expect(agreed.getByText("FOB Qingdao")).toBeVisible();
  await expect(agreed.getByText("45 days after the deposit")).toBeVisible();
  await expect(agreed.getByText("Worked out once the deposit is in")).toBeVisible();
  await expect(page.getByRole("region", { name: "Warranty & conditions" }).getByText(/^12 months/)).toBeVisible();
  // No list of stages: each stage's word is on its tab; the next step is the header's one strong button.
  await expect(page.getByRole("region", { name: "Where it stands" })).toHaveCount(0);
  await expect(page.locator("[data-record-top] [data-slot=primary]").getByRole("link", { name: "Record the deposit" })).toBeVisible();
  const items = page.getByRole("region", { name: "Items", exact: true });
  await expect(items.getByRole("columnheader", { name: "Where it is" })).toBeVisible();
  await expect(items.getByRole("gridcell", { name: "Not ordered yet" }).or(items.getByRole("cell", { name: "Not ordered yet" })).first()).toBeVisible();
  // The customer beside the factory is hidden for now (16 Nov 2026).
  await expect(page.getByRole("region", { name: "The customer and the supplier, side by side" })).toHaveCount(0);
  expect(await accessibilityProblems(page), "the order's Overview meets WCAG 2.2 AA").toEqual([]);

  // Its Edit opens only that box's part: a new port differs from the quotation, so it asks why; the reason goes with it.
  await agreed.getByRole("button", { name: "Edit delivery and payment" }).click();
  const form = page.getByRole("dialog", { name: "Delivery & payment" });
  for (const group of ["Delivery", "Payment"]) await expect(form.locator("legend", { hasText: group }).first()).toBeVisible();
  await expect(form.locator("legend", { hasText: "Warranty" })).toHaveCount(0);
  await expect(form.getByRole("link", { name: "Open the payment plan" })).toBeVisible();
  expect(await accessibilityProblems(page), "the Edit window meets WCAG 2.2 AA").toEqual([]);
  await form.locator("#agr-pod").fill("Karachi");
  await form.getByRole("button", { name: /^Save \d+ changes?$/ }).click();
  await form.getByRole("radio", { name: "Agreed a new port" }).click();
  await form.getByRole("button", { name: "Save with this reason" }).click();
  await expect(form).toBeHidden();
  await expect(agreed.getByText("Karachi")).toBeVisible();
  await expect(agreed.getByRole("link", { name: "Changed 1×" })).toBeVisible();
  // The warranty's Edit: only Warranty and Conditions; nothing changed is nothing to save.
  await page.getByRole("region", { name: "Warranty & conditions" }).getByRole("button", { name: "Edit the warranty and conditions" }).click();
  const cond = page.getByRole("dialog", { name: "Warranty & conditions" });
  await expect(cond.locator("legend", { hasText: "Warranty" }).first()).toBeVisible();
  await expect(cond.locator("#agr-pod")).toHaveCount(0);
  await cond.getByRole("button", { name: "Cancel" }).click();
  await expect(cond).toBeHidden();

  // The header's next step (accepted as T/T, the deposit not in) opens its tab and the window there that does it.
  await page.locator("[data-record-top] [data-slot=primary]").getByRole("link", { name: "Record the deposit" }).click();
  await expect(page).toHaveURL((u) => u.pathname === `/orders/${orderId}/payment` && !u.searchParams.has("do"));
  const pay = page.getByRole("dialog", { name: "Record a payment" });
  await expect(pay).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pay).toBeHidden();

  // Who the goods go to is on Shipping now; how the papers print, on Documents.
  await page.goto(`/orders/${orderId}/shipping`);
  const instructions = page.getByRole("region", { name: "Shipping instructions" });
  await expect(instructions.locator("dd", { hasText: deal.customer })).toBeVisible();
  await expect(instructions.getByText("Karachi")).toBeVisible();
  await page.goto(`/orders/${orderId}/documents`);
  await expect(page.getByRole("region", { name: "How the documents print" }).getByText("Agreed payment conditions")).toBeVisible();

  // The factory's side, in the same groups: its offer's terms until the purchase order is sent.
  await page.goto(`/orders/${orderId}/factory`);
  await expect(page.getByRole("region", { name: "Purchase order" }).getByText("Made from their offer")).toBeVisible();
  const factory = page.getByRole("region", { name: "Agreed with the supplier" });
  await expect(factory.getByText("30 days after the deposit")).toBeVisible();
  await expect(factory.getByText("12 months", { exact: true })).toBeVisible();
  expect(await accessibilityProblems(page), "the purchase order meets WCAG 2.2 AA").toEqual([]);
  await factory.getByRole("button", { name: "Change", exact: true }).click();
  const terms = page.getByRole("dialog", { name: /What we agreed with Jinan Terms/ });
  await expect(terms.getByText(/Not sent yet/)).toBeVisible();
  expect(await accessibilityProblems(page), "the supplier's Change window meets WCAG 2.2 AA").toEqual([]);
  await terms.locator("#fac-lead").fill("35");
  await terms.getByRole("button", { name: /^Save \d+ changes?$/ }).click();
  await expect(terms).toBeHidden();
  await expect(factory.getByText("35 days after the deposit")).toBeVisible();
  // The purchase order's paper prints it.
  await page.goto(`/print/orders/${orderId}/purchase-order`);
  await expect(page.getByText("Delivery: FOB Qingdao, ready 35 days after our deposit.")).toBeVisible();
  expect(errors).toEqual([]);
});
