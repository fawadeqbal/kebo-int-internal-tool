import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";
import { today } from "./dates";

type Submission = { id: string; status: string; kind: string; order: { id: string } | null; amount: string | null; can: { approve: boolean; withdraw: boolean } };
type List = { rows: Submission[]; total: number };

/**
 * Money, step 7: Staff add money on the web and a manager verifies it. The rules of sending and approving
 * (nothing counts while it waits; approved, it is recorded as the approver) are tested in approvals.test.ts.
 * Here, what the web windows need on top: the account names for someone who only sends money, and one
 * order's waiting money for its Payment tab. What is sent here is taken back, so no order's money moves.
 */
describe("staff add, a manager verifies: what the web windows read", () => {
  let app: INestApplication;
  let manager: string;
  let sana: string;
  let orders: { id: string; due: string; currency: string }[];
  const sent: string[] = [];
  const send = async (orderId: string, amount: number) => {
    const s = (await api(app, sana).post("/submissions", { kind: "payment", orderId, body: { currency: "USD", receivedCurrency: "USD", receivedAmount: amount, amount, paidOn: today, method: "bank_transfer" } }).expect(201)).body as Submission;
    sent.push(s.id);
    return s;
  };

  beforeAll(async () => {
    app = await startApp();
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    sana = await signIn(app, "sana@example.com");
    // Two orders Sana sees that still have money to come, in USD.
    const owed = (await api(app, sana).get("/money/receivables").expect(200)).body as { rows: { id: string; due: string; currency: string }[] };
    orders = owed.rows.filter((r) => r.currency === "USD" && Number(r.due) > 50).slice(0, 2);
    expect(orders).toHaveLength(2);
  });
  afterAll(async () => {
    // Taken back, so the next test's lists and figures are as they were.
    for (const id of sent) await api(app, sana).post(`/submissions/${id}/withdraw`, {});
    await app?.close();
  });

  it("someone who only sends money can choose the account: names, no balances", async () => {
    const mine = (await api(app, sana).get("/money/accounts").expect(200)).body as Record<string, unknown>[];
    for (const a of mine) {
      expect(Object.keys(a).sort()).toEqual(["archived", "currency", "id", "kind", "name"]);
    }
    // A manager still sees what is in each.
    const all = (await api(app, manager).get("/money/accounts").expect(200)).body as Record<string, unknown>[];
    expect(all.length).toBe(mine.length);
    if (all.length) expect(all[0]).toHaveProperty("balance");
  });

  it("an order's Payment tab reads only that order's waiting money: the sender theirs, the manager to verify", async () => {
    const [a, b] = orders;
    const onA = await send(a!.id, 10);
    const onB = await send(b!.id, 20);
    const ofSana = (await api(app, sana).get(`/submissions?status=all&mine=true&orderId=${a!.id}&pageSize=100`).expect(200)).body as List;
    expect(ofSana.rows.map((r) => r.id)).toContain(onA.id);
    expect(ofSana.rows.map((r) => r.id)).not.toContain(onB.id);
    expect(ofSana.rows.every((r) => r.order?.id === a!.id)).toBe(true);
    expect(ofSana.rows.find((r) => r.id === onA.id)).toMatchObject({ status: "pending", can: { approve: false, withdraw: true } });
    const ofManager = (await api(app, manager).get(`/submissions?status=all&orderId=${b!.id}&pageSize=100`).expect(200)).body as List;
    expect(ofManager.rows.map((r) => r.id)).toContain(onB.id);
    expect(ofManager.rows.every((r) => r.order?.id === b!.id)).toBe(true);
    expect(ofManager.rows.find((r) => r.id === onB.id)).toMatchObject({ status: "pending", can: { approve: true } });
    await api(app, sana).get("/submissions?orderId=not-an-id").expect(422);
  });
});
