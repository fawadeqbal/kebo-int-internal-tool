import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/**
 * Design "RFQ Desk — terms that travel" (16 Nov 2026), step 1: the factory offer and the quotation keep their
 * terms in the same four groups as facts — a lead time as days from a moment, the payment as parts, a warranty
 * as months from a moment — with the words they print worked out from them. An older client that sends only
 * the words, the advance % or the deposit and balance is understood as before, and nothing it leaves out is lost.
 */
describe("terms in four groups: the factory offer and the quotation", () => {
  let app: INestApplication;
  let sana: string;
  let inquiryId: string;
  let itemId: string;
  let offerId: string;
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const customer = (
      await api(app, sana)
        .post("/customers", { name: `Al-Shifa Pharma ${tag}`, country: "PK", contacts: [{ name: "Imran", email: `i-${tag}@alshifa.test` }] })
        .expect(201)
    ).body;
    inquiryId = (
      await api(app, sana)
        .post("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me, items: [{ description: "Blister packing machine", quantity: 1, unit: "set" }] })
        .expect(201)
    ).body.id;
    itemId = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body.items[0].id;
  });

  afterAll(async () => {
    await app?.close();
  });

  const offer = async () => (await api(app, sana).get(`/factory-quotes/${offerId}`).expect(200)).body;

  it("a factory offer keeps its lead time as days from a moment, its payment as parts and its warranty as months", async () => {
    offerId = (
      await api(app, sana)
        .post(`/inquiries/${inquiryId}/factory-quotes`, {
          newFactoryName: `Jinan Pharma Machinery ${tag}`,
          reference: "JP-2611-08",
          receivedOn: "2026-11-12",
          currency: "CNY",
          basis: "FOB",
          basisPlace: "Qingdao",
          leadDays: 30,
          leadFrom: "after_payment",
          paymentParts: [
            { label: "Advance 30%", percent: 30, rule: "on_order" },
            { label: "Balance 70%", percent: 70, rule: "on_ready" },
          ],
          warrantyMonths: 12,
          warrantyFrom: "shipment",
          warranty: "Parts, not labour",
          moq: "1 set",
          lines: [{ requestedItemId: itemId, description: "Blister packing machine", model: "DPP-260", quantity: 1, unit: "set", unitPrice: 186000 }],
        })
        .expect(201)
    ).body.id;
    const q = await offer();
    expect(q).toMatchObject({
      leadTime: "30 days after the advance",
      leadDays: 30,
      leadFrom: "after_payment",
      advancePercent: 30,
      warranty: "Parts, not labour",
      warrantyMonths: 12,
      warrantyFrom: "shipment",
    });
    expect(q.paymentParts).toEqual([
      { label: "Advance 30%", percent: 30, rule: "on_order", days: null },
      { label: "Balance 70%", percent: 70, rule: "on_ready", days: null },
    ]);
    // Parts that do not add up are refused, saying so.
    const refused = await api(app, sana)
      .put(`/factory-quotes/${offerId}`, { factoryId: q.factory.id, receivedOn: q.receivedOn, currency: "CNY", paymentParts: [{ label: "Advance", percent: 50, rule: "on_order" }] })
      .expect(422);
    expect(JSON.stringify(refused.body)).toMatch(/add up to 100%/);
  });

  it("an older form that leaves the new terms out keeps them; one that sends only the advance % replaces the parts", async () => {
    const q = await offer();
    const head = { factoryId: q.factory.id, receivedOn: q.receivedOn, currency: "CNY", basis: "FOB", basisPlace: "Qingdao", moq: "1 set", leadTime: q.leadTime };
    await api(app, sana).put(`/factory-quotes/${offerId}`, head).expect(200);
    expect(await offer()).toMatchObject({ leadDays: 30, leadTime: "30 days after the advance", warrantyMonths: 12, warrantyFrom: "shipment", advancePercent: 30 });
    expect((await offer()).paymentParts).toHaveLength(2);
    await api(app, sana).put(`/factory-quotes/${offerId}`, { ...head, advancePercent: 40 }).expect(200);
    const after = await offer();
    expect(after.advancePercent).toBe(40);
    expect(after.paymentParts.map((p: { percent: number; rule: string }) => `${p.percent} ${p.rule}`)).toEqual(["40 on_order", "60 on_ready"]);
    // Back to 30/70 for what follows; and a lead time cleared keeps its words only when there are no days.
    await api(app, sana)
      .put(`/factory-quotes/${offerId}`, { ...head, paymentParts: [{ label: "Advance 30%", percent: 30, rule: "on_order" }, { label: "Balance 70%", percent: 70, rule: "on_ready" }] })
      .expect(200);
    expect((await offer()).advancePercent).toBe(30);
  });

  it("a new quotation starts from the company's payment as parts and its usual warranty as months", async () => {
    const draft = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/draft`).expect(200)).body;
    expect(draft.paymentRoute).toBeNull();
    // No parts kept yet: the company's deposit and balance (the form shows them as parts).
    expect(draft.paymentParts).toBeNull();
    expect(draft).toMatchObject({ depositPercent: 30, balanceTerms: "before_shipment" });
    // The demo company's usual warranty: "Warranty: 12 months from the site acceptance test (SAT), parts and service."
    expect(draft).toMatchObject({ warrantyMonths: 12, warrantyFrom: "sat", warranty: "parts and service" });
    // The option promises the factory's days, from the deposit.
    expect(draft.options[0]).toMatchObject({ factoryQuoteId: offerId, leadDays: 30, leadFrom: "after_payment", leadTime: "30 days after the deposit" });
    // What the offer gives, for the checks beside each option.
    const offers = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/offers?currency=USD`).expect(200)).body;
    expect(offers.offers[0].terms).toMatchObject({ leadDays: 30, leadFrom: "after_payment", warrantyMonths: 12, warrantyFrom: "shipment" });
    expect(offers.offers[0].terms.parts).toHaveLength(2);
  });

  it("a quotation's parts give its deposit and balance; its route, port and warranty are kept; the paper's facts come back", async () => {
    const draft = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/draft`).expect(200)).body;
    const r = (
      await api(app, sana)
        .post(`/inquiries/${inquiryId}/quotation/revisions`, {
          ...draft,
          portOfDischarge: "Karachi",
          paymentRoute: "informal",
          paymentParts: [
            { label: "Deposit 30%", percent: 30, rule: "on_order" },
            { label: "Before shipment 60%", percent: 60, rule: "before_shipment" },
            { label: "After the site test 10%", percent: 10, rule: "after_sat", days: 15 },
          ],
          warrantyMonths: 12,
          warrantyFrom: "sat",
          warranty: "parts and service",
          options: [{ ...draft.options[0], leadDays: 45, leadFrom: "after_payment", leadTime: "anything" }],
        })
        .expect(201)
    ).body;
    expect(r).toMatchObject({
      depositPercent: 30,
      balanceTerms: "before_shipment",
      paymentRoute: "informal",
      portOfDischarge: "Karachi",
      warrantyMonths: 12,
      warrantyFrom: "sat",
      warranty: "parts and service",
      leadTime: "45 days after the deposit",
    });
    expect(r.paymentParts.map((p: { percent: number; rule: string; days: number | null }) => `${p.percent} ${p.rule} ${p.days}`)).toEqual([
      "30 on_order null",
      "60 before_shipment null",
      "10 after_sat 15",
    ]);
    expect(r.options[0]).toMatchObject({ leadDays: 45, leadFrom: "after_payment", leadTime: "45 days after the deposit" });
    expect(r.options[0].factoryTerms).toMatchObject({ leadDays: 30, warrantyMonths: 12, warrantyFrom: "shipment" });
    // Its values come back as the editor sends them, so a save of one field loses none of them.
    const values = (await api(app, sana).get(`/revisions/${r.id}/values`).expect(200)).body;
    expect(values).toMatchObject({ portOfDischarge: "Karachi", paymentRoute: "informal", warrantyMonths: 12, warrantyFrom: "sat" });
    expect(values.paymentParts).toHaveLength(3);
    expect(values.options[0]).toMatchObject({ leadDays: 45, leadFrom: "after_payment" });
    await api(app, sana).put(`/revisions/${r.id}`, { ...values, notes: "Prices include export wooden cases." }).expect(200);
    const again = (await api(app, sana).get(`/revisions/${r.id}`).expect(200)).body;
    expect(again).toMatchObject({ notes: "Prices include export wooden cases.", portOfDischarge: "Karachi", paymentRoute: "informal", warrantyMonths: 12 });
    expect(again.paymentParts).toHaveLength(3);
    // An older client: the deposit and balance it sends, read as parts.
    const { paymentParts: _p, paymentRoute: _r, portOfDischarge: _d, warrantyMonths: _m, warrantyFrom: _f, ...older } = values;
    await api(app, sana).put(`/revisions/${r.id}`, { ...older, depositPercent: 50, balanceTerms: "against_bl_copy" }).expect(200);
    const old = (await api(app, sana).get(`/revisions/${r.id}`).expect(200)).body;
    expect(old).toMatchObject({ depositPercent: 50, balanceTerms: "against_bl_copy", paymentRoute: "informal", portOfDischarge: "Karachi", warrantyMonths: 12 });
    expect(old.paymentParts.map((p: { percent: number; rule: string }) => `${p.percent} ${p.rule}`)).toEqual(["50 on_order", "50 against_bl_copy"]);
  });

  it("accepting starts the order on the route the quotation chose", async () => {
    const values = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation`).expect(200)).body.revisions[0];
    const id = values.id;
    // After arrival implies no route; the quotation says informal.
    const v = (await api(app, sana).get(`/revisions/${id}/values`).expect(200)).body;
    await api(app, sana)
      .put(`/revisions/${id}`, { ...v, paymentParts: [{ label: "Deposit 30%", percent: 30, rule: "on_order" }, { label: "Balance 70%", percent: 70, rule: "after_arrival" }], paymentRoute: "informal" })
      .expect(200);
    await api(app, sana).post(`/revisions/${id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${id}/status`, { to: "accepted" }).expect(200);
    const deal = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body;
    const m = (await api(app, sana).get(`/orders/${deal.orders[0].id}/money`).expect(200)).body;
    expect(m.route.route).toBe("informal");
  });
});
