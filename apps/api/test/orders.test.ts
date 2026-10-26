import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

describe("orders: the checklist through the API", () => {
  let app: INestApplication;
  let sana: string;
  let bilal: string;
  let manager: string;
  let orderId: string;

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    bilal = await signIn(app, "bilal@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    // Sana's open order on balance-against-B/L-copy terms (from the demo seed).
    const mine = await api(app, sana).get("/orders?mine=true").expect(200);
    orderId = mine.body.find((o: { stage: string }) => o.stage === "awaiting_deposit").id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("refuses requests without a session", async () => {
    await api(app).get("/orders").expect(401);
    const bad = await api(app).post("/auth/login", { email: "sana@example.com", password: "wrong" }).expect(401);
    expect(bad.body.error).toBe("Wrong email or password.");
  });

  it("shows staff only their own deals", async () => {
    await api(app, bilal).get(`/orders/${orderId}`).expect(404);
    await api(app, manager).get(`/orders/${orderId}`).expect(200);
  });

  it("gives the plan in the order the terms set, with the next step", async () => {
    const res = await api(app, sana).get(`/orders/${orderId}`).expect(200);
    const keys = res.body.plan.steps.map((s: { key: string }) => s.key);
    expect(keys.indexOf("shipped")).toBeLessThan(keys.indexOf("customer_balance"));
    expect(res.body.plan.next.key).toBe("customer_deposit");
    expect(res.body.plan.next.hint).toMatch(/^30% deposit: USD /);
  });

  it("keeps money in before money out: staff are stopped, a manager must explain an override", async () => {
    const blocked = await api(app, sana).post(`/orders/${orderId}/steps`, { action: "done", key: "factory_deposit" }).expect(409);
    expect(blocked.body).toMatchObject({ code: "deposit_first", error: "Wait for the customer's deposit before paying the factory." });
    const noNote = await api(app, manager).post(`/orders/${orderId}/steps`, { action: "done", key: "factory_deposit" }).expect(409);
    expect(noNote.body.code).toBe("note_required");
  });

  it("marks steps done and moves the next step on", async () => {
    const done = await api(app, sana).post(`/orders/${orderId}/steps`, { action: "done", key: "customer_deposit", note: "TT received" }).expect(200);
    const deposit = done.body.plan.steps.find((s: { key: string }) => s.key === "customer_deposit");
    expect(deposit.status).toBe("done");
    expect(done.body.plan.next.key).toBe("factory_order");
    expect(done.body.stage).toBe("in_production");
    // and back again
    const undone = await api(app, sana).post(`/orders/${orderId}/steps`, { action: "undo", key: "customer_deposit" }).expect(200);
    expect(undone.body.plan.next.key).toBe("customer_deposit");
  });

  it("validates input with clear messages", async () => {
    const res = await api(app, sana).post(`/orders/${orderId}/steps`, { action: "finish", key: "nope" }).expect(422);
    expect(res.body.fieldErrors).toHaveProperty("action");
    const future = await api(app, sana).post(`/orders/${orderId}/steps`, { action: "done", key: "customer_deposit", on: "2099-01-01" }).expect(409);
    expect(future.body.code).toBe("future_date");
  });

  it("recalculates due dates when the ship date changes", async () => {
    const res = await api(app, sana).patch(`/orders/${orderId}/dates`, { shipBy: "2027-03-01", readyOn: null }).expect(200);
    const shipped = res.body.plan.steps.find((s: { key: string }) => s.key === "shipped");
    expect(shipped.due).toBe("2027-03-01");
  });

  it("lists my to-do with late work first", async () => {
    const res = await api(app, bilal).get("/me/todo").expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].next.overdue).toBe(true);
  });
});
