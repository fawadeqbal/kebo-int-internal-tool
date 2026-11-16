import type { INestApplication } from "@nestjs/common";
import { addDays, formatDate } from "@kebo/utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";
import { Clock } from "../src/common/time/clock.service";

/**
 * Design "RFQ Desk — terms that travel" (16 Nov 2026), step 3a: the factory's side of the order starts from its
 * offer — the plan from the offer's parts (an advance and the rest when ready stays the usual plan, as before), and
 * the purchase order says which offer it was made from and prints its delivery basis, lead time, warranty and the
 * payment note. An offer that says none of it prints as before.
 */
describe("the factory's side starts from its offer", () => {
  let app: INestApplication;
  let sana: string;
  let today = "";
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    today = app.get(Clock).today();
  });

  afterAll(async () => {
    await app?.close();
  });

  /** A deal with one factory offer (these terms), quoted and accepted: the order and its factory. */
  async function accepted(offer: Record<string, unknown>) {
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const n = Math.random().toString(36).slice(2, 6);
    const customer = (
      await api(app, sana)
        .post("/customers", { name: `Factory Terms ${tag} ${n}`, country: "PK", contacts: [{ name: "Imran", email: `i-${tag}-${n}@factory-terms.test` }] })
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
        newFactoryName: `Jinan Factory Terms ${tag} ${n}`,
        receivedOn: addDays(today, -3),
        currency: "CNY",
        lines: [{ requestedItemId: item, description: "Blister packing machine", quantity: 1, unit: "set", unitPrice: 186000 }],
        ...offer,
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/draft`).expect(200)).body;
    const r = (
      await api(app, sana)
        .post(`/inquiries/${inquiryId}/quotation/revisions`, { ...draft, options: [{ ...draft.options[0], prices: [{ lineId: draft.options[0].prices[0].lineId, unitPrice: 30125 }] }] })
        .expect(201)
    ).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "accepted", route: "informal" }).expect(200);
    return (await api(app, sana).get(`/inquiries/${inquiryId}`)).body.orders[0].id as string;
  }
  const money = async (id: string) => (await api(app, sana).get(`/orders/${id}/money`).expect(200)).body;
  const purchaseOrders = async (id: string) => (await api(app, sana).get(`/orders/${id}/purchase-orders`).expect(200)).body;
  const poPaper = async (id: string) => (await api(app, sana).get(`/orders/${id}/papers/purchase-order/doc`).expect(200)).body.doc as { meta: { label: string; value: string }[]; bullets: unknown[] };
  const rows = (plan: { rows: { label: string; amount: string; dueRule: string; dueDays: number | null }[] }) => plan.rows.map((r) => [r.label, r.amount, r.dueRule, r.dueDays]);

  const THREE = {
    reference: "JP-2611-08",
    basis: "FOB",
    basisPlace: "Qingdao",
    leadDays: 30,
    leadFrom: "after_payment",
    paymentParts: [
      { label: "Advance 30%", percent: 30, rule: "on_order" },
      { label: "Ready 60%", percent: 60, rule: "on_ready" },
      { label: "After shipping 10%", percent: 10, rule: "after_shipping", days: 30 },
    ],
    paymentTerms: "By T/T to their account in Jinan.",
    warrantyMonths: 12,
    warrantyFrom: "shipment",
    warranty: "parts, not labour",
  };

  it("the plan is the offer's parts: before it is saved, and saved as they are once the purchase order is sent", async () => {
    const id = await accepted(THREE);
    const plan = (await money(id)).factories.plans[0];
    expect(plan).toMatchObject({ saved: false, owed: "186000.00" });
    expect(rows(plan)).toEqual([
      ["Advance 30%", "55800.00", "on_order", null],
      ["Ready 60%", "111600.00", "on_ready", null],
      ["After shipping 10%", "18600.00", "on_ship_plus_days", 30],
    ]);
    // Sent (before the deposit, with a reason): the factory is ordered from, and its plan is kept as it was shown.
    const po = (await purchaseOrders(id)).items[0];
    await api(app, sana).post(`/orders/${id}/purchase-orders/${po.id}/send`, { sentOn: today, reason: "The factory needs the order this week" }).expect(200);
    const saved = (await money(id)).factories.plans[0];
    expect(saved.saved).toBe(true);
    expect(rows(saved)).toEqual(rows(plan));
  });

  it("the purchase order says which offer it was made from and prints its terms", async () => {
    const id = await accepted(THREE);
    const po = (await purchaseOrders(id)).items[0];
    expect(po.offer).toMatchObject({ reference: "JP-2611-08", receivedOn: addDays(today, -3), basis: "FOB", basisPlace: "Qingdao" });
    const paper = await poPaper(id);
    expect(paper.meta).toContainEqual({ label: "Your offer", value: `JP-2611-08 of ${formatDate(addDays(today, -3))}` });
    // Not ready yet: the delivery says what was agreed, without a date.
    expect(paper.bullets).toContain("Delivery: FOB Qingdao, ready 30 days after our advance.");
    expect(paper.bullets).toContain("Payment: Advance 30%, CNY 55,800.00, when we order; Ready 60%, CNY 111,600.00, on the ready date; After shipping 10%, CNY 18,600.00, 30 days after shipping.");
    expect(paper.bullets).toContain("By T/T to their account in Jinan.");
    expect(paper.bullets).toContain("Warranty: 12 months from shipment, parts, not labour.");
  });

  it("an older offer (an advance %, words only) keeps its usual plan and prints as before", async () => {
    const id = await accepted({ advancePercent: 40, paymentTerms: "40% advance, balance before shipment", leadTime: "about six weeks" });
    const plan = (await money(id)).factories.plans[0];
    expect(rows(plan)).toEqual([
      ["Advance 40%", "74400.00", "on_order", null],
      ["Balance 60%", "111600.00", "on_ready", null],
    ]);
    const paper = await poPaper(id);
    expect(paper.meta.map((m) => m.label)).toEqual(["Our order", "Your offer", "Ready by"]);
    expect(paper.meta[1]!.value).toBe(`dated ${formatDate(addDays(today, -3))}`);
    expect(paper.bullets).toContain("Delivery: lead time about six weeks.");
    // Its payment words are its terms, not a note beside parts: the plan prints those.
    expect(paper.bullets).not.toContain("40% advance, balance before shipment");
    expect(JSON.stringify(paper.bullets)).not.toMatch(/Warranty/);
  });
});
