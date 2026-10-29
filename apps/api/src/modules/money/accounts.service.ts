import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, fromDbDateOrNull, type Prisma } from "@kebo/database";
import { fromMinor, orderProfit, roundHalfAway } from "@kebo/money";
import { can, type LostReason } from "@kebo/shared";
import { addDays, dateIn, ForbiddenError, NotFoundError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { convert, costingsOf, MainMoney, paysBasis } from "./order-money";

const person = { select: { id: true, name: true } } as const;

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

  /** What an expense can be for: customers, their deals and orders, and factories. */
  async expenseTargets(user: SessionUser) {
    this.assertManager(user);
    // Open deals and orders, and those of the last year: an expense is almost always on one of them,
    // and a pick list of thousands is neither quick to send nor to use.
    const since = new Date(`${addDays(this.clock.today(), -365)}T00:00:00Z`);
    const [customers, deals, orders, factories] = await Promise.all([
      this.prisma.db.customer.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      this.prisma.db.inquiry.findMany({
        where: { deletedAt: null, OR: [{ stage: { in: ["new", "sourcing", "quoted"] } }, { createdAt: { gte: since } }] },
        select: { id: true, refNo: true, title: true, stage: true, customer: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 400,
      }),
      this.prisma.db.order.findMany({
        where: { status: { not: "cancelled" }, OR: [{ status: "open" }, { createdAt: { gte: since } }] },
        select: { id: true, refNo: true, inquiryId: true, customer: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 400,
      }),
      this.prisma.db.factory.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
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
      factories,
    };
  }

  async customerAccount(user: SessionUser, customerId: string) {
    this.assertManager(user);
    const customer = await this.prisma.db.customer.findFirst({
      where: { id: customerId, deletedAt: null },
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
              shippedOn: true,
              stage: true,
              status: true,
              factoryPaid: { where: { voidedAt: null }, select: { amount: true, rate: true } },
              payments: { where: { voidedAt: null }, select: { bankCharges: true, currency: true } },
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
        },
      }),
      this.prisma.db.payment.findMany({
        where: { customerId, voidedAt: null, order: { status: { not: "cancelled" } } },
        select: {
          amount: true,
          currency: true,
          paidOn: true,
          kind: true,
          order: { select: { id: true, refNo: true, currency: true, mainCurrency: true, mainRate: true } },
        },
      }),
    ]);
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
      factoryPaid: 0,
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
          order.payments.filter((p) => p.currency === order.currency).reduce((s, p) => s + decimalToMinor(p.bankCharges), 0),
        );
        const p = orderProfit({
          revenueMinor: revenue,
          costedRevenueMinor: costedRevenue,
          goodsCostMinor: goodsCost,
          receivedMinor: 0,
          factoryPaidMinor: 0,
          expensesMinor: spent.onOrder,
          basisCostMinor: 0,
          bankChargesMinor: bank,
        });
        // Freight paid for the planned costs to reach the basis is already in the goods cost.
        const covered = Math.min(inMain(c.basisCostMinor), spent.basisPaid, spent.onOrder);
        const profit = p.earnedMinor + covered;
        money = { revenue, goodsCost, uncosted: revenue - costedRevenue, profit, net: profit - spent.beforeSale };
        t.sales += revenue;
        t.goodsCost += goodsCost;
        // What was spent on the order (cash); profit counts freight paid for the planned basis costs once.
        t.orderCosts += spent.onOrder;
        t.bankCharges += bank;
        t.beforeSale += spent.beforeSale;
        t.uncosted += revenue - costedRevenue;
        t.profit += profit;
        t.factoryPaid += order.factoryPaid.reduce((s, x) => s + inMain(convert(decimalToMinor(x.amount), Number(x.rate))), 0);
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
      t.received +=
        p.currency === p.order.currency ? fx.order(decimalToMinor(p.amount), p.order) : fx.live(decimalToMinor(p.amount), p.currency);

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
        const shipped = fromDbDateOrNull(o.shippedOn);
        if (shipped) events.push({ on: shipped, kind: "shipped", text: `${o.refNo} shipped`, href: `/orders/${o.id}` });
      }
    }
    for (const p of payments)
      events.push({
        on: fromDbDate(p.paidOn),
        kind: "payment",
        text: `Payment for ${p.order.refNo}`,
        amount: p.amount.toFixed(2),
        currency: p.currency,
        href: `/orders/${p.order.id}/money`,
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
        factoryPaid: fromMinor(t.factoryPaid),
        /** Cash so far: in from them, less paid to factories for their orders, less everything spent on them. */
        cash: fromMinor(t.received - t.factoryPaid - spentTotal),
        uncostedRevenue: fromMinor(t.uncosted),
      },
      lostReasons: [...lost.entries()]
        .map(([reason, r]) => ({ reason, deals: r.deals, spent: fromMinor(r.spent) }))
        .sort((a, b) => b.deals - a.deals),
      rows,
      timeline: events.slice(0, 80),
      missingRates: fx.missingRates,
    };
  }
}
