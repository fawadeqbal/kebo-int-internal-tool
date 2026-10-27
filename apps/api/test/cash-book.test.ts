import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/** Our money accounts, moves between them, the account on each payment and expense, and the cash book. */
describe("cash book", () => {
  let app: INestApplication;
  let manager: string;
  let sana: string;
  let bank: string;
  let cash: string;
  const tag = Date.now().toString(36);
  const today = new Date().toISOString().slice(0, 10);
  const book = async (q: string) => (await api(app, manager).get(`/money/cash-book?from=${today}&to=${today}&${q}`).expect(200)).body;
  const balance = async (id: string) => ((await api(app, manager).get("/money/accounts").expect(200)).body as { id: string; balance: string }[]).find((a) => a.id === id)!.balance;

  beforeAll(async () => {
    app = await startApp();
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    sana = await signIn(app, "sana@example.com");
  });

  afterAll(async () => {
    await app?.close();
  });

  it("keeps accounts with an opening balance; staff cannot see the cash book", async () => {
    bank = (await api(app, manager).post("/money/accounts", { name: `Meezan USD ${tag}`, kind: "bank", currency: "USD", openingBalance: 1000, openingOn: "2026-01-01" }).expect(201)).body.id;
    cash = (await api(app, manager).post("/money/accounts", { name: `Office cash ${tag}`, kind: "cash", currency: "PKR", openingBalance: 50000, openingOn: "2026-01-01" }).expect(201)).body.id;
    await api(app, manager).post("/money/accounts", { name: `meezan usd ${tag}`, currency: "USD", openingOn: "2026-01-01" }).expect(400);
    expect(await balance(bank)).toBe("1000.00");
    await api(app, sana).get(`/money/cash-book?from=${today}&to=${today}`).expect(403);
  });

  it("puts payments and expenses on an account of the same currency", async () => {
    await api(app, manager)
      .post("/expenses", { category: "meals", description: `Lunch ${tag}`, amount: 3000, currency: "PKR", rate: 280, spentOn: today, accountId: bank })
      .expect(400)
      .expect((r) => expect(r.body.error).toMatch(/holds USD/));
    await api(app, manager).post("/expenses", { category: "meals", description: `Lunch ${tag}`, amount: 3000, currency: "PKR", rate: 280, spentOn: today, accountId: cash }).expect(201);
    expect(await balance(cash)).toBe("47000.00");

    const orders = (await api(app, manager).get("/orders?status=open").expect(200)).body as { id: string; currency: string }[];
    const order = orders.find((o) => o.currency === "USD")!;
    await api(app, manager).post(`/orders/${order.id}/payments`, { kind: "balance", amount: 10, currency: "USD", paidOn: today, accountId: bank, reference: `TT-${tag}` }).expect(201);
    expect(await balance(bank)).toBe("1010.00");
    const pays = (await api(app, manager).get(`/orders/${order.id}/payments`).expect(200)).body.payments;
    expect(pays.find((p: { reference: string }) => p.reference === `TT-${tag}`).account).toMatchObject({ id: bank });
  });

  it("moves money between accounts, in two currencies when they differ", async () => {
    const move = { fromAccountId: bank, toAccountId: cash, amountOut: 100, transferredOn: today, note: `Changed to rupees ${tag}` };
    await api(app, manager).post("/money/transfers", move).expect(400);
    const t = (await api(app, manager).post("/money/transfers", { ...move, amountIn: 28000 }).expect(201)).body;
    expect(await balance(bank)).toBe("910.00");
    expect(await balance(cash)).toBe("75000.00");

    const b = await book(`account=${bank}`);
    expect(b).toMatchObject({ opening: "1000.00", closing: "910.00", account: { id: bank } });
    expect(b.rows.map((r: { kind: string; amount: string; balance: string }) => [r.kind, r.amount, r.balance])).toEqual([
      ["in", "10.00", "1010.00"],
      ["transfer_out", "-100.00", "910.00"],
    ]);
    // All accounts: moves between our accounts are not counted as money in or out.
    const all = await book("currency=USD");
    expect(all.rows.some((r: { kind: string }) => r.kind === "transfer_out")).toBe(true);
    const usd = all.totals.find((x: { currency: string }) => x.currency === "USD");
    expect(Number(usd.in)).toBeGreaterThanOrEqual(10);

    await api(app, manager).post(`/money/transfers/${t.id}/void`, { reason: "Typed twice" }).expect(200);
    expect(await balance(bank)).toBe("1010.00");
    expect(await balance(cash)).toBe("47000.00");
  });

  it("lists what has no account yet, and puts it on one afterwards", async () => {
    const e = (await api(app, manager).post("/expenses", { category: "office", description: `Paper ${tag}`, amount: 25, currency: "USD", spentOn: today }).expect(201)).body;
    const none = await book("account=none");
    expect(none.rows.some((r: { id: string }) => r.id === e.id)).toBe(true);
    expect(none.unassigned).toBeGreaterThan(0);
    await api(app, manager).put(`/money/entries/expense/${e.id}/account`, { accountId: cash }).expect(400);
    await api(app, manager).put(`/money/entries/expense/${e.id}/account`, { accountId: bank }).expect(200);
    expect(await balance(bank)).toBe("985.00");
    // A used account keeps its currency.
    await api(app, manager).patch(`/money/accounts/${bank}`, { name: `Meezan USD ${tag}`, kind: "bank", currency: "PKR", openingBalance: 1000, openingOn: "2026-01-01" }).expect(400);
    // Closing it keeps it in the list but not for new money.
    await api(app, manager).patch(`/money/accounts/${cash}`, { name: `Office cash ${tag}`, kind: "cash", currency: "PKR", openingBalance: 50000, openingOn: "2026-01-01", archived: true }).expect(200);
    await api(app, manager)
      .post("/expenses", { category: "meals", description: "Tea", amount: 500, currency: "PKR", rate: 280, spentOn: today, accountId: cash })
      .expect(400)
      .expect((r) => expect(r.body.error).toMatch(/is closed/));
  });
});
