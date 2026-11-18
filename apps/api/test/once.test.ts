import type { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { api, signIn, startApp } from "./app";
import { PrismaService } from "../src/database/prisma.service";
import { Clock } from "../src/common/time/clock.service";

/**
 * One-time keys (common/http/once.ts): a money save sent with an Idempotency-Key is done once; a repeat (a double
 * tap, a retry after the answer was lost, the phone sending its waiting saves again) gets the first answer.
 */
describe("money saves are done once per key", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let manager: string;
  let admin: string;
  let today = "";
  const tag = Date.now().toString(36);
  const db = () => prisma.company(FIRST_COMPANY_ID);
  const expense = (description: string, amount = 1200) => ({ category: "office", description, amount, currency: "USD", spentOn: today });
  const send = (body: object, key?: string) => {
    const r = api(app, manager).post("/expenses", body);
    return key ? r.set("idempotency-key", key) : r;
  };
  const count = (description: string) => db().expense.count({ where: { description } });

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    today = app.get(Clock).today();
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    admin = await signIn(app, "admin@example.com", "Admin@12345");
  });

  afterAll(async () => {
    await app?.close();
  });

  it("a repeat with the same key saves nothing more and gets the first answer", async () => {
    const key = `test-${tag}-1`;
    const first = await send(expense(`Toner ${tag}`), key).expect(201);
    const again = await send(expense(`Toner ${tag}`), key).expect(201);
    expect(again.body).toEqual(first.body);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(first.headers["idempotent-replayed"]).toBeUndefined();
    expect(await count(`Toner ${tag}`)).toBe(1);
  });

  it("two at the same moment: one save, and both get its answer", async () => {
    const key = `test-${tag}-2`;
    const [a, b] = await Promise.all([send(expense(`Document ${tag}`), key), send(expense(`Document ${tag}`), key)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body).toEqual(b.body);
    expect(await count(`Document ${tag}`)).toBe(1);
  });

  it("the same key with other details is refused; a new key is a new save; without a key, as before", async () => {
    const key = `test-${tag}-3`;
    await send(expense(`Ink ${tag}`, 500), key).expect(201);
    const other = await send(expense(`Ink ${tag}`, 700), key).expect(422);
    expect(other.body.error).toBe("This was already saved with other details. Close the window and check the list before saving again.");
    await send(expense(`Ink ${tag}`, 500), `test-${tag}-4`).expect(201);
    await send(expense(`Ink ${tag}`, 500)).expect(201);
    await send(expense(`Ink ${tag}`, 500)).expect(201);
    expect(await count(`Ink ${tag}`)).toBe(4);
  });

  it("a save that failed lets its key go: corrected and sent again with it, it saves", async () => {
    const key = `test-${tag}-5`;
    await send({ ...expense(`Stamps ${tag}`), amount: 0 }, key).expect(422);
    await send(expense(`Stamps ${tag}`), key).expect(201);
    await send(expense(`Stamps ${tag}`), key).expect(201);
    expect(await count(`Stamps ${tag}`)).toBe(1);
  });

  it("a key that is not one is refused before anything is saved", async () => {
    const res = await send(expense(`Glue ${tag}`), "no good!").expect(400);
    expect(res.body.error).toBe("This save's one-time key is not valid. Reload and try again.");
    expect(await count(`Glue ${tag}`)).toBe(0);
  });

  it("keys are per person: another person's key is theirs", async () => {
    const key = `test-${tag}-6`;
    await send(expense(`Tape ${tag}`), key).expect(201);
    await api(app, admin).post("/expenses", expense(`Tape ${tag}`)).set("idempotency-key", key).expect(201);
    expect(await count(`Tape ${tag}`)).toBe(2);
  });

  it("every money save takes a key: money in and out, credit, receipts, refunds, costs, repaying, transfers, submissions", async () => {
    const id = randomUUID();
    const routes = [
      `/orders/${id}/payments`,
      `/orders/${id}/use-credit`,
      `/customers/${id}/receipts`,
      `/customers/${id}/credit/refund`,
      `/orders/${id}/factory-payments`,
      "/expenses",
      `/expenses/${id}/repay`,
      "/money/transfers",
      "/submissions",
    ];
    for (const url of routes) {
      const res = await api(app, admin).post(url, {}).set("idempotency-key", "not a key!");
      expect([url, res.status, res.body.error]).toEqual([url, 400, "This save's one-time key is not valid. Reload and try again."]);
    }
  });
});
