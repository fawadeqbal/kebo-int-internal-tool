import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";
import { day, today } from "./dates";

type Account = { id: string; name: string; currency: string; openedOn: string | null; start: string; in: string; out: string; end: string; now: string };
type Month = { month: string; customers: string; suppliers: string; bills: string; company: string; net: string; cashEnd: string };
type Report = {
  currency: string;
  from: string;
  to: string;
  months: Month[];
  total: { customers: string; suppliers: string; bills: string; company: string; net: string };
  in: { amount: string; entries: number };
  out: { amount: string; entries: number };
  cashNow: string;
  byCurrency: { currency: string; accounts: number; amount: string; inMain: string }[];
  accounts: Account[];
  offAccount: number;
};
const cents = (v: string) => Math.round(Number(v) * 100);

/**
 * Money, step 5 (Reports › Cash): what the accounts did in a period, read from the cash book's own rows.
 * Other tests record money at the same time, so the checks are on two accounts made here and on sums that
 * must hold whatever else is recorded.
 */
describe("the cash report", () => {
  let app: INestApplication;
  let manager: string;
  let sana: string;
  const tag = Date.now().toString(36);
  const from = day(-10);
  const report = async (q = `from=${from}&to=${today}`) => (await api(app, manager).get(`/money/cash-report?${q}`).expect(200)).body as Report;
  let a: string;
  let b: string;

  beforeAll(async () => {
    app = await startApp();
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    sana = await signIn(app, "sana@example.com");
    const account = async (name: string, openingBalance: number) =>
      ((await api(app, manager).post("/money/accounts", { name: `${name} ${tag}`, kind: "bank", currency: "USD", openingBalance, openingOn: day(-40) }).expect(201)).body as { id: string }).id;
    a = await account("Report A", 1000);
    b = await account("Report B", 0);
    const cost = (amount: number, spentOn: string) =>
      api(app, manager).post("/expenses", { category: "office", description: `Paper ${tag}`, amount, currency: "USD", spentOn, accountId: a }).expect(201);
    // Before the period: 100 left A. In the period: 200 left A for a cost, and 300 moved from A to B.
    await cost(100, day(-20));
    await cost(200, day(-2));
    await api(app, manager).post("/money/transfers", { fromAccountId: a, toAccountId: b, amountOut: 300, transferredOn: day(-1) }).expect(201);
  });
  afterAll(async () => {
    await app?.close();
  });

  it("an account starts with what it held the day before, and ends with what it holds on Cash & bank", async () => {
    const r = await report();
    const ra = r.accounts.find((x) => x.id === a)!;
    const rb = r.accounts.find((x) => x.id === b)!;
    expect(ra).toMatchObject({ start: "900.00", in: "0.00", out: "500.00", end: "400.00", now: "400.00", openedOn: null });
    expect(rb).toMatchObject({ start: "0.00", in: "300.00", out: "0.00", end: "300.00", now: "300.00" });
    const book = (await api(app, manager).get("/money/accounts").expect(200)).body as { id: string; balance: string }[];
    expect(book.find((x) => x.id === a)!.balance).toBe("400.00");
    expect(book.find((x) => x.id === b)!.balance).toBe("300.00");
  });

  it("a period that ends before today leaves later moves out of the end, not out of now", async () => {
    const r = await report(`from=${from}&to=${day(-2)}`);
    expect(r.accounts.find((x) => x.id === a)).toMatchObject({ start: "900.00", out: "200.00", end: "700.00", now: "400.00" });
    // An account opened inside the period says so, and starts with what was in it that day.
    const early = await report(`from=${day(-60)}&to=${today}`);
    expect(early.accounts.find((x) => x.id === a)).toMatchObject({ openedOn: day(-40), start: "1000.00", out: "600.00", end: "400.00" });
  });

  it("each month's net is what came in less what went out, and a move between our accounts is in neither", async () => {
    const r = await report();
    expect(r.months.map((m) => m.month)).toContain(today.slice(0, 7));
    for (const m of r.months) expect(cents(m.net)).toBe(cents(m.customers) - cents(m.suppliers) - cents(m.bills) - cents(m.company));
    const sum = (k: "customers" | "suppliers" | "bills" | "company" | "net") => r.months.reduce((t, m) => t + cents(m[k]), 0);
    for (const k of ["customers", "suppliers", "bills", "company", "net"] as const) expect(sum(k)).toBe(cents(r.total[k]));
    expect(cents(r.in.amount)).toBe(cents(r.total.customers));
    expect(cents(r.out.amount)).toBe(cents(r.total.suppliers) + cents(r.total.bills) + cents(r.total.company));
    // The cost paid from A in the period is a company cost of at least that much.
    expect(cents(r.total.company)).toBeGreaterThanOrEqual(20000);
    expect(cents(r.cashNow)).toBe(r.byCurrency.reduce((t, x) => t + cents(x.inMain), 0));
    expect(r.byCurrency.find((x) => x.currency === "USD")!.accounts).toBeGreaterThanOrEqual(2);
  });

  it("the company's own costs of a month are told apart, for Reports › Profit", async () => {
    const admin = await signIn(app, "admin@example.com", "Admin@12345");
    const facts = (await api(app, admin).get(`/insights/facts/cash?from=${day(-25)}&to=${today}`).expect(200)).body as { months: { month: string; expenses: string; company: string }[] };
    const company = facts.months.reduce((t, m) => t + cents(m.company), 0);
    // The two costs paid from A have no order: both are the company's (other tests add more).
    expect(company).toBeGreaterThanOrEqual(30000);
    for (const m of facts.months) expect(cents(m.company)).toBeLessThanOrEqual(cents(m.expenses));
  });

  it("is for managers", async () => {
    await api(app, sana).get(`/money/cash-report?from=${from}&to=${today}`).expect(403);
    await api(app, manager).get("/money/cash-report?from=yesterday&to=today").expect(422);
  });
});
