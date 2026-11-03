import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIRST_COMPANY_ID } from "@kebo/database";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service";
import { Clock } from "../src/common/time/clock.service";
import { api, signIn, startApp } from "./app";

/**
 * One figure everywhere (PR G): on the demo data, Home, the report, Leaks and Insights give the same numbers
 * for the same period and filters, because they all read the Insights tables.
 */
describe("one figure: Home, Reports and Leaks read the same tables as Insights", () => {
  let app: INestApplication;
  let manager: string;
  let today: string;
  const facts = async <T = Record<string, unknown>>(path: string): Promise<T> => (await api(app, manager).get(`/insights/facts/${path}`).expect(200)).body as T;
  const cents = (v: string | number | null | undefined) => Math.round(Number(v ?? 0) * 100);
  const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((t, x) => t + f(x), 0);
  type Row = Record<string, string | number | null> & { period: string; sales: string; profitQuote: string; marginQuote: number | null; orders: number; costed: string };

  beforeAll(async () => {
    app = await startApp();
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    today = app.get(Clock).today();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("Home's money is Insights' month: sales, cash in, to receive, overdue, quoted, open orders", async () => {
    const month = today.slice(0, 7);
    const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const span = `from=${month}-01&to=${end}`;
    const home = (await api(app, manager).get("/dashboard").expect(200)).body.money;
    const [orders, cash, aging, now, funnel] = await Promise.all([
      facts<{ rows: Row[] }>(`orders/groups?${span}&period=all`),
      facts<{ months: { in: string }[] }>(`cash?${span}`),
      facts<{ total: string }>("aging?side=receivable"),
      facts<{ overdue: { amount: string } }>(`now?${span}`),
      facts<{ quotedValue: string }>(`funnel?${span}`),
    ]);
    expect(home.thisMonth.won).toBe(orders.rows[0]?.sales ?? "0.00");
    expect(cents(home.thisMonth.received)).toBe(sum(cash.months, (m) => cents(m.in)));
    expect(home.thisMonth.quoted).toBe(funnel.quotedValue);
    expect(home.now.toReceive).toBe(aging.total);
    expect(home.now.overdue).toBe(now.overdue.amount);
    const open = await app.get(PrismaService).company(FIRST_COMPANY_ID).order.count({ where: { status: "open" } });
    expect(home.now.openOrders).toBe(open);
    expect(Number(home.now.toReceive)).toBeGreaterThan(0);
  });

  it("the report is Insights for the same span: funnel, sales, profit and margin, people, the 12 months", async () => {
    const from = `${today.slice(0, 4)}-01-01`;
    const span = `from=${from}&to=${today}`;
    const r = (await api(app, manager).get(`/reports?${span}`).expect(200)).body;
    const [funnel, orders, byCustomer, months] = await Promise.all([
      facts<{ inquiries: number; quoted: number; won: number; lost: number; winRate: number | null; lostReasons: { reason: string; count: number }[] }>(`funnel?${span}`),
      facts<{ rows: Row[] }>(`orders/groups?${span}&period=all`),
      facts<{ rows: (Row & { label: string })[] }>(`orders/groups?${span}&period=all&by=customer`),
      facts<{ rows: { period: string; inquiries: number; won: number }[] }>(`inquiries/groups?from=${today.slice(0, 7)}-01&to=${today}&period=month`),
    ]);
    expect(r.funnel).toEqual({ received: funnel.inquiries, quoted: funnel.quoted, won: funnel.won, lost: funnel.lost, winRatePercent: funnel.winRate });
    expect(r.lostReasons.map((x: { reason: string; count: number }) => [x.reason, x.count])).toEqual(funnel.lostReasons.map((x) => [x.reason, x.count]));
    const t = orders.rows[0]!;
    expect(r.wonValue).toBe(t.sales);
    expect(r.profit.total.revenue).toBe(t.sales);
    expect(r.profit.total.profit).toBe(t.profitQuote);
    expect(r.profit.total.marginPercent).toBe(t.marginQuote);
    expect(r.profit.total.orders).toBe(t.orders);
    expect(cents(r.profit.total.uncostedRevenue)).toBe(cents(t.sales) - cents(t.costed));
    // Each customer's line is Insights' customer row.
    for (const c of r.profit.byCustomer) {
      const g = byCustomer.rows.find((x) => x.label === c.key)!;
      expect([c.revenue, c.profit, c.orders]).toEqual([g.sales, g.profitQuote, g.orders]);
    }
    expect(sum(r.profit.byCustomer, (c: { profit: string }) => cents(c.profit))).toBe(cents(t.profitQuote));
    // This month in the 12 months: inquiries that came in, and won of them.
    const m = months.rows.find((x) => x.period === today.slice(0, 7));
    expect(r.trend.at(-1)).toEqual({ month: today.slice(0, 7), received: m?.inquiries ?? 0, won: m?.won ?? 0 });
    expect(r.trend).toHaveLength(12);
  });

  it("Leaks' planned and actual profit are each order's profit on the quote and profit now expected", async () => {
    const from = `${today.slice(0, 4)}-01-01`;
    const span = `from=${from}&to=${today}`;
    const l = (await api(app, manager).get(`/reports/leaks?${span}`).expect(200)).body;
    const [orders, rows, cash, months] = await Promise.all([
      facts<{ rows: Row[] }>(`orders/groups?${span}&period=all`),
      facts<{ rows: { orderId: string; status: string; sales: string; profitQuote: string; profitExpected: string; costsOverPlan: string }[] }>(`orders?${span}&limit=1000`),
      facts<{ months: { month: string; expenses: string | null }[] }>(`cash?from=${l.trend[0].month}-01&to=${today}`),
      facts<{ rows: Row[] }>(`orders/groups?from=${l.trend[0].month}-01&to=${today}&period=month`),
    ]);
    expect(l.summary.planned).toBe(orders.rows[0]!.profitQuote);
    expect(cents(l.summary.uncostedRevenue)).toBe(cents(orders.rows[0]!.sales) - cents(orders.rows[0]!.costed));
    for (const o of l.orders) {
      const f = rows.rows.find((x) => x.orderId === o.id)!;
      expect([o.revenue, o.planned, o.orderCosts]).toEqual([f.sales, f.profitQuote, f.costsOverPlan]);
      // Actual: profit now expected, less what the deal cost before the order and factories paid beyond what we owe.
      expect(cents(o.actual) + cents(o.beforeSale) + cents(o.factoryExtra)).toBe(cents(f.profitExpected));
    }
    for (const t of l.trend) {
      expect(t.sales).toBe(months.rows.find((x) => x.period === t.month)?.sales ?? "0.00");
      expect(t.expenses).toBe(cash.months.find((x) => x.month === t.month)?.expenses ?? "0.00");
    }
  });

  it("my target counts Insights' sales for the orders I handle", async () => {
    const prisma = app.get(PrismaService);
    const sana = await prisma.company(FIRST_COMPANY_ID).user.findFirstOrThrow({ where: { email: "sana@example.com" } });
    const month = today.slice(0, 7);
    await api(app, manager).put(`/insights/targets/${month}/people/${sana.id}`, { amount: 1000 }).expect(200);
    const token = await signIn(app, "sana@example.com");
    const mine = (await api(app, token).get("/me/target").expect(200)).body;
    const g = await facts<{ rows: Row[] }>(`orders/groups?from=${month}-01&to=${today}&period=all&personId=${sana.id}`);
    expect(mine.sold).toBe(g.rows[0]?.sales ?? "0.00");
    await api(app, manager).put(`/insights/targets/${month}/people/${sana.id}`, { amount: 0 }).expect(200);
  });

  it("no other module works out what is due, received, profit or margin on its own", () => {
    const src = (f: string) => readFileSync(join(__dirname, "../src/modules", f), "utf8");
    // The pages that add figures up read the tables: none of the per-record helpers or sums of money rows.
    for (const f of ["reports/reports.service.ts", "money/leaks.service.ts", "insights/insights.service.ts"]) {
      const code = src(f).replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
      for (const banned of ["costingsOf", "costDocLines", "profitTotals", "profitBy", "orderMoney(", "positionsSql", "from payments", "from factory_payments", "fx.order("])
        expect(`${f}: ${code.includes(banned) ? banned : "ok"}`).toBe(`${f}: ok`);
    }
  });
});
