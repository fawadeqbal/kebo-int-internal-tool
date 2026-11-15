import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";
import { Clock } from "../src/common/time/clock.service";

/** The month close: money dated in a closed month stays as it was reported; reopening says why. */
describe("closing the books", () => {
  let app: INestApplication;
  let admin: string;
  let manager: string;
  let latest = "";
  let today = "";
  const tag = Date.now().toString(36);
  const expense = (spentOn: string, extra: object = {}) => ({ category: "office", description: `Paper ${tag}`, amount: 120, currency: "USD", spentOn, ...extra });
  const closed = /^The books are closed through \d{2} \w{3} \d{4}: money dated then stays as it was reported\. Date it later, or reopen the month in Settings › Closed months\.$/;

  beforeAll(async () => {
    app = await startApp();
    today = app.get(Clock).today();
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    latest = (await api(app, admin).get("/books/close").expect(200)).body.latest;
  });

  afterAll(async () => {
    await api(app, admin).put("/books/close", { month: null, reason: "Test done: open again" });
    await app?.close();
  });

  it("closes a month that has ended (settings.manage), never this one", async () => {
    const sana = await signIn(app, "sana@example.com");
    await api(app, sana).put("/books/close", { month: latest.slice(0, 7) }).expect(403);
    await api(app, admin).put("/books/close", { month: today.slice(0, 7) }).expect(400);
    const made = await api(app, manager).post("/expenses", expense(latest));
    if (made.status !== 201) console.log("expense:", made.status, JSON.stringify(made.body));
    const before = made.body;
    (globalThis as { kept?: string }).kept = before.id;
    const v = (await api(app, admin).put("/books/close", { month: latest.slice(0, 7) }).expect(200)).body;
    expect(v).toMatchObject({ closedThrough: latest, closedBy: "Super Admin" });
  });

  it("refuses money dated then, and changing or removing it; a later date and its note are fine", async () => {
    const id = (globalThis as { kept?: string }).kept!;
    const refused = await api(app, manager).post("/expenses", expense(latest)).expect(409);
    expect(refused.body).toMatchObject({ code: "books_closed" });
    expect(refused.body.error).toMatch(closed);
    await api(app, manager).post("/expenses", expense(today)).expect(201);
    await api(app, manager).patch(`/expenses/${id}`, expense(latest, { amount: 150, reason: "Wrong amount" })).expect(409);
    await api(app, manager).post(`/expenses/${id}/void`, { reason: "Entered twice" }).expect(409);
    // Moving it out of the closed month is a change to it too.
    await api(app, manager).patch(`/expenses/${id}`, expense(today, { reason: "Wrong day" })).expect(409);
    await api(app, manager).patch(`/expenses/${id}`, expense(latest, { note: "Receipt in the blue file", reason: "A note" })).expect(200);
  });

  it("reopening says why, and then the change goes through", async () => {
    const id = (globalThis as { kept?: string }).kept!;
    await api(app, admin).put("/books/close", { month: null }).expect(400);
    await api(app, admin).put("/books/close", { month: null, reason: "A late invoice for last month" }).expect(200);
    expect((await api(app, manager).get("/books/close").expect(200)).body.closedThrough).toBeNull();
    await api(app, manager).patch(`/expenses/${id}`, expense(latest, { amount: 150, reason: "Wrong amount" })).expect(200);
    const audit = (await api(app, admin).get("/audit?entityType=settings&pageSize=5").expect(200)).body;
    expect(JSON.stringify(audit)).toContain("A late invoice for last month");
  });
});
