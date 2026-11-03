import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

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

  it("keeps a monthly target and shows how far along it is, on Insights' sales", async () => {
    await api(app, staff).get("/insights/target").expect(403);
    await api(app, staff).put(`/insights/targets/${month}`, { amount: 50000 }).expect(403);
    await api(app, manager).put(`/insights/targets/2026-13`, { amount: 1 }).expect(422);
    await api(app, manager).put(`/insights/targets/${month}`, { amount: 50000 }).expect(200);
    const t = (await api(app, manager).get("/insights/target").expect(200)).body;
    expect(t).toMatchObject({ month, amount: "50000.00", currency: "USD", canSet: true });
    const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const sales = (await api(app, manager).get(`/insights/facts/orders/groups?from=${month}-01&to=${end}&period=all`).expect(200)).body.rows[0]?.sales ?? "0.00";
    expect(t.reached).toBe(sales);
    expect(t.percent).toBe(Math.round((Number(t.reached) / 50000) * 100));
    expect((await api(app, manager).get(`/insights/targets?year=${today.slice(0, 4)}`).expect(200)).body).toEqual([{ month, amount: "50000.00", currency: "USD" }]);
    await api(app, manager).put(`/insights/targets/${month}`, { amount: 0 }).expect(200);
    expect((await api(app, manager).get("/insights/target").expect(200)).body.amount).toBeNull();
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
