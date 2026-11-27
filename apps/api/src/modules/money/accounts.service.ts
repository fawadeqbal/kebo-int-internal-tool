import { Injectable } from "@nestjs/common";
import { livePurchase, livePart, decimalToMinor, fromDbDate, fromDbDateOrNull, toDbDate, type Prisma, isCustomer, isSupplier } from "@kebo/database";
import { fromMinor, orderMoney, roundHalfAway } from "@kebo/money";
import { can, shippedOnOf, type ExpenseCategory, type LostReason } from "@kebo/shared";
import { addDays, dateIn, ForbiddenError, monthsBetween, NotFoundError, type ISODate } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { convert, costingsOf, MainMoney, paysBasis } from "./order-money";

const person = { select: { id: true, name: true } } as const;

/** Kinds spent to sell (on a customer, an inquiry or an order): trips, hotels, meals, gifts, samples, courier, checks. */
const SELLING = new Set<string>(["travel", "hotel", "meals", "gifts", "samples", "courier", "inspection"]);
/** Kinds that are a visit to a supplier when one is named. */
const VISITS = new Set<string>(["travel", "hotel", "meals", "inspection"]);

type Event = {
  on: string;
  kind: "deal" | "won" | "lost" | "order" | "shipped" | "payment" | "expense";
  text: string;
  amount?: string;
  currency?: string;
  href?: string;
};

/**
 * A customer's account, for managers: every deal (won, lost or open), what
 * their orders earned, everything spent on them (on orders, on deals before
 * the sale, on deals we lost, and on them in general), money in and out, and a
 * timeline. All in the main currency at the rates used (orders at the rate
 * stored on each).
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
  ) {}

  private assertManager(user: SessionUser) {
    if (!can(user, "expenses.manage")) throw new ForbiddenError("Only managers can see what was spent and earned.");
  }

  /** What an expense can be for: customers, their deals and orders, and suppliers. */
  async expenseTargets(user: SessionUser) {
    this.assertManager(user);
    // Every open deal and order, and those of the last year: an expense is almost always on one of them. No cap
    // (review 24 Nov: the 400 newest left older open orders such as SO-2026-0002 without a way to get a cost).
    const since = new Date(`${addDays(this.clock.today(), -365)}T00:00:00Z`);
    const [customers, deals, orders, suppliers] = await Promise.all([
      this.prisma.db.party.findMany({ where: { ...isCustomer, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      this.prisma.db.inquiry.findMany({
        where: { deletedAt: null, OR: [{ stage: { in: ["new", "sourcing", "quoted"] } }, { createdAt: { gte: since } }] },
        select: { id: true, refNo: true, title: true, stage: true, customer: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.db.order.findMany({
        where: { status: { not: "cancelled" }, OR: [{ status: "open" }, { createdAt: { gte: since } }] },
        select: { id: true, refNo: true, inquiryId: true, customer: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.db.party.findMany({ where: { ...isSupplier, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    return {
      customers,
      deals: deals.map((d) => ({
        id: d.id,
        refNo: d.refNo,
        title: d.title,
        stage: d.stage,
        customerId: d.customer.id,
        customer: d.customer.name,
      })),
      orders: orders.map((o) => ({ id: o.id, refNo: o.refNo, dealId: o.inquiryId, customerId: o.customer.id, customer: o.customer.name })),
      factories: suppliers,
    };
  }

  async customerAccount(user: SessionUser, customerId: string) {
    this.assertManager(user);
    const customer = await this.prisma.db.party.findFirst({
      where: { ...isCustomer, id: customerId, deletedAt: null },
      select: { id: true, name: true, createdAt: true },
    });
    if (!customer) throw new NotFoundError("Customer");
    const { sales } = await this.settings.get();
    const main = sales.currency;
    const fx = new MainMoney(main, sales.exchangeRates);

    const [deals, expenses, payments] = await Promise.all([
      this.prisma.db.inquiry.findMany({
        where: { customerId, deletedAt: null },
        select: {
          id: true,
          refNo: true,
          title: true,
          stage: true,
          lostReason: true,
          lostNote: true,
          createdAt: true,
          closedAt: true,
          assignee: person,
          orders: {
            where: { status: { not: "cancelled" } },
            select: {
              id: true,
              refNo: true,
              currency: true,
              mainCurrency: true,
              mainRate: true,
              total: true,
              orderedOn: true,
              // The day it shipped: the earliest day one of its shipments left.
              shipments: { select: { departedOn: true } },
              stage: true,
              status: true,
              supplierPaid: { where: livePurchase, select: { share: true, movement: { select: { rate: true } } } },
              allocations: { where: livePart, select: { bankCharges: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.db.expense.findMany({
        where: { customerId, voidedAt: null },
        select: {
          id: true,
          amount: true,
          rate: true,
          currency: true,
          inquiryId: true,
          orderId: true,
          category: true,
          spentOn: true,
          description: true,
          borneBy: true,
        },
      }),
      this.prisma.db.allocation.findMany({
        where: { ...livePart, order: { customerId, status: { not: "cancelled" } } },
        select: {
          amount: true,
          bankCharges: true,
          on: true,
          kind: true,
          order: { select: { id: true, refNo: true, currency: true, mainCurrency: true, mainRate: true } },
        },
      }),
    ]);
    // When each order's deposit was asked for (its fixed due day).
    const depositsDue = await this.prisma.db.invoice.findMany({
      where: { part: "deposit", dueOn: { not: null }, order: { customerId, status: { not: "cancelled" } } },
      select: { orderId: true, amount: true, dueOn: true },
    });
    const costings = await costingsOf(
      this.prisma.db,
      deals.flatMap((d) => d.orders.map((o) => ({ id: o.id, totalMinor: decimalToMinor(o.total) }))),
    );

    const inMain = (e: { amount: Prisma.Decimal; rate: Prisma.Decimal }) => convert(decimalToMinor(e.amount), Number(e.rate));
    const byDeal = new Map<string, { beforeSale: number; onOrder: number; basisPaid: number }>();
    // An order's expense belongs to the order's deal, even if it was saved without it.
    const dealOfOrder = new Map(deals.flatMap((d) => d.orders.map((o) => [o.id, d.id] as const)));
    let otherCosts = 0;
    for (const raw of expenses) {
      const e = { ...raw, inquiryId: (raw.orderId && dealOfOrder.get(raw.orderId)) || raw.inquiryId };
      const v = inMain(e);
      if (!e.inquiryId) {
        otherCosts += v;
        continue;
      }
      const d = byDeal.get(e.inquiryId) ?? { beforeSale: 0, onOrder: 0, basisPaid: 0 };
      if (e.orderId) {
        // Charged to the customer or taken off what we owe a supplier: not a cost of the order.
        if (e.borneBy !== "us") continue;
        d.onOrder += v;
        if (paysBasis(e.category)) d.basisPaid += v;
      } else d.beforeSale += v;
      byDeal.set(e.inquiryId, d);
    }

    const t = {
      sales: 0,
      goodsCost: 0,
      orderCosts: 0,
      beforeSale: 0,
      lostDeals: 0,
      openDeals: 0,
      otherCosts,
      received: 0,
      supplierPaid: 0,
      uncosted: 0,
      profit: 0,
      bankCharges: 0,
    };
    const lost = new Map<LostReason | "not_said", { deals: number; spent: number }>();
    const rows = deals.map((d) => {
      const spent = byDeal.get(d.id) ?? { beforeSale: 0, onOrder: 0, basisPaid: 0 };
      const order = d.orders[0] ?? null;
      let money: { revenue: number; goodsCost: number; uncosted: number; profit: number; net: number } | null = null;
      if (order) {
        // As on the order's page: profit on the revenue that has a cost, with the costs to reach the basis and bank charges.
        const c = costings.get(order.id)!;
        const inMain = (minor: number) => fx.order(minor, order);
        const revenue = inMain(c.revenueMinor);
        const costedRevenue = inMain(c.costedRevenueMinor);
        const goodsCost = inMain(c.goodsCostMinor) + inMain(c.basisCostMinor);
        const bank = inMain(
          order.allocations.reduce((s, p) => s + decimalToMinor(p.bankCharges), 0),
        );
        // Profit now expected, as on the order's Costs page (freight paid for the planned basis costs counted there once).
        const p = orderMoney({
          revenueMinor: revenue,
          costedRevenueMinor: costedRevenue,
          goodsCostMinor: inMain(c.goodsCostMinor),
          basisCostMinor: inMain(c.basisCostMinor),
          receivedMinor: 0,
          supplierPaidMinor: 0,
          expensesMinor: spent.onOrder,
          basisPaidMinor: spent.basisPaid,
          bankChargesMinor: bank,
          beforeSaleMinor: spent.beforeSale,
        });
        const profit = p.expectedMinor;
        money = { revenue, goodsCost, uncosted: revenue - costedRevenue, profit, net: p.netMinor };
        t.sales += revenue;
        t.goodsCost += goodsCost;
        // What was spent on the order (cash); profit counts freight paid for the planned basis costs once.
        t.orderCosts += spent.onOrder;
        t.bankCharges += bank;
        t.beforeSale += spent.beforeSale;
        t.uncosted += revenue - costedRevenue;
        t.profit += profit;
        t.supplierPaid += order.supplierPaid.reduce((s, x) => s + inMain(convert(decimalToMinor(x.share), Number(x.movement.rate))), 0);
      } else if (d.stage === "lost") {
        t.lostDeals += spent.beforeSale + spent.onOrder;
        const key = d.lostReason ?? "not_said";
        const r = lost.get(key) ?? { deals: 0, spent: 0 };
        r.deals += 1;
        r.spent += spent.beforeSale + spent.onOrder;
        lost.set(key, r);
      } else {
        t.openDeals += spent.beforeSale + spent.onOrder;
      }
      return {
        id: d.id,
        refNo: d.refNo,
        title: d.title,
        stage: d.stage,
        lostReason: d.lostReason,
        lostNote: d.lostNote,
        receivedOn: d.createdAt,
        closedAt: d.closedAt,
        assignee: d.assignee,
        spent: fromMinor(spent.beforeSale + spent.onOrder),
        beforeSale: fromMinor(spent.beforeSale),
        order: order && {
          id: order.id,
          refNo: order.refNo,
          stage: order.stage,
          status: order.status,
          revenue: fromMinor(money!.revenue),
          /** Value on lines without a cost: left out of profit. */
          uncostedRevenue: fromMinor(money!.uncosted),
          goodsCost: fromMinor(money!.goodsCost),
          costs: fromMinor(spent.onOrder),
          profit: fromMinor(money!.profit),
          net: fromMinor(money!.net),
        },
      };
    });
    for (const p of payments)
      t.received += fx.order(decimalToMinor(p.amount), p.order!);

    // How late the deposits come: the day the deposit payments add up to the deposit, against its due day.
    const lateDays: number[] = [];
    for (const inv of depositsDue) {
      const paid = payments.filter((p) => p.order!.id === inv.orderId && p.kind === "deposit").sort((a, b) => +a.on - +b.on);
      const need = decimalToMinor(inv.amount);
      let sum = 0;
      for (const p of paid) {
        sum += decimalToMinor(p.amount) + decimalToMinor(p.bankCharges);
        if (sum >= need) {
          lateDays.push(Math.round((+p.on - +inv.dueOn!) / 86_400_000));
          break;
        }
      }
    }

    const won = deals.filter((d) => d.orders.length > 0).length;
    const lostCount = deals.filter((d) => d.orders.length === 0 && d.stage === "lost").length;
    const spentTotal = t.orderCosts + t.beforeSale + t.lostDeals + t.openDeals + t.otherCosts;
    const profit = t.profit;
    const net = profit - t.beforeSale - t.lostDeals - t.openDeals - t.otherCosts;
    const sellingCosts = t.beforeSale + t.lostDeals + t.otherCosts;

    const events: Event[] = [];
    for (const d of deals) {
      events.push({
        on: dateIn(d.createdAt, this.clock.timeZone),
        kind: "deal",
        text: `${d.refNo} received: ${d.title}`,
        href: `/inquiries/${d.id}`,
      });
      if (d.closedAt && d.stage === "lost")
        events.push({ on: dateIn(d.closedAt, this.clock.timeZone), kind: "lost", text: `${d.refNo} lost`, href: `/inquiries/${d.id}` });
      for (const o of d.orders) {
        events.push({
          on: fromDbDate(o.orderedOn),
          kind: "order",
          text: `${d.refNo} won: order ${o.refNo}`,
          amount: o.total.toFixed(2),
          currency: o.currency,
          href: `/orders/${o.id}`,
        });
        const shipped = shippedOnOf(o.shipments.map((s) => ({ departedOn: fromDbDateOrNull(s.departedOn) })));
        if (shipped) events.push({ on: shipped, kind: "shipped", text: `${o.refNo} shipped`, href: `/orders/${o.id}` });
      }
    }
    for (const p of payments)
      events.push({
        on: fromDbDate(p.on),
        kind: "payment",
        text: `Payment for ${p.order!.refNo}`,
        amount: p.amount.toFixed(2),
        currency: p.order!.currency,
        href: `/orders/${p.order!.id}/payment`,
      });
    for (const e of expenses)
      events.push({ on: fromDbDate(e.spentOn), kind: "expense", text: e.description, amount: e.amount.toFixed(2), currency: e.currency });
    events.sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0));

    return {
      customer: { id: customer.id, name: customer.name, since: customer.createdAt },
      currency: main,
      deals: { total: deals.length, won, lost: lostCount, open: deals.length - won - lostCount },
      /** Won ÷ (won + lost), 0–100; null before any deal is decided. */
      winRate: won + lostCount > 0 ? Math.round((won / (won + lostCount)) * 100) : null,
      totals: {
        sales: fromMinor(t.sales),
        goodsCost: fromMinor(t.goodsCost),
        orderCosts: fromMinor(t.orderCosts),
        /** Their orders' value with a cost, less goods (with the costs to reach the basis), order costs and bank charges. */
        profit: fromMinor(profit),
        bankCharges: fromMinor(t.bankCharges),
        beforeSale: fromMinor(t.beforeSale),
        lostDeals: fromMinor(t.lostDeals),
        openDeals: fromMinor(t.openDeals),
        otherCosts: fromMinor(t.otherCosts),
        spent: fromMinor(spentTotal),
        /** What the customer is worth so far: profit less everything spent to win and keep them. */
        net: fromMinor(net),
        /** Spent to win business (before sales, on lost deals, on them in general) for each order won. */
        sellingCostPerWin: won > 0 ? fromMinor(roundHalfAway(sellingCosts / won)) : null,
        received: fromMinor(t.received),
        supplierPaid: fromMinor(t.supplierPaid),
        /** Cash so far: in from them, less paid to suppliers for their orders, less everything spent on them. */
        cash: fromMinor(t.received - t.supplierPaid - spentTotal),
        uncostedRevenue: fromMinor(t.uncosted),
      },
      /** Profit ÷ sales on their orders, in percent (one decimal); null before any order. */
      margin: t.sales > 0 ? Math.round((t.profit / t.sales) * 1000) / 10 : null,
      /** Average days their deposits came after the day asked (negative: early); null when none is paid yet. */
      depositDaysLate: lateDays.length ? Math.round(lateDays.reduce((a, b) => a + b, 0) / lateDays.length) : null,
      lostReasons: [...lost.entries()]
        .map(([reason, r]) => ({ reason, deals: r.deals, spent: fromMinor(r.spent) }))
        .sort((a, b) => b.deals - a.deals),
      rows,
      timeline: events.slice(0, 80),
      missingRates: fx.missingRates,
    };
  }

  /**
   * What one person spent (design "spending", the person's page): the costs they paid, and the ones they
   * recorded where nobody else is named, in a period (default this year), in the main currency at each cost's
   * own rate. By kind and by what it was for: on orders (already in those orders' profit), before an order on
   * an inquiry we won, on inquiries lost or still open, on customers, and for the company. "Outside orders" is
   * what their profit after all costs takes off: before orders, lost and open inquiries, customers. Owed back:
   * every cost they paid from their own money and were not paid back, whenever it was.
   */
  async personSpending(user: SessionUser, personId: string, q: { from?: ISODate; to?: ISODate }) {
    this.assertManager(user);
    const who = await this.prisma.db.user.findFirst({ where: { id: personId }, select: { id: true, name: true } });
    if (!who) throw new NotFoundError("Person");
    const today = this.clock.today();
    const to = q.to ?? today;
    const from = q.from ?? `${to.slice(0, 4)}-01-01`;
    const { sales } = await this.settings.get();
    const select = {
      id: true,
      category: true,
      description: true,
      amount: true,
      currency: true,
      rate: true,
      spentOn: true,
      ownMoney: true,
      payLater: true,
      repaidOn: true,
      paidById: true,
      account: { select: { name: true } },
      order: { select: { id: true, refNo: true } },
      inquiry: { select: { id: true, refNo: true, stage: true, orders: { where: { status: { not: "cancelled" } }, select: { id: true }, take: 1 } } },
      customer: { select: { id: true, name: true } },
    } as const;
    const [rows, owedRows] = await Promise.all([
      this.prisma.db.expense.findMany({
        where: { voidedAt: null, spentOn: { gte: toDbDate(from), lte: toDbDate(to) }, OR: [{ paidById: personId }, { paidById: null, recordedById: personId }] },
        orderBy: [{ spentOn: "desc" }, { createdAt: "desc" }],
        select,
      }),
      this.prisma.db.expense.findMany({
        where: { voidedAt: null, ownMoney: true, repaidOn: null, paidById: personId, OR: [{ orderId: null }, { order: { status: { not: "cancelled" } } }] },
        orderBy: [{ spentOn: "asc" }, { createdAt: "asc" }],
        select,
      }),
    ]);
    const inMain = (e: { amount: Prisma.Decimal; rate: Prisma.Decimal }) => convert(decimalToMinor(e.amount), Number(e.rate));
    type For = "orders" | "before" | "lost" | "open" | "customers" | "company";
    const forOf = (e: (typeof rows)[number]): For =>
      e.order ? "orders" : e.inquiry ? (e.inquiry.orders.length ? "before" : e.inquiry.stage === "lost" ? "lost" : "open") : e.customer ? "customers" : "company";
    const byKind = new Map<string, number>();
    const byFor: Record<For, number> = { orders: 0, before: 0, lost: 0, open: 0, customers: 0, company: 0 };
    let spent = 0;
    for (const e of rows) {
      const v = inMain(e);
      spent += v;
      byKind.set(e.category, (byKind.get(e.category) ?? 0) + v);
      byFor[forOf(e)] += v;
    }
    const view = (e: (typeof rows)[number]) => ({
      id: e.id,
      category: e.category as ExpenseCategory,
      description: e.description,
      amount: e.amount.toFixed(2),
      currency: e.currency,
      inMain: fromMinor(inMain(e)),
      spentOn: fromDbDate(e.spentOn),
      for: forOf(e),
      order: e.order,
      inquiry: e.inquiry && { id: e.inquiry.id, refNo: e.inquiry.refNo, stage: e.inquiry.stage },
      customer: e.customer,
      /** How it was paid: their own money (owed back until it is), a bill not paid yet, or an account. */
      paid: e.ownMoney ? (e.repaidOn ? ("own_repaid" as const) : ("own" as const)) : e.payLater && !e.repaidOn ? ("not_yet" as const) : ("account" as const),
      account: e.account?.name ?? null,
      /** Recorded by them with nobody named as paying it. */
      recordedOnly: e.paidById !== personId,
    });
    const owed = new Map<string, { currency: string; minor: number; ids: string[] }>();
    for (const e of owedRows) {
      const o = owed.get(e.currency) ?? { currency: e.currency, minor: 0, ids: [] };
      o.minor += decimalToMinor(e.amount);
      o.ids.push(e.id);
      owed.set(e.currency, o);
    }
    return {
      person: who,
      currency: sales.currency,
      from,
      to,
      spent: fromMinor(spent),
      count: rows.length,
      byKind: [...byKind].map(([category, v]) => ({ category: category as ExpenseCategory, amount: fromMinor(v) })).sort((a, b) => Number(b.amount) - Number(a.amount)),
      byFor: Object.fromEntries(Object.entries(byFor).map(([k, v]) => [k, fromMinor(v)])) as Record<For, string>,
      /** Before orders, lost and open inquiries, customers: what profit after all costs takes off their orders' profit. */
      outside: fromMinor(byFor.before + byFor.lost + byFor.open + byFor.customers),
      latest: rows.slice(0, 5).map(view),
      owed: {
        total: [...owed.values()].map((o) => ({ currency: o.currency, amount: fromMinor(o.minor), ids: o.ids })),
        rows: owedRows.map(view),
      },
    };
  }

  /**
   * Reports › Spending (design "spending"): who spends, on what, and what winning and losing cost us, in a period.
   * Every cost in the main currency at its own rate. "Spent to sell": trips, hotels, meals, gifts, samples,
   * courier and checks on a customer, an inquiry or an order (the company's own costs stay on Company costs).
   * A person's spending is the costs they paid, or recorded with nobody named, as on their page. "On lost deals":
   * spent in the period on inquiries that are lost, by why they were lost. Owed back: what staff paid from their
   * own money and were not paid back, whenever it was spent.
   */
  async spendingReport(user: SessionUser, q: { from?: ISODate; to?: ISODate; prevFrom?: ISODate; prevTo?: ISODate }) {
    this.assertManager(user);
    const today = this.clock.today();
    // Never past today: an end far ahead only made a months list of every month up to it. A period that starts
    // after its end (one wholly ahead of today, or typed backwards) has nothing in it, as before: no costs, no months.
    // The period to compare with (prevFrom, prevTo) is only summed, so it is read as asked.
    const to = q.to && q.to < today ? q.to : today;
    const from = q.from ?? `${to.slice(0, 4)}-01-01`;
    const { sales } = await this.settings.get();
    const select = {
      category: true,
      amount: true,
      rate: true,
      spentOn: true,
      paidById: true,
      recordedById: true,
      orderId: true,
      customerId: true,
      factory: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true } },
      inquiry: { select: { id: true, stage: true, lostReason: true, orders: { where: { status: { not: "cancelled" } }, select: { id: true }, take: 1 } } },
    } as const;
    const [rows, before, owedRows, people] = await Promise.all([
      this.prisma.db.expense.findMany({ where: { voidedAt: null, spentOn: { gte: toDbDate(from), lte: toDbDate(to) } }, select }),
      q.prevFrom && q.prevTo
        ? this.prisma.db.expense.findMany({ where: { voidedAt: null, spentOn: { gte: toDbDate(q.prevFrom), lte: toDbDate(q.prevTo) } }, select })
        : Promise.resolve([]),
      this.prisma.db.expense.findMany({
        where: { voidedAt: null, ownMoney: true, repaidOn: null, paidById: { not: null }, OR: [{ orderId: null }, { order: { status: { not: "cancelled" } } }] },
        select: { amount: true, rate: true, paidById: true },
      }),
      this.prisma.db.user.findMany({ where: { isSystem: false }, select: { id: true, name: true } }),
    ]);
    const inMain = (e: { amount: Prisma.Decimal; rate: Prisma.Decimal }) => convert(decimalToMinor(e.amount), Number(e.rate));
    const toSell = (e: (typeof rows)[number]) => SELLING.has(e.category) && !!(e.orderId || e.inquiry || e.customerId);
    const whoOf = (e: { paidById: string | null; recordedById: string }) => e.paidById ?? e.recordedById;
    const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "Someone";
    const sum = (list: typeof rows, keep: (e: (typeof rows)[number]) => boolean) => list.filter(keep).reduce((t, e) => t + inMain(e), 0);

    const byPerson = new Map<string, { spent: number; toSell: number; lost: number; owed: number }>();
    const personOf = (id: string) => byPerson.get(id) ?? byPerson.set(id, { spent: 0, toSell: 0, lost: 0, owed: 0 }).get(id)!;
    const kinds = new Map<string, number>();
    const reasons = new Map<string, { deals: Set<string>; spent: number }>();
    const months = new Map<string, number>();
    const suppliers = new Map<string, { factory: { id: string; name: string }; visits: number; spent: number }>();
    const customers = new Map<string, { customer: { id: string; name: string }; spent: number }>();
    let company = 0;
    let onWon = 0;
    for (const e of rows) {
      const v = inMain(e);
      const p = personOf(whoOf(e));
      p.spent += v;
      if (!e.orderId && !e.inquiry && !e.customerId) company += v;
      if (e.customer) {
        const c = customers.get(e.customer.id) ?? { customer: e.customer, spent: 0 };
        c.spent += v;
        customers.set(e.customer.id, c);
      }
      const lost = !e.orderId && e.inquiry?.stage === "lost" && e.inquiry.orders.length === 0;
      if (lost) {
        p.lost += v;
        const key = e.inquiry!.lostReason ?? "not_said";
        const r = reasons.get(key) ?? { deals: new Set<string>(), spent: 0 };
        r.deals.add(e.inquiry!.id);
        r.spent += v;
        reasons.set(key, r);
      }
      if (e.factory && VISITS.has(e.category)) {
        const f = suppliers.get(e.factory.id) ?? { factory: e.factory, visits: 0, spent: 0 };
        f.visits += 1;
        f.spent += v;
        suppliers.set(e.factory.id, f);
      }
      if (!toSell(e)) continue;
      p.toSell += v;
      kinds.set(e.category, (kinds.get(e.category) ?? 0) + v);
      const m = fromDbDate(e.spentOn).slice(0, 7);
      months.set(m, (months.get(m) ?? 0) + v);
      if (e.orderId || (e.inquiry && e.inquiry.orders.length > 0)) onWon += v;
    }
    for (const e of owedRows) personOf(e.paidById!).owed += inMain(e);
    const total = (k: "spent" | "toSell" | "lost" | "owed") => [...byPerson.values()].reduce((t, p) => t + p[k], 0);
    const monthList = monthsBetween(from, to);
    return {
      currency: sales.currency,
      from,
      to,
      toSell: fromMinor(total("toSell")),
      toSellBefore: q.prevFrom && q.prevTo ? fromMinor(sum(before, toSell)) : null,
      /** Spent to sell on orders, or before them on inquiries we won. */
      onWon: fromMinor(onWon),
      lost: { spent: fromMinor(total("lost")), deals: new Set([...reasons.values()].flatMap((r) => [...r.deals])).size },
      /** The company's own costs (on no customer, inquiry or order): Money › Company costs. */
      company: fromMinor(company),
      owed: fromMinor(total("owed")),
      people: [...byPerson]
        .map(([id, p]) => ({ person: { id, name: nameOf(id) }, spent: fromMinor(p.spent), toSell: fromMinor(p.toSell), lost: fromMinor(p.lost), owed: fromMinor(p.owed) }))
        .sort((a, b) => Number(b.spent) - Number(a.spent) || Number(b.owed) - Number(a.owed)),
      kinds: [...kinds].map(([category, v]) => ({ category: category as ExpenseCategory, amount: fromMinor(v) })).sort((a, b) => Number(b.amount) - Number(a.amount)),
      lostReasons: [...reasons]
        .map(([reason, r]) => ({ reason: reason as LostReason | "not_said", deals: r.deals.size, spent: fromMinor(r.spent) }))
        .sort((a, b) => Number(b.spent) - Number(a.spent)),
      factories: [...suppliers.values()].map((f) => ({ factory: f.factory, visits: f.visits, spent: fromMinor(f.spent) })).sort((a, b) => Number(b.spent) - Number(a.spent)),
      /** Everything spent on each customer in the period (on them, their inquiries and their orders). */
      customers: [...customers.values()].map((c) => ({ customer: c.customer, spent: fromMinor(c.spent) })).sort((a, b) => Number(b.spent) - Number(a.spent)),
      months: monthList.map((m) => ({ month: m, toSell: fromMinor(months.get(m) ?? 0) })),
    };
  }
}
