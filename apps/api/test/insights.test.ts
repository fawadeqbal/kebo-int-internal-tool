import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service";
import { api, signIn, startApp } from "./app";

describe("dashboard, reports, notifications, reminders, audit", () => {
  let app: INestApplication;
  let admin: string;
  let manager: string;
  let staff: string;

  beforeAll(async () => {
    app = await startApp();
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    staff = await signIn(app, "bilal@example.com");
  });

  afterAll(async () => {
    await app?.close();
  });

  it("gives staff their to-do and deals, and managers the money and workload too", async () => {
    const mine = (await api(app, staff).get("/dashboard").expect(200)).body;
    expect(mine.money).toBeNull();
    expect(mine.todo.length).toBeGreaterThan(0);
    expect(mine.todo[0]).toHaveProperty("needs.title");
    expect(mine.todo[0].needs.late).toBe(true); // Bilal's goods are past the factory's ready date
    const all = (await api(app, manager).get("/dashboard").expect(200)).body;
    expect(all.money.currency).toBe("USD");
    expect(Number(all.money.now.toReceive)).toBeGreaterThan(0);
    expect(all.workload.some((p: { name: string; openOrders: number }) => p.name === "Bilal" && p.openOrders > 0)).toBe(true);
  });

  it("reports funnel, lost reasons and profit; staff cannot see reports", async () => {
    await api(app, staff).get("/reports").expect(403);
    const r = (await api(app, manager).get("/reports?from=2020-01-01&to=2099-12-31").expect(200)).body;
    expect(r.funnel.received).toBeGreaterThan(0);
    expect(r.funnel.won).toBeGreaterThan(0);
    expect(r.lostReasons.map((x: { reason: string }) => x.reason)).toEqual(expect.arrayContaining(["price_too_high"]));
    expect(Number(r.profit.total.profit)).toBeGreaterThan(0);
    expect(r.trend).toHaveLength(12);
  });

  it("notifies people about what happened (and never the person who did it)", async () => {
    const customer = (await api(app, staff).get("/customers?pageSize=1").expect(200)).body.rows[0];
    const created = (await api(app, staff).post("/inquiries", { customerId: customer.id, category: "Machinery", items: [{ description: "Notify test item", quantity: 1 }] }).expect(201)).body;
    const n = (await api(app, manager).get("/notifications").expect(200)).body;
    expect(n.items.some((x: { type: string; link: string }) => x.type === "inquiry.created" && x.link === `/inquiries/${created.id}`)).toBe(true);
    const own = (await api(app, staff).get("/notifications").expect(200)).body;
    expect(own.items.some((x: { link: string; type: string }) => x.type === "inquiry.created" && x.link === `/inquiries/${created.id}`)).toBe(false);
    await api(app, manager).post("/notifications/read", { ids: "all" }).expect(200);
    expect((await api(app, manager).get("/notifications").expect(200)).body.unread).toBe(0);
  });

  it("runs reminders once a day: orders waiting too long reach the handler", async () => {
    const first = (await api(app, admin).post("/admin/reminders/run").expect(200)).body;
    const again = (await api(app, admin).post("/admin/reminders/run").expect(200)).body;
    expect(again.sent).toBe(0); // same day: nothing twice
    expect(first.sent).toBeGreaterThanOrEqual(0);
    const prisma = app.get(PrismaService);
    const bilal = await prisma.db.user.findUniqueOrThrow({ where: { email: "bilal@example.com" } });
    const late = await prisma.db.notification.findFirst({ where: { userId: bilal.id, type: "reminder.order" } });
    expect(late?.title).toMatch(/Goods due from the factory|Get the|orders need you/);
    await api(app, staff).post("/admin/reminders/run").expect(403);
  });

  it("keeps an audit trail managers can read", async () => {
    await api(app, staff).get("/audit").expect(403);
    const a = (await api(app, manager).get("/audit?entityType=order&pageSize=5").expect(200)).body;
    expect(a.rows.length).toBeGreaterThan(0);
    expect(a.rows[0]).toHaveProperty("userName");
  });

  it("keeps the company stamp image in the settings (a data URL of a few hundred KB)", async () => {
    const before = (await api(app, admin).get("/settings").expect(200)).body.company;
    const stamp = `data:image/jpeg;base64,${"A".repeat(300_000)}`;
    const saved = (await api(app, admin).put("/settings/company", { ...before, stamp }).expect(200)).body;
    expect(JSON.stringify(saved)).toContain(stamp.slice(0, 40));
    await api(app, admin).put("/settings/company", { ...before, stamp: "javascript:alert(1)" }).expect(422);
    await api(app, admin).put("/settings/company", before).expect(200);
  });
});
