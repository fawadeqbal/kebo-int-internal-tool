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
describe("the supplier's side starts from its offer", () => {
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

  /** A deal with one factory offer (these terms), quoted and accepted: the order and its factory. */
  async function accepted(offer: Record<string, unknown>) {
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const n = Math.random().toString(36).slice(2, 6);
    const customer = (
      await api(app, sana)
        .post("/customers", { name: `Supplier Terms ${tag} ${n}`, country: "PK", contacts: [{ name: "Imran", email: `i-${tag}-${n}@factory-terms.test` }] })
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
      { label: "Deposit 30%", percent: 30, rule: "on_order" },
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
      ["Deposit 30%", "55800.00", "on_order", null],
      ["Ready 60%", "111600.00", "on_ready", null],
      ["After shipping 10%", "18600.00", "on_ship_plus_days", 30],
    ]);
    // Sent (before the deposit, with a reason): the factory is ordered from, and its plan is kept as it was shown.
    const po = (await purchaseOrders(id)).items[0];
    await api(app, sana).post(`/orders/${id}/purchase-orders/${po.id}/send`, { sentOn: today, reason: "The supplier needs the order this week" }).expect(200);
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
    expect(paper.bullets).toContain("Delivery: FOB Qingdao, ready 30 days after our deposit.");
    expect(paper.bullets).toContain("Payment: Deposit 30%, CNY 55,800.00, when we order; Ready 60%, CNY 111,600.00, on the ready date; After shipping 10%, CNY 18,600.00, 30 days after shipping.");
    expect(paper.bullets).toContain("By T/T to their account in Jinan.");
    expect(paper.bullets).toContain("Warranty: 12 months from shipment, parts, not labour.");
  });

  it("agreed with the factory: its offer's until sent, its own once sent; a change from the offer asks why; ready by from the advance", async () => {
    const id = await accepted(THREE);
    const po = (await purchaseOrders(id)).items[0];
    expect(po.agreed).toMatchObject({
      copied: false,
      basis: "FOB",
      basisPlace: "Qingdao",
      leadDays: 30,
      leadTime: "30 days after the deposit",
      warrantyLine: "12 months from shipment, parts, not labour.",
      paymentNote: "By T/T to their account in Jinan.",
      readyBy: { by: "advance", on: null, readyOn: null },
      changes: 0,
    });
    // Before it is sent, it is still being prepared: no why.
    await api(app, sana).patch(`/orders/${id}/purchase-orders/${po.id}/terms`, { notes: "Pack each machine in a fumigated case." }).expect(200);
    await api(app, sana).post(`/orders/${id}/purchase-orders/${po.id}/send`, { sentOn: today, reason: "The supplier needs the order this week" }).expect(200);
    const sent = (await purchaseOrders(id)).items[0];
    expect(sent.agreed).toMatchObject({ copied: true, leadDays: 30, notes: "Pack each machine in a fumigated case.", changes: 1 });
    // Sent: a lead time other than the offer's asks why; the same values again change nothing.
    await api(app, sana).patch(`/orders/${id}/purchase-orders/${po.id}/terms`, { leadDays: 35 }).expect(409);
    await api(app, sana).patch(`/orders/${id}/purchase-orders/${po.id}/terms`, { leadDays: 35, reason: "Agreed a new lead time" }).expect(200);
    await api(app, sana).patch(`/orders/${id}/purchase-orders/${po.id}/terms`, { leadDays: 35, leadFrom: "after_payment", basis: "FOB", basisPlace: "Qingdao" }).expect(200);
    const changed = (await purchaseOrders(id)).items[0];
    expect(changed.agreed).toMatchObject({ leadDays: 35, leadTime: "35 days after the deposit", changes: 2, offered: { leadDays: 30 } });
    // The advance paid in full: the ready date is worked out from it.
    const factoryId = (await money(id)).factories.plans[0].factory.id;
    await api(app, manager).post(`/orders/${id}/factory-payments`, { factoryId, kind: "deposit", amount: 55800, currency: "CNY", paidOn: today }).expect(201);
    expect((await purchaseOrders(id)).items[0].agreed.readyBy).toEqual({ by: "advance", on: today, readyOn: addDays(today, 35) });
    // The paper and the customer's side by side use what was agreed.
    const paper = await poPaper(id);
    expect(paper.bullets).toContain("Delivery: FOB Qingdao, ready 35 days after our deposit.");
    expect(paper.bullets.at(-1)).toBe("Pack each machine in a fumigated case.");
    const order = (await api(app, sana).get(`/orders/${id}`).expect(200)).body;
    expect(order.factoryTerms[0].terms.leadDays).toBe(35);
    // The history: what changed, in words, under the factory order.
    const history = (await api(app, sana).get(`/history?type=order&id=${id}`).expect(200)).body as { summary: string; step: string | null; reason: string | null; changes: { field: string; from: string | null; to: string | null }[] }[];
    const lead = history.find((e) => e.summary.includes(`${po.number}: what was agreed with`) && e.summary.includes("lead time 35 days after the deposit"));
    expect(lead).toMatchObject({ step: "factory", reason: "Agreed a new lead time" });
    expect(lead?.changes).toEqual([{ field: "leadTime", from: "30 days after the deposit", to: "35 days after the deposit" }]);
  });

  it("ordered from the supplier by its day (no purchase order sent one by one): what was agreed is kept too", async () => {
    const id = await accepted(THREE);
    await api(app, sana).patch(`/orders/${id}/factory-order`, { factoryOrderedOn: today }).expect(200);
    const po = (await purchaseOrders(id)).items[0];
    expect(po.agreed).toMatchObject({ copied: true, leadDays: 30, paymentNote: "By T/T to their account in Jinan." });
    // It went to the factory: a lead time other than the offer's asks why.
    await api(app, sana).patch(`/orders/${id}/purchase-orders/${po.id}/terms`, { leadDays: 40 }).expect(409);
  });

  it("an older offer (an deposit %, words only) keeps its usual plan and prints as before", async () => {
    const id = await accepted({ advancePercent: 40, paymentTerms: "40% deposit, balance before shipment", leadTime: "about six weeks" });
    const plan = (await money(id)).factories.plans[0];
    expect(rows(plan)).toEqual([
      ["Deposit 40%", "74400.00", "on_order", null],
      ["Balance 60%", "111600.00", "on_ready", null],
    ]);
    const paper = await poPaper(id);
    expect(paper.meta.map((m) => m.label)).toEqual(["Our order", "Your offer", "Ready by"]);
    expect(paper.meta[1]!.value).toBe(`dated ${formatDate(addDays(today, -3))}`);
    expect(paper.bullets).toContain("Delivery: lead time about six weeks.");
    // Its payment words are its terms, not a note beside parts: the plan prints those.
    expect(paper.bullets).not.toContain("40% deposit, balance before shipment");
    expect(JSON.stringify(paper.bullets)).not.toMatch(/Warranty/);
  });
});
