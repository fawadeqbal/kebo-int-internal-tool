import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, fromDbDateOrNull, toDbDate, toDbDateOrNull, type Prisma } from "@kebo/database";
import {
  formatMinor,
  fromMinor,
  fxRate,
  orderProfit,
  planTotalMinor,
  roundHalfAway,
  settle,
  toMinor,
  withTaxMinor,
  type Minor,
} from "@kebo/money";
import { BALANCE_TERMS_LABEL, can, planStatus, type ExpenseInput, type FactoryPaymentInput, type PaymentPlanInput } from "@kebo/shared";
import { DomainError, ForbiddenError, NotFoundError, type ISODate } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { requireReason } from "../../common/audit/reason";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { OrdersService } from "../orders/orders.service";

const person = { select: { id: true, name: true } } as const;

/** Lines of an order with the factory price they came from (for what we owe each factory). */
const linesWithFactory = {
  orderBy: { sortOrder: "asc" },
  include: {
    quoteLine: {
      select: {
        factoryQuoteLine: {
          select: {
            unitPrice: true,
            taxRate: true,
            factoryQuote: { select: { currency: true, factory: { select: { id: true, name: true, owner: person } } } },
          },
        },
      },
    },
  },
} satisfies Prisma.Order$linesArgs;

type FactoryRow = { id: string; name: string; owner: { id: string; name: string } | null };

/** Amount ÷ rate (units of its currency per one unit of the target), rounded to cents. */
const convert = (minor: Minor, rate: number) => roundHalfAway(minor / rate);

/**
 * Money around orders and the company (Step 2):
 * - the customer's payment plan on each order (instalments, ticked off as money comes in);
 * - what we owe each factory for an order, and what we paid it;
 * - expenses, for an order or for the company (managers and the super admin only);
 * - profit & loss per order and per month, earned and cash.
 */
@Injectable()
export class MoneyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly orders: OrdersService,
  ) {}

  private assertExpenses(user: SessionUser) {
    if (!can(user.role, "expenses.manage")) throw new ForbiddenError("Only managers can see expenses and profit.");
  }

  /** Units of `from` per one unit of `to` from Settings, or the rate given; refuses a missing rate instead of using 1:1. */
  private async rateFor(from: string, to: string, given: number | null | undefined) {
    if (given) return given;
    const { sales } = await this.settings.get();
    const r = fxRate(from, to, sales.currency, sales.exchangeRates);
    if (r === null) throw new DomainError(`There is no exchange rate for ${from} in Settings. Enter the rate (${from} per 1 ${to}).`);
    return r;
  }

  private async activePerson(id: string | null | undefined) {
    if (!id) return null;
    const u = await this.prisma.db.user.findFirst({ where: { id, isActive: true } });
    if (!u) throw new DomainError("Choose an active person from the team.");
    return id;
  }

  /* ---------------------------------------------------------------- one order */

  /** What we owe each factory for the order's goods (their price plus tax × the quantity ordered), in the factory's currency. */
  private owedByFactory(lines: Prisma.OrderLineGetPayload<{ include: (typeof linesWithFactory)["include"] }>[]) {
    const owed = new Map<string, { factory: FactoryRow; currency: string; owedMinor: Minor; lines: number }>();
    for (const l of lines) {
      const fl = l.quoteLine?.factoryQuoteLine;
      if (!fl) continue;
      const f = fl.factoryQuote.factory;
      const key = `${f.id}:${fl.factoryQuote.currency}`;
      const unit = withTaxMinor(decimalToMinor(fl.unitPrice), Number(fl.taxRate));
      const cur = owed.get(key) ?? { factory: f, currency: fl.factoryQuote.currency, owedMinor: 0, lines: 0 };
      cur.owedMinor += roundHalfAway(unit * Number(l.quantity));
      cur.lines += 1;
      owed.set(key, cur);
    }
    return owed;
  }

  /**
   * Everything about an order's money: the plan (all who see the order), what
   * we owe and paid the factories (people who see costs), its expenses and
   * profit (managers).
   */
  async forOrder(user: SessionUser, orderId: string) {
    const base = await this.orders.load(user, orderId);
    const o = await this.prisma.db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        lines: linesWithFactory,
        planItems: { orderBy: { sortOrder: "asc" } },
        payments: { where: { voidedAt: null } },
        factoryPaid: {
          orderBy: [{ paidOn: "asc" }, { createdAt: "asc" }],
          include: { factory: { select: { id: true, name: true } }, paidBy: person },
        },
        expenses: { orderBy: [{ spentOn: "asc" }, { createdAt: "asc" }], include: { paidBy: person } },
      },
    });
    const s = await this.settings.get();
    const today = this.clock.today();
    const totalMinor = decimalToMinor(o.total);
    const live = o.payments.filter((p) => p.currency === o.currency);
    const position = settle(
      totalMinor,
      live.map((p) => ({ amountMinor: decimalToMinor(p.amount), bankChargesMinor: decimalToMinor(p.bankCharges) })),
      Number(o.depositPercent),
    );
    const plan = planStatus(
      o.planItems.map((p) => ({ id: p.id, label: p.label, amountMinor: decimalToMinor(p.amount), dueOn: fromDbDateOrNull(p.dueOn) })),
      position.settledMinor,
      today,
      s.reminders.dueSoonDays,
    );
    const planSum = planTotalMinor(plan);
    const next = plan.find((p) => p.status !== "paid") ?? null;

    const seeCosts = can(user.role, "sourcing.manage");
    const seeExpenses = can(user.role, "expenses.manage");

    // Factories: owed from the order's lines, paid from the factory payments (same currency only).
    const owed = this.owedByFactory(o.lines);
    const livePaid = o.factoryPaid.filter((p) => !p.voidedAt);
    for (const p of livePaid) {
      const key = `${p.factoryId}:${p.currency}`;
      if (!owed.has(key)) {
        const f = await this.prisma.db.factory.findUniqueOrThrow({
          where: { id: p.factoryId },
          select: { id: true, name: true, owner: person },
        });
        owed.set(key, { factory: f, currency: p.currency, owedMinor: 0, lines: 0 });
      }
    }
    const factories = [...owed.entries()].map(([key, f]) => {
      const paidMinor = livePaid.filter((p) => `${p.factoryId}:${p.currency}` === key).reduce((t, p) => t + decimalToMinor(p.amount), 0);
      return {
        factory: { id: f.factory.id, name: f.factory.name },
        lookedAfterBy: f.factory.owner,
        currency: f.currency,
        lines: f.lines,
        owed: fromMinor(f.owedMinor),
        paid: fromMinor(paidMinor),
        toPay: fromMinor(Math.max(f.owedMinor - paidMinor, 0)),
        /** Paid more than its prices add up to (extra work, or a price that changed). */
        overpaid: paidMinor > f.owedMinor && f.owedMinor > 0 ? fromMinor(paidMinor - f.owedMinor) : null,
      };
    });

    // Profit, in the order's currency.
    const orderPerMain = fxRate(o.currency, s.sales.currency, s.sales.currency, s.sales.exchangeRates);
    const liveExpenses = o.expenses.filter((e) => !e.voidedAt);
    const expensesMinor =
      orderPerMain === null
        ? null
        : liveExpenses.reduce((t, e) => t + roundHalfAway(convert(decimalToMinor(e.amount), Number(e.rate)) * orderPerMain), 0);
    const factoryPaidMinor = livePaid.reduce((t, p) => t + convert(decimalToMinor(p.amount), Number(p.rate)), 0);
    let goodsCostMinor = 0;
    let uncostedMinor = 0;
    for (const l of o.lines) {
      if (l.unitCost === null) uncostedMinor += decimalToMinor(l.lineTotal);
      else goodsCostMinor += roundHalfAway(decimalToMinor(l.unitCost) * Number(l.quantity));
    }
    // The order total is after the discount; revenue on uncosted lines is scaled the same way.
    const linesSum = o.lines.reduce((t, l) => t + decimalToMinor(l.lineTotal), 0);
    const uncostedRevenueMinor = linesSum > 0 ? roundHalfAway((uncostedMinor * totalMinor) / linesSum) : 0;
    const profit =
      expensesMinor === null
        ? null
        : orderProfit({
            revenueMinor: totalMinor,
            goodsCostMinor,
            uncostedRevenueMinor,
            receivedMinor: position.receivedMinor,
            factoryPaidMinor,
            expensesMinor,
          });

    return {
      orderId: o.id,
      refNo: o.refNo,
      currency: o.currency,
      total: fromMinor(totalMinor),
      terms: BALANCE_TERMS_LABEL[o.balanceTerms],
      received: fromMinor(position.settledMinor),
      due: fromMinor(position.outstandingMinor),
      plan: {
        items: plan.map((p) => ({
          id: p.id,
          label: p.label,
          amount: fromMinor(p.amountMinor),
          dueOn: p.dueOn,
          paid: fromMinor(p.paidMinor),
          open: fromMinor(p.openMinor),
          status: p.status,
        })),
        /** The instalments must add up to the order total; a different sum is shown as a problem to fix. */
        matchesTotal: planSum === totalMinor,
        difference: fromMinor(totalMinor - planSum),
        next: next && { label: next.label, open: fromMinor(next.openMinor), dueOn: next.dueOn, status: next.status },
        canEdit: can(user.role, "orders.update") && o.status !== "cancelled",
      },
      factories: seeCosts
        ? {
            rows: factories,
            payments: o.factoryPaid.map((p) => ({
              id: p.id,
              factory: p.factory,
              kind: p.kind,
              amount: p.amount.toFixed(2),
              currency: p.currency,
              rate: Number(p.rate),
              /** In the order's currency at the rate used. */
              inOrderCurrency: fromMinor(convert(decimalToMinor(p.amount), Number(p.rate))),
              paidOn: fromDbDate(p.paidOn),
              method: p.method,
              paidBy: p.paidBy,
              reference: p.reference,
              note: p.note,
              voided: p.voidedAt ? { at: p.voidedAt, reason: p.voidReason } : null,
            })),
            canRecord: can(user.role, "payments.record") && o.status !== "cancelled",
          }
        : null,
      expenses: seeExpenses ? o.expenses.map((e) => this.expenseView(e)) : null,
      profit:
        seeExpenses && profit
          ? {
              revenue: fromMinor(totalMinor),
              goodsCost: fromMinor(goodsCostMinor),
              uncostedRevenue: fromMinor(uncostedRevenueMinor),
              expenses: fromMinor(expensesMinor!),
              earned: fromMinor(profit.earnedMinor),
              marginPercent: profit.marginPercent,
              coveragePercent: profit.coveragePercent,
              received: fromMinor(position.receivedMinor),
              factoryPaid: fromMinor(factoryPaidMinor),
              cash: fromMinor(profit.cashMinor),
            }
          : null,
      missingRate: seeExpenses && expensesMinor === null ? o.currency : null,
      cancelled: base.status === "cancelled",
    };
  }

  /* ---------------------------------------------------------------- the plan */

  /**
   * Replace the order's instalments. They must add up to the order total. Once
   * the customer has paid something, changing the plan says why.
   */
  async setPlan(user: SessionUser, orderId: string, input: PaymentPlanInput) {
    if (!can(user.role, "orders.update")) throw new ForbiddenError("You cannot change orders.");
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${orderId}::uuid for update`;
      const o = await this.orders.load(user, orderId, tx);
      if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
      const sum = input.items.reduce((t, i) => t + toMinor(i.amount), 0);
      const total = decimalToMinor(o.total);
      if (sum !== total)
        throw new DomainError(
          `The instalments add up to ${formatMinor(sum, o.currency)}, but the order is ${formatMinor(total, o.currency)}. Make them match.`,
        );
      const before = await tx.paymentPlanItem.findMany({ where: { orderId }, orderBy: { sortOrder: "asc" } });
      const describe = (rows: { label: string; amount: string; dueOn: string | null }[]) =>
        rows.map((r) => `${r.label} ${r.amount}${r.dueOn ? ` by ${r.dueOn}` : ""}`).join("; ");
      const was = describe(before.map((b) => ({ label: b.label, amount: b.amount.toFixed(2), dueOn: fromDbDateOrNull(b.dueOn) })));
      const now = describe(input.items.map((i) => ({ label: i.label, amount: fromMinor(toMinor(i.amount)), dueOn: i.dueOn })));
      if (was === now) return;
      const paid = o.payments.some((p) => p.currency === o.currency);
      const reason = paid
        ? requireReason(input.reason, "plan", "the payment plan changes after the customer has paid")
        : (input.reason ?? null);
      const keep = new Set(before.map((b) => b.id));
      await tx.paymentPlanItem.deleteMany({
        where: { orderId, id: { notIn: input.items.map((i) => i.id).filter((id): id is string => !!id && keep.has(id)) } },
      });
      for (const [n, i] of input.items.entries()) {
        const row = { label: i.label, amount: i.amount, dueOn: toDbDateOrNull(i.dueOn), sortOrder: n };
        if (i.id && keep.has(i.id)) await tx.paymentPlanItem.update({ where: { id: i.id }, data: row });
        else await tx.paymentPlanItem.create({ data: { ...row, orderId } });
      }
      await this.audit.record(tx, {
        userId: user.id,
        action: "payment_plan",
        entityType: "order",
        entityId: orderId,
        summary: `${o.refNo}: payment plan changed`,
        oldValues: { plan: was },
        newValues: { plan: now },
        reason,
      });
    });
    return this.forOrder(user, orderId);
  }

  /* ---------------------------------------------------------------- factory payments */

  private async factoryPaymentData(o: { currency: string }, input: FactoryPaymentInput) {
    if (input.paidOn > this.clock.today()) throw new DomainError("The payment date cannot be in the future.");
    const f = await this.prisma.db.factory.findFirst({ where: { id: input.factoryId, deletedAt: null } });
    if (!f) throw new DomainError("That factory was removed. Choose another one.");
    return {
      factoryId: f.id,
      kind: input.kind,
      amount: input.amount,
      currency: input.currency,
      rate: await this.rateFor(input.currency, o.currency, input.rate),
      paidOn: toDbDate(input.paidOn),
      method: input.method,
      // The person who looks after the factory pays it, unless someone else is named.
      paidById: (await this.activePerson(input.paidById)) ?? f.ownerId,
      reference: input.reference,
      note: input.note,
      factoryName: f.name,
    };
  }

  async recordFactoryPayment(user: SessionUser, orderId: string, input: FactoryPaymentInput) {
    if (!can(user.role, "payments.record")) throw new ForbiddenError("Only accounts (managers) can record payments.");
    const o = await this.orders.load(user, orderId);
    if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
    const { factoryName, ...data } = await this.factoryPaymentData(o, input);
    await this.prisma.tx(async (tx) => {
      const p = await tx.factoryPayment.create({ data: { ...data, orderId, recordedById: user.id } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "payment_out",
        entityType: "order",
        entityId: orderId,
        summary: `${o.refNo}: paid ${factoryName} ${input.currency} ${data.amount}${input.reference ? ` (${input.reference})` : ""}`,
        newValues: { factoryPaymentId: p.id },
      });
    });
    return this.forOrder(user, orderId);
  }

  private async findFactoryPayment(user: SessionUser, id: string) {
    if (!can(user.role, "payments.record")) throw new ForbiddenError("Only accounts (managers) can change payments.");
    const p = await this.prisma.db.factoryPayment.findUnique({ where: { id }, include: { factory: { select: { name: true } } } });
    if (!p) throw new NotFoundError("Payment");
    const o = await this.orders.load(user, p.orderId);
    if (p.voidedAt) throw new DomainError("This payment was removed.");
    return { p, o };
  }

  /** Changing a recorded factory payment always says why. */
  async editFactoryPayment(user: SessionUser, id: string, input: FactoryPaymentInput) {
    const { p, o } = await this.findFactoryPayment(user, id);
    const reason = requireReason(input.reason, "payment", "a recorded payment changes");
    const { factoryName, ...data } = await this.factoryPaymentData(o, { ...input, rate: input.rate ?? Number(p.rate) });
    await this.prisma.tx(async (tx) => {
      await tx.factoryPayment.update({ where: { id }, data });
      await this.audit.record(tx, {
        userId: user.id,
        action: "payment_out_edit",
        entityType: "order",
        entityId: o.id,
        summary: `${o.refNo}: changed the payment to ${factoryName}`,
        oldValues: {
          factory: p.factory.name,
          amount: `${p.currency} ${p.amount.toFixed(2)}`,
          paidOn: fromDbDate(p.paidOn),
          rate: Number(p.rate),
          reference: p.reference,
        },
        newValues: {
          factory: factoryName,
          amount: `${data.currency} ${fromMinor(toMinor(data.amount))}`,
          paidOn: input.paidOn,
          rate: data.rate,
          reference: data.reference,
        },
        reason,
      });
    });
    return this.forOrder(user, o.id);
  }

  /** A payment recorded by mistake: it stays listed, crossed out. */
  async voidFactoryPayment(user: SessionUser, id: string, reason: string) {
    const { p, o } = await this.findFactoryPayment(user, id);
    await this.prisma.tx(async (tx) => {
      await tx.factoryPayment.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "payment_out_void",
        entityType: "order",
        entityId: o.id,
        summary: `${o.refNo}: removed the payment of ${p.currency} ${p.amount.toFixed(2)} to ${p.factory.name}`,
        reason,
      });
    });
    return this.forOrder(user, o.id);
  }

  /** What we still owe each factory across all orders that are not cancelled (people who see costs). */
  async payables(user: SessionUser, mine: boolean) {
    if (!can(user.role, "sourcing.manage")) throw new ForbiddenError("You cannot see factory costs.");
    const orders = await this.prisma.db.order.findMany({
      where: { status: { not: "cancelled" } },
      select: {
        id: true,
        refNo: true,
        stage: true,
        customer: { select: { name: true } },
        lines: linesWithFactory,
        factoryPaid: { where: { voidedAt: null }, select: { factoryId: true, currency: true, amount: true } },
      },
      orderBy: { orderedOn: "asc" },
    });
    const byFactory = new Map<
      string,
      {
        factory: FactoryRow;
        currency: string;
        owedMinor: Minor;
        paidMinor: Minor;
        orders: { id: string; refNo: string; stage: string; customer: string; toPay: string }[];
      }
    >();
    for (const o of orders) {
      for (const [key, f] of this.owedByFactory(o.lines)) {
        const paid = o.factoryPaid.filter((p) => `${p.factoryId}:${p.currency}` === key).reduce((t, p) => t + decimalToMinor(p.amount), 0);
        const left = f.owedMinor - paid;
        const row = byFactory.get(key) ?? { factory: f.factory, currency: f.currency, owedMinor: 0, paidMinor: 0, orders: [] };
        row.owedMinor += f.owedMinor;
        row.paidMinor += paid;
        if (left > 0) row.orders.push({ id: o.id, refNo: o.refNo, stage: o.stage, customer: o.customer.name, toPay: fromMinor(left) });
        byFactory.set(key, row);
      }
    }
    return [...byFactory.values()]
      .filter((r) => r.orders.length && (!mine || r.factory.owner?.id === user.id))
      .map((r) => ({
        factory: { id: r.factory.id, name: r.factory.name },
        lookedAfterBy: r.factory.owner,
        currency: r.currency,
        owed: fromMinor(r.owedMinor),
        paid: fromMinor(r.paidMinor),
        toPay: fromMinor(r.orders.reduce((t, o) => t + toMinor(o.toPay), 0)),
        orders: r.orders,
      }))
      .sort((a, b) => Number(b.toPay) - Number(a.toPay));
  }

  /* ---------------------------------------------------------------- expenses */

  private expenseView(
    e: Prisma.ExpenseGetPayload<{ include: { paidBy: typeof person } }> & { order?: { id: string; refNo: string } | null },
  ) {
    return {
      id: e.id,
      order: e.order ?? null,
      orderId: e.orderId,
      category: e.category,
      description: e.description,
      amount: e.amount.toFixed(2),
      currency: e.currency,
      rate: Number(e.rate),
      /** In the main currency at the rate used. */
      inMain: fromMinor(convert(decimalToMinor(e.amount), Number(e.rate))),
      spentOn: fromDbDate(e.spentOn),
      paidBy: e.paidBy,
      reference: e.reference,
      note: e.note,
      voided: e.voidedAt ? { at: e.voidedAt, reason: e.voidReason } : null,
    };
  }

  /** ?from=&to= (dates), ?orderId=, ?kind=order|general */
  async listExpenses(user: SessionUser, q: { from?: ISODate; to?: ISODate; orderId?: string; kind?: "order" | "general" }) {
    this.assertExpenses(user);
    const { sales } = await this.settings.get();
    const rows = await this.prisma.db.expense.findMany({
      where: {
        ...(q.orderId
          ? { orderId: q.orderId }
          : q.kind === "order"
            ? { orderId: { not: null } }
            : q.kind === "general"
              ? { orderId: null }
              : {}),
        ...(q.from || q.to ? { spentOn: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      },
      include: { paidBy: person, order: { select: { id: true, refNo: true } } },
      orderBy: [{ spentOn: "desc" }, { createdAt: "desc" }],
      take: 500,
    });
    const live = rows.filter((r) => !r.voidedAt);
    const total = live.reduce((t, e) => t + convert(decimalToMinor(e.amount), Number(e.rate)), 0);
    return { currency: sales.currency, total: fromMinor(total), rows: rows.map((e) => this.expenseView(e)) };
  }

  private async expenseData(user: SessionUser, input: ExpenseInput) {
    if (input.spentOn > this.clock.today()) throw new DomainError("The date cannot be in the future.");
    let order: { id: string; refNo: string } | null = null;
    if (input.orderId) {
      const o = await this.orders.load(user, input.orderId);
      if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
      order = { id: o.id, refNo: o.refNo };
    }
    const { sales } = await this.settings.get();
    return {
      order,
      data: {
        orderId: order?.id ?? null,
        category: input.category,
        description: input.description,
        amount: input.amount,
        currency: input.currency,
        rate: await this.rateFor(input.currency, sales.currency, input.rate),
        spentOn: toDbDate(input.spentOn),
        paidById: await this.activePerson(input.paidById),
        reference: input.reference,
        note: input.note,
      },
    };
  }

  async createExpense(user: SessionUser, input: ExpenseInput) {
    this.assertExpenses(user);
    const { order, data } = await this.expenseData(user, input);
    const e = await this.prisma.tx(async (tx) => {
      const row = await tx.expense.create({
        data: { ...data, recordedById: user.id },
        include: { paidBy: person, order: { select: { id: true, refNo: true } } },
      });
      await this.expenseAudit(tx, user, row.id, order, `Expense ${input.currency} ${data.amount}: ${input.description}`, "expense");
      return row;
    });
    return this.expenseView(e);
  }

  /** Order expenses are kept in the order's history, general ones under "expenses". */
  private async expenseAudit(
    tx: Tx,
    user: SessionUser,
    id: string,
    order: { id: string; refNo: string } | null,
    summary: string,
    action: string,
    extra: { reason?: string | null; oldValues?: Record<string, unknown>; newValues?: Record<string, unknown> } = {},
  ) {
    await this.audit.record(tx, {
      userId: user.id,
      action,
      entityType: order ? "order" : "expense",
      entityId: order?.id ?? id,
      summary: order ? `${order.refNo}: ${summary}` : summary,
      ...extra,
    });
  }

  private async findExpense(user: SessionUser, id: string) {
    this.assertExpenses(user);
    const e = await this.prisma.db.expense.findUnique({ where: { id }, include: { order: { select: { id: true, refNo: true } } } });
    if (!e) throw new NotFoundError("Expense");
    if (e.voidedAt) throw new DomainError("This expense was removed.");
    return e;
  }

  /** Changing a recorded expense always says why. */
  async editExpense(user: SessionUser, id: string, input: ExpenseInput) {
    const e = await this.findExpense(user, id);
    const reason = requireReason(input.reason, "payment", "a recorded expense changes");
    const { order, data } = await this.expenseData(user, { ...input, rate: input.rate ?? Number(e.rate) });
    const row = await this.prisma.tx(async (tx) => {
      const updated = await tx.expense.update({
        where: { id },
        data,
        include: { paidBy: person, order: { select: { id: true, refNo: true } } },
      });
      await this.expenseAudit(tx, user, id, order ?? e.order, `changed the expense "${e.description}"`, "expense_edit", {
        reason,
        oldValues: {
          amount: `${e.currency} ${e.amount.toFixed(2)}`,
          category: e.category,
          spentOn: fromDbDate(e.spentOn),
          order: e.order?.refNo ?? null,
          description: e.description,
        },
        newValues: {
          amount: `${data.currency} ${fromMinor(toMinor(data.amount))}`,
          category: data.category,
          spentOn: input.spentOn,
          order: order?.refNo ?? null,
          description: data.description,
        },
      });
      return updated;
    });
    return this.expenseView(row);
  }

  async voidExpense(user: SessionUser, id: string, reason: string) {
    const e = await this.findExpense(user, id);
    await this.prisma.tx(async (tx) => {
      await tx.expense.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason } });
      await this.expenseAudit(
        tx,
        user,
        id,
        e.order,
        `removed the expense "${e.description}" (${e.currency} ${e.amount.toFixed(2)})`,
        "expense_void",
        { reason },
      );
    });
    return { ok: true };
  }

  /* ---------------------------------------------------------------- profit & loss */

  /**
   * The company's profit & loss for a year, month by month, in the main currency.
   * - Earned: an order counts in the month it shipped — its value, less the
   *   factory cost of its goods and its expenses; less the general expenses of
   *   the month.
   * - Cash: what came in from customers that month, less what was paid to
   *   factories and all expenses paid that month.
   */
  async profitAndLoss(user: SessionUser, year: number) {
    this.assertExpenses(user);
    const { sales } = await this.settings.get();
    const main = sales.currency;
    const from = toDbDate(`${year}-01-01`);
    const to = toDbDate(`${year}-12-31`);
    const missing = new Set<string>();
    /** Order currency → main: divide by units of the order currency per main unit. */
    const toMain = (minor: Minor, currency: string) => {
      const r = fxRate(currency, main, main, sales.exchangeRates);
      if (r === null) {
        missing.add(currency);
        return 0;
      }
      return convert(minor, r);
    };

    const [shipped, payments, factoryPaid, expenses] = await Promise.all([
      this.prisma.db.order.findMany({
        where: { status: { not: "cancelled" }, shippedOn: { gte: from, lte: to } },
        select: {
          id: true,
          refNo: true,
          currency: true,
          total: true,
          shippedOn: true,
          customer: { select: { name: true } },
          lines: { select: { unitCost: true, quantity: true, lineTotal: true } },
          expenses: { where: { voidedAt: null }, select: { amount: true, rate: true } },
        },
      }),
      this.prisma.db.payment.findMany({
        where: { voidedAt: null, paidOn: { gte: from, lte: to } },
        select: { amount: true, currency: true, paidOn: true },
      }),
      this.prisma.db.factoryPayment.findMany({
        where: { voidedAt: null, paidOn: { gte: from, lte: to } },
        select: { amount: true, rate: true, paidOn: true, order: { select: { currency: true } } },
      }),
      this.prisma.db.expense.findMany({
        where: { voidedAt: null, spentOn: { gte: from, lte: to } },
        select: { amount: true, rate: true, spentOn: true, orderId: true },
      }),
    ]);

    const months = Array.from({ length: 12 }, (_, i) => ({
      month: `${year}-${String(i + 1).padStart(2, "0")}`,
      earned: { revenue: 0, goodsCost: 0, orderExpenses: 0, generalExpenses: 0, orders: 0, uncostedRevenue: 0 },
      cash: { in: 0, factories: 0, expenses: 0 },
    }));
    const monthOf = (d: Date) => months[d.getUTCMonth()]!;

    const orderRows: {
      id: string;
      refNo: string;
      customer: string;
      month: string;
      revenue: number;
      goodsCost: number;
      expenses: number;
      profit: number;
    }[] = [];
    for (const o of shipped) {
      const m = monthOf(o.shippedOn!);
      const revenue = toMain(decimalToMinor(o.total), o.currency);
      const linesSum = o.lines.reduce((t, l) => t + decimalToMinor(l.lineTotal), 0);
      let cost = 0;
      let uncosted = 0;
      for (const l of o.lines) {
        if (l.unitCost === null) uncosted += decimalToMinor(l.lineTotal);
        else cost += roundHalfAway(decimalToMinor(l.unitCost) * Number(l.quantity));
      }
      const goodsCost = toMain(cost, o.currency);
      // The order total is after the discount: revenue on uncosted lines takes the same share.
      const uncostedRevenue = linesSum > 0 ? roundHalfAway((uncosted / linesSum) * revenue) : 0;
      const exp = o.expenses.reduce((t, e) => t + convert(decimalToMinor(e.amount), Number(e.rate)), 0);
      m.earned.revenue += revenue;
      m.earned.goodsCost += goodsCost;
      m.earned.orderExpenses += exp;
      m.earned.uncostedRevenue += uncostedRevenue;
      m.earned.orders += 1;
      orderRows.push({
        id: o.id,
        refNo: o.refNo,
        customer: o.customer.name,
        month: m.month,
        revenue,
        goodsCost,
        expenses: exp,
        profit: revenue - goodsCost - exp,
      });
    }
    for (const e of expenses) {
      const inMain = convert(decimalToMinor(e.amount), Number(e.rate));
      if (!e.orderId) monthOf(e.spentOn).earned.generalExpenses += inMain;
      monthOf(e.spentOn).cash.expenses += inMain;
    }
    for (const p of payments) monthOf(p.paidOn).cash.in += toMain(decimalToMinor(p.amount), p.currency);
    for (const p of factoryPaid)
      monthOf(p.paidOn).cash.factories += toMain(convert(decimalToMinor(p.amount), Number(p.rate)), p.order.currency);

    const money = (n: number) => fromMinor(n);
    const rows = months.map((m) => {
      const earnedProfit = m.earned.revenue - m.earned.goodsCost - m.earned.orderExpenses - m.earned.generalExpenses;
      const cashNet = m.cash.in - m.cash.factories - m.cash.expenses;
      return {
        month: m.month,
        earned: {
          orders: m.earned.orders,
          revenue: money(m.earned.revenue),
          goodsCost: money(m.earned.goodsCost),
          orderExpenses: money(m.earned.orderExpenses),
          generalExpenses: money(m.earned.generalExpenses),
          profit: money(earnedProfit),
          uncostedRevenue: money(m.earned.uncostedRevenue),
        },
        cash: { in: money(m.cash.in), factories: money(m.cash.factories), expenses: money(m.cash.expenses), net: money(cashNet) },
      };
    });
    const sum = (f: (m: (typeof months)[number]) => number) => months.reduce((t, m) => t + f(m), 0);
    return {
      year,
      currency: main,
      months: rows,
      total: {
        earned: {
          orders: sum((m) => m.earned.orders),
          revenue: money(sum((m) => m.earned.revenue)),
          goodsCost: money(sum((m) => m.earned.goodsCost)),
          orderExpenses: money(sum((m) => m.earned.orderExpenses)),
          generalExpenses: money(sum((m) => m.earned.generalExpenses)),
          profit: money(sum((m) => m.earned.revenue - m.earned.goodsCost - m.earned.orderExpenses - m.earned.generalExpenses)),
          uncostedRevenue: money(sum((m) => m.earned.uncostedRevenue)),
        },
        cash: {
          in: money(sum((m) => m.cash.in)),
          factories: money(sum((m) => m.cash.factories)),
          expenses: money(sum((m) => m.cash.expenses)),
          net: money(sum((m) => m.cash.in - m.cash.factories - m.cash.expenses)),
        },
      },
      orders: orderRows
        .sort((a, b) => b.profit - a.profit)
        .map((o) => ({
          ...o,
          revenue: money(o.revenue),
          goodsCost: money(o.goodsCost),
          expenses: money(o.expenses),
          profit: money(o.profit),
        })),
      missingRates: [...missing],
    };
  }
}
