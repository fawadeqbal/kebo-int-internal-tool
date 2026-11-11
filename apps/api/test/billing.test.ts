import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

type Invoice = {
  id: string | null;
  number: string | null;
  label: string;
  order: { id: string; refNo: string };
  party: { id: string; name: string };
  currency: string;
  amount: string;
  paid: string;
  open: string;
  dueOn: string | null;
  late: number;
};
type Invoices = { side: string; rows: Invoice[]; totals: { currency: string; open: string; late: string; count: number }[] };
type PlanRow = {
  id: string | null;
  supplierRef: string | null;
  label: string;
  percent: number | null;
  amount: string;
  open: string;
  dueRule: string;
  dueOn: string | null;
};

/**
 * Billing (claude/billing-4-design.md): the open invoices of each side, instalment by instalment. A customer
 * invoice carries its payment request number; a supplier invoice the supplier's own number once given.
 * They are paid in due order from the order's payments, so what is open adds up to what the order still owes.
 */
describe("billing", () => {
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

  it("lists what customers owe, invoice by invoice, late first, adding up to each order's due", async () => {
    type Receivables = { rows: { id: string; due: string; charged: string }[] };
    const due = async () => (await api(app, manager).get("/money/receivables").expect(200)).body as Receivables;
    // Other test files record money at the same time: compare only orders that did not move while we read.
    const before = await due();
    const r = (await api(app, manager).get("/billing/invoices?side=receivable").expect(200)).body as Invoices;
    const after = await due();
    expect(r.rows.length).toBeGreaterThan(0);
    for (const i of r.rows) {
      // An instalment has its payment request number; what is due beyond them (charges, a grown total) has none.
      if (i.id) expect(i.number).toMatch(/^PR-\d{4}-\d{4}-\d+$/);
      else expect(i.number).toBeNull();
      expect(Number(i.open)).toBeGreaterThan(0);
      expect(Number(i.open)).toBeLessThanOrEqual(Number(i.amount));
    }
    // Late first (most days late), then by due date.
    const lates = r.rows.map((i) => i.late);
    expect(lates).toEqual([...lates].sort((a, b) => b - a));
    // Each order's open rows add up to what it still owes.
    const steady = before.rows.filter((o) => after.rows.some((x) => x.id === o.id && x.due === o.due));
    expect(steady.length).toBeGreaterThan(0);
    for (const o of steady) {
      const open = r.rows.filter((i) => i.order.id === o.id).reduce((t, i) => t + Number(i.open), 0);
      expect(open.toFixed(2), o.id).toBe(Number(o.due).toFixed(2));
    }
    const total = r.totals.reduce((t, x) => t + x.count, 0);
    expect(total).toBe(r.rows.length);
  });

  it("keeps the supplier's own invoice number on their instalment and lists it under payables", async () => {
    const r = (await api(app, manager).get("/billing/invoices?side=payable").expect(200)).body as Invoices;
    expect(r.rows.length).toBeGreaterThan(0);
    const { order } = r.rows[0]!;
    const m = (await api(app, manager).get(`/orders/${order.id}/money`).expect(200)).body as {
      factories: { plans: { factory: { id: string }; rows: PlanRow[] }[] };
    };
    const plan = m.factories.plans.find((p) => p.factory.id === r.rows[0]!.party.id)!;
    const ref = `INV-${Date.now().toString(36)}`;
    const items = plan.rows.map((x, n) => ({
      label: x.label,
      percent: x.percent,
      amount: x.amount,
      dueRule: x.dueRule,
      dueOn: x.dueOn,
      supplierRef: n === plan.rows.length - 1 ? ref : null,
    }));
    const saved = (await api(app, manager).put(`/orders/${order.id}/factory-plan`, { factoryId: plan.factory.id, items }).expect(200))
      .body as {
      factories: { plans: { factory: { id: string }; rows: PlanRow[] }[] };
    };
    const rows = saved.factories.plans.find((p) => p.factory.id === plan.factory.id)!.rows;
    expect(rows.at(-1)).toMatchObject({ supplierRef: ref, id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    const after = (await api(app, manager).get("/billing/invoices?side=payable").expect(200)).body as Invoices;
    // Still open: listed with the supplier's number (a part paid in full leaves the list).
    const listed = after.rows.find((i) => i.id === rows.at(-1)!.id);
    if (Number(rows.at(-1)!.open) > 0)
      expect(listed).toMatchObject({ number: ref, order: { id: order.id }, party: { id: plan.factory.id } });
    else expect(listed).toBeUndefined();
  });

  it("receivables for those who record money; payables for those who see costs (staff do), as the old lists", async () => {
    await api(app).get("/billing/invoices?side=receivable").expect(401);
    await api(app, bilal).get("/billing/invoices?side=receivable").expect(403);
    await api(app, bilal).get("/billing/invoices?side=payable").expect(200);
    await api(app, manager).get("/billing/invoices?side=nope").expect(422);
  });
});
