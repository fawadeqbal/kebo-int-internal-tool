import type { INestApplication } from "@nestjs/common";
import { addDays } from "@kebo/utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";
import { Clock } from "../src/common/time/clock.service";

/**
 * Design "RFQ Desk — terms that travel" (16 Nov 2026), step 2: accepting a quotation copies what was agreed with
 * the customer into the order — its plan is the quotation's parts (30 · 60 · 10 after the site test), its lead
 * time works out the ship-by date (once the deposit is in, or from the order), its warranty and conditions are
 * the order's own — and the order's papers print them. An order made before keeps its papers as they were.
 */
describe("agreed with the customer: the quotation's terms in the order", () => {
  let app: INestApplication;
  let sana: string;
  let manager: string;
  let today = "";
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    today = app.get(Clock).today();
  });

  afterAll(async () => {
    await app?.close();
  });

  /** A deal with one factory offer, quoted with these terms and accepted: the order. */
  async function accepted(terms: Record<string, unknown>, lead: { leadDays: number; leadFrom: string }) {
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const customer = (
      await api(app, sana)
        .post("/customers", { name: `Agreed Pharma ${tag} ${Math.random().toString(36).slice(2, 6)}`, country: "PK", contacts: [{ name: "Imran", email: `i-${tag}-${Math.random().toString(36).slice(2, 6)}@agreed.test` }] })
        .expect(201)
    ).body;
    const inquiryId = (
      await api(app, sana)
        .post("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me, items: [{ description: "Blister packing machine", quantity: 1, unit: "set" }] })
        .expect(201)
    ).body.id;
    const item = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body.items[0].id;
    await api(app, sana)
      .post(`/inquiries/${inquiryId}/factory-quotes`, {
        newFactoryName: `Jinan Agreed ${tag}`,
        receivedOn: addDays(today, -3),
        currency: "USD",
        leadDays: 30,
        leadFrom: "after_payment",
        lines: [{ requestedItemId: item, description: "Blister packing machine", quantity: 1, unit: "set", unitPrice: 20000 }],
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/draft`).expect(200)).body;
    const r = (
      await api(app, sana)
        .post(`/inquiries/${inquiryId}/quotation/revisions`, {
          ...draft,
          ...terms,
          options: [{ ...draft.options[0], prices: [{ lineId: draft.options[0].prices[0].lineId, unitPrice: 30000 }], ...lead }],
        })
        .expect(201)
    ).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "accepted", route: "informal" }).expect(200);
    const deal = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body;
    return deal.orders[0].id as string;
  }
  const money = async (id: string) => (await api(app, sana).get(`/orders/${id}/money`).expect(200)).body;
  const order = async (id: string) => (await api(app, sana).get(`/orders/${id}`).expect(200)).body;
  const contract = async (id: string) => (await api(app, sana).get(`/orders/${id}/papers/sales-contract/doc`).expect(200)).body;

  const THREE = {
    paymentParts: [
      { label: "Deposit 30%", percent: 30, rule: "on_order" },
      { label: "Before shipment 60%", percent: 60, rule: "before_shipment" },
      { label: "After the site test 10%", percent: 10, rule: "after_sat", days: 15 },
    ],
    warrantyMonths: 12,
    warrantyFrom: "sat",
    warranty: "parts and service",
    deliveryTerms: "Export wooden cases.",
    paymentTerms: "Bank charges outside China are for the buyer.",
  };

  let threeId = "";

  it("the plan is the quotation's parts, each dated by its rule", async () => {
    threeId = await accepted(THREE, { leadDays: 45, leadFrom: "after_payment" });
    const m = await money(threeId);
    expect(m.plan.items.map((i: { label: string; amount: string; dueRule: string | null; dueDays: number | null }) => [i.label, i.amount, i.dueRule, i.dueDays])).toEqual([
      ["Deposit 30%", "9000.00", "fixed", null],
      ["Before shipment 60%", "18000.00", "on_ready", null],
      ["After the site test 10%", "3000.00", "after_sat", 15],
    ]);
    // Not dated until the site test is done.
    expect(m.plan.items[2].dueOn).toBeNull();
  });

  it("the ship-by date is worked out once the deposit is in; typed by hand, it stays", async () => {
    expect((await order(threeId)).shipBy).toBeNull();
    const deposit = (await money(threeId)).plan.items[0];
    await api(app, manager).post(`/orders/${threeId}/payments`, { kind: "deposit", amount: deposit.amount, currency: "USD", paidOn: today }).expect(201);
    expect((await order(threeId)).shipBy).toBe(addDays(today, 45));
    // Typed by hand: a later payment no longer moves it.
    await api(app, sana).patch(`/orders/${threeId}/details`, { shipBy: addDays(today, 60) }).expect(200);
    await api(app, manager).post(`/orders/${threeId}/payments`, { kind: "balance", amount: 100, currency: "USD", paidOn: today }).expect(201);
    expect((await order(threeId)).shipBy).toBe(addDays(today, 60));
  });

  it("counted from the order, the ship-by date is there at once", async () => {
    const id = await accepted({}, { leadDays: 40, leadFrom: "after_order" });
    expect((await order(id)).shipBy).toBe(addDays(today, 40));
  });

  it("the order's papers print the parts, the lead time, the warranty and the conditions agreed", async () => {
    const doc = (await contract(threeId)).doc as { bullets: string[] };
    const text = doc.bullets.join("\n");
    expect(text).toContain("Our usual payment is made by 30% Advance deposit, 60% before shipment and 10% 15 days after the site acceptance test (SAT).");
    expect(text).toContain("Delivery: 45 days after the deposit.");
    expect(text).toContain("Warranty: 12 months from the site acceptance test (SAT), parts and service.");
    expect(text).toContain("Export wooden cases.");
  });

  it("a deposit and one balance build the plan from the route, as before", async () => {
    const id = await accepted({ paymentParts: [{ label: "Deposit 30%", percent: 30, rule: "on_order" }, { label: "Balance 70%", percent: 70, rule: "against_bl_copy" }] }, { leadDays: 30, leadFrom: "after_payment" });
    const m = await money(id);
    expect(m.plan.items.map((i: { label: string; part: string | null }) => i.label)).toEqual(["Deposit 30%", "Balance against B/L copy"]);
    const text = ((await contract(id)).doc as { bullets: string[] }).bullets.join("\n");
    expect(text).toContain("Our usual payment is made by 30% Advance deposit and 70% against B/L copy.");
  });
});
