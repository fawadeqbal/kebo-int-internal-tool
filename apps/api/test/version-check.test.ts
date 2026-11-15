import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";
import { Clock } from "../src/common/time/clock.service";

/** A save sends the version it started from (If-Match): one over someone else's change is refused, never silent. */
describe("saves check the version they started from", () => {
  let app: INestApplication;
  let sana: string;
  let manager: string;
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
  });
  afterAll(async () => {
    await app?.close();
  });

  it("a customer: the manager's change first, then Sana's from her older copy is refused, with who and when", async () => {
    const made = (await api(app, sana).post("/customers", { name: `Version Pharma ${tag}`, country: "PK", contacts: [{ name: "Ali", email: `ali-${tag}@v.test` }] }).expect(201)).body;
    const opened = (await api(app, sana).get(`/customers/${made.id}`).expect(200)).body;
    const body = (c: typeof opened, address: string) => ({
      type: c.type,
      name: c.name,
      country: c.country,
      address,
      defaultCurrency: c.defaultCurrency,
      contacts: c.contacts.map((x: { id: string; name: string; email: string | null }) => ({ id: x.id, name: x.name, email: x.email, isPrimary: true })),
    });
    // The manager opened it at the same time, and saves first.
    await api(app, manager).put(`/customers/${made.id}`, body(opened, "Plot 9, Lahore")).set("if-match", opened.updatedAt).expect(200);
    const late = await api(app, sana).put(`/customers/${made.id}`, body(opened, "Plot 1, Lahore")).set("if-match", opened.updatedAt).expect(409);
    expect(late.body.code).toBe("stale");
    expect(late.body.error).toMatch(/^\S.* changed this while you had it open \((just now|\d+ minutes? ago)\)\. Reload to see their change, then make yours again\.$/);
    expect((await api(app, sana).get(`/customers/${made.id}`).expect(200)).body.address).toBe("Plot 9, Lahore");
    // Reloaded: her save goes through. Without a version, as before.
    const fresh = (await api(app, sana).get(`/customers/${made.id}`).expect(200)).body;
    await api(app, sana).put(`/customers/${made.id}`, body(fresh, "Plot 1, Lahore")).set("if-match", fresh.updatedAt).expect(200);
    await api(app, sana).put(`/customers/${made.id}`, body(fresh, "Plot 2, Lahore")).expect(200);
  });

  it("money: a payment on an order and a cost, each changed from an older copy, are refused", async () => {
    const today = app.get(Clock).today();
    // An open order in USD that still has money to come (the demo has them).
    const open = (await api(app, manager).get("/orders").query({ status: "open" }).expect(200)).body as { id: string; currency: string }[];
    let orderId: string | null = null;
    for (const o of open.filter((x) => x.currency === "USD")) {
      if (Number((await api(app, manager).get(`/orders/${o.id}/payments`).expect(200)).body.due) > 5) {
        orderId = o.id;
        break;
      }
    }
    expect(orderId).not.toBeNull();
    const pay = { receivedAmount: 2, receivedCurrency: "USD", amount: 2, currency: "USD", bankCharges: 0, paidOn: today, reference: `V-${tag}` };
    const id = (await api(app, manager).post(`/orders/${orderId}/payments`, pay).expect(201)).body.createdId as string;
    const opened = ((await api(app, manager).get(`/orders/${orderId}/payments`).expect(200)).body.payments as { id: string; updatedAt: string }[]).find((p) => p.id === id)!;
    expect(opened.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await api(app, manager)
      .patch(`/payments/${id}`, { ...pay, receivedAmount: 3, amount: 3, reason: "It was 3" })
      .set("if-match", opened.updatedAt)
      .expect(200);
    const late = await api(app, manager)
      .patch(`/payments/${id}`, { ...pay, receivedAmount: 4, amount: 4, reason: "It was 4" })
      .set("if-match", opened.updatedAt)
      .expect(409);
    expect(late.body.code).toBe("stale");
    const kept = ((await api(app, manager).get(`/orders/${orderId}/payments`).expect(200)).body.payments as { id: string; amount: string }[]).find((p) => p.id === id)!;
    expect(kept.amount).toBe("3.00");
    await api(app, manager).post(`/payments/${id}/void`, { reason: "A test payment" }).expect(200);

    // A cost of the company.
    const cost = { category: "office", description: `Paper ${tag}`, amount: 5, currency: "USD", spentOn: today };
    const made = (await api(app, manager).post("/expenses", cost).expect(201)).body as { id: string; updatedAt: string };
    await api(app, manager)
      .patch(`/expenses/${made.id}`, { ...cost, amount: 6, reason: "It was 6" })
      .set("if-match", made.updatedAt)
      .expect(200);
    const stale = await api(app, manager)
      .patch(`/expenses/${made.id}`, { ...cost, amount: 7, reason: "It was 7" })
      .set("if-match", made.updatedAt)
      .expect(409);
    expect(stale.body.code).toBe("stale");
    await api(app, manager).post(`/expenses/${made.id}/void`, { reason: "A test cost" }).expect(200);
  });
});
