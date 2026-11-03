import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decimalToMinor, FIRST_COMPANY_ID } from "@kebo/database";
import { fromMinor, settle, splitDeposit } from "@kebo/money";
import { paperDateText, readSettings } from "@kebo/shared";
import { todayIn } from "@kebo/utils";
import { PrismaService } from "../src/database/prisma.service";
import { CompaniesService } from "../src/common/company/companies.service";
import { factoryPositionsSql, positionsSql } from "../src/modules/money/due";
import { factoryBorneExpenses, factoryPositionOf, fxOf, positionOf, positionRelations } from "../src/modules/money/position";
import { api, signIn, startApp } from "./app";

/**
 * One money truth (single source of truth, PR 1): what a customer still owes,
 * the deposit, what we still owe a factory and what an LC draws are worked out
 * in one place and read the same on every screen, paper, list and report, and
 * the SQL that narrows lists agrees with it to the cent.
 */
describe("one money truth", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sana: string;
  let manager: string;
  let me: string;
  const tag = Date.now().toString(36);
  const today = todayIn(process.env.APP_TIME_ZONE ?? "Asia/Shanghai");
  const day = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const db = () => prisma.company(FIRST_COMPANY_ID);
  const fx = async () => fxOf(readSettings(Object.fromEntries((await db().setting.findMany()).map((r) => [r.key, r.value]))), true);

  let n = 0;
  /** An order of 10 pumps at USD 1,000 (USD 10,000, 30% deposit) bought at CNY 1,000 + tax from a factory of its own. */
  async function makeOrder(opts: { taxRate?: number; taxIncluded?: boolean; factoryPrice?: number } = {}) {
    n += 1;
    const customer = (
      await api(app, sana)
        .post("/customers", { name: `Truth ${n} ${tag}`, country: "NG", contacts: [{ name: "Ada", email: `ada-${n}-${tag}@truth.test` }] })
        .expect(201)
    ).body;
    const factoryId = (await api(app, sana).post("/factories", { name: `Truth Works ${n} ${tag}`, address: "Taizhou" }).expect(201)).body.id as string;
    const inquiry = (
      await api(app, sana)
        .post("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me, items: [{ description: "Pump", quantity: 10 }] })
        .expect(201)
    ).body;
    const item = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, {
        factoryId,
        receivedOn: day(-10),
        currency: "CNY",
        taxRate: opts.taxRate ?? 0,
        taxIncluded: opts.taxIncluded ?? false,
        lines: [{ requestedItemId: item.id, description: "Pump", quantity: 10, unitPrice: opts.factoryPrice ?? 1000 }],
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiry.id}/quotation/draft`)).body;
    const options = [{ ...draft.options[0], prices: draft.options[0].prices.map((p: Record<string, unknown>) => ({ ...p, unitPrice: 1000 })) }];
    const r = (
      await api(app, sana).post(`/inquiries/${inquiry.id}/quotation/revisions`, { ...draft, currency: "USD", depositPercent: 30, options }).expect(201)
    ).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "accepted" }).expect(200);
    const o = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.orders[0];
    // Won and ordered months ago: this month's reports elsewhere (top customers) are left as they are.
    await prisma.platform.$executeRaw`update orders set ordered_on = ordered_on - 75 where id = ${o.id}::uuid`;
    await prisma.platform.$executeRaw`update inquiries set closed_at = closed_at - interval '75 days' where id = ${inquiry.id}::uuid`;
    return { orderId: o.id as string, refNo: o.refNo as string, customerId: customer.id as string, factoryId };
  }
  const order = async (id: string) => (await api(app, manager).get(`/orders/${id}`).expect(200)).body;
  const money = async (id: string) => (await api(app, manager).get(`/orders/${id}/money`).expect(200)).body;
  const payments = async (id: string) => (await api(app, manager).get(`/orders/${id}/payments`).expect(200)).body;
  const doc = async (id: string, kind: string, q = "") => (await api(app, manager).get(`/orders/${id}/papers/${kind}/doc${q}`).expect(200)).body.doc;
  const checks = async (id: string, kind: string) =>
    (await api(app, manager).get(`/orders/${id}/papers/${kind}/checks`).expect(200)).body.checks as { key: string; label: string; ok: boolean; value: string; required: boolean }[];
  const pay = (id: string, amount: number, kind = "balance") =>
    api(app, manager).post(`/orders/${id}/payments`, { kind, amount, currency: "USD", paidOn: today }).expect(201);
  const listed = async (id: string, status = "open") =>
    ((await api(app, manager).get(`/orders?status=${status}`).expect(200)).body as { id: string; due: string }[]).find((o) => o.id === id);
  const modulesOff = async (off: string[]) => {
    await prisma.platform.company.update({ where: { id: FIRST_COMPANY_ID }, data: { featuresOff: off } });
    app.get(CompaniesService).forget(FIRST_COMPANY_ID);
  };

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    sana = await signIn(app, "sana@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    me = (await api(app, sana).get("/auth/me")).body.id;
    await modulesOff([]);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe("an expense charged to the customer is added to the order's balance, everywhere", () => {
    let o: Awaited<ReturnType<typeof makeOrder>>;

    beforeAll(async () => {
      o = await makeOrder();
      await pay(o.orderId, 10_000);
    });

    it("is paid in full before anything is charged", async () => {
      expect((await order(o.orderId)).money).toMatchObject({ total: "10000.00", received: "10000.00", due: "0.00", charged: "0.00", status: "paid" });
    });

    it("counts USD 800 charged in still due on the order, the list, the money tab, payments, receivables and the papers", async () => {
      await api(app, manager)
        .post("/expenses", { orderId: o.orderId, category: "inspection", description: `Inspection ${tag}`, amount: 800, currency: "USD", spentOn: today, borneBy: "customer" })
        .expect(201);
      const v = await order(o.orderId);
      expect(v.money).toMatchObject({ total: "10000.00", charged: "800.00", received: "10000.00", due: "800.00", status: "partly_paid" });
      expect((await listed(o.orderId))?.due).toBe("800.00");
      const m = await money(o.orderId);
      expect([m.due, m.chargedTotal]).toEqual(["800.00", "800.00"]);
      const p = await payments(o.orderId);
      expect([p.due, p.charged, p.status]).toEqual(["800.00", "800.00", "partly_paid"]);
      const r = (await api(app, manager).get("/money/receivables").expect(200)).body;
      expect(r.rows.find((x: { id: string }) => x.id === o.orderId)).toMatchObject({ due: "800.00", charged: "800.00" });

      // Papers: the payment request for the balance asks for it, the statement and the receipt show it.
      const request = await doc(o.orderId, "payment-request");
      expect(request.total).toMatchObject({ label: "Amount due", amount: "800.00", currency: "USD" });
      expect(request.sums).toContainEqual({ label: "Charged to you (expenses)", value: { money: "800.00", currency: "USD" } });
      expect(request.bullets).toContain("Includes USD 800.00 of expenses charged to you.");
      const statement = await doc(o.orderId, "customer-statement");
      expect(statement.total).toMatchObject({ label: "Balance due (incl. USD 800.00 charged)", amount: "800.00" });
      expect(statement.rows[0]).toMatchObject({ total: { money: "10000.00" }, charged: { money: "800.00" }, due: { money: "800.00" } });
      const receipt = await doc(o.orderId, "payment-receipt");
      expect(receipt.bullets).toContainEqual({ label: "Still due:", value: { money: "800.00", currency: "USD" } });
      expect(receipt.bullets).toContainEqual({ label: "Charged to you:", value: { money: "800.00", currency: "USD" } });
      const proforma = (await api(app, manager).get(`/orders/${o.orderId}/documents/proforma`).expect(200)).body;
      expect(proforma.totals).toMatchObject({ total: "10000.00", charged: "800.00", received: "10000.00", due: "800.00" });
    });

    it("lets the customer pay it, and is then paid in full", async () => {
      // The order part is capped at what is due with the charge (the rest of a transfer would be credit).
      const part = (await api(app, manager).post(`/orders/${o.orderId}/payments`, { kind: "balance", currency: "USD", receivedAmount: 900, receivedCurrency: "USD", amount: 801, paidOn: today }))
        .status;
      expect(part).toBe(400);
      await pay(o.orderId, 800);
      expect((await order(o.orderId)).money).toMatchObject({ due: "0.00", status: "paid" });
    });

    it("closing asks about money due while only the charge is open", async () => {
      const x = await makeOrder();
      await pay(x.orderId, 10_000);
      await api(app, manager)
        .post("/expenses", { orderId: x.orderId, category: "courier", description: `Courier ${tag}`, amount: 35, currency: "USD", spentOn: today, borneBy: "customer" })
        .expect(201);
      await api(app, manager).post(`/orders/${x.orderId}/stage`, { to: "in_production", confirm: true }).expect(200);
      await api(app, manager).post(`/orders/${x.orderId}/stage`, { to: "shipped", shippedOn: today, confirm: true }).expect(200);
      const res = await api(app, manager).post(`/orders/${x.orderId}/stage`, { to: "done" });
      expect(res.status).toBe(409);
      expect(res.body.error).toContain("USD 35.00 is still due");
    });
  });

  describe("a payment plan edited to a 50% deposit", () => {
    let o: Awaited<ReturnType<typeof makeOrder>>;

    beforeAll(async () => {
      o = await makeOrder();
      const items = (await money(o.orderId)).plan.items as { id: string; label: string; amount: string; dueOn: string | null; part: string }[];
      expect(items.map((i) => [i.part, i.amount])).toEqual([
        ["deposit", "3000.00"],
        ["balance", "7000.00"],
      ]);
      await api(app, manager)
        .put(`/orders/${o.orderId}/payment-plan`, {
          items: [
            { id: items[0]!.id, label: "Deposit 50%", amount: "5000.00", dueOn: items[0]!.dueOn },
            { id: items[1]!.id, label: "Balance", amount: "5000.00", dueOn: null },
          ],
        })
        .expect(200);
      await pay(o.orderId, 3000, "deposit");
    });

    it("asks for 50% on the order, the gate, the checklist, the proforma and the contract", async () => {
      const v = await order(o.orderId);
      expect(v.money).toMatchObject({ deposit: "5000.00", depositPercent: 50, depositDue: "2000.00", status: "partly_paid" });
      expect(v.depositPercent).toBe(30); // as accepted
      expect(v.needs.title).toBe("Get the deposit (USD 2,000.00)");
      expect((await api(app, sana).get(`/orders/${o.orderId}/flow`).expect(200)).body.payment.depositIn).toBe(false);
      const steps = (await api(app, sana).get(`/orders/${o.orderId}/steps`).expect(200)).body.items as { key: string | null; done: boolean; needs: string | null }[];
      expect(steps.find((s) => s.key === "deposit_in")).toMatchObject({ done: false, needs: "USD 5,000.00 (50%)" });
      const pi = (await api(app, manager).get(`/orders/${o.orderId}/documents/proforma`).expect(200)).body;
      expect(pi.paymentSentence).toContain("50%");
      expect(pi.totals).toMatchObject({ deposit: "5000.00", depositPercent: 50 });
      expect((await doc(o.orderId, "sales-contract")).bullets[0]).toContain("50%");
      const res = await api(app, manager).post(`/orders/${o.orderId}/stage`, { to: "in_production" });
      expect(res.status).toBe(409);
      expect(res.body.error).toContain("The deposit (USD 5,000.00) has not been received yet.");
    });

    it("ticks the deposit once 50% is in", async () => {
      await pay(o.orderId, 2000, "deposit");
      expect((await order(o.orderId)).money).toMatchObject({ depositDue: "0.00", status: "deposit_paid" });
      expect((await api(app, sana).get(`/orders/${o.orderId}/flow`).expect(200)).body.payment.depositIn).toBe(true);
      const steps = (await api(app, sana).get(`/orders/${o.orderId}/steps`).expect(200)).body.items as { key: string | null; done: boolean }[];
      expect(steps.find((s) => s.key === "deposit_in")?.done).toBe(true);
    });
  });

  describe("an expense the factory bears comes off what we owe it, everywhere", () => {
    let o: Awaited<ReturnType<typeof makeOrder>>;
    const owing = async () => {
      const f = await fx();
      return (await factoryPositionsSql(db(), f, [o.orderId])).filter((r) => r.toPayMinor > 0).length > 0;
    };

    beforeAll(async () => {
      // CNY 1,000 + 13% × 10 = CNY 11,300: the default plan is 30% (3,390) on order and 7,910 on the ready date.
      o = await makeOrder({ taxRate: 13 });
      await api(app, manager).patch(`/orders/${o.orderId}/factory-order`, { factoryOrderedOn: day(-20) }).expect(200);
      await api(app, manager).patch(`/orders/${o.orderId}/details`, { readyOn: day(-3) }).expect(200);
      await api(app, manager)
        .post(`/orders/${o.orderId}/factory-payments`, { factoryId: o.factoryId, kind: "deposit", amount: 3390, currency: "CNY", paidOn: day(-15) })
        .expect(201);
    });

    it("shows the balance late before the factory bears anything", async () => {
      const m = await money(o.orderId);
      expect(m.factories.rows[0]).toMatchObject({ owed: "11300.00", paid: "3390.00", toPay: "7910.00" });
      expect(m.factories.plans[0]).toMatchObject({ toPay: "7910.00", next: { status: "late", open: "7910.00" } });
      expect(await owing()).toBe(true);
    });

    it("with a CNY 7,910 inspection charged to the factory: nothing left to pay, nothing late, on every screen and the PO", async () => {
      await api(app, manager)
        .post("/expenses", {
          orderId: o.orderId,
          category: "inspection",
          description: `Failed inspection ${tag}`,
          amount: 7910,
          currency: "CNY",
          rate: 7.1,
          spentOn: today,
          borneBy: "factory",
          factoryId: o.factoryId,
        })
        .expect(201);
      const m = await money(o.orderId);
      expect(m.factories.rows[0]).toMatchObject({ owed: "11300.00", paid: "11300.00", takenOff: "7910.00", toPay: "0.00" });
      expect(m.factories.plans[0]).toMatchObject({ paid: "11300.00", toPay: "0.00", next: null });
      expect(m.factories.plans[0].rows.map((r: { status: string }) => r.status)).toEqual(["paid", "paid"]);
      expect(await owing()).toBe(false);
      const payables = (await api(app, manager).get("/money/payables").expect(200)).body;
      expect(JSON.stringify(payables)).not.toContain(o.refNo);
      const costs = (await api(app, manager).get(`/orders/${o.orderId}/costs`).expect(200)).body;
      expect(costs.profit.factoryOwed).toEqual([{ currency: "CNY", amount: "11300.00", toPay: "0.00" }]);
      const po = await doc(o.orderId, "purchase-order");
      expect(po.total).toMatchObject({ label: "Total with tax", amount: "11300.00", currency: "CNY" });
      expect(po.bullets).toContainEqual({ label: `Charged to you on ${paperDateText(today)}:`, value: { money: "7910.00", currency: "CNY" } });
      expect(po.bullets).toContainEqual({ label: "Still to pay:", value: { money: "0.00", currency: "CNY" } });
    });
  });

  describe("the purchase order", () => {
    it("states the payment terms from the factory's plan, not a fixed sentence", async () => {
      const o = await makeOrder({ taxRate: 13, taxIncluded: true, factoryPrice: 1130 });
      let po = await doc(o.orderId, "purchase-order");
      // Tax included: the prices are the total (10 × 1,130); the default plan, 30% on order.
      expect(po.total).toMatchObject({ label: "Total", amount: "11300.00", currency: "CNY" });
      expect(po.rows[0]).toMatchObject({ price: { money: "1130.00", currency: "CNY" }, amount: { money: "11300.00", currency: "CNY" } });
      expect(po.bullets).not.toContain("Balance before the goods leave the factory, after our inspection.");
      expect(po.bullets).toContain("Payment: Advance 30%, CNY 3,390.00, when we order; Balance 70%, CNY 7,910.00, on the ready date.");
      await api(app, manager)
        .put(`/orders/${o.orderId}/factory-plan`, {
          factoryId: o.factoryId,
          items: [
            { label: "Advance", percent: 50, amount: 5650, dueRule: "on_order", dueOn: null },
            { label: "Balance", percent: 50, amount: 5650, dueRule: "fixed", dueOn: "2027-01-15" },
          ],
        })
        .expect(200);
      po = await doc(o.orderId, "purchase-order");
      expect(po.bullets).toContain("Payment: Advance 50%, CNY 5,650.00, when we order; Balance 50%, CNY 5,650.00, by 15 Jan 2027.");
    });
  });

  describe("an LC draws what the LC covers", () => {
    let o: Awaited<ReturnType<typeof makeOrder>>;
    const contract = (amount: number | null) =>
      api(app, sana)
        .put(`/orders/${o.orderId}/bank-contract`, {
          number: `LC-${tag}`,
          status: "opened",
          customerBank: "Zenith Bank, Lagos",
          ourBank: "Bank of China",
          amount,
          currency: amount === null ? null : "USD",
        })
        .expect(200);

    beforeAll(async () => {
      o = await makeOrder();
      await api(app, sana).patch(`/orders/${o.orderId}/route`, { route: "letter_of_credit", lcTerms: "at_sight" }).expect(200);
    });

    it("without an LC amount: the bill of exchange and the cover letter draw the LC balance (70%), not the order total", async () => {
      await contract(null);
      expect((await doc(o.orderId, "bill-of-exchange")).total).toMatchObject({ label: "Exchange for", amount: "7000.00", currency: "USD" });
      expect((await doc(o.orderId, "bank-cover-letter")).total).toMatchObject({ amount: "7000.00", currency: "USD" });
      expect((await checks(o.orderId, "bill-of-exchange")).find((c) => c.key === "lcAmount")).toBeUndefined();
    });

    it("never more than the LC balance; a different LC amount is a check on the Make page", async () => {
      await contract(10_000);
      expect((await doc(o.orderId, "bill-of-exchange")).total).toMatchObject({ amount: "7000.00" });
      const c = (await checks(o.orderId, "bill-of-exchange")).find((x) => x.key === "lcAmount");
      expect(c).toMatchObject({ ok: false, required: false, label: "LC amount", value: "USD 10,000.00, balance USD 7,000.00" });
      expect((await checks(o.orderId, "bank-cover-letter")).find((x) => x.key === "lcAmount")?.ok).toBe(false);
      await contract(6000);
      expect((await doc(o.orderId, "bill-of-exchange")).total).toMatchObject({ amount: "6000.00" });
      await contract(7000);
      expect((await checks(o.orderId, "bill-of-exchange")).find((x) => x.key === "lcAmount")).toMatchObject({ ok: true });
    });
  });

  describe("the database and the app agree", () => {
    it("SQL positions equal positionOf on every order (mixed: charged in other currencies, bank charges, plans)", async () => {
      // One more with a charge in CNY on a USD order (at its own rate) and bank charges.
      const o = await makeOrder();
      await api(app, manager).post(`/orders/${o.orderId}/payments`, { kind: "deposit", amount: 2975, bankCharges: 25, currency: "USD", paidOn: today }).expect(201);
      await api(app, manager)
        .post("/expenses", { orderId: o.orderId, category: "courier", description: `Courier CNY ${tag}`, amount: 355.55, currency: "CNY", rate: 7.1, spentOn: today, borneBy: "customer" })
        .expect(201);
      const rows = await db().order.findMany({ where: { status: { not: "cancelled" } }, include: positionRelations });
      expect(rows.length).toBeGreaterThan(3);
      // With the expenses module, and without it (then nothing counts as charged, in both).
      for (const f of [await fx(), { ...(await fx()), expensesOn: false }]) {
        const sql = new Map((await positionsSql(db(), f)).map((r) => [r.id, r]));
        for (const r of rows) {
          const p = positionOf(r, f);
          expect([r.refNo, sql.get(r.id)?.chargedMinor, sql.get(r.id)?.settledMinor, sql.get(r.id)?.dueMinor]).toEqual([r.refNo, p.chargedMinor, p.settledMinor, p.dueMinor]);
        }
      }
      // CNY 355.55 at 7.1 = USD 50.08.
      expect(positionOf(rows.find((r) => r.id === o.orderId)!, await fx())).toMatchObject({ chargedMinor: 50_08, settledMinor: 3_000_00, dueMinor: 7_050_08 });
      expect(positionOf(rows.find((r) => r.id === o.orderId)!, { ...(await fx()), expensesOn: false })).toMatchObject({ chargedMinor: 0, dueMinor: 7_000_00 });
    });

    it("SQL factory positions equal factoryPositionOf on every order", async () => {
      const rows = await db().order.findMany({
        where: { status: { not: "cancelled" } },
        include: { lines: true, factoryPaid: { where: { voidedAt: null } }, expenses: factoryBorneExpenses },
      });
      for (const f of [await fx(), { ...(await fx()), expensesOn: false }]) {
        const sql = await factoryPositionsSql(db(), f);
        for (const r of rows) {
          const ts = factoryPositionOf(r, f).filter((x) => x.lines > 0);
          const mine = sql.filter((x) => x.orderId === r.id);
          expect(mine.map((x) => [x.factoryId, x.currency, x.owedMinor, x.paidMinor, x.takenOffMinor, x.toPayMinor]).sort()).toEqual(
            ts.map((x) => [x.factoryId, x.currency, x.owedMinor, x.paidMinor, x.takenOffMinor, x.toPayMinor]).sort(),
          );
        }
      }
    });

    it("leaves every order without a charge or an edited plan exactly as settle() had it", async () => {
      const f = await fx();
      const rows = await db().order.findMany({ where: { status: { not: "cancelled" } }, include: positionRelations });
      let same = 0;
      for (const r of rows) {
        const total = decimalToMinor(r.total);
        const accepted = splitDeposit(total, Number(r.depositPercent)).deposit;
        const planDeposit = r.planItems.filter((i) => i.part === "deposit").reduce((t, i) => t + decimalToMinor(i.amount), 0);
        if (r.expenses.length || (planDeposit && planDeposit !== accepted)) continue;
        const old = settle(
          total,
          r.payments.filter((p) => p.currency === r.currency).map((p) => ({ amountMinor: decimalToMinor(p.amount), bankChargesMinor: decimalToMinor(p.bankCharges) })),
          Number(r.depositPercent),
        );
        const p = positionOf(r, f);
        expect([r.refNo, fromMinor(p.dueMinor), p.status, fromMinor(p.depositMinor), fromMinor(p.depositOutstandingMinor)]).toEqual([
          r.refNo,
          fromMinor(old.outstandingMinor),
          old.status,
          fromMinor(Number(r.depositPercent) > 0 ? accepted : 0),
          fromMinor(old.depositOutstandingMinor),
        ]);
        same += 1;
      }
      expect(same).toBeGreaterThan(3);
    });
  });
});
