import type { INestApplication } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIRST_COMPANY_ID, seedCompanyBase } from "@kebo/database";
import { api, signIn, startApp } from "./app";
import { PrismaService, type Tx } from "../src/database/prisma.service";
import { Clock } from "../src/common/time/clock.service";
import { CompanyContext } from "../src/common/company/company-context";
import { toInfo } from "../src/common/company/companies.service";
import { LedgerPosting } from "../src/modules/ledger/posting.service";

type Row = {
  id: string;
  entryNo: number;
  groupId: string;
  type: string;
  sourceType: string;
  sourceId: string;
  part: string;
  account: string;
  debit: string;
  credit: string;
  currency: string;
  debitBase: string;
  creditBase: string;
  reversesId: string | null;
  reason: string | null;
  ref: string;
  orderId: string | null;
  date: Date;
};
type Check = { differences: { kind: string; key: string; ledger: string; expected: string }[]; checked: Record<string, number> };

/**
 * Finance › Ledger: every write path posts its document's rows in the same transaction (payments, transfers over
 * several orders, credit used, refunded and removed, factory payments, expenses and who bears them, own money and
 * its repayment, transfers between accounts, opening balances, orders made and cancelled, approvals); a change is
 * a reversal plus the new rows (an order's or factory part's amounts: the difference); exchange differences; every
 * posting balanced; rows never changed; the rebuild idempotent; the check against today's figures; the read
 * endpoints, who may read them, and another company reaches none of it.
 */
describe("the ledger", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let posting: LedgerPosting;
  let sana: string;
  let manager: string;
  let admin: string;
  let bilal: string;
  let me: string;
  let managerId: string;
  let customerId: string;
  let factoryId: string;
  let usdAccount: string;
  let cnyAccount: string;
  let today = "";
  const tag = Date.now().toString(36);
  const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const day = (n: number) => addDays(today, n);
  const db = () => prisma.company(FIRST_COMPANY_ID);
  const inCompany = async <T>(fn: () => Promise<T>) => {
    const c = await prisma.platform.company.findUniqueOrThrow({ where: { id: FIRST_COMPANY_ID } });
    return CompanyContext.run(toInfo(c), fn);
  };
  const n = (v: { toString(): string } | null | undefined) => Number(v?.toString() ?? 0);

  /** A new deal for the customer, quoted and accepted: its order's id. */
  const newOrder = async (price = 71000, currency = "USD", factory = factoryId) => {
    const inquiry = (
      await api(app, sana)
        .post("/inquiries", {
          customerId,
          category: "Machinery",
          assigneeId: me,
          items: [{ description: "Cartoning machine", quantity: 1 }],
        })
        .expect(201)
    ).body;
    const item = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, {
        factoryId: factory,
        receivedOn: day(-5),
        currency: "CNY",
        lines: [{ requestedItemId: item.id, description: "ZH-120", quantity: 1, unitPrice: price, taxRate: 13 }],
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiry.id}/quotation/draft`)).body;
    const r = (
      await api(app, sana)
        .post(`/inquiries/${inquiry.id}/quotation/revisions`, { ...draft, depositPercent: 30, currency })
        .expect(201)
    ).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "accepted" }).expect(200);
    return (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.orders[0].id as string;
  };
  const rowsOf = (sourceType: string, sourceId: string) =>
    db().ledgerEntry.findMany({ where: { sourceType, sourceId }, orderBy: [{ entryNo: "asc" }, { line: "asc" }] }) as unknown as Promise<
      Row[]
    >;
  /** What the customer owes on an order as the ledger has it (debit − credit), and in the main currency. */
  const owedOn = async (orderId: string) => {
    const o = await db().order.findUniqueOrThrow({ where: { id: orderId } });
    const rows = (await db().ledgerEntry.findMany({
      where: { orderId, account: `customer:${o.customerId}`, currency: o.currency },
    })) as unknown as Row[];
    return {
      minor: Math.round(rows.reduce((t, r) => t + n(r.debit) - n(r.credit), 0) * 100),
      base: Math.round(rows.reduce((t, r) => t + n(r.debitBase) - n(r.creditBase), 0) * 100),
    };
  };
  const due = async (orderId: string) =>
    (await api(app, manager).get(`/orders/${orderId}/payments`).expect(200)).body as {
      due: string;
      total: string;
      received: string;
      charged: string;
    };
  /** The ledger agrees with today's figures, and every posting is balanced. */
  const agrees = async () => {
    const c = (await api(app, manager).get("/ledger/check").expect(200)).body as Check;
    expect(c.differences, JSON.stringify(c.differences.slice(0, 10))).toEqual([]);
    return c;
  };
  const balanced = (rows: Row[]) => {
    const by = new Map<string, number>();
    for (const r of rows)
      by.set(r.groupId, (by.get(r.groupId) ?? 0) + Math.round(n(r.debitBase) * 100) - Math.round(n(r.creditBase) * 100));
    for (const [g, v] of by) expect(v, `posting ${g}`).toBe(0);
  };

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    posting = app.get(LedgerPosting);
    today = app.get(Clock).today();
    sana = await signIn(app, "sana@example.com");
    bilal = await signIn(app, "bilal@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    me = (await api(app, sana).get("/auth/me")).body.id;
    managerId = (await api(app, manager).get("/auth/me")).body.id;
    customerId = (
      await api(app, sana)
        .post("/customers", { name: `Ledger Pharma ${tag}`, country: "PK", contacts: [{ name: "Rauf", email: `rauf-${tag}@ledger.test` }] })
        .expect(201)
    ).body.id;
    factoryId = (
      await api(app, sana)
        .post("/factories", { name: `Ledger Pack ${tag}` })
        .expect(201)
    ).body.id;
    usdAccount = (
      await api(app, manager)
        .post("/money/accounts", { name: `Ledger USD ${tag}`, kind: "bank", currency: "USD", openingBalance: 1000, openingOn: day(-60) })
        .expect(201)
    ).body.id;
    cnyAccount = (
      await api(app, manager)
        .post("/money/accounts", { name: `Ledger CNY ${tag}`, kind: "bank", currency: "CNY", openingBalance: 50000, openingOn: day(-60) })
        .expect(201)
    ).body.id;
    // What earlier tests wrote straight into the database (not through a save) is posted, as the nightly run does.
    await inCompany(() => posting.syncAll());
  });

  afterAll(async () => {
    await app?.close();
  });

  it("is posted from every record, and agrees with today's figures (the demo and everything before)", async () => {
    const c = await agrees();
    expect(c.checked.orders).toBeGreaterThan(0);
    expect(c.checked.accounts).toBeGreaterThan(0);
    // Every posting balanced in the main currency.
    const unbalanced = await db().$queryRaw<{ n: number }[]>`
      select count(*)::int as n from (select group_id from ledger_entries group by group_id having sum(debit_base) <> sum(credit_base)) x`;
    expect(unbalanced[0]!.n).toBe(0);
  });

  it("an order and what we owe its factory, from the day it is made", async () => {
    const orderId = await newOrder();
    const o = await db().order.findUniqueOrThrow({ where: { id: orderId } });
    const order = await rowsOf("order", orderId);
    expect(order.map((r) => [r.type, r.account, n(r.debit), n(r.credit)])).toEqual([
      ["order", `customer:${customerId}`, n(o.total), 0],
      ["order", "sales", 0, n(o.total)],
    ]);
    const po = await rowsOf("purchase_order", `${orderId}:${factoryId}`);
    // CNY 71,000 + 13% tax: what factoryPosition says we owe.
    expect(po.map((r) => [r.type, r.account, r.currency, n(r.debit), n(r.credit)])).toEqual([
      ["purchase_order", "goods_cost", "CNY", 80230, 0],
      ["purchase_order", `factory:${factoryId}`, "CNY", 0, 80230],
    ]);
    expect(po[0]!.ref).toContain(o.refNo);
    balanced([...order, ...po]);
    await agrees();
  });

  it("a payment, changed (a correction: reversed and posted again) and removed (reversed, with the reason)", async () => {
    const orderId = await newOrder();
    const paid = (
      await api(app, manager)
        .post(`/orders/${orderId}/payments`, {
          receivedAmount: 1000,
          receivedCurrency: "USD",
          amount: 1000,
          currency: "USD",
          bankCharges: 15,
          paidOn: day(-3),
          accountId: usdAccount,
        })
        .expect(201)
    ).body;
    const id = paid.createdId as string;
    // Posted by its payment entry (the money in); changed and removed as the payment on the order.
    const entry = (await db().allocation.findUniqueOrThrow({ where: { id } })).movementId;
    let rows = await rowsOf("movement", entry);
    expect(rows.map((r) => [r.type, r.account, n(r.debit), n(r.credit)])).toEqual([
      ["money_in", `money:${usdAccount}`, 1000, 0],
      ["money_in", "bank_charges", 15, 0],
      ["money_in", `customer:${customerId}`, 0, 1015],
    ]);
    expect(rows[0]!.ref).toMatch(/^RC-\d{4}-\d{4}-1$/);
    expect((await owedOn(orderId)).minor / 100).toBe(Number((await due(orderId)).due));
    await agrees();

    await api(app, manager)
      .patch(`/payments/${id}`, {
        receivedAmount: 1200,
        receivedCurrency: "USD",
        amount: 1200,
        currency: "USD",
        bankCharges: 15,
        paidOn: day(-2),
        accountId: usdAccount,
        reason: "Typed 1,000 for 1,200",
      })
      .expect(200);
    rows = await rowsOf("movement", entry);
    const reversal = rows.filter((r) => r.reversesId);
    expect(reversal).toHaveLength(3);
    expect(reversal.every((r) => r.type === "correction" && r.reason === "Typed 1,000 for 1,200")).toBe(true);
    const live = rows.filter((r) => !r.reversesId && !rows.some((x) => x.reversesId === r.id));
    expect(live.map((r) => n(r.debit) + n(r.credit))).toEqual([1200, 15, 1215]);
    balanced(rows);
    await agrees();

    // Saving it again unchanged posts nothing (idempotent).
    const before = rows.length;
    await api(app, manager)
      .patch(`/payments/${id}`, {
        receivedAmount: 1200,
        receivedCurrency: "USD",
        amount: 1200,
        currency: "USD",
        bankCharges: 15,
        paidOn: day(-2),
        accountId: usdAccount,
        reason: "Same again",
      })
      .expect(200);
    expect(await rowsOf("movement", entry)).toHaveLength(before);

    await api(app, manager).post(`/payments/${id}/void`, { reason: "Wrong order" }).expect(200);
    rows = await rowsOf("movement", entry);
    expect(rows.filter((r) => r.reversesId && r.reason === "Wrong order")).toHaveLength(3);
    expect(rows.filter((r) => !r.reversesId && !rows.some((x) => x.reversesId === r.id))).toHaveLength(0);
    const o = await db().order.findUniqueOrThrow({ where: { id: orderId } });
    expect((await owedOn(orderId)).minor).toBe(Math.round(n(o.total) * 100));
    await agrees();
  });

  it("one transfer over several orders with the rest as credit; credit used, refunded and the refund removed", async () => {
    const a = await newOrder(50000);
    const b = await newOrder(50000);
    await api(app, manager)
      .post(`/customers/${customerId}/receipts`, {
        receivedAmount: 5000,
        receivedCurrency: "USD",
        currency: "USD",
        paidOn: day(-1),
        accountId: usdAccount,
        parts: [
          { orderId: a, amount: 2000 },
          { orderId: b, amount: 1500 },
        ],
      })
      .expect(201);
    const receipt = await db().moneyMovement.findFirstOrThrow({ where: { partyId: customerId }, orderBy: { createdAt: "desc" } });
    const rows = await rowsOf("movement", receipt.id);
    expect(rows.map((r) => [r.account, n(r.debit), n(r.credit), r.orderId])).toEqual([
      [`money:${usdAccount}`, 5000, 0, null],
      [`customer:${customerId}`, 0, 2000, a],
      [`customer:${customerId}`, 0, 1500, b],
      [`credit:${customerId}`, 0, 1500, null],
    ]);
    // What a transfer pays when it arrives posts nothing of its own.
    for (const p of await db().allocation.findMany({ where: { movementId: receipt.id } })) expect(await rowsOf("allocation", p.id)).toEqual([]);
    await agrees();

    // Credit used on another order: off the credit, off what the customer owes there; no money moved.
    const c = await newOrder(50000);
    await api(app, manager).post(`/orders/${c}/use-credit`, { amount: 500 }).expect(201);
    const used = await db().allocation.findFirstOrThrow({ where: { orderId: c, later: true } });
    expect(used.movementId).toBe(receipt.id);
    expect((await rowsOf("allocation", used.id)).map((r) => [r.type, r.account, n(r.debit), n(r.credit)])).toEqual([
      ["credit", `credit:${customerId}`, 500, 0],
      ["credit", `customer:${customerId}`, 0, 500],
    ]);
    // Refunded from an account, then the refund removed.
    await api(app, manager)
      .post(`/customers/${customerId}/credit/refund`, { amount: 300, currency: "USD", on: today, accountId: usdAccount })
      .expect(201);
    const refund = await db().moneyMovement.findFirstOrThrow({ where: { partyId: customerId, direction: "out" }, orderBy: { createdAt: "desc" } });
    const r1 = await rowsOf("movement", refund.id);
    expect(r1.map((r) => [r.type, r.account, n(r.debit), n(r.credit)])).toEqual([
      ["money_out", `credit:${customerId}`, 300, 0],
      ["money_out", `money:${usdAccount}`, 0, 300],
    ]);
    expect(r1[0]!.ref).toMatch(/^CR-\d{4}-\d{4}$/);
    await agrees();
    await api(app, admin).post(`/customer-credits/${refund.id}/void`, { reason: "Not sent yet" }).expect(200);
    expect((await rowsOf("movement", refund.id)).filter((r) => r.reversesId)).toHaveLength(2);
    await agrees();

    // A transfer removed: all of it reversed at once (its payment and its credit too).
    await api(app, manager)
      .post(`/customers/${customerId}/receipts`, {
        receivedAmount: 150,
        receivedCurrency: "USD",
        currency: "USD",
        paidOn: today,
        accountId: usdAccount,
        parts: [{ orderId: c, amount: 100 }],
      })
      .expect(201);
    const second = await db().moneyMovement.findFirstOrThrow({ where: { partyId: customerId }, orderBy: { createdAt: "desc" } });
    expect(await rowsOf("movement", second.id)).toHaveLength(3);
    await api(app, admin).post(`/customer-receipts/${second.id}/void`, { reason: "Bounced" }).expect(200);
    const gone = await rowsOf("movement", second.id);
    expect(gone.filter((r) => r.reversesId && r.reason === "Bounced")).toHaveLength(3);
    await agrees();
  });

  it("factory payments: posted, changed, removed; paid at another rate than the order's, the difference is an exchange difference", async () => {
    const orderId = await newOrder(10000);
    const part = `${orderId}:${factoryId}:CNY`;
    // What we owe: CNY 11,300 (with 13% tax), posted at Settings' 7.1; paid at 7.0 per USD.
    const made = (
      await api(app, manager)
        .post(`/orders/${orderId}/factory-payments`, {
          factoryId,
          amount: 11300,
          currency: "CNY",
          rate: 7,
          paidOn: day(-1),
          accountId: cnyAccount,
        })
        .expect(201)
    ).body;
    const id = made.createdId as string;
    // Posted by its payment entry (the money out); changed and removed as the payment on the order.
    const entry = (await db().allocation.findUniqueOrThrow({ where: { id } })).movementId;
    const rows = await rowsOf("movement", entry);
    expect(rows.map((r) => [r.type, r.account, r.currency, n(r.debit), n(r.credit)])).toEqual([
      ["money_out", `factory:${factoryId}`, "CNY", 11300, 0],
      ["money_out", `money:${cnyAccount}`, "CNY", 0, 11300],
    ]);
    expect(rows[0]!.ref).toMatch(/^FP-\d{4}-\d{4}-1$/);
    // Settled in CNY; in USD it was worth 1,591.55 when owed and cost 1,614.29: a 22.74 loss.
    const fx = await rowsOf("fx_factory", part);
    expect(fx.map((r) => [r.type, r.account, n(r.debit), n(r.credit), n(r.debitBase), n(r.creditBase)])).toEqual([
      ["fx", `factory:${factoryId}`, 0, 0, 0, 22.74],
      ["fx", "fx_diff", 22.74, 0, 22.74, 0],
    ]);
    const base = await db().$queryRaw<{ b: string }[]>`
      select sum(debit_base - credit_base)::text as b from ledger_entries where order_id = ${orderId}::uuid and account = ${`factory:${factoryId}`}`;
    expect(Number(base[0]!.b)).toBe(0);
    await agrees();

    // Changed: no longer settled, the exchange difference is reversed too.
    await api(app, manager)
      .patch(`/factory-payments/${id}`, {
        factoryId,
        amount: 10000,
        currency: "CNY",
        rate: 7,
        paidOn: day(-1),
        accountId: cnyAccount,
        reason: "Part only",
      })
      .expect(200);
    expect((await rowsOf("fx_factory", part)).filter((r) => r.reversesId)).toHaveLength(2);
    await agrees();
    await api(app, manager).post(`/factory-payments/${id}/void`, { reason: "Bank sent it back" }).expect(200);
    const after = await rowsOf("movement", entry);
    expect(after.filter((r) => r.reversesId && r.reason === "Bank sent it back")).toHaveLength(2);
    balanced((await db().ledgerEntry.findMany({ where: { orderId } })) as unknown as Row[]);
    await agrees();
  });

  it("an order in another currency paid in the main one at another rate: the exchange difference once it is settled", async () => {
    const orderId = await newOrder(20000, "CNY");
    const o = await db().order.findUniqueOrThrow({ where: { id: orderId } });
    const totalMinor = Math.round(n(o.total) * 100);
    // USD at 0.14 per CNY (7.14 CNY a dollar) against the order's 7.1: the order is worth less in USD than it was.
    const received = Math.ceil((totalMinor * 14) / 100);
    await api(app, manager)
      .post(`/orders/${orderId}/payments`, {
        receivedAmount: received / 100,
        receivedCurrency: "USD",
        rate: 0.14,
        amount: totalMinor / 100,
        currency: "CNY",
        paidOn: today,
        accountId: usdAccount,
      })
      .expect(201);
    const owed = await owedOn(orderId);
    expect(owed.minor).toBe(0);
    expect(owed.base).toBe(0);
    const fx = await rowsOf("fx_order", orderId);
    expect(fx.map((r) => r.account).sort()).toEqual([`customer:${customerId}`, "fx_diff"].sort());
    balanced(fx);
    await agrees();
  });

  it("expenses: who bears them (a change reverses and posts again), own money and its repayment, removed", async () => {
    const orderId = await newOrder(30000);
    const dueBefore = Number((await due(orderId)).due);
    const e = (
      await api(app, manager)
        .post("/expenses", {
          orderId,
          category: "courier",
          description: `DHL papers ${tag}`,
          amount: 62,
          currency: "USD",
          spentOn: day(-1),
          accountId: usdAccount,
        })
        .expect(201)
    ).body;
    let rows = await rowsOf("expense", e.id);
    expect(rows.map((r) => [r.account, n(r.debit), n(r.credit)])).toEqual([
      ["expense:courier", 62, 0],
      [`money:${usdAccount}`, 0, 62],
    ]);
    expect(rows[0]!.ref).toMatch(/^EX-\d{4}-\d{4}$/);
    // Charged to the customer: they owe it too (on the order), and it is recovered.
    await api(app, manager)
      .patch(`/expenses/${e.id}`, {
        orderId,
        category: "courier",
        description: `DHL papers ${tag}`,
        amount: 62,
        currency: "USD",
        spentOn: day(-1),
        accountId: usdAccount,
        borneBy: "customer",
        reason: "Their papers",
      })
      .expect(200);
    rows = await rowsOf("expense", e.id);
    const live = rows.filter((r) => !r.reversesId && !rows.some((x) => x.reversesId === r.id));
    expect(live.map((r) => [r.account, n(r.debit), n(r.credit)])).toEqual([
      ["expense:courier", 62, 0],
      [`money:${usdAccount}`, 0, 62],
      [`customer:${customerId}`, 62, 0],
      ["expenses_recovered", 0, 62],
    ]);
    expect(rows.filter((r) => r.reversesId).every((r) => r.reason === "Their papers")).toBe(true);
    expect(Number((await due(orderId)).due)).toBe(dueBefore + 62);
    await agrees();
    // Borne by the factory instead (CNY 710 → off what we owe it, in CNY).
    const f = (
      await api(app, manager)
        .post("/expenses", {
          orderId,
          factoryId,
          category: "other",
          description: `Guard door ${tag}`,
          amount: 710,
          currency: "CNY",
          rate: 7.1,
          spentOn: day(-1),
          accountId: cnyAccount,
          borneBy: "factory",
        })
        .expect(201)
    ).body;
    rows = await rowsOf("expense", f.id);
    expect(rows.map((r) => [r.account, r.currency, n(r.debit), n(r.credit)])).toContainEqual([`factory:${factoryId}`, "CNY", 710, 0]);
    await agrees();
    await api(app, manager).post(`/expenses/${f.id}/void`, { reason: "Factory refused" }).expect(200);
    await agrees();

    // From Sana's own money: we owe her until it is repaid.
    const own = (
      await api(app, manager)
        .post("/expenses", {
          orderId,
          category: "inland_transport",
          description: `Taxi ${tag}`,
          amount: 320,
          currency: "CNY",
          rate: 7.1,
          spentOn: day(-1),
          paidById: me,
          ownMoney: true,
        })
        .expect(201)
    ).body;
    rows = await rowsOf("expense", own.id);
    expect(rows.map((r) => [r.account, n(r.credit)])).toContainEqual([`staff:${me}`, 320]);
    await agrees();
    await api(app, manager).post(`/expenses/${own.id}/repay`, { repaidOn: today, accountId: cnyAccount }).expect(200);
    rows = await rowsOf("expense", own.id);
    const repaid = rows.filter((r) => r.part === "repaid");
    expect(repaid.map((r) => [r.type, r.account, n(r.debit), n(r.credit)])).toEqual([
      ["money_out", `staff:${me}`, 320, 0],
      ["money_out", `money:${cnyAccount}`, 0, 320],
    ]);
    // The spending itself was not reposted by the repayment.
    expect(rows.filter((r) => r.reversesId)).toEqual([]);
    await agrees();
    const staff = (await api(app, manager).get(`/ledger/parties/staff/${me}`).expect(200)).body;
    expect(staff.rows.length).toBeGreaterThanOrEqual(2);
  });

  it("transfers between accounts and opening balances (a changed opening balance posts the difference)", async () => {
    const pkr = (
      await api(app, manager)
        .post("/money/accounts", { name: `Ledger PKR ${tag}`, kind: "cash", currency: "PKR", openingBalance: 0, openingOn: day(-10) })
        .expect(201)
    ).body.id;
    expect(await rowsOf("account", pkr)).toEqual([]);
    const t = (
      await api(app, manager)
        .post("/money/transfers", { fromAccountId: usdAccount, toAccountId: pkr, amountOut: 100, amountIn: 28000, transferredOn: today })
        .expect(201)
    ).body;
    const rows = await rowsOf("movement", t.id);
    expect(rows.find((r) => r.account === `money:${pkr}`)!.debit).toBeTruthy();
    expect(rows[0]!.ref).toMatch(/^TR-\d{4}-\d{4}$/);
    balanced(rows);
    await agrees();
    await api(app, manager).post(`/money/transfers/${t.id}/void`, { reason: "Typed twice" }).expect(200);
    expect((await rowsOf("movement", t.id)).filter((r) => r.reversesId && r.reason === "Typed twice").length).toBeGreaterThan(0);
    await agrees();

    const acc = (await api(app, manager).get("/money/accounts").expect(200)).body.find((a: { id: string }) => a.id === usdAccount);
    await api(app, manager)
      .patch(`/money/accounts/${usdAccount}`, { name: acc.name, kind: "bank", currency: "USD", openingBalance: 1500, openingOn: day(-60) })
      .expect(200);
    const opening = await rowsOf("account", usdAccount);
    expect(opening.map((r) => [r.type, r.account, n(r.debit), n(r.credit)])).toEqual([
      ["opening", `money:${usdAccount}`, 1000, 0],
      ["opening", "opening", 0, 1000],
      ["correction", `money:${usdAccount}`, 500, 0],
      ["correction", "opening", 0, 500],
    ]);
    await agrees();
  });

  it("an order cancelled: reversed with the reason; the money in kept as credit; what the factory had is a loss", async () => {
    const orderId = await newOrder(40000);
    await api(app, manager)
      .post(`/orders/${orderId}/payments`, {
        receivedAmount: 3000,
        receivedCurrency: "USD",
        amount: 3000,
        currency: "USD",
        paidOn: day(-2),
        accountId: usdAccount,
      })
      .expect(201);
    await api(app, manager)
      .post(`/orders/${orderId}/factory-payments`, { factoryId, amount: 5000, currency: "CNY", paidOn: day(-2), accountId: cnyAccount })
      .expect(201);
    await api(app, manager)
      .post(`/orders/${orderId}/cancel`, { reason: "Customer called it off", customerMoney: "credit", factoryMoney: "loss" })
      .expect(200);
    const order = await rowsOf("order", orderId);
    expect(order.filter((r) => r.reversesId).map((r) => r.reason)).toEqual(["Customer called it off", "Customer called it off"]);
    const po = await rowsOf("purchase_order", `${orderId}:${factoryId}`);
    expect(po.filter((r) => r.reversesId)).toHaveLength(2);
    // What paid it is released (the transfer stands): back off the order, onto the customer's credit.
    const kept = await db().allocation.findFirstOrThrow({ where: { orderId, target: "order", voidedAt: { not: null } } });
    expect((await rowsOf("allocation", kept.id)).map((r) => [r.account, n(r.debit), n(r.credit)])).toEqual([
      [`customer:${customerId}`, 3000, 0],
      [`credit:${customerId}`, 0, 3000],
    ]);
    // The customer owes nothing on it any more; the factory's money written off.
    expect((await owedOn(orderId)).minor).toBe(0);
    const loss = await db().expense.findFirstOrThrow({ where: { orderId, step: "factory" } });
    expect((await rowsOf("expense", loss.id)).map((r) => [r.account, n(r.debit), n(r.credit)])).toEqual([
      ["expense:other", 5000, 0],
      [`factory:${factoryId}`, 0, 5000],
    ]);
    await agrees();
  });

  it("approvals: money sent for approval posts nothing until it is approved", async () => {
    const orderId = await newOrder(10000);
    const before = await db().ledgerEntry.count({ where: { orderId, sourceType: "movement" } });
    const sent = (
      await api(app, sana)
        .post("/submissions", { kind: "payment", orderId, body: { amount: 250, currency: "USD", paidOn: today } })
        .expect(201)
    ).body;
    expect(await db().ledgerEntry.count({ where: { orderId, sourceType: "movement" } })).toBe(before);
    await api(app, manager).post(`/submissions/${sent.id}/approve`, {}).expect(200);
    const p = await db().allocation.findFirstOrThrow({ where: { orderId }, orderBy: { createdAt: "desc" } });
    const rows = await rowsOf("movement", p.movementId);
    expect(rows.map((r) => n(r.debit) + n(r.credit))).toEqual([250, 250]);
    const entry = (await api(app, manager).get(`/ledger/entries/${rows[0]!.id}`).expect(200)).body;
    expect(entry.source.approvedBy).toBeTruthy();
    await agrees();
  });

  it("an order's or factory part's amounts change: the difference is posted as a correction", async () => {
    const orderId = await newOrder(10000);
    const o = await db().order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const line = o.lines.find((l) => l.factoryId)!;
    // A change of total and of the factory's price (no screen changes them yet; the rule is ready for one).
    await db().$transaction(async (tx) => {
      await tx.order.update({ where: { id: orderId }, data: { total: n(o.total) + 100 } });
      await tx.orderLine.update({ where: { id: line.id }, data: { factoryUnitPrice: 11000 } });
    });
    await inCompany(() =>
      db().$transaction(async (tx) =>
        posting.post(tx as Tx, [{ type: "order_all", id: orderId }], { userId: managerId, reason: "Price agreed again" }),
      ),
    );
    const order = await rowsOf("order", orderId);
    expect(order.filter((r) => r.type === "correction").map((r) => [r.account, n(r.debit), n(r.credit), r.reason])).toEqual([
      [`customer:${customerId}`, 100, 0, "Price agreed again"],
      ["sales", 0, 100, "Price agreed again"],
    ]);
    const po = await rowsOf("purchase_order", `${orderId}:${factoryId}`);
    // 1,000 more a unit, with 13% tax: 1,130.
    expect(po.filter((r) => r.type === "correction").map((r) => [r.account, n(r.debit), n(r.credit)])).toEqual([
      ["goods_cost", 1130, 0],
      [`factory:${factoryId}`, 0, 1130],
    ]);
    await agrees();
  });

  it("rows are never changed or deleted (only the rebuild may, by saying so)", async () => {
    const one = await db().ledgerEntry.findFirstOrThrow();
    await expect(db().ledgerEntry.update({ where: { id: one.id }, data: { memo: "edited" } })).rejects.toThrow(/never changed or deleted/);
    await expect(db().ledgerEntry.delete({ where: { id: one.id } })).rejects.toThrow(/never changed or deleted/);
    await expect(db().$executeRawUnsafe(`update ledger_entries set debit = debit + 1 where id = '${one.id}'`)).rejects.toThrow(
      /never changed or deleted/,
    );
    // With the rebuild's setting, inside its transaction (rolled back here).
    const undo = new Error("undo");
    await expect(
      db().$transaction(async (tx) => {
        await tx.$executeRaw`set local kebo.ledger_rewrite = 'on'`;
        await tx.ledgerEntry.update({ where: { id: one.id }, data: { memo: "allowed" } });
        throw undo;
      }),
    ).rejects.toBe(undo);
    expect((await db().ledgerEntry.findUniqueOrThrow({ where: { id: one.id } })).memo).toBe(one.memo);
  });

  it("the rebuild is idempotent: again it writes nothing; from nothing it posts the same balances", async () => {
    const again = await inCompany(() => posting.syncAll());
    expect(again.postings).toBe(0);
    const dry = await inCompany(() => posting.syncAll({ dryRun: true }));
    expect(dry.postings).toBe(0);
    const balances = async () =>
      db().$queryRaw<{ account: string; currency: string; m: string }[]>`
        select account, currency::text, sum(debit - credit)::text as m from ledger_entries group by 1, 2 having sum(debit - credit) <> 0 order by 1, 2`;
    const was = await balances();
    await inCompany(async () => {
      await posting.reset();
      await posting.syncAll();
    });
    expect(await balances()).toEqual(was);
    expect((await inCompany(() => posting.syncAll())).postings).toBe(0);
    await agrees();
  });

  it("reads: entries with totals, one entry with its document, a party's ledger with ageing, ageing, accounts", async () => {
    const list = (await api(app, manager).get(`/ledger/entries?customerId=${customerId}&lead=true&pageSize=200`).expect(200)).body;
    expect(list.rows.length).toBeGreaterThan(5);
    expect(list.totals.balanced).toBe(true);
    const payment = list.rows.find(
      (r: { type: string; removed: unknown; source: { type: string } }) =>
        r.type === "money_in" && !r.removed && r.source.type === "movement",
    );
    expect(payment.counter.label).toBeTruthy();
    expect(payment.with).toMatchObject({ kind: "customer", id: customerId });
    const removed = (await api(app, manager).get(`/ledger/entries?customerId=${customerId}&removed=false&pageSize=500`).expect(200)).body;
    expect(removed.rows.every((r: { removed: unknown; reversesId: string | null }) => !r.removed && !r.reversesId)).toBe(true);
    const corrections = (await api(app, manager).get(`/ledger/entries?type=correction&customerId=${customerId}`).expect(200)).body;
    expect(corrections.rows.length).toBeGreaterThan(0);

    const entry = (await api(app, manager).get(`/ledger/entries/${payment.id}`).expect(200)).body;
    expect(entry.rows.length).toBeGreaterThanOrEqual(2);
    expect(entry.totals.debit).toBe(entry.totals.credit);
    expect(entry.source.orderId).toBeTruthy();
    await api(app, manager).get("/ledger/entries/00000000-0000-4000-8000-000000000000").expect(404);

    const party = (
      await api(app, manager)
        .get(`/ledger/parties/customer/${customerId}?from=${day(-30)}&to=${today}`)
        .expect(200)
    ).body;
    expect(party.party.name).toContain("Ledger Pharma");
    expect(party.ageing.buckets.map((b: { bucket: string }) => b.bucket)).toEqual(["not_due", "d1_30", "d31_60", "d61_90", "d90_plus"]);
    const last = party.rows.at(-1);
    expect(last.balanceBase).toBe(party.closing.base);
    const open = (await api(app, manager).get(`/ledger/parties/customer/${customerId}?onlyOpen=true`).expect(200)).body;
    expect(open.closing.base).toBe(party.closing.base);
    const fac = (await api(app, manager).get(`/ledger/parties/factory/${factoryId}`).expect(200)).body;
    expect(fac.sign).toBe("we owe");
    await api(app, manager).get(`/ledger/parties/factory/${customerId}`).expect(404);
    await api(app, manager).get(`/ledger/parties/nobody/${customerId}`).expect(400);

    for (const side of ["receivable", "payable", "staff"]) {
      const a = (await api(app, manager).get(`/ledger/ageing?side=${side}`).expect(200)).body;
      expect(a.buckets).toHaveLength(5);
    }
    const accounts = (await api(app, manager).get("/ledger/accounts").expect(200)).body;
    expect(accounts.totals.balanced).toBe(true);
    expect(accounts.groups.map((g: { group: string }) => g.group)).toEqual(
      expect.arrayContaining(["Money", "Customers", "Factories", "Sales"]),
    );
  });

  it("statements: a paper per party and currency, numbered per party and year when issued", async () => {
    const draft = (await api(app, manager).get(`/ledger/parties/customer/${customerId}/statement?from=${day(-30)}&to=${today}&currency=USD`).expect(200)).body;
    expect(draft.doc.number).toBe("Draft");
    expect(draft.issued).toBe(false);
    expect(draft.doc.title).toBe("STATEMENT OF ACCOUNT");
    expect(draft.doc.rows[0].item).toBe("Opening balance");
    expect(draft.doc.rows.at(-1).balance).toEqual({ money: draft.doc.total.amount, currency: "USD" });
    const year = Number(today.slice(0, 4));
    const one = (await api(app, manager).post(`/ledger/parties/factory/${factoryId}/statement`, { year }).expect(201)).body;
    const two = (await api(app, manager).post(`/ledger/parties/factory/${factoryId}/statement`, { year }).expect(201)).body;
    expect(two.no).toBe(one.no + 1);
    expect(two.number).toBe(`ST-F-${year}-${String(two.no).padStart(4, "0")}`);
    const issued = (await api(app, manager).get(`/ledger/parties/factory/${factoryId}/statement?no=${two.no}`).expect(200)).body;
    expect(issued.doc.number).toBe(two.number);
    expect(issued.share.message).toContain(two.number);
    // A number never issued is refused; another company or no permission reaches none of it.
    await api(app, manager).get(`/ledger/parties/factory/${factoryId}/statement?no=${two.no + 50}`).expect(400);
    await api(app, bilal).post(`/ledger/parties/factory/${factoryId}/statement`, { year }).expect(403);
    await api(app, manager).post(`/ledger/parties/factory/${customerId}/statement`, { year }).expect(404);
    const staff = (await api(app, manager).get(`/ledger/parties/staff/${me}/statement`).expect(200)).body;
    expect(staff.doc.columns.map((c: { label: string }) => c.label)).toContain("Paid from own money");
  });

  it("who may read it: ledger.view (managers, the super admin, who records payments or expenses)", async () => {
    for (const path of [
      "/ledger/entries",
      "/ledger/accounts",
      "/ledger/ageing",
      `/ledger/parties/customer/${customerId}`,
      "/ledger/check",
    ]) {
      await api(app).get(path).expect(401);
      await api(app, bilal).get(path).expect(403);
      await api(app, admin).get(path).expect(200);
    }
    const roles = await db().role.findMany({ select: { key: true, permissions: true, superAdmin: true } });
    for (const r of roles)
      if (
        r.key === "manager" ||
        r.key === "admin" ||
        r.permissions.includes("payments.record") ||
        r.permissions.includes("expenses.manage")
      )
        expect(r.superAdmin || r.permissions.includes("ledger.view"), r.key ?? "").toBe(true);
  });

  it("another company reaches none of it", async () => {
    const one = await db().ledgerEntry.findFirstOrThrow({ where: { customerId } });
    const password = "Ledger@12345678";
    const company = await prisma.platform.company.create({ data: { slug: `lg-${tag}`.slice(0, 30), name: `Ledger other ${tag}` } });
    const email = `boss@lg-${tag}.test`;
    await seedCompanyBase(prisma.company(company.id), {
      admin: { email, name: "Boss", role: "admin", passwordHash: await bcrypt.hash(password, 10) },
    });
    const boss = await signIn(app, email, password);
    const theirs = (await api(app, boss).get("/ledger/entries").expect(200)).body;
    expect(theirs.rows).toEqual([]);
    await api(app, boss).get(`/ledger/entries/${one.id}`).expect(404);
    await api(app, boss).get(`/ledger/parties/customer/${customerId}`).expect(404);
    await api(app, boss).get(`/ledger/parties/factory/${factoryId}`).expect(404);
    await api(app, boss).get(`/ledger/parties/factory/${factoryId}/statement`).expect(404);
    await api(app, boss).post(`/ledger/parties/factory/${factoryId}/statement`, { year: 2026 }).expect(404);
    expect((await api(app, boss).get("/ledger/accounts").expect(200)).body.groups).toEqual([]);
    expect((await api(app, boss).get("/ledger/check").expect(200)).body.differences).toEqual([]);
    // Their connection cannot point a row at our records.
    await expect(
      prisma.company(company.id).$executeRawUnsafe(
        `insert into ledger_entries (id, entry_no, group_id, date, type, source_type, source_id, ref, account, debit, currency, customer_id)
         values (gen_random_uuid(), 1, gen_random_uuid(), now(), 'order', 'order', 'x', 'x', 'sales', 1, 'USD', '${customerId}')`,
      ),
    ).rejects.toThrow(/another company|foreign key/);
  });
});
