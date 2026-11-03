import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FIRST_COMPANY_ID, fromDbDate, fromDbDateOrNull } from "@kebo/database";
import { toMinor } from "@kebo/money";
import { readSettings, shippedOnOf, type Permission } from "@kebo/shared";
import { dateIn, todayIn } from "@kebo/utils";
import { PrismaService } from "../src/database/prisma.service";
import { CompanyContext } from "../src/common/company/company-context";
import { toInfo } from "../src/common/company/companies.service";
import type { SessionUser } from "../src/common/auth/session-user";
import { FactsService } from "../src/modules/insights/facts/facts.service";
import { FactsReadService } from "../src/modules/insights/facts/facts-read.service";
import { factoryPositionsSql } from "../src/modules/money/due";
import { fxOf } from "../src/modules/money/position";
import { MainMoney } from "../src/modules/money/order-money";
import { readyOnOf } from "../src/modules/orders/ready";
import { api, signIn, startApp } from "./app";

/**
 * Insights data (PR B): three calculated tables written only by the shared rules. They agree with the
 * screens for every demo order, inquiry and order × factory; they follow every change (through the
 * queue the database triggers fill); the nightly check finds, logs and fixes a planted difference; an
 * empty company is fine; companies stay apart; money is only for people who may see it.
 */
describe("Insights data: order, inquiry and factory facts", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let facts: FactsService;
  let read: FactsReadService;
  let sana: string;
  let manager: string;
  let me: string;
  const tag = Date.now().toString(36);
  const tz = process.env.APP_TIME_ZONE ?? "Asia/Shanghai";
  const today = todayIn(tz);
  const day = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const db = () => prisma.company(FIRST_COMPANY_ID);
  const inKebo = async <T>(fn: () => Promise<T>) => {
    const c = await prisma.platform.company.findUniqueOrThrow({ where: { id: FIRST_COMPANY_ID } });
    return CompanyContext.run(toInfo(c), fn);
  };
  const settings = async () => readSettings(Object.fromEntries((await db().setting.findMany()).map((r) => [r.key, r.value])));
  const main = async () => {
    const s = await settings();
    return new MainMoney(s.sales.currency, s.sales.exchangeRates);
  };
  /** The stored row as the read API sees it (the queue is worked off first). */
  const row = async (orderId: string) =>
    ((await api(app, manager).get(`/insights/facts/orders?limit=1000`).expect(200)).body.rows as Record<string, unknown>[]).find((r) => r.orderId === orderId)!;
  const stored = (orderId: string) => db().orderFact.findUniqueOrThrow({ where: { orderId } });
  const factoryRow = async (orderId: string) => {
    await api(app, manager).get("/insights/facts/status").expect(200);
    await inKebo(() => facts.drain());
    return db().factoryOrderFact.findFirstOrThrow({ where: { orderId } });
  };

  let n = 0;
  /** An order of 10 pumps at USD 1,000 (USD 10,000, 30% deposit) bought at CNY 1,000 from a factory of its own. */
  async function makeOrder() {
    n += 1;
    const customer = (
      await api(app, sana)
        .post("/customers", { name: `Facts ${n} ${tag}`, country: "KE", contacts: [{ name: "Ada", email: `ada-${n}-${tag}@facts.test` }] })
        .expect(201)
    ).body;
    const factoryId = (await api(app, sana).post("/factories", { name: `Facts Works ${n} ${tag}`, address: "Taizhou" }).expect(201)).body.id as string;
    const inquiry = (
      await api(app, sana)
        .post("/inquiries", { customerId: customer.id, category: "Machinery", channel: "whatsapp", assigneeId: me, items: [{ description: "Pump", quantity: 10 }] })
        .expect(201)
    ).body;
    const item = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, {
        factoryId,
        receivedOn: day(-10),
        currency: "CNY",
        taxRate: 0,
        lines: [{ requestedItemId: item.id, description: "Pump", quantity: 10, unitPrice: 1000 }],
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiry.id}/quotation/draft`)).body;
    const options = [{ ...draft.options[0], prices: draft.options[0].prices.map((p: Record<string, unknown>) => ({ ...p, unitPrice: 1000 })) }];
    const r = (await api(app, sana).post(`/inquiries/${inquiry.id}/quotation/revisions`, { ...draft, currency: "USD", depositPercent: 30, options }).expect(201)).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "accepted" }).expect(200);
    const o = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.orders[0];
    return { orderId: o.id as string, inquiryId: inquiry.id as string, customerId: customer.id as string, factoryId };
  }

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    facts = app.get(FactsService);
    read = app.get(FactsReadService);
    sana = await signIn(app, "sana@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    me = (await api(app, sana).get("/auth/me")).body.id;
    await prisma.platform.company.update({ where: { id: FIRST_COMPANY_ID }, data: { featuresOff: [] } });
    // From scratch, as on the first start after the migration.
    await inKebo(() => facts.rebuild(false));
  });

  afterAll(async () => {
    await app?.close();
  });

  describe("agrees with the shared rules for every demo order, inquiry and order × factory", () => {
    it("has one row per order and per inquiry kept", async () => {
      expect(await db().orderFact.count()).toBe(await db().order.count());
      expect(await db().inquiryFact.count()).toBe(await db().inquiry.count({ where: { deletedAt: null } }));
      expect(await db().orderFact.count()).toBeGreaterThan(0);
    });

    it("each order's money is its money page and Costs page, at the order's rate", async () => {
      const fx = await main();
      const orders = await db().order.findMany({
        select: { id: true, status: true, currency: true, mainCurrency: true, mainRate: true, orderedOn: true, factories: true, lines: { select: { factoryId: true } }, shipments: { select: { departedOn: true } } },
      });
      for (const o of orders) {
        const f = await stored(o.id);
        const money = (await api(app, manager).get(`/orders/${o.id}/money`).expect(200)).body;
        const inMain = (v: string) => fx.order(toMinor(v), o) / 100;
        expect([o.id, Number(f.receivedMain)]).toEqual([o.id, inMain(money.received)]);
        expect([o.id, Number(f.dueMain)]).toEqual([o.id, o.status === "cancelled" ? 0 : inMain(money.due)]);
        const costs = (await api(app, manager).get(`/orders/${o.id}/costs`).expect(200)).body;
        if (costs.profit) {
          expect([o.id, Number(f.profitExpectedMain)]).toEqual([o.id, inMain(costs.profit.expected)]);
          expect([o.id, Number(f.profitQuoteMain)]).toEqual([o.id, inMain(costs.profit.onQuote)]);
          expect([o.id, f.margin === null ? null : Number(f.margin)]).toEqual([o.id, costs.profit.margin]);
        }
        expect(fromDbDate(f.orderedOn)).toBe(fromDbDate(o.orderedOn));
        expect(fromDbDateOrNull(f.shippedOn)).toBe(shippedOnOf(o.shipments.map((s) => ({ departedOn: fromDbDateOrNull(s.departedOn) }))));
        expect(fromDbDateOrNull(f.readyOn)).toBe(readyOnOf(o));
      }
    });

    it("what customers owe and what is late is Money › To receive's", async () => {
      const fx = await main();
      const r = (await api(app, manager).get("/money/receivables").expect(200)).body;
      const orders = new Map((await db().order.findMany({ select: { id: true, currency: true, mainCurrency: true, mainRate: true } })).map((o) => [o.id, o]));
      for (const x of r.rows as { id: string; due: string; overdue: string }[]) {
        const f = await stored(x.id);
        expect([x.id, Number(f.dueMain)]).toEqual([x.id, fx.order(toMinor(x.due), orders.get(x.id)!) / 100]);
        expect([x.id, Number(f.overdueMain)]).toEqual([x.id, fx.order(toMinor(x.overdue), orders.get(x.id)!) / 100]);
      }
      // And none owes that the list leaves out.
      const listed = new Set((r.rows as { id: string }[]).map((x) => x.id));
      expect((await db().orderFact.findMany({ where: { dueMain: { gt: 0 } }, select: { orderId: true } })).map((x) => x.orderId).filter((id) => !listed.has(id))).toEqual([]);
    });

    it("this month's sales are Insights' (one formula)", async () => {
      const from = `${today.slice(0, 7)}-01`;
      const insights = (await api(app, manager).get(`/insights?from=${from}&to=${today}`).expect(200)).body;
      const groups = (await api(app, manager).get(`/insights/facts/orders/groups?from=${from}&to=${today}&period=all`).expect(200)).body;
      expect(groups.rows[0]?.sales ?? "0.00").toBe(insights.kpis.revenue.value);
      expect(groups.rows[0]?.orders ?? 0).toBe(insights.kpis.orders.value);
    });

    it("what we owe each factory is factoryPosition's (the SQL twin)", async () => {
      const s = await settings();
      const sql = await factoryPositionsSql(db(), fxOf(s, true));
      const rows = await db().factoryOrderFact.findMany({ where: { status: { not: "cancelled" } } });
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        const mine = sql.filter((x) => x.orderId === r.orderId && x.factoryId === r.factoryId);
        expect(mine.length).toBeGreaterThan(0);
        if (mine.length === 1) {
          expect([r.orderId, r.currency, Number(r.owed), Number(r.toPay)]).toEqual([r.orderId, mine[0]!.currency, mine[0]!.owedMinor / 100, mine[0]!.toPayMinor / 100]);
          expect(Number(r.paid)).toBe((mine[0]!.paidMinor + mine[0]!.takenOffMinor) / 100);
        }
      }
      // One row per factory the lines are bought from.
      const pairs = await db().orderLine.findMany({ where: { factoryId: { not: null } }, select: { orderId: true, factoryId: true }, distinct: ["orderId", "factoryId"] });
      expect(await db().factoryOrderFact.count()).toBe(pairs.length);
    });

    it("each inquiry's dates, prices and outcome are its own", async () => {
      const inquiries = await db().inquiry.findMany({
        where: { deletedAt: null },
        select: { id: true, stage: true, createdAt: true, closedAt: true, lostReason: true, _count: { select: { factoryQuotes: { where: { deletedAt: null } } } } },
      });
      for (const i of inquiries) {
        const f = await db().inquiryFact.findUniqueOrThrow({ where: { inquiryId: i.id } });
        const outcome = i.stage === "won" || i.stage === "lost" ? i.stage : "open";
        expect([i.id, f.outcome, fromDbDate(f.receivedOn), f.gotPrices]).toEqual([i.id, outcome, dateIn(i.createdAt, tz), i._count.factoryQuotes > 0]);
        if (outcome !== "open" && i.closedAt) expect(fromDbDateOrNull(f.closedOn)).toBe(dateIn(i.closedAt, tz));
        if (outcome === "lost") expect(f.lostReason).toBe(i.lostReason);
      }
    });

    it("the nightly check finds nothing to fix right after", async () => {
      const r = await inKebo(() => facts.rebuild(false));
      expect(r.differences).toEqual([]);
    });
  });

  describe("follows every change", () => {
    let o: Awaited<ReturnType<typeof makeOrder>>;
    beforeAll(async () => {
      o = await makeOrder();
    });

    it("a new order has its row, its factory's row, and its inquiry is won", async () => {
      expect(await row(o.orderId)).toMatchObject({ sales: "10000.00", received: "0.00", due: "10000.00", channel: "whatsapp", country: "KE", status: "open" });
      expect(await factoryRow(o.orderId)).toMatchObject({ factoryId: o.factoryId, currency: "CNY", offersSent: 1, offerWon: true, claims: 0 });
      expect(Number((await factoryRow(o.orderId)).owed)).toBe(10000);
      expect((await db().inquiryFact.findUniqueOrThrow({ where: { inquiryId: o.inquiryId } })).outcome).toBe("won");
    });

    it("is caught up a moment after a change, without a read", async () => {
      await api(app, manager).post(`/orders/${o.orderId}/payments`, { kind: "deposit", amount: 1000, currency: "USD", paidOn: today }).expect(201);
      await vi.waitFor(async () => expect(Number((await stored(o.orderId)).receivedMain)).toBe(1000), { timeout: 5000, interval: 100 });
      expect(await db().factsQueue.count()).toBe(0);
    });

    it("a payment, and its void", async () => {
      const p = (await api(app, manager).post(`/orders/${o.orderId}/payments`, { kind: "deposit", amount: 2000, currency: "USD", paidOn: today }).expect(201)).body;
      expect(await row(o.orderId)).toMatchObject({ received: "3000.00", due: "7000.00" });
      const id = p.id ?? p.payment?.id ?? (await db().payment.findFirstOrThrow({ where: { orderId: o.orderId, amount: 2000 } })).id;
      await api(app, manager).post(`/payments/${id}/void`, { reason: "Entered twice" }).expect(200);
      expect(await row(o.orderId)).toMatchObject({ received: "1000.00", due: "9000.00" });
    });

    it("an expense we bear cuts the expected profit and is a cost over plan", async () => {
      const before = await row(o.orderId);
      await api(app, manager)
        .post("/expenses", { orderId: o.orderId, category: "inspection", description: `Inspection ${tag}`, amount: 500, currency: "USD", spentOn: today, borneBy: "us" })
        .expect(201);
      const after = await row(o.orderId);
      expect(after).toMatchObject({ expenses: "500.00", costsOverPlan: "500.00" });
      expect(toMinor(String(after.profitExpected))).toBe(toMinor(String(before.profitExpected)) - 50_000);
    });

    it("a plan edit moves what is late", async () => {
      const plan = (await api(app, manager).get(`/orders/${o.orderId}/money`).expect(200)).body.plan.items as { id: string; label: string; amount: string }[];
      const items = plan.map((p, i) => ({ id: p.id, label: p.label, amount: Number(p.amount), dueOn: i === 0 ? day(-40) : day(30), dueRule: "fixed" }));
      await api(app, manager).put(`/orders/${o.orderId}/payment-plan`, { items, reason: "Agreed new dates" }).expect(200);
      // The deposit (3,000) was due 40 days ago and 1,000 came in.
      expect(await row(o.orderId)).toMatchObject({ overdue: "2000.00", due: "9000.00" });
      const aging = (await api(app, manager).get(`/insights/facts/aging?side=receivable&bucket=d60&customerId=${o.customerId}`).expect(200)).body;
      expect(aging).toMatchObject({ d60: "2000.00", notDue: "7000.00", total: "9000.00" });
      expect(aging.orders).toEqual([expect.objectContaining({ orderId: o.orderId, amount: "2000.00" })]);
    });

    it("a factory payment", async () => {
      await api(app, manager).post(`/orders/${o.orderId}/factory-payments`, { factoryId: o.factoryId, kind: "deposit", amount: 3000, currency: "CNY", paidOn: today }).expect(201);
      const f = await factoryRow(o.orderId);
      expect([Number(f.owed), Number(f.paid), Number(f.toPay)]).toEqual([10000, 3000, 7000]);
    });

    it("the ready date, a shipment that left, and the delivery", async () => {
      await db().orderFactory.upsert({
        where: { orderId_factoryId: { orderId: o.orderId, factoryId: o.factoryId } },
        create: { orderId: o.orderId, factoryId: o.factoryId, readyOn: new Date(`${day(-6)}T00:00:00Z`) },
        update: { readyOn: new Date(`${day(-6)}T00:00:00Z`) },
      });
      await prisma.platform.$executeRaw`update orders set ship_by = ${day(-5)}::date where id = ${o.orderId}::uuid`;
      await api(app, sana).post(`/orders/${o.orderId}/shipments`, { mode: "sea", status: "departed", departedOn: day(-2) }).expect(201);
      const r = await row(o.orderId);
      expect(r).toMatchObject({ shippedOn: day(-2), onTime: false });
      expect(r.daysToShip).toBe((Date.parse(day(-2)) - Date.parse(String(r.orderedOn))) / 86_400_000);
      // Ready when the goods left (nothing marked received): 4 days after the factory's date.
      expect(await factoryRow(o.orderId)).toMatchObject({ daysLate: 4, onTime: false });
      expect(fromDbDateOrNull((await factoryRow(o.orderId)).readyActual)).toBe(day(-2));
      await api(app, sana).patch(`/orders/${o.orderId}/delivery`, { deliveredOn: day(-1) }).expect(200);
      expect((await row(o.orderId)).deliveredOn).toBe(day(-1));
    });

    it("an inquiry lost, with its reason", async () => {
      const customer = (await api(app, sana).post("/customers", { name: `Facts lost ${tag}`, country: "AE", contacts: [{ name: "Omar", email: `omar-${tag}@facts.test` }] }).expect(201)).body;
      const inquiry = (await api(app, sana).post("/inquiries", { customerId: customer.id, category: "Bottling", channel: "email", items: [{ description: "Capper", quantity: 1 }] }).expect(201)).body;
      await api(app, sana).post(`/inquiries/${inquiry.id}/stage`, { to: "lost", lostReason: "price_too_high", note: "Cheaper elsewhere" }).expect(200);
      const funnel = (await api(app, manager).get(`/insights/facts/funnel?customerId=${customer.id}`).expect(200)).body;
      expect(funnel).toMatchObject({ inquiries: 1, lost: 1, won: 0, open: 0, lostReasons: [{ reason: "price_too_high", count: 1 }] });
      expect(await db().inquiryFact.findUniqueOrThrow({ where: { inquiryId: inquiry.id } })).toMatchObject({ outcome: "lost", lostReason: "price_too_high", channel: "email", country: "AE" });
    });

    it("a change made straight in the database is followed too (the triggers queue it)", async () => {
      await prisma.platform.$executeRaw`update customers set country = 'TZ' where id = ${o.customerId}::uuid`;
      expect((await row(o.orderId)).country).toBe("TZ");
    });

    it("everything is still what a full check works out", async () => {
      expect((await inKebo(() => facts.rebuild(false))).differences).toEqual([]);
    });
  });

  describe("the nightly check", () => {
    it("finds a planted difference, logs it and fixes it", async () => {
      const [a, b] = await db().orderFact.findMany({ take: 2, orderBy: { orderId: "asc" } });
      const lost = await db().inquiryFact.findFirstOrThrow();
      await prisma.platform.$executeRaw`update order_facts set total_main = 1, on_time = null where order_id = ${a!.orderId}::uuid`;
      await prisma.platform.$executeRaw`delete from order_facts where order_id = ${b!.orderId}::uuid`;
      await prisma.platform.$executeRaw`delete from inquiry_facts where inquiry_id = ${lost.inquiryId}::uuid`;
      const warn = vi.spyOn((facts as unknown as { log: { warn: (m: string) => void } }).log, "warn");
      const r = await inKebo(() => facts.rebuild(true));
      expect(r.differences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ table: "order_facts", key: a!.orderId, kind: "changed", columns: expect.arrayContaining([{ column: "total_main", stored: 1, worked: a!.totalMain.toFixed(2) }]) }),
          { table: "order_facts", key: b!.orderId, kind: "missing" },
          { table: "inquiry_facts", key: lost.inquiryId, kind: "missing" },
        ]),
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("the nightly check fixed"));
      expect(warn.mock.calls[0]![0]).toContain(`${a!.orderId}: total_main 1 → "${a!.totalMain.toFixed(2)}"`);
      warn.mockRestore();
      expect((await stored(a!.orderId)).totalMain.toFixed(2)).toBe(a!.totalMain.toFixed(2));
      expect(await db().orderFact.count({ where: { orderId: b!.orderId } })).toBe(1);
      expect(await db().inquiryFact.count({ where: { inquiryId: lost.inquiryId } })).toBe(1);
      expect((await inKebo(() => facts.rebuild(true))).differences).toEqual([]);
    });

    it("throws away rows of deleted inquiries", async () => {
      const i = await db().inquiryFact.findFirstOrThrow({ where: { outcome: "open" } });
      await prisma.platform.$executeRaw`update inquiries set deleted_at = now() where id = ${i.inquiryId}::uuid`;
      await prisma.platform.$executeRaw`delete from facts_queue`;
      const r = await inKebo(() => facts.rebuild(false));
      expect(r.differences).toContainEqual({ table: "inquiry_facts", key: i.inquiryId, kind: "extra" });
      expect(await db().inquiryFact.count({ where: { inquiryId: i.inquiryId } })).toBe(0);
      await prisma.platform.$executeRaw`update inquiries set deleted_at = null where id = ${i.inquiryId}::uuid`;
      await inKebo(() => facts.drain());
      expect(await db().inquiryFact.count({ where: { inquiryId: i.inquiryId } })).toBe(1);
    });
  });

  describe("another company", () => {
    let other: Awaited<ReturnType<typeof prisma.platform.company.create>>;
    const person = (permissions: Permission[]): SessionUser => ({
      id: "00000000-0000-4000-8000-000000000000",
      name: "Reader",
      email: "reader@facts.test",
      role: "manager",
      roleName: "Manager",
      permissions,
      twoStepSetupRequired: false,
      sessionId: "s",
      companyId: other.id,
      viaPlatform: false,
    });
    const inOther = <T>(fn: () => Promise<T>) => CompanyContext.run(toInfo(other), fn);

    beforeAll(async () => {
      other = await prisma.platform.company.create({ data: { slug: `facts-${tag}`, name: `Facts ${tag}` } });
    });
    afterAll(async () => {
      await prisma.platform.company.delete({ where: { id: other.id } });
    });

    it("an empty company: nothing to fill, nothing to fix, every read is empty", async () => {
      expect(await inOther(() => facts.fillIfEmpty())).toBe(false);
      expect(await inOther(() => facts.rebuild(true))).toEqual({ orders: 0, inquiries: 0, factoryRows: 0, differences: [] });
      const boss = person(["reports.view", "expenses.manage"]);
      expect((await inOther(() => read.orderGroups(boss, { period: "month", by: "customer" }))).rows).toEqual([]);
      expect((await inOther(() => read.factoryGroups(boss, { period: "all", by: "factory" }))).rows).toEqual([]);
      expect(await inOther(() => read.funnel(boss, {}))).toMatchObject({ inquiries: 0, won: 0, lost: 0, lostReasons: [] });
      expect(await inOther(() => read.aging(boss, { side: "receivable" }))).toMatchObject({ total: "0.00", notDue: "0.00", over60: "0.00" });
      expect(await inOther(() => read.aging(boss, { side: "payable" }))).toMatchObject({ total: "0.00" });
      expect((await inOther(() => read.cash(boss, {}))).months).toEqual([]);
    });

    it("sees none of Kebo's rows, and cannot write them", async () => {
      expect(await db().orderFact.count()).toBeGreaterThan(0);
      const theirs = prisma.company(other.id);
      expect(await theirs.orderFact.count()).toBe(0);
      expect(await theirs.inquiryFact.count()).toBe(0);
      expect(await theirs.factoryOrderFact.count()).toBe(0);
      expect(await theirs.factsQueue.count()).toBe(0);
      const a = await db().orderFact.findFirstOrThrow();
      expect(await theirs.$executeRaw`update order_facts set total_main = 0 where order_id = ${a.orderId}::uuid`).toBe(0);
      // Nor point a row of its own at Kebo's order.
      await expect(theirs.$executeRaw`insert into facts_queue (kind, entity_id) values ('order', ${a.orderId}::uuid)`).resolves.toBe(1);
      await expect(
        theirs.$executeRaw`insert into factory_order_facts (order_id, factory_id, status, ordered_on, main_currency, owed_main, paid_main, to_pay_main, offers_sent, offer_won, claims)
                           select order_id, factory_id, status, ordered_on, main_currency, 0, 0, 0, 0, false, 0 from (values (${a.orderId}::uuid, ${a.orderId}::uuid, 'open'::"OrderStatus", current_date, 'USD')) v(order_id, factory_id, status, ordered_on, main_currency)`,
      ).rejects.toThrow();
      // Its queue entry for an order it cannot see leaves nothing behind.
      await inOther(() => facts.drain());
      expect(await theirs.orderFact.count()).toBe(0);
      expect(await theirs.factsQueue.count()).toBe(0);
    });
  });

  describe("money only for people who may see money", () => {
    const person = (permissions: Permission[]): SessionUser => ({
      id: me,
      name: "Reader",
      email: "reader@facts.test",
      role: "manager",
      roleName: "Manager",
      permissions,
      twoStepSetupRequired: false,
      sessionId: "s",
      companyId: FIRST_COMPANY_ID,
      viaPlatform: false,
    });

    it("shows sales and gross profit, hides costs, expected profit, expenses, factory money and cash out", async () => {
      const reader = person(["reports.view"]);
      const g = (await inKebo(() => read.orderGroups(reader, { period: "all", by: "company" }))).rows[0]!;
      expect(g.sales).not.toBeNull();
      expect(g.profitQuote).not.toBeNull();
      expect([g.cost, g.profitExpected, g.margin, g.expenses, g.costsOverPlan]).toEqual([null, null, null, null, null]);
      const f = (await inKebo(() => read.factoryGroups(reader, { period: "all", by: "factory" }))).rows;
      expect(f.length).toBeGreaterThan(0);
      expect(f.every((r) => r.spend === null && r.toPay === null && r.own === null)).toBe(true);
      await expect(inKebo(() => read.aging(reader, { side: "payable" }))).rejects.toThrow("Only people who may see money");
      const cash = await inKebo(() => read.cash(reader, {}));
      expect(cash.months.every((m) => m.out === null && m.expenses === null && m.net === null)).toBe(true);
      const rows = (await inKebo(() => read.orders(reader, { limit: 5 }))).rows;
      expect(rows.every((r) => r.cost === null && r.profitExpected === null && r.expenses === null)).toBe(true);

      const boss = person(["reports.view", "expenses.manage"]);
      const b = (await inKebo(() => read.orderGroups(boss, { period: "all", by: "company" }))).rows[0]!;
      expect([b.cost, b.profitExpected, b.expenses]).not.toContain(null);
      expect((await inKebo(() => read.factoryGroups(boss, { period: "all", by: "factory" }))).rows.some((r) => r.spend !== null)).toBe(true);
    });

    it("nobody without Reports reads them", async () => {
      await expect(inKebo(() => read.orderGroups(person([]), { period: "all", by: "company" }))).rejects.toThrow();
      await api(app, sana).get("/insights/facts/orders/groups").expect(403);
    });
  });

  describe("the read API", () => {
    it("groups by period and by who / where / what, with names", async () => {
      for (const by of ["customer", "person", "channel", "country", "category"]) {
        const r = (await api(app, manager).get(`/insights/facts/orders/groups?period=quarter&by=${by}`).expect(200)).body;
        expect(r.rows.length).toBeGreaterThan(0);
        expect(r.rows[0]).toMatchObject({ period: expect.stringMatching(/^\d{4}-Q[1-4]$/), key: expect.any(String), label: expect.any(String) });
      }
      const inq = (await api(app, manager).get("/insights/facts/inquiries/groups?period=year&by=channel").expect(200)).body;
      expect(inq.rows.reduce((t: number, r: { inquiries: number }) => t + r.inquiries, 0)).toBe(await db().inquiry.count({ where: { deletedAt: null } }));
      const fac = (await api(app, manager).get("/insights/facts/factories/groups?period=all&by=factory").expect(200)).body;
      expect(fac.rows.some((r: { offersSent: number; label: string }) => r.offersSent > 0 && r.label.length > 0)).toBe(true);
      const cash = (await api(app, manager).get(`/insights/facts/cash?from=${day(-400)}&to=${today}`).expect(200)).body;
      expect(cash.months.length).toBeGreaterThan(0);
      expect((await api(app, manager).get("/insights/facts/status").expect(200)).body).toMatchObject({ pending: 0, orders: await db().order.count() });
      await api(app, manager).get("/insights/facts/orders/groups?by=planet").expect(422);
    });
  });
});
