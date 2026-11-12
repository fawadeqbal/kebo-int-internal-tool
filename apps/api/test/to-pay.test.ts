import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toMinor } from "@kebo/money";
import { api, signIn, startApp } from "./app";

type Row = {
  key: string;
  order: { id: string };
  supplier: { id: string };
  currency: string;
  amount: string;
  paid: string;
  open: string;
  late: number;
  customerMoney: { route: string | null; currency: string; total: string; received: string; state: string; words: string; warn: boolean };
};

/**
 * Payments › To pay: the open parts of every supplier's plan. Nothing is stored for it, so it must agree with
 * the two places that already say the same thing: Payables (the same parts) and the order's own money (the
 * customer's side shown beside each part).
 */
describe("payments: to pay suppliers", () => {
  let app: INestApplication;
  let manager: string;
  let bilal: string;

  beforeAll(async () => {
    app = await startApp();
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    bilal = await signIn(app, "bilal@example.com");
  });

  afterAll(async () => {
    await app?.close();
  });

  it("lists the same open parts as Payables, each adding up, with totals per currency", async () => {
    const list = (await api(app, manager).get("/billing/to-pay").expect(200)).body as {
      rows: Row[];
      totals: { currency: string; open: string; late: string; count: number }[];
      canPay: boolean;
    };
    const payables = (await api(app, manager).get("/billing/invoices?side=payable").expect(200)).body as {
      rows: { open: string; currency: string }[];
    };
    expect(list.rows.length).toBe(payables.rows.length);
    const sum = (rows: { open: string; currency: string }[], c: string) =>
      rows.filter((r) => r.currency === c).reduce((t, r) => t + toMinor(r.open), 0);
    for (const t of list.totals) {
      expect(toMinor(t.open)).toBe(sum(list.rows, t.currency));
      expect(toMinor(t.open)).toBe(sum(payables.rows, t.currency));
      expect(t.count).toBe(list.rows.filter((r) => r.currency === t.currency).length);
    }
    for (const r of list.rows) {
      expect(toMinor(r.open)).toBeGreaterThan(0);
      expect(toMinor(r.open)).toBe(toMinor(r.amount) - toMinor(r.paid));
    }
    // Late ones first.
    const firstNotLate = list.rows.findIndex((r) => r.late === 0);
    if (firstNotLate >= 0) expect(list.rows.slice(firstNotLate).every((r) => r.late === 0)).toBe(true);
  });

  it("says of each part where the customer's money stands, as the order itself does", async () => {
    const list = (await api(app, manager).get("/billing/to-pay").expect(200)).body as { rows: Row[] };
    const row = list.rows[0];
    if (!row) return; // nothing owed in the seed
    const m = (await api(app, manager).get(`/orders/${row.order.id}/money`).expect(200)).body as {
      received: string;
      due: string;
      currency: string;
      route: { route: string | null };
      factories: {
        customer: { state: string; words: string; warn: boolean };
        plans: { factory: { id: string }; currency: string; rows: { open: string }[] }[];
      };
    };
    expect(row.customerMoney).toMatchObject({ ...m.factories.customer, route: m.route.route, currency: m.currency, received: m.received });
    expect(toMinor(row.customerMoney.total)).toBe(toMinor(m.received) + toMinor(m.due));
    // The same parts as the order's Factory step shows for that supplier.
    const plan = m.factories.plans.find((p) => p.factory.id === row.supplier.id && p.currency === row.currency)!;
    const mine = list.rows.filter((r) => r.order.id === row.order.id && r.supplier.id === row.supplier.id && r.currency === row.currency);
    expect(mine.map((r) => toMinor(r.open))).toEqual(plan.rows.filter((r) => toMinor(r.open) > 0).map((r) => toMinor(r.open)));
  });

  it("is only for people who see factory costs", async () => {
    const me = (await api(app, bilal).get("/auth/me").expect(200)).body as { permissions?: string[] };
    if (me.permissions?.includes("sourcing.manage")) return;
    await api(app, bilal).get("/billing/to-pay").expect(403);
  });
});
