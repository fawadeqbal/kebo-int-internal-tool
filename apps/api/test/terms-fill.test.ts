import type { INestApplication } from "@nestjs/common";
import { addDays } from "@kebo/utils";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";
import { Clock } from "../src/common/time/clock.service";
import { PrismaService } from "../src/database/prisma.service";
import { CompaniesService } from "../src/common/company/companies.service";
import { CompanyContext } from "../src/common/company/company-context";
import { TermsFillService } from "../src/modules/orders/terms-fill.service";

/**
 * Design "RFQ Desk — terms that travel" (16 Nov 2026), step 4: old records filled once. An order made before it kept
 * its own copy of what was agreed takes its quotation's (exactly what it showed and printed: nothing on a screen or
 * a paper changes), its typed ship-by date stays typed; a purchase order sent before it kept what was agreed with
 * the factory takes its offer's. Run again, nothing happens.
 */
describe("old records take the terms they were agreed on, once", () => {
  let app: INestApplication;
  let sana: string;
  let today = "";
  const tag = Date.now().toString(36);
  const asCompany = async <T>(fn: () => Promise<T>) => CompanyContext.run((await app.get(CompaniesService).byId(FIRST_COMPANY_ID))!, fn);

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    today = app.get(Clock).today();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("an old order and a purchase order sent before: the same on every screen and paper, now their own", async () => {
    // An order with three parts, a warranty from the site test, conditions; its purchase order sent.
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const customer = (
      await api(app, sana).post("/customers", { name: `Fill Pharma ${tag}`, country: "PK", contacts: [{ name: "Imran", email: `i-${tag}@fill.test` }] }).expect(201)
    ).body;
    const inquiryId = (
      await api(app, sana)
        .post("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me, items: [{ description: "Blister packing machine", quantity: 1, unit: "set" }] })
        .expect(201)
    ).body.id;
    const item = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body.items[0].id;
    await api(app, sana)
      .post(`/inquiries/${inquiryId}/factory-quotes`, {
        newFactoryName: `Jinan Fill ${tag}`,
        reference: "JF-1",
        receivedOn: addDays(today, -3),
        currency: "CNY",
        basis: "FOB",
        basisPlace: "Qingdao",
        leadDays: 30,
        leadFrom: "after_payment",
        paymentParts: [
          { label: "Advance 30%", percent: 30, rule: "on_order" },
          { label: "Balance 70%", percent: 70, rule: "on_ready" },
        ],
        paymentTerms: "By T/T to their account in Jinan.",
        warrantyMonths: 12,
        warrantyFrom: "shipment",
        lines: [{ requestedItemId: item, description: "Blister packing machine", quantity: 1, unit: "set", unitPrice: 186000 }],
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/draft`).expect(200)).body;
    const r = (
      await api(app, sana)
        .post(`/inquiries/${inquiryId}/quotation/revisions`, {
          ...draft,
          portOfDischarge: "Karachi",
          warrantyMonths: 12,
          warrantyFrom: "sat",
          warranty: "parts and service",
          deliveryTerms: "Export wooden cases.",
          paymentTerms: "Bank charges outside China are for the buyer.",
          notes: "Prices include loading at Qingdao.",
          options: [{ ...draft.options[0], prices: [{ lineId: draft.options[0].prices[0].lineId, unitPrice: 30125 }], leadDays: 45, leadFrom: "after_payment" }],
        })
        .expect(201)
    ).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "accepted", route: "informal" }).expect(200);
    const id = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body.orders[0].id as string;
    const po = (await api(app, sana).get(`/orders/${id}/purchase-orders`).expect(200)).body.items[0];
    await api(app, sana).post(`/orders/${id}/purchase-orders/${po.id}/send`, { sentOn: today, reason: "Needed this week" }).expect(200);

    // As before the copies were kept: nothing on the order or the purchase order, a ship-by date typed on it.
    const typedOn = addDays(today, 80);
    await asCompany(async () => {
      const db = app.get(PrismaService).db;
      await db.order.update({
        where: { id },
        data: {
          termsCopied: false,
          shipBy: new Date(`${typedOn}T00:00:00Z`),
          shipByTyped: false,
          portOfDischarge: null,
          leadDays: null,
          leadFrom: null,
          warrantyMonths: null,
          warrantyFrom: null,
          warrantyWords: null,
          deliveryConditions: null,
          paymentConditions: null,
          conditionsNotes: null,
        },
      });
      await db.purchaseOrder.update({
        where: { id: po.id },
        data: { termsCopied: false, basis: null, basisPlace: null, leadDays: null, leadFrom: null, warrantyMonths: null, warrantyFrom: null, warrantyWords: null, paymentNote: null, moq: null },
      });
    });
    const seen = async () => {
      const o = (await api(app, sana).get(`/orders/${id}`).expect(200)).body;
      const contract = (await api(app, sana).get(`/orders/${id}/papers/sales-contract/doc`).expect(200)).body.doc;
      const proforma = (await api(app, sana).get(`/orders/${id}/papers/commercial-invoice/doc`).expect(200)).body.doc;
      const poPaper = (await api(app, sana).get(`/orders/${id}/papers/purchase-order/doc`).expect(200)).body.doc;
      const pos = (await api(app, sana).get(`/orders/${id}/purchase-orders`).expect(200)).body.items[0];
      const { copied, shipByTyped, shipByFrom, ...agreed } = o.agreed;
      const { copied: poCopied, ...poAgreed } = pos.agreed;
      return { copied, shipByTyped, shipByFrom, poCopied, agreed, shipBy: o.shipBy, factoryTerms: o.factoryTerms, contract: contract.bullets, proforma: proforma.bullets, po: poPaper.bullets, poMeta: poPaper.meta, poAgreed };
    };
    const before = await seen();
    expect(before).toMatchObject({ copied: false, poCopied: false, shipBy: typedOn });
    expect(before.agreed).toMatchObject({ portOfDischarge: "Karachi", leadDays: 45, warrantyMonths: 12, warrantyFrom: "sat", deliveryConditions: "Export wooden cases." });

    const filled = await asCompany(() => app.get(TermsFillService).fillCompany());
    expect(filled.orders).toBeGreaterThanOrEqual(1);
    expect(filled.purchaseOrders).toBeGreaterThanOrEqual(1);
    const after = await seen();
    // Now their own; the ship-by date typed on it stays typed.
    expect(after).toMatchObject({ copied: true, poCopied: true, shipBy: typedOn, shipByTyped: true, shipByFrom: { by: "typed" } });
    // Every screen and paper says what it said — but an order without a port of discharge of its own takes the one
    // the quotation agreed (accepted before the order kept it): the papers name it now.
    expect(after.agreed).toEqual(before.agreed);
    expect(after.factoryTerms).toEqual(before.factoryTerms);
    const withPort = (bullets: unknown[]) =>
      bullets.map((b) => (typeof b === "string" ? b.replace("Shipment: by sea,", "Shipment: by sea to Karachi,").replace(/^Shipped\.$/, "Shipped to Karachi.") : b));
    expect(after.contract).toEqual(withPort(before.contract));
    expect(after.contract).toContain("Delivery: 45 days after the deposit.");
    expect(after.proforma).toEqual(withPort(before.proforma));
    expect(after.po).toEqual(before.po);
    expect(after.poMeta).toEqual(before.poMeta);
    expect(after.poAgreed).toEqual(before.poAgreed);
    // Run again: nothing to do for it.
    const again = await asCompany(() => app.get(TermsFillService).fillCompany());
    expect(again).toEqual({ orders: 0, purchaseOrders: 0 });
  });
});
