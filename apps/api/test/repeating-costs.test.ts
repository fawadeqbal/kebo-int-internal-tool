import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";
import { day, today } from "./dates";

type Waiting = { key: string; description: string; amount: string; currency: string; day: number; on: string; last: { on: string; amount: string } };
type Repeating = { month: string; repeating: number; waiting: Waiting[] };

/**
 * Money, step 4: a cost of the company that comes every month. Each month's cost is an expense of its own;
 * while the latest of its chain says it repeats, the next month's is proposed, and is confirmed or skipped.
 */
describe("the company's costs that come every month", () => {
  let app: INestApplication;
  let manager: string;
  let sana: string;
  const tag = Date.now().toString(36);
  const month = today.slice(0, 7);
  // A day in the month before this one (the 3rd), whatever today is.
  const lastMonth = `${day(-Number(today.slice(8, 10)) - 1).slice(0, 7)}-03`;
  const repeating = async () => (await api(app, manager).get("/expenses/repeating").expect(200)).body as Repeating;
  const mine = async () => (await repeating()).waiting.filter((w) => w.description.endsWith(tag));
  const add = (body: object) => api(app, manager).post("/expenses", { category: "rent", currency: "USD", spentOn: lastMonth, ...body });

  beforeAll(async () => {
    app = await startApp();
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    sana = await signIn(app, "sana@example.com");
  });
  afterAll(async () => {
    await app?.close();
  });

  it("a cost marked as repeating last month is proposed this month, with last month's amount and its day", async () => {
    const rent = (await add({ description: `Office rent ${tag}`, amount: 1000, repeats: true }).expect(201)).body;
    expect(rent).toMatchObject({ repeats: true });
    expect(rent.repeatKey).toMatch(/^[0-9a-f-]{36}$/);
    // One that does not repeat is not proposed.
    await add({ description: `Paper ${tag}`, category: "office", amount: 25 }).expect(201);
    const w = await mine();
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ key: rent.repeatKey, description: `Office rent ${tag}`, amount: "1000.00", currency: "USD", day: 3, on: `${month}-03`, last: { on: lastMonth, amount: "1000.00" } });
  });

  it("confirming it adds this month's cost to the same chain, and it is not proposed again", async () => {
    const [w] = await mine();
    const confirmed = (await api(app, manager).post("/expenses", { category: "rent", description: w!.description, amount: 1050, currency: "USD", spentOn: today, repeats: true, repeatKey: w!.key }).expect(201)).body;
    expect(confirmed).toMatchObject({ repeats: true, repeatKey: w!.key, amount: "1050.00" });
    expect(await mine()).toHaveLength(0);
    // Removed by mistake: last month's is the latest again, so this month's is proposed again.
    await api(app, manager).post(`/expenses/${confirmed.id}/void`, { reason: "typed twice" }).expect(200);
    expect((await mine()).map((x) => x.amount)).toEqual(["1000.00"]);
  });

  it("skipping leaves this month out; stopping ends the chain", async () => {
    const [w] = await mine();
    const after = (await api(app, manager).post(`/expenses/repeating/${w!.key}`, { what: "skip" }).expect(200)).body as Repeating;
    expect(after.waiting.some((x) => x.key === w!.key)).toBe(false);
    // It still repeats (next month it is proposed again): only this month was skipped.
    const before = (await repeating()).repeating;
    await api(app, manager).post(`/expenses/repeating/${w!.key}`, { what: "stop" }).expect(200);
    expect((await repeating()).repeating).toBe(before - 1);
    await api(app, manager).post(`/expenses/repeating/${w!.key}`, { what: "skip" }).expect(404);
  });

  it("only a cost of the company itself repeats, and only people who see expenses open the list", async () => {
    const order = ((await api(app, manager).get("/orders?status=open").expect(200)).body as { id: string }[])[0]!;
    const onOrder = (await api(app, manager).post("/expenses", { orderId: order.id, category: "freight", description: `Freight ${tag}`, amount: 10, currency: "USD", spentOn: today, repeats: true }).expect(201)).body;
    expect(onOrder).toMatchObject({ repeats: false, repeatKey: null });
    await api(app, manager).post("/expenses", { category: "rent", description: `Other ${tag}`, amount: 1, currency: "USD", spentOn: today, repeats: true, repeatKey: "00000000-0000-4000-8000-000000000000" }).expect(400);
    await api(app, sana).get("/expenses/repeating").expect(403);
  });

  it("the company's list leaves the orders' costs out", async () => {
    const list = (await api(app, manager).get(`/expenses?kind=company&from=${lastMonth}&to=${today}&pageSize=200`).expect(200)).body as { rows: { description: string; orderId: string | null }[] };
    expect(list.rows.every((r) => r.orderId === null)).toBe(true);
    expect(list.rows.some((r) => r.description === `Office rent ${tag}`)).toBe(true);
    expect(list.rows.some((r) => r.description === `Freight ${tag}`)).toBe(false);
  });
});
