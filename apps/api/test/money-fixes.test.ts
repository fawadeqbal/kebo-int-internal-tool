import type { INestApplication } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIRST_COMPANY_ID, seedCompanyBase } from "@kebo/database";
import { multiplyMinor, toMinor, withTaxMinor } from "@kebo/money";
import { todayIn } from "@kebo/utils";
import { PrismaService } from "../src/database/prisma.service";
import { owedLineSql } from "../src/modules/money/due";
import { Prisma } from "@kebo/database";
import { api, signIn, startApp } from "./app";

/**
 * The money audit: an order carries the costs to reach the basis it was sold
 * on, its factory prices and its rate, all frozen when it is made; profit is
 * only ever counted on revenue with a cost, the same on every screen; rates,
 * decimals and days are exact.
 */
describe("money fixes", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sana: string;
  let manager: string;
  let admin: string;
  let sanaId: string;
  let sales: Record<string, unknown>;
  const tag = Date.now().toString(36);
  const today = todayIn(process.env.APP_TIME_ZONE ?? "Asia/Shanghai");
  const monthStart = `${today.slice(0, 7)}-01`;
  const year = Number(today.slice(0, 4));
  const db = () => prisma.company(FIRST_COMPANY_ID);

  type OfferLine = { description: string; quantity: number; unit?: string; unitPrice: number; taxRate: number };
  /** A deal with a customer of its own, the customer's items, and factory offers. */
  async function deal(
    name: string,
    opts: {
      items?: { description: string; quantity: number }[];
      offers?: { name: string; currency: string; basis?: string; lines: OfferLine[] }[];
    } = {},
  ) {
    const customer = (
      await api(app, sana)
        .post("/customers", {
          name: `${name} ${tag}`,
          country: "NG",
          contacts: [{ name: "Ola", email: `${name.replace(/\W/g, "")}-${tag}@x.test` }],
        })
        .expect(201)
    ).body;
    const inquiry = (
      await api(app, sana)
        .post("/inquiries", {
          customerId: customer.id,
          category: "Machinery",
          assigneeId: sanaId,
          requirements: name,
          items: opts.items ?? [],
        })
        .expect(201)
    ).body;
    const offers: string[] = [];
    for (const o of opts.offers ?? []) {
      const q = (
        await api(app, sana)
          .post(`/inquiries/${inquiry.id}/factory-quotes`, {
            newFactoryName: `${o.name} ${tag}`,
            receivedOn: today,
            currency: o.currency,
            basis: o.basis ?? null,
          })
          .expect(201)
      ).body.id;
      await api(app, sana).post(`/factory-quotes/${q}/lines`, { lines: o.lines }).expect(201);
      offers.push(q);
    }
    return { customerId: customer.id as string, customerName: customer.name as string, inquiryId: inquiry.id as string, offers };
  }
  /** Quote one option (with the body changes given), send it and accept it: the order's id. */
  async function order(
    inquiryId: string,
    option: (draft: Record<string, unknown>, lines: (quoteId: string) => { id: string }[]) => Record<string, unknown>,
    revision: Record<string, unknown> = {},
  ) {
    const draft = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/draft`).expect(200)).body;
    const offers = (
      await api(app, sana)
        .get(`/inquiries/${inquiryId}/quotation/offers?currency=${revision.currency ?? "USD"}`)
        .expect(200)
    ).body;
    const lines = (q: string) => offers.offers.find((o: { factoryQuoteId: string }) => o.factoryQuoteId === q).lines;
    const r = (
      await api(app, sana)
        .post(`/inquiries/${inquiryId}/quotation/revisions`, { ...draft, ...revision, options: [option(draft.options[0], lines)] })
        .expect(201)
    ).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "accepted" }).expect(200);
    return { orderId: (await api(app, sana).get(`/inquiries/${inquiryId}`)).body.orders[0].id as string, option: r.options[0] };
  }
  const ship = async (orderId: string) => {
    await api(app, sana).post(`/orders/${orderId}/stage`, { to: "in_production", confirm: true }).expect(200);
    await api(app, sana).post(`/orders/${orderId}/stage`, { to: "shipped", shippedOn: today, confirm: true }).expect(200);
  };
  const orderMoney = async (orderId: string) => (await api(app, manager).get(`/orders/${orderId}/money`).expect(200)).body;
  const pnl = async () => (await api(app, manager).get(`/money/profit-and-loss?year=${year}`).expect(200)).body;
  const report = async (from = monthStart, to = today) => (await api(app, manager).get(`/reports?from=${from}&to=${to}`).expect(200)).body;
  const setRates = (rates: Record<string, number>) =>
    api(app, admin)
      .put("/settings/sales", { ...sales, exchangeRates: rates, reason: "New exchange rate" })
      .expect(200);

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    sana = await signIn(app, "sana@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    sanaId = (await api(app, sana).get("/auth/me")).body.id;
    sales = (await api(app, admin).get("/settings").expect(200)).body.sales;
    await setRates({ CNY: 7.1 });
  });

  afterAll(async () => {
    await api(app, admin).put("/settings/sales", { ...sales, reason: "Back as it was" });
    await app?.close();
  });

  describe("an EXW offer sold CFR (the audit's example)", () => {
    let d: Awaited<ReturnType<typeof deal>>;
    let orderId: string;

    beforeAll(async () => {
      d = await deal("Lagos Mills", {
        offers: [
          {
            name: "Henan Mills",
            currency: "CNY",
            basis: "EXW",
            lines: [{ description: "Maize mill", quantity: 1, unit: "set", unitPrice: 71000, taxRate: 0 }],
          },
        ],
      });
      const made = await order(
        d.inquiryId,
        (o, lines) => ({
          ...o,
          factoryQuoteId: d.offers[0],
          prices: [{ lineId: lines(d.offers[0]!)[0]!.id, unitPrice: 14000 }],
          // A courier charge with no cost: revenue that is never counted as profit.
          charges: [{ type: "charge", description: "Courier of documents", quantity: 1, unit: "lot", unitPrice: 500, unitCost: null }],
          costs: [
            { step: "to_port", amount: 3550, currency: "CNY", note: "Truck to Qingdao" },
            { step: "freight", amount: 2500, currency: "USD" },
          ],
        }),
        { incoterm: "CFR", incotermPlace: "Lagos" },
      );
      orderId = made.orderId;
      // The option: CNY 71,000 / 7.1 = 10,000 + 3,000 to reach CFR = 13,000 against 14,000 with a cost.
      expect(made.option.costing).toMatchObject({
        cost: "13000.00",
        sales: "14000.00",
        profit: "1000.00",
        marginPercent: 7.1,
        uncostedLines: 1,
      });
    });

    it("keeps the costs to reach CFR on the order: the same cost and margin as the option", async () => {
      const m = await orderMoney(orderId);
      expect(m.total).toBe("14500.00");
      expect(m.profit).toMatchObject({
        revenue: "14500.00",
        costedRevenue: "14000.00",
        uncostedRevenue: "500.00",
        goodsCost: "10000.00",
        basisCost: "3000.00",
        earned: "1000.00",
        marginPercent: 7.1,
        coveragePercent: 97,
      });
      expect(m.profit.basisCosts).toEqual([
        { step: "to_port", amount: "3550.00", currency: "CNY", cost: "500.00", note: "Truck to Qingdao" },
        { step: "freight", amount: "2500.00", currency: "USD", cost: "2500.00", note: null },
      ]);
    });

    it("pays for the planned freight with the freight expense, without counting it twice", async () => {
      const e = (
        await api(app, manager)
          .post("/expenses", {
            orderId,
            category: "freight",
            description: `Sea freight ${tag}`,
            amount: 2800,
            currency: "USD",
            spentOn: today,
          })
          .expect(201)
      ).body;
      const m = await orderMoney(orderId);
      // 2,800 of the 3,000 planned: already in the cost, profit stays 1,000; cash shows all of it.
      expect(m.profit).toMatchObject({ expenses: "2800.00", expensesCounted: "0.00", earned: "1000.00" });
      await api(app, manager).post(`/expenses/${e.id}/void`, { reason: "Test done" }).expect(200);
    });

    it("shows the same profit, and the same amount not costed, on the order, in profit & loss, Insights, Reports and where we lose money", async () => {
      await ship(orderId);
      const m = (await orderMoney(orderId)).profit;
      const p = (await pnl()).orders.find((o: { id: string }) => o.id === orderId);
      expect(p).toMatchObject({
        revenue: "14500.00",
        uncostedRevenue: "500.00",
        goodsCost: "10000.00",
        basisCost: "3000.00",
        profit: m.earned,
      });
      const r = (await report()).profit.byCustomer.find((g: { key: string }) => g.key === d.customerName);
      expect(r).toMatchObject({
        revenue: "14500.00",
        uncostedRevenue: "500.00",
        cost: "13000.00",
        profit: "1000.00",
        marginPercent: 7.1,
        coveragePercent: 97,
      });
      const i = (await api(app, manager).get(`/insights?from=${monthStart}&to=${today}`).expect(200)).body;
      expect(i.topCustomers.find((c: { customer: { id: string } }) => c.customer.id === d.customerId)).toMatchObject({
        revenue: "14500.00",
        grossProfit: "1000.00",
        uncostedRevenue: "500.00",
      });
      const leaks = (await api(app, manager).get(`/reports/leaks?from=${monthStart}&to=${today}`).expect(200)).body;
      expect(leaks.orders.find((o: { id: string }) => o.id === orderId)).toMatchObject({
        planned: "1000.00",
        actual: "1000.00",
        uncosted: true,
        uncostedRevenue: "500.00",
      });
      const a = (await api(app, manager).get(`/customers/${d.customerId}/account`).expect(200)).body;
      expect(a.totals).toMatchObject({ sales: "14500.00", profit: "1000.00", uncostedRevenue: "500.00" });
    });
  });

  describe("what we owe a factory", () => {
    let d: Awaited<ReturnType<typeof deal>>;
    let orderId: string;
    let lineIds: string[];

    beforeAll(async () => {
      d = await deal("Kano Pipes", {
        offers: [
          {
            name: "Hebei Pipes",
            currency: "CNY",
            lines: [
              { description: "Valve", quantity: 1, unit: "pcs", unitPrice: 100.5, taxRate: 13 },
              { description: "Hose", quantity: 4.1, unit: "m", unitPrice: 19.85, taxRate: 0 },
            ],
          },
          { name: "Other Works", currency: "CNY", lines: [{ description: "Valve", quantity: 1, unitPrice: 120, taxRate: 13 }] },
        ],
      });
      ({ orderId } = await order(d.inquiryId, (o, lines) => ({
        ...o,
        factoryQuoteId: d.offers[0],
        prices: lines(d.offers[0]!).map((l) => ({ lineId: l.id, unitPrice: 50 })),
        charges: [],
        costs: [],
      })));
      lineIds = (await api(app, sana).get(`/factory-quotes/${d.offers[0]}`).expect(200)).body.lines.map((l: { id: string }) => l.id);
    });

    it("works it out exactly: 100.50 + 13% = 113.57, 19.85 × 4.10 = 81.39", async () => {
      const m = await orderMoney(orderId);
      expect(m.factories.rows).toEqual([expect.objectContaining({ currency: "CNY", owed: "194.96", toPay: "194.96", lines: 2 })]);
    });

    it("stays as ordered when the factory's offer changes or loses a line", async () => {
      await api(app, sana)
        .patch(`/factory-lines/${lineIds[0]}`, { unitPrice: 200, taxRate: 0, reason: "Factory raised its price" })
        .expect(200);
      await api(app, sana)
        .delete(`/factory-lines/${lineIds[1]}?reason=${encodeURIComponent("Factory dropped it")}`)
        .expect(200);
      const m = await orderMoney(orderId);
      expect(m.factories.rows).toEqual([expect.objectContaining({ owed: "194.96", toPay: "194.96", lines: 2 })]);
      const payables = (await api(app, sana).get("/money/payables").expect(200)).body;
      expect(
        payables.flatMap((p: { orders: { id: string; toPay: string }[] }) => p.orders).find((o: { id: string }) => o.id === orderId),
      ).toMatchObject({ toPay: "194.96" });
    });

    it("is settled by paying exactly that, in the database too", async () => {
      const f = (await orderMoney(orderId)).factories.rows[0].factory.id;
      await api(app, manager)
        .post(`/orders/${orderId}/factory-payments`, { factoryId: f, kind: "balance", amount: 194.96, currency: "CNY", paidOn: today })
        .expect(201);
      const payables = (await api(app, sana).get("/money/payables").expect(200)).body;
      expect(payables.flatMap((p: { orders: { id: string }[] }) => p.orders).find((o: { id: string }) => o.id === orderId)).toBeUndefined();
      expect((await orderMoney(orderId)).factories.rows[0]).toMatchObject({ paid: "194.96", toPay: "0.00", overpaid: null });
    });

    it("never takes a rate for the order's own currency, and keeps or looks up the rate on a change", async () => {
      const other = (await api(app, sana).get(`/factory-quotes/${d.offers[1]}`).expect(200)).body.factory.id;
      // A factory owed nothing on this order may be paid in any currency; in USD (the order's), the rate is 1.
      const made = (
        await api(app, manager)
          .post(`/orders/${orderId}/factory-payments`, {
            factoryId: other,
            kind: "other",
            amount: 10,
            currency: "USD",
            rate: 7,
            paidOn: today,
          })
          .expect(201)
      ).body;
      const pay = () => made.factories.payments.find((p: { id: string }) => p.id === made.createdId);
      expect(pay()).toMatchObject({ currency: "USD", rate: 1, inOrderCurrency: "10.00" });
      // Changed to CNY with no rate: the Settings rate, not the old 1.
      const edited = (
        await api(app, manager)
          .patch(`/factory-payments/${made.createdId}`, {
            factoryId: other,
            kind: "other",
            amount: 71,
            currency: "CNY",
            paidOn: today,
            reason: "Paid in yuan",
          })
          .expect(200)
      ).body;
      expect(edited.factories.payments.find((p: { id: string }) => p.id === made.createdId)).toMatchObject({
        currency: "CNY",
        rate: 7.1,
        inOrderCurrency: "10.00",
      });
      // Same currency, no rate: the rate used before stays.
      await api(app, manager)
        .patch(`/factory-payments/${made.createdId}`, {
          factoryId: other,
          kind: "other",
          amount: 71,
          currency: "CNY",
          rate: 7,
          paidOn: today,
          reason: "Bank rate",
        })
        .expect(200);
      const kept = (
        await api(app, manager)
          .patch(`/factory-payments/${made.createdId}`, {
            factoryId: other,
            kind: "other",
            amount: 70,
            currency: "CNY",
            paidOn: today,
            reason: "Typo",
          })
          .expect(200)
      ).body;
      expect(kept.factories.payments.find((p: { id: string }) => p.id === made.createdId)).toMatchObject({
        rate: 7,
        inOrderCurrency: "10.00",
      });
    });
  });

  describe("expense rates", () => {
    it("are 1 in the main currency, kept while the currency stays, and looked up (or asked for) when it changes", async () => {
      const base = { category: "office", description: `Paper ${tag}`, spentOn: today };
      const e = (
        await api(app, manager)
          .post("/expenses", { ...base, amount: 70, currency: "CNY", rate: 7 })
          .expect(201)
      ).body;
      expect(e).toMatchObject({ rate: 7, inMain: "10.00" });
      // To USD (the main currency) with no rate: 1, never the old 7.
      const usd = (
        await api(app, manager)
          .patch(`/expenses/${e.id}`, { ...base, amount: 10, currency: "USD", reason: "Paid in dollars" })
          .expect(200)
      ).body;
      expect(usd).toMatchObject({ rate: 1, inMain: "10.00" });
      // A rate sent for the main currency is ignored.
      expect(
        (
          await api(app, manager)
            .patch(`/expenses/${e.id}`, { ...base, amount: 10, currency: "USD", rate: 5, reason: "Typo" })
            .expect(200)
        ).body,
      ).toMatchObject({ rate: 1 });
      // Back to CNY with no rate: today's Settings rate.
      expect(
        (
          await api(app, manager)
            .patch(`/expenses/${e.id}`, { ...base, amount: 71, currency: "CNY", reason: "Paid in yuan" })
            .expect(200)
        ).body,
      ).toMatchObject({ rate: 7.1, inMain: "10.00" });
      // A currency with no rate in Settings: asked for, never taken as 1:1.
      const missing = await api(app, manager)
        .patch(`/expenses/${e.id}`, { ...base, amount: 2800, currency: "PKR", reason: "Paid in rupees" })
        .expect(400);
      expect(missing.body.error).toBe("There is no exchange rate for PKR in Settings. Enter the rate (PKR per 1 USD).");
      await api(app, manager).post(`/expenses/${e.id}/void`, { reason: "Test done" }).expect(200);
    });
  });

  describe("bank charges", () => {
    it("are a cost, and money in is what arrived: 980 + 20 on a 1,000 order", async () => {
      const d = await deal("Abuja Bricks", {
        offers: [
          { name: "Fujian Bricks", currency: "CNY", lines: [{ description: "Brick press", quantity: 1, unitPrice: 5680, taxRate: 0 }] },
        ],
      });
      const { orderId } = await order(d.inquiryId, (o, lines) => ({
        ...o,
        factoryQuoteId: d.offers[0],
        prices: [{ lineId: lines(d.offers[0]!)[0]!.id, unitPrice: 1000 }],
        charges: [],
        costs: [],
      }));
      const before = {
        dash: (await api(app, manager).get("/dashboard").expect(200)).body.money.thisMonth.received,
        cash: (await pnl()).months[Number(today.slice(5, 7)) - 1].cash.in,
      };
      await api(app, manager)
        .post(`/orders/${orderId}/payments`, { kind: "balance", amount: 980, bankCharges: 20, currency: "USD", paidOn: today })
        .expect(201);
      const m = await orderMoney(orderId);
      expect(m).toMatchObject({ received: "1000.00", due: "0.00" }); // settled in full
      // 1,000 − 800 goods − 20 bank charges; cash in is the 980 that arrived.
      expect(m.profit).toMatchObject({ bankCharges: "20.00", earned: "180.00", received: "980.00" });
      const dash = (await api(app, manager).get("/dashboard").expect(200)).body.money;
      expect(toMinor(dash.thisMonth.received) - toMinor(before.dash)).toBe(980_00);
      const after = (await pnl()).months[Number(today.slice(5, 7)) - 1].cash.in;
      expect(toMinor(after) - toMinor(before.cash)).toBe(980_00);
      await ship(orderId);
      expect((await pnl()).orders.find((o: { id: string }) => o.id === orderId)).toMatchObject({ profit: "180.00", expenses: "20.00" });
    });
  });

  describe("rates kept on the order", () => {
    it("keeps past months still when the rates in Settings change", async () => {
      const d = await deal("Ibadan Oil", { items: [{ description: "Oil press", quantity: 1 }] });
      const { orderId } = await order(
        d.inquiryId,
        (o) => ({
          ...o,
          factoryQuoteId: null,
          prices: (o.prices as { lineId: string }[]).map((p) => ({ ...p, unitPrice: 7100 })),
          charges: [],
          costs: [],
        }),
        { currency: "CNY" },
      );
      await ship(orderId);
      const row = async () => (await pnl()).orders.find((o: { id: string }) => o.id === orderId);
      const sold = async () => {
        const r = await report();
        return { wonValue: r.wonValue, total: r.profit.total };
      };
      expect(await row()).toMatchObject({ revenue: "1000.00", uncostedRevenue: "1000.00", profit: "0.00" });
      const before = await sold();
      await setRates({ CNY: 7 });
      // At today's rate it would be 1,014.29: it stays at the rate it was sold at, and so does the month.
      expect(await row()).toMatchObject({ revenue: "1000.00" });
      expect(await sold()).toEqual(before);
      await setRates({ CNY: 7.1 });
    });
  });

  describe("a currency without a rate", () => {
    it("is listed by Reports and Home and never silently added as 0; expenses on a cancelled order become general expenses", async () => {
      const d = await deal("Karachi Rice", { items: [{ description: "Rice polisher", quantity: 1 }] });
      const { orderId } = await order(
        d.inquiryId,
        (o) => ({
          ...o,
          factoryQuoteId: null,
          prices: (o.prices as { lineId: string }[]).map((p) => ({ ...p, unitPrice: 2_800_000 })),
          charges: [],
          costs: [],
        }),
        { currency: "PKR" },
      );
      expect((await report()).missingRates).toEqual(["PKR"]);
      expect((await api(app, manager).get("/dashboard").expect(200)).body.money.missingRates).toEqual(["PKR"]);
      // An expense on it, then the order is cancelled: the expense is the company's own that month.
      const month = Number(today.slice(5, 7)) - 1;
      await api(app, manager)
        .post("/expenses", {
          orderId,
          category: "inspection",
          description: `Inspection ${tag}`,
          amount: 77,
          currency: "USD",
          spentOn: today,
        })
        .expect(201);
      const before = (await pnl()).months[month].earned.generalExpenses;
      await api(app, manager).post(`/orders/${orderId}/cancel`, { reason: "Customer cancelled" }).expect(200);
      const after = (await pnl()).months[month].earned.generalExpenses;
      expect(toMinor(after) - toMinor(before)).toBe(77_00);
      expect((await report()).missingRates).toEqual([]);
    });
  });

  describe("days in the company's time zone", () => {
    it("puts a deal from 05:00 on 1 November (Shanghai) in November in Reports, Insights and where we lose money", async () => {
      const d = await deal("Jos Tin");
      const count = async (from: string, to: string) => (await report(from, to)).funnel.received as number;
      const before = { nov: await count("2025-11-01", "2025-11-30"), oct: await count("2025-10-01", "2025-10-31") };
      const insightsBefore = (await api(app, manager).get("/insights?from=2025-11-01&to=2025-11-01").expect(200)).body.kpis.received.value;
      // 2025-11-01 05:00 in Shanghai is 2025-10-31 21:00 UTC; lost at the same moment.
      await db()
        .$executeRaw`update inquiries set created_at = '2025-10-31T21:00:00Z', closed_at = '2025-10-31T21:00:00Z', stage = 'lost', lost_reason = 'no_reply' where id = ${d.inquiryId}::uuid`;
      expect(await count("2025-11-01", "2025-11-30")).toBe(before.nov + 1);
      expect(await count("2025-10-01", "2025-10-31")).toBe(before.oct);
      const trend = (await report("2025-11-01", "2025-11-30")).trend;
      expect(trend.at(-1)).toMatchObject({ month: "2025-11" });
      expect((await api(app, manager).get("/insights?from=2025-11-01&to=2025-11-01").expect(200)).body.kpis.received.value).toBe(
        insightsBefore + 1,
      );
      const refNo = (await api(app, sana).get(`/inquiries/${d.inquiryId}`)).body.refNo;
      const lost = async (day: string) =>
        (await api(app, manager).get(`/reports/leaks?from=${day}&to=${day}`).expect(200)).body.lostDeals.map(
          (x: { refNo: string }) => x.refNo,
        );
      expect(await lost("2025-11-01")).toContain(refNo);
      expect(await lost("2025-10-31")).not.toContain(refNo);
    });
  });

  describe("the main currency", () => {
    it("is locked once money is recorded; a PKR company keeps its USD rate exact", async () => {
      // Kebo has orders: refused, in plain words; the rates can still change.
      expect((await api(app, admin).get("/settings/main-currency").expect(200)).body).toMatchObject({ locked: true });
      const refused = await api(app, admin)
        .put("/settings/sales", { ...sales, currency: "PKR", exchangeRates: { USD: 1 / 280, CNY: 7.1 / 280 }, reason: "New main currency" })
        .expect(400);
      expect(refused.body.error).toMatch(
        /^The main currency cannot change any more: orders, .* are already recorded with rates against it\. You can still change the exchange rates\.$/,
      );

      // A new company with nothing recorded may choose PKR.
      const company = await prisma.platform.company.create({ data: { slug: `pkr-${tag}`, name: `PKR Traders ${tag}` } });
      const email = `boss@pkr-${tag}.test`;
      await seedCompanyBase(prisma.company(company.id), {
        admin: { email, name: "Boss", role: "admin", passwordHash: await bcrypt.hash("Boss12345678", 10) },
      });
      const boss = await signIn(app, email, "Boss12345678");
      expect((await api(app, boss).get("/settings/main-currency").expect(200)).body).toEqual({ locked: false, reason: null });
      const own = (await api(app, boss).get("/settings").expect(200)).body.sales;
      await api(app, boss)
        .put("/settings/sales", { ...own, currency: "PKR", exchangeRates: { USD: 1 / 280, CNY: 7.1 / 280 }, reason: "We work in rupees" })
        .expect(200);
      // USD 100,000 at 280: PKR 28,000,000.00 exactly (at 0.003571 it would be 28,003,360.40).
      const e = (
        await api(app, boss)
          .post("/expenses", { category: "office", description: "Machine deposit", amount: 100000, currency: "USD", spentOn: today })
          .expect(201)
      ).body;
      expect(e.inMain).toBe("28000000.00");
      expect((await api(app, boss).get("/settings/main-currency").expect(200)).body).toMatchObject({
        locked: true,
        reason: expect.stringContaining("expenses"),
      });
      await api(app, boss)
        .put("/settings/sales", { ...own, currency: "USD", reason: "Back to dollars" })
        .expect(400);
    });
  });

  it("works out what a factory line owes the same way in the database as in the app", async () => {
    // Random prices, taxes and quantities with 2 decimals, and the half-cent cases.
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const cents = (n: number) => (rnd(n) / 100).toFixed(2);
    const cases: [string, string, string][] = [
      ["100.50", "13", "1"],
      ["19.85", "0", "4.10"],
      ["1.15", "13", "1"],
      ["0.01", "50", "0.50"],
      ["99999.99", "100", "99999.99"],
    ];
    for (let i = 0; i < 2000; i++) cases.push([cents(10_000_000), cents(10_001), cents(1_000_000)]);
    const rows = await db().$queryRaw<{ i: number; owed: string }[]>`
      select i, ${owedLineSql(Prisma.sql`p`, Prisma.sql`t`, Prisma.sql`q`)}::text as owed
      from unnest(${cases.map((c) => c[0])}::numeric[], ${cases.map((c) => c[1])}::numeric[], ${cases.map((c) => c[2])}::numeric[]) with ordinality as x(p, t, q, i)`;
    const app = rows.map((r) =>
      multiplyMinor(withTaxMinor(toMinor(cases[Number(r.i) - 1]![0]), cases[Number(r.i) - 1]![1]), cases[Number(r.i) - 1]![2]),
    );
    expect(rows.map((r) => Number(r.owed))).toEqual(app);
    expect(app.slice(0, 2)).toEqual([113_57, 81_39]);
  });
});
