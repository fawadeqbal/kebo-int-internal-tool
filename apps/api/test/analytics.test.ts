import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMonths, previousPeriod } from "../src/modules/insights/insights.service";
import { api, signIn, startApp } from "./app";

describe("comparing a period with the one before", () => {
  it("compares a month (or months) with the same days before", () => {
    expect(previousPeriod("2026-10-01", "2026-10-28")).toEqual({ from: "2026-09-01", to: "2026-09-28" });
    expect(previousPeriod("2026-10-01", "2026-10-31")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(previousPeriod("2026-03-01", "2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(previousPeriod("2026-07-01", "2026-09-30")).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(previousPeriod("2026-01-01", "2026-10-28")).toEqual({ from: "2025-03-01", to: "2025-12-28" });
  });
  it("compares other days with as many days just before", () => {
    expect(previousPeriod("2026-10-11", "2026-10-20")).toEqual({ from: "2026-10-01", to: "2026-10-10" });
  });
  it("keeps the day inside the month", () => {
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2024-03-31", -1)).toBe("2024-02-29");
    expect(addMonths("2026-01-15", -12)).toBe("2025-01-15");
  });
});

/** Insights (managers), targets, the reminders on Home and what customers owe. */
describe("insights", () => {
  let app: INestApplication;
  let manager: string;
  let staff: string;
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  beforeAll(async () => {
    app = await startApp();
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    staff = await signIn(app, "bilal@example.com");
  });

  afterAll(async () => {
    await app?.close();
  });

  it("gives managers the period against the one before, month by month", async () => {
    await api(app, staff).get("/insights").expect(403);
    const i = (await api(app, manager).get(`/insights?from=${today.slice(0, 4)}-01-01&to=${today}`).expect(200)).body;
    expect(i.range).toEqual({ from: `${today.slice(0, 4)}-01-01`, to: today });
    expect(i.series.length).toBeGreaterThanOrEqual(12);
    // The year's sales are the months' sales added up.
    const fromSeries = i.series.filter((s: { month: string }) => s.month.startsWith(today.slice(0, 4))).reduce((t: number, s: { revenue: string }) => t + Number(s.revenue), 0);
    expect(Number(i.kpis.revenue.value)).toBeCloseTo(fromSeries, 1);
    expect(Number(i.kpis.revenue.value)).toBeGreaterThan(0);
    expect(i.kpis.grossProfit.value).not.toBeNull();
    expect(i.funnel.received).toBeGreaterThanOrEqual(i.funnel.quoted);
    expect(i.funnel.quoted).toBeGreaterThanOrEqual(i.funnel.won);
    expect(i.topCustomers.length).toBeGreaterThan(0);
    expect(i.countries.length).toBeGreaterThan(0);
    expect(Object.keys(i.aging)).toEqual(["notDue", "d30", "d60", "d90", "older"]);
    const aged = Object.values(i.aging as Record<string, string>).reduce((t, v) => t + Number(v), 0);
    expect(aged).toBeCloseTo(Number(i.now.toReceive), 0);
    expect(i.now.cashInHand).not.toBeNull();
    expect(i.people.some((p: { name: string }) => p.name === "Sana" || p.name === "Bilal")).toBe(true);
  });

  it("keeps a monthly target and shows how far along it is", async () => {
    await api(app, staff).put(`/insights/targets/${month}`, { amount: 50000 }).expect(403);
    await api(app, manager).put(`/insights/targets/2026-13`, { amount: 1 }).expect(422);
    await api(app, manager).put(`/insights/targets/${month}`, { amount: 50000 }).expect(200);
    const i = (await api(app, manager).get("/insights").expect(200)).body;
    expect(i.target).toMatchObject({ month, amount: "50000.00" });
    expect(i.target.percent).toBe(Math.round((Number(i.target.reached) / 50000) * 100));
    expect(i.series.find((s: { month: string }) => s.month === month).target).toBe("50000.00");
    expect((await api(app, manager).get(`/insights/targets?year=${today.slice(0, 4)}`).expect(200)).body).toEqual([{ month, amount: "50000.00", currency: "USD" }]);
    await api(app, manager).put(`/insights/targets/${month}`, { amount: 0 }).expect(200);
    expect((await api(app, manager).get("/insights").expect(200)).body.target.amount).toBeNull();
  });

  it("lists what needs each person, and puts one off or marks it done", async () => {
    const mine = (await api(app, staff).get("/reminders").expect(200)).body;
    const all = (await api(app, manager).get("/reminders").expect(200)).body;
    expect(all.items.length).toBeGreaterThanOrEqual(mine.items.length);
    expect(all.items.some((r: { kind: string }) => r.kind === "money")).toBe(true);
    // Most urgent first.
    const levels = all.items.map((r: { level: string }) => ({ bad: 0, warn: 1, info: 2 })[r.level as "bad"]);
    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
    const first = all.items[0];
    await api(app, manager).post("/reminders/snooze", { key: first.key, days: 3 }).expect(200);
    let after = (await api(app, manager).get("/reminders").expect(200)).body;
    expect(after.items.some((r: { key: string }) => r.key === first.key)).toBe(false);
    expect(after.counts.hidden).toBe(1);
    await api(app, manager).post("/reminders/restore", { key: first.key }).expect(200);
    await api(app, manager).post("/reminders/done", { key: first.key }).expect(200);
    after = (await api(app, manager).get("/reminders").expect(200)).body;
    expect(after.items.some((r: { key: string }) => r.key === first.key)).toBe(false);
    await api(app, manager).post("/reminders/restore", { key: first.key }).expect(200);
    expect((await api(app, manager).get("/reminders").expect(200)).body.items.some((r: { key: string }) => r.key === first.key)).toBe(true);
  });

  it("lists what customers still owe, the most overdue first", async () => {
    await api(app, staff).get("/money/receivables").expect(403);
    const r = (await api(app, manager).get("/money/receivables").expect(200)).body;
    expect(r.rows.length).toBeGreaterThan(0);
    for (const row of r.rows) expect(Number(row.due)).toBeGreaterThan(0);
    const late = r.rows.map((x: { daysLate: number }) => x.daysLate);
    expect([...late].sort((a, b) => b - a)).toEqual(late);
    const usd = r.totals.find((t: { currency: string }) => t.currency === "USD");
    expect(Number(usd.due)).toBeCloseTo(
      r.rows.filter((x: { currency: string }) => x.currency === "USD").reduce((t: number, x: { due: string }) => t + Number(x.due), 0),
      2,
    );
  });
});
