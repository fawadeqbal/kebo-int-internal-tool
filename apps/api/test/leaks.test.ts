import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/** "Where we lose money": lost deals' cost, planned against actual profit, money stuck, and warnings. */
describe("where we lose money", () => {
  let app: INestApplication;
  let manager: string;
  let staff: string;
  const today = new Date().toISOString().slice(0, 10);
  const year = today.slice(0, 4);
  const report = async () => (await api(app, manager).get(`/reports/leaks?from=${year}-01-01&to=${today}`).expect(200)).body;

  beforeAll(async () => {
    app = await startApp();
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    staff = await signIn(app, "bilal@example.com");
  });

  afterAll(async () => {
    await app?.close();
  });

  it("is for managers, and adds up lost deals, profit kept and the year's trend", async () => {
    await api(app, staff).get("/reports/leaks").expect(403);
    const r = await report();
    expect(r.range).toEqual({ from: `${year}-01-01`, to: today });
    expect(r.trend.length).toBeGreaterThanOrEqual(3);
    expect(r.trend.length).toBeLessThanOrEqual(12);
    expect(r.summary.lostDeals).toBeGreaterThan(0);
    // The demo's trip for the lost film deal.
    expect(Number(r.summary.lostSpent)).toBeGreaterThan(0);
    expect(r.lostReasons.find((x: { reason: string }) => x.reason === "price_too_high")).toBeTruthy();
    expect(Number(r.summary.leaked)).toBeCloseTo(Number(r.summary.planned) - Number(r.summary.actual), 2);
    for (const o of r.orders) expect(Number(o.leaked)).toBeCloseTo(Number(o.planned) - Number(o.actual), 2);
    expect(r.byPerson.length).toBeGreaterThan(0);
  });

  it("warns when an order loses money and when an open deal costs too much for its quotation", async () => {
    const t = (await api(app, manager).get("/expenses/targets").expect(200)).body;
    const r0 = await report();
    const order = r0.orders[0];
    await api(app, manager)
      .post("/expenses", { orderId: order.id, category: "freight", description: "Air freight, rush", amount: Number(order.planned) + 1000, currency: "USD", spentOn: today })
      .expect(201);
    const quoted = t.deals.find((d: { stage: string }) => d.stage === "quoted");
    const q = (await api(app, manager).get(`/inquiries/${quoted.id}/quotation`).expect(200)).body;
    const total = Number(q.revisions[0].total);
    await api(app, manager)
      .post("/expenses", { inquiryId: quoted.id, category: "travel", description: "Second visit", amount: Math.ceil(total * 0.06), currency: q.revisions[0].currency, rate: q.revisions[0].currency === "USD" ? undefined : 7.1, spentOn: today })
      .expect(201);

    const r = await report();
    const texts = r.warnings.map((w: { text: string }) => w.text);
    expect(texts.some((x: string) => x.startsWith(`Order ${order.refNo}`) && x.includes("is losing money"))).toBe(true);
    expect(texts.some((x: string) => x.startsWith(`${quoted.refNo} `) && x.includes("of its quotation"))).toBe(true);
    expect(r.warnings[0].level).toBe("bad");
    expect(r.orders[0].refNo).toBe(order.refNo); // the biggest leak comes first
  });
});
