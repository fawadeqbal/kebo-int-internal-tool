import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/** Expenses on deals and factories, profit after what was spent before the sale, and a customer's account. */
describe("customer account", () => {
  let app: INestApplication;
  let sana: string;
  let manager: string;
  let customerId: string;
  let lostDeal: string;
  let openDeal: string;
  let factoryId: string;
  const tag = Date.now().toString(36);
  const today = new Date().toISOString().slice(0, 10);
  const spend = (body: Record<string, unknown>) =>
    api(app, manager).post("/expenses", { category: "travel", currency: "USD", spentOn: today, ...body });

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    const me = (await api(app, sana).get("/auth/me")).body.id;
    customerId = (
      await api(app, sana)
        .post("/customers", { name: `Peshawar Mills ${tag}`, country: "PK", contacts: [{ name: "Khan", email: `khan-${tag}@pm.test` }] })
        .expect(201)
    ).body.id;
    const deal = async (what: string) =>
      (await api(app, sana).post("/inquiries", { customerId, category: "Machinery", assigneeId: me, items: [{ description: what, quantity: 1 }] }).expect(201)).body.id as string;
    lostDeal = await deal("Flour mill 50 t/day");
    openDeal = await deal("Bran finisher");
    await api(app, sana).post(`/inquiries/${lostDeal}/stage`, { to: "lost", lostReason: "price_too_high", note: "Turkish mill was cheaper" }).expect(200);
    factoryId = (await api(app, manager).get("/factories?pageSize=1").expect(200)).body.rows[0].id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("puts an expense on a deal (its customer is filled in) and on the factory visited", async () => {
    const trip = (await spend({ inquiryId: lostDeal, factoryId, description: `Trip to check the mill ${tag}`, amount: 400 }).expect(201)).body;
    expect(trip).toMatchObject({ deal: { id: lostDeal, stage: "lost" }, customer: { id: customerId }, factory: { id: factoryId }, order: null });
    await spend({ inquiryId: openDeal, category: "samples", description: "Bran samples", amount: 60 }).expect(201);
    await spend({ customerId, category: "meals", description: "Dinner in Peshawar", amount: 40 }).expect(201);
    // A deal of another customer is refused.
    const other = (await api(app, manager).get("/customers/names").expect(200)).body.find((c: { id: string }) => c.id !== customerId);
    const bad = await spend({ inquiryId: lostDeal, customerId: other.id, description: "x", amount: 1 }).expect(400);
    expect(bad.body.error).toMatch(/is for another customer/);
    // Filters by deal and by factory.
    const onDeal = (await api(app, manager).get(`/expenses?inquiryId=${lostDeal}`).expect(200)).body;
    expect(onDeal.rows.map((r: { description: string }) => r.description)).toEqual([`Trip to check the mill ${tag}`]);
    const atFactory = (await api(app, manager).get(`/expenses?factoryId=${factoryId}`).expect(200)).body;
    expect(atFactory.rows.some((r: { description: string }) => r.description === `Trip to check the mill ${tag}`)).toBe(true);
  });

  it("shows the customer's account: lost deals' cost by reason, open deals, and the net", async () => {
    await api(app, sana).get(`/customers/${customerId}/account`).expect(403);
    const a = (await api(app, manager).get(`/customers/${customerId}/account`).expect(200)).body;
    expect(a.deals).toEqual({ total: 2, won: 0, lost: 1, open: 1 });
    expect(a.winRate).toBe(0);
    expect(a.totals).toMatchObject({ sales: "0.00", lostDeals: "400.00", openDeals: "60.00", otherCosts: "40.00", spent: "500.00", net: "-500.00", sellingCostPerWin: null });
    expect(a.lostReasons).toEqual([{ reason: "price_too_high", deals: 1, spent: "400.00" }]);
    expect(a.rows.find((r: { id: string }) => r.id === lostDeal)).toMatchObject({ stage: "lost", spent: "400.00", lostReason: "price_too_high", order: null });
    expect(a.timeline.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(["deal", "lost", "expense"]));
  });

  it("takes what was spent on a won deal before the sale off the order's profit", async () => {
    const orders = (await api(app, manager).get("/orders?status=open").expect(200)).body as { id: string; currency: string; customer: { id: string } }[];
    const order = orders.find((o) => o.currency === "USD")!;
    const before = (await api(app, manager).get(`/orders/${order.id}/money`).expect(200)).body;
    const dealId = before.deal.id;
    await spend({ inquiryId: dealId, description: `Visit before the order ${tag}`, amount: 250 }).expect(201);
    const after = (await api(app, manager).get(`/orders/${order.id}/money`).expect(200)).body;
    expect(Number(after.profit.beforeSale) - Number(before.profit.beforeSale)).toBeCloseTo(250, 2);
    expect(after.profit.earned).toBe(before.profit.earned); // the order's own profit stays
    expect(Number(after.profit.net)).toBeCloseTo(Number(after.profit.earned) - Number(after.profit.beforeSale), 2);
    expect(after.dealExpenses.some((e: { description: string }) => e.description === `Visit before the order ${tag}`)).toBe(true);
    // Staff see neither.
    const staff = (await api(app, sana).get(`/orders/${order.id}/money`)).body;
    if (staff.profit !== undefined) expect(staff.dealExpenses ?? null).toBeNull();

    const a = (await api(app, manager).get(`/customers/${order.customer.id}/account`).expect(200)).body;
    expect(a.deals.won).toBeGreaterThan(0);
    expect(Number(a.totals.beforeSale)).toBeGreaterThanOrEqual(250);
    expect(Number(a.totals.net)).toBeCloseTo(
      Number(a.totals.profit) - Number(a.totals.beforeSale) - Number(a.totals.lostDeals) - Number(a.totals.openDeals) - Number(a.totals.otherCosts),
      2,
    );
    const row = a.rows.find((r: { id: string }) => r.id === dealId);
    expect(Number(row.order.net)).toBeCloseTo(Number(row.order.profit) - Number(row.beforeSale), 2);
  });

  it("lists what an expense can be for", async () => {
    await api(app, sana).get("/expenses/targets").expect(403);
    const t = (await api(app, manager).get("/expenses/targets").expect(200)).body;
    expect(t.deals.find((d: { id: string }) => d.id === lostDeal)).toMatchObject({ customerId, stage: "lost" });
    expect(t.factories.length).toBeGreaterThan(0);
    expect(t.orders[0]).toHaveProperty("dealId");
  });
});
