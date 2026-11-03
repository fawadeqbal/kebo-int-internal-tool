import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, fromDbDateOrNull, toDbDate, toDbDateOrNull, type Prisma } from "@kebo/database";
import { formatMinor, fromMinor, fxRate, orderCosting, orderMoney, planTotalMinor, roundHalfAway, toMinor, type Minor } from "@kebo/money";
import {
  balanceTermsOf,
  BALANCE_TERMS_LABEL,
  can,
  planHow,
  plannedAndSpent,
  planStatus,
  planWhen,
  routeSummary,
  STEP_OF_CATEGORY,
  shippedOnOf,
  type ExpenseBearer,
  type ExpenseCategory,
  type ExpenseInput,
  type FactoryPaymentInput,
  type FactoryPlanInput,
  type FlowStep,
  type PaymentPlanInput,
  type RepayInput,
} from "@kebo/shared";
import { DomainError, ForbiddenError, NotFoundError, type ISODate } from "@kebo/utils";
import { LimitsService } from "../../common/company/limits.service";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { safeFileName, StorageService } from "../../common/storage/storage.service";
import { checkAccount } from "./account-check";
import { ordersOwingFactories } from "./due";
import { convert, costingsOf, MainMoney, orderRate, paysBasis } from "./order-money";
import { fileView } from "./payment-file-view";
import { factoryPlansOf, owedByFactory } from "./factory-plan";
import { chargedOf, factoryBorneExpenses, factoryPositionOf, fxOf, positionOf } from "./position";
import { termsOf } from "./route-plan";
import { AuditService } from "../../common/audit/audit.service";
import { requireReason } from "../../common/audit/reason";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { OrdersService } from "../orders/orders.service";

const person = { select: { id: true, name: true } } as const;

/** Lines of an order with the factory price frozen on them when it was made (for what we owe each factory). */
const linesWithFactory = {
  orderBy: { sortOrder: "asc" },
  include: { factory: { select: { id: true, name: true, owner: person } } },
} satisfies Prisma.Order$linesArgs;

type FactoryRow = { id: string; name: string; owner: { id: string; name: string } | null };

const expenseInclude = {
  paidBy: person,
  order: { select: { id: true, refNo: true } },
  customer: { select: { id: true, name: true } },
  inquiry: { select: { id: true, refNo: true, title: true, stage: true } },
  factory: { select: { id: true, name: true } },
  account: { select: { id: true, name: true } },
  repaidAccount: { select: { id: true, name: true } },
} satisfies Prisma.ExpenseInclude;
type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>;

const RECEIPT_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png", "webp", "gif", "heic"]);

/**
 * Money around orders and the company (Step 2):
 * - the customer's payment plan on each order (instalments, ticked off as money comes in);
 * - what we owe each factory for an order, and what we paid it;
 * - expenses, for an order, spent on a customer or for the company, with receipts (managers and the super admin only);
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
    private readonly storage: StorageService,
    private readonly limits: LimitsService,
  ) {}

  private assertExpenses(user: SessionUser) {
    if (!can(user, "expenses.manage")) throw new ForbiddenError("Only managers can see expenses and profit.");
  }

  /**
   * Units of `from` per one unit of `to`: always 1 for the same currency
   * (whatever was sent); else the rate given, or Settings when none is. A
   * missing rate is refused, never taken as 1:1.
   */
  private async rateFor(from: string, to: string, given: number | null | undefined) {
    if (from === to) return 1;
    if (given) return given;
    const { sales } = await this.settings.get();
    const r = fxRate(from, to, sales.currency, sales.exchangeRates);
    if (r === null) throw new DomainError(`There is no exchange rate for ${from} in Settings. Enter the rate (${from} per 1 ${to}).`);
    return r;
  }

  /** On a change: the rate sent; else the one used before while the currency stays; else Settings (rateFor). */
  private keptRate(input: { currency: string; rate?: number | null }, before: { currency: string; rate: Prisma.Decimal }) {
    return input.rate ?? (input.currency === before.currency ? Number(before.rate) : null);
  }

  private async activePerson(id: string | null | undefined) {
    if (!id) return null;
    const u = await this.prisma.db.user.findFirst({ where: { id, isActive: true } });
    if (!u) throw new DomainError("Choose an active person from the team.");
    return id;
  }

  /* ---------------------------------------------------------------- one order */

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
        costs: true,
        planItems: { orderBy: { sortOrder: "asc" } },
        payments: { where: { voidedAt: null } },
        factoryPaid: {
          orderBy: [{ paidOn: "asc" }, { createdAt: "asc" }],
          include: { factory: { select: { id: true, name: true } }, paidBy: person, account: { select: { id: true, name: true } } },
        },
        expenses: { orderBy: [{ spentOn: "asc" }, { createdAt: "asc" }], include: expenseInclude },
      },
    });
    const s = await this.settings.get();
    const today = this.clock.today();
    const totalMinor = decimalToMinor(o.total);
    // Spent on the deal before it became this order (trips, samples, visits to factories): managers only.
    const dealExpenses = can(user, "expenses.manage")
      ? await this.prisma.db.expense.findMany({
          where: { inquiryId: o.inquiryId, orderId: null },
          include: expenseInclude,
          orderBy: [{ spentOn: "asc" }, { createdAt: "asc" }],
        })
      : [];
    const fx = fxOf(s, await this.limits.allows("expenses"));
    // Where the order stands with the customer: the same position as every screen and paper (charged expenses included).
    const position = positionOf(o, fx);
    const terms = termsOf(o);
    const plan = planStatus(
      o.planItems.map((p) => ({
        id: p.id,
        label: p.label,
        amountMinor: decimalToMinor(p.amount),
        dueOn: fromDbDateOrNull(p.dueOn),
        part: p.part,
        dueRule: p.dueRule,
        dueDays: p.dueDays,
      })),
      position.settledMinor,
      today,
      s.reminders.dueSoonDays,
    );
    const planSum = planTotalMinor(plan);
    const next = plan.find((p) => p.status !== "paid") ?? null;

    const seeCosts = can(user, "sourcing.manage");
    // Expenses are a plan feature: without it the order shows no costs (and no profit after them).
    const expensesOn = await this.limits.allows("expenses");
    const seeExpenses = can(user, "expenses.manage") && expensesOn;
    const orderPerMain = orderRate(o, s.sales.currency, s.sales.exchangeRates);
    const inOrder = (e: { amount: Prisma.Decimal; rate: Prisma.Decimal }) =>
      roundHalfAway(convert(decimalToMinor(e.amount), Number(e.rate)) * orderPerMain!);
    const liveAll = expensesOn ? o.expenses.filter((e) => !e.voidedAt) : [];

    // Charged to the customer: added to what they owe on this order (in its currency, at its own rate), as in the position.
    const charged = chargedOf(o, fx).filter((c) => c.minor !== null);
    const chargedMinor = position.chargedMinor;
    const dueMinor = position.dueMinor;

    // Factories: owed from the order's lines (with tax), less what we paid them and the expenses they bear: factoryPosition.
    const livePaid = o.factoryPaid.filter((p) => !p.voidedAt);
    const factoryRows = factoryPositionOf(o, fx);
    const factoryOf = new Map<string, FactoryRow>(o.lines.flatMap((l) => (l.factory ? [[l.factory.id, l.factory] as const] : [])));
    for (const r of factoryRows)
      if (!factoryOf.has(r.factoryId))
        factoryOf.set(r.factoryId, await this.prisma.db.factory.findUniqueOrThrow({ where: { id: r.factoryId }, select: { id: true, name: true, owner: person } }));
    const owed = new Map(factoryRows.map((r) => [r.key, r]));
    // For each counted factory payment: paid so far to that factory (same currency) and what is left after it.
    const factoryAfter = new Map<string, { paid: string; toPay: string }>();
    const running = new Map<string, number>();
    for (const p of livePaid) {
      const key = `${p.factoryId}:${p.currency}`;
      const sum = (running.get(key) ?? 0) + decimalToMinor(p.amount);
      running.set(key, sum);
      factoryAfter.set(p.id, { paid: fromMinor(sum), toPay: fromMinor(Math.max((owed.get(key)?.owedMinor ?? 0) - sum, 0)) });
    }
    const recorders = new Map(
      (
        await this.prisma.db.user.findMany({
          where: { id: { in: [...new Set(o.factoryPaid.map((p) => p.recordedById))] } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u]),
    );
    const factories = factoryRows.map((r) => {
      const f = factoryOf.get(r.factoryId)!;
      return {
        factory: { id: f.id, name: f.name },
        lookedAfterBy: f.owner,
        currency: r.currency,
        lines: r.lines,
        owed: fromMinor(r.owedMinor),
        /** Paid, with the expenses the factory bears (taken off what we owe it). */
        paid: fromMinor(r.settledMinor),
        takenOff: fromMinor(r.takenOffMinor),
        toPay: fromMinor(r.toPayMinor),
        /** Paid more than its prices add up to (extra work, or a price that changed). */
        overpaid: r.overpaidMinor > 0 ? fromMinor(r.overpaidMinor) : null,
      };
    });

    // Profit, in the order's currency: expenses (kept in the main currency) come back at the order's own rate.
    // Only those borne by us cut it: the customer pays the others back, or they come off what we owe a factory.
    const liveExpenses = liveAll.filter((e) => e.borneBy === "us");
    const expensesMinor = orderPerMain === null ? null : liveExpenses.reduce((t, e) => t + inOrder(e), 0);
    // Freight and the like pay for their own planned cost first (per planned step, as on the Costs page).
    const basisPaidMinor =
      orderPerMain === null
        ? 0
        : plannedAndSpent(
            o.costs.map((c) => ({ step: c.step, costMinor: decimalToMinor(c.cost) })),
            liveExpenses.map((e) => ({ category: e.category as ExpenseCategory, minor: inOrder(e) })),
          ).coveredMinor;
    const beforeSaleMinor = orderPerMain === null ? null : dealExpenses.filter((e) => !e.voidedAt).reduce((t, e) => t + inOrder(e), 0);
    const factoryPaidMinor = livePaid.reduce((t, p) => t + convert(decimalToMinor(p.amount), Number(p.rate)), 0);
    const costing = orderCosting(
      o.lines.map((l) => ({
        lineTotalMinor: decimalToMinor(l.lineTotal),
        quantity: l.quantity.toString(),
        unitCostMinor: l.unitCost === null ? null : decimalToMinor(l.unitCost),
      })),
      totalMinor,
      o.costs.reduce((t, c) => t + decimalToMinor(c.cost), 0),
    );
    const profit =
      expensesMinor === null
        ? null
        : orderMoney({
            ...costing,
            receivedMinor: position.receivedMinor,
            factoryPaidMinor,
            expensesMinor,
            basisPaidMinor,
            bankChargesMinor: position.bankChargesMinor,
            beforeSaleMinor: beforeSaleMinor ?? 0,
          });
    const netMinor = profit ? profit.netMinor : 0;

    return {
      orderId: o.id,
      refNo: o.refNo,
      currency: o.currency,
      total: fromMinor(totalMinor),
      // The terms the route now means (as accepted until a route is chosen).
      terms: BALANCE_TERMS_LABEL[balanceTermsOf(terms, o.balanceTerms)],
      /** How the customer pays, from the route ("LC, deferred 90 days"); null until chosen. */
      route: { route: terms.route, summary: routeSummary(terms) },
      received: fromMinor(position.settledMinor),
      /** Still due: the order total and what was charged to the customer, less what came in. */
      due: fromMinor(dueMinor),
      /** Expenses charged to the customer on this order: "Charged to you: …" lines. */
      charged: charged.map((c) => ({ id: c.expense.id, description: c.expense.description, spentOn: fromDbDate(c.expense.spentOn), amount: fromMinor(c.minor!) })),
      chargedTotal: fromMinor(chargedMinor),
      plan: {
        items: plan.map((p) => ({
          id: p.id,
          label: p.label,
          amount: fromMinor(p.amountMinor),
          dueOn: p.dueOn,
          paid: fromMinor(p.paidMinor),
          open: fromMinor(p.openMinor),
          status: p.status,
          /** deposit | balance (built from the route), null when typed by hand. */
          part: p.part,
          /** "T/T", "LC, deferred 90 days". */
          how: planHow(p.part, terms),
          /** When an undated part falls due ("90 days after the papers"). */
          when: p.dueOn ? null : planWhen(p, terms) || null,
        })),
        /** The instalments must add up to the order total; a different sum is shown as a problem to fix. */
        matchesTotal: planSum === totalMinor,
        difference: fromMinor(totalMinor - planSum),
        next: next && { label: next.label, open: fromMinor(next.openMinor), dueOn: next.dueOn, status: next.status },
        canEdit: can(user, "orders.update") && o.status !== "cancelled",
      },
      factories: seeCosts
        ? {
            rows: factories,
            payments: o.factoryPaid.map((p) => ({
              id: p.id,
              factory: p.factory,
              recordedBy: recorders.get(p.recordedById) ?? null,
              recordedAt: p.createdAt,
              /** Set when it was changed after it was recorded. */
              changedAt: p.updatedAt.getTime() - p.createdAt.getTime() > 2000 ? p.updatedAt : null,
              /** Paid to this factory so far and still to pay (in this currency) once this payment counted. */
              after: factoryAfter.get(p.id) ?? null,
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
              account: p.account,
              voided: p.voidedAt ? { at: p.voidedAt, reason: p.voidReason } : null,
              /** A photo or PDF proving it (bank slip, the factory's receipt). */
              file: fileView(p),
            })),
            canRecord: can(user, "payments.record") && o.status !== "cancelled",
            /** Each factory's payment plan (advance on order, balance on the ready date) with what is paid on each part. */
            plans: await factoryPlansOf(this.prisma.db, o.id, s.sales.factoryAdvancePercent, today, s.reminders.dueSoonDays, fx),
            canPlan: can(user, "sourcing.manage") && o.status !== "cancelled",
          }
        : null,
      expenses: seeExpenses ? o.expenses.map((e) => this.expenseView(e)) : null,
      /** Spent on the deal before the order (not part of the order's own expenses). */
      dealExpenses: seeExpenses ? dealExpenses.map((e) => this.expenseView(e)) : null,
      deal: { id: o.inquiryId },
      profit:
        seeExpenses && profit
          ? {
              revenue: fromMinor(totalMinor),
              /** The part of the order value whose lines have a cost: profit is worked out on it alone. */
              costedRevenue: fromMinor(costing.costedRevenueMinor),
              /** Order value on lines without a cost: never counted as profit, shown apart. */
              uncostedRevenue: fromMinor(costing.uncostedRevenueMinor),
              goodsCost: fromMinor(costing.goodsCostMinor),
              /** Costs to reach the basis it was sold on (to the port, freight…), from the accepted option. */
              basisCost: fromMinor(costing.basisCostMinor),
              basisCosts: o.costs.map((c) => ({
                step: c.step,
                amount: c.amount.toFixed(2),
                currency: c.currency,
                cost: c.cost.toFixed(2),
                note: c.note,
              })),
              /** All its expenses (cash), and those counted in profit: freight paid for the planned costs is counted there once. */
              expenses: fromMinor(expensesMinor!),
              expensesCounted: fromMinor(profit.expensesCountedMinor),
              /** Taken by banks from the customer's payments: a cost. */
              bankCharges: fromMinor(position.bankChargesMinor),
              /** Profit on the quote: the costed revenue less the goods and the planned basis costs. */
              grossOnQuote: fromMinor(profit.grossOnQuoteMinor),
              /** Profit now expected (the Costs page's "expected"): also less our expenses beyond the plan and the bank charges. */
              expected: fromMinor(profit.expectedMinor),
              /** The same figure under its older name. */
              earned: fromMinor(profit.expectedMinor),
              /** Spent on the deal before the sale, and the profit once that is taken off too. */
              beforeSale: fromMinor(beforeSaleMinor ?? 0),
              net: fromMinor(netMinor),
              netMarginPercent: costing.costedRevenueMinor > 0 ? roundHalfAway((netMinor / costing.costedRevenueMinor) * 1000) / 10 : null,
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
    if (!can(user, "orders.update")) throw new ForbiddenError("You cannot change orders.");
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

  /**
   * The currencies we owe a factory in on this order (its offers' currencies).
   * A payment only counts against what we owe in the same currency, so a
   * payment in another one would leave the debt standing: refused.
   */
  private async checkFactoryCurrency(orderId: string, factory: { id: string; name: string }, currency: string, keep?: string) {
    if (keep && keep === currency) return;
    const lines = await this.prisma.db.orderLine.findMany({ where: { orderId, factoryId: factory.id }, select: { factoryCurrency: true } });
    const owedIn = [...new Set(lines.map((l) => l.factoryCurrency).filter((c): c is string => !!c))];
    if (owedIn.length && !owedIn.includes(currency)) {
      throw new DomainError(
        `We owe ${factory.name} in ${owedIn.join(" and ")}. Record the payment in ${owedIn[0]}: a payment in ${currency} would not count against what we owe. If you sent ${currency}, enter the ${owedIn[0]} amount the factory received.`,
      );
    }
  }

  private async factoryPaymentData(
    o: { id: string; currency: string },
    input: FactoryPaymentInput,
    keepCurrency?: string,
    keepAccount?: string | null,
  ) {
    if (input.paidOn > this.clock.today()) throw new DomainError("The payment date cannot be in the future.");
    const f = await this.prisma.db.factory.findFirst({ where: { id: input.factoryId, deletedAt: null } });
    if (!f) throw new DomainError("That factory was removed. Choose another one.");
    await this.checkFactoryCurrency(o.id, f, input.currency, keepCurrency);
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
      accountId: await checkAccount(this.prisma.db, input.accountId, input.currency, keepAccount, await this.limits.allows("cash_book")),
      factoryName: f.name,
    };
  }

  async recordFactoryPayment(user: SessionUser, orderId: string, input: FactoryPaymentInput) {
    if (!can(user, "payments.record")) throw new ForbiddenError("Only accounts (managers) can record payments.");
    const o = await this.orders.load(user, orderId);
    if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
    const { factoryName, ...data } = await this.factoryPaymentData(o, input);
    const createdId = await this.prisma.tx(async (tx) => {
      const created = await tx.factoryPayment.create({ data: { ...data, orderId, recordedById: user.id } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "payment_out",
        entityType: "order",
        entityId: orderId,
        summary: `${o.refNo}: paid ${factoryName} ${input.currency} ${data.amount}${input.reference ? ` (${input.reference})` : ""}`,
      });
      return created.id;
    });
    /** `createdId`: the new payment, so its proof can follow. */
    return { ...(await this.forOrder(user, orderId)), createdId };
  }

  private async findFactoryPayment(user: SessionUser, id: string) {
    if (!can(user, "payments.record")) throw new ForbiddenError("Only accounts (managers) can change payments.");
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
    // A payment already recorded in another currency (before this rule) may keep it.
    const { factoryName, ...data } = await this.factoryPaymentData(
      o,
      { ...input, rate: this.keptRate(input, p) },
      p.factoryId === input.factoryId ? p.currency : undefined,
      p.accountId,
    );
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

  /**
   * The factory's payment plan on this order: its parts in order (they add up
   * to what we owe it on the order's lines), each due when we order, on the
   * ready date (it moves with it) or on a fixed day.
   */
  async setFactoryPlan(user: SessionUser, orderId: string, input: FactoryPlanInput) {
    if (!can(user, "sourcing.manage")) throw new ForbiddenError("You cannot change what we pay the factories.");
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${orderId}::uuid for update`;
      const o = await this.orders.load(user, orderId, tx);
      if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
      const f = await tx.factory.findFirst({ where: { id: input.factoryId } });
      if (!f) throw new DomainError("Choose a factory of this order.");
      const lines = await tx.orderLine.findMany({ where: { orderId, factoryId: f.id }, include: { factory: { select: { id: true, name: true } } } });
      const owed = [...owedByFactory(lines).values()][0];
      if (!owed) throw new DomainError(`${f.name} has no lines with a price on this order.`);
      const sum = input.items.reduce((t, i) => t + toMinor(i.amount), 0);
      if (sum !== owed.owedMinor)
        throw new DomainError(`The parts add up to ${formatMinor(sum, owed.currency)}, but we owe ${f.name} ${formatMinor(owed.owedMinor, owed.currency)}. Make them match.`);
      for (const i of input.items) if (i.dueRule === "fixed" && !i.dueOn) throw new DomainError(`Give “${i.label}” its date.`);
      const before = await tx.factoryPaymentPlan.findMany({ where: { orderId, factoryId: f.id }, orderBy: { sortOrder: "asc" } });
      await tx.factoryPaymentPlan.deleteMany({ where: { orderId, factoryId: f.id } });
      await tx.factoryPaymentPlan.createMany({
        data: input.items.map((i, n) => ({
          orderId,
          factoryId: f.id,
          label: i.label,
          percent: i.percent,
          amount: i.amount,
          currency: owed.currency,
          dueRule: i.dueRule,
          dueOn: i.dueRule === "fixed" ? toDbDateOrNull(i.dueOn) : null,
          sortOrder: n,
        })),
      });
      const describe = (rows: { label: string; amount: string; dueRule: string }[]) => rows.map((r) => `${r.label} ${r.amount} (${r.dueRule})`).join("; ");
      await this.audit.record(tx, {
        userId: user.id,
        action: "payment_out_plan",
        entityType: "order",
        entityId: orderId,
        summary: `${o.refNo}: plan for paying ${f.name} set`,
        oldValues: { plan: describe(before.map((b) => ({ label: b.label, amount: b.amount.toFixed(2), dueRule: b.dueRule }))) },
        newValues: { plan: describe(input.items.map((i) => ({ label: i.label, amount: fromMinor(toMinor(i.amount)), dueRule: i.dueRule }))) },
      });
    });
    return this.forOrder(user, orderId);
  }

  /** What we still owe each factory across all orders that are not cancelled (people who see costs). */
  async payables(user: SessionUser, mine: boolean) {
    if (!can(user, "sourcing.manage")) throw new ForbiddenError("You cannot see factory costs.");
    // Only orders where a factory may still be owed (worked out in the database, the same rule), not every order ever.
    const s = await this.settings.get();
    const fx = fxOf(s, await this.limits.allows("expenses"));
    const owing = await ordersOwingFactories(this.prisma, fx);
    const orders = await this.prisma.db.order.findMany({
      where: { status: { not: "cancelled" }, id: { in: owing } },
      select: {
        id: true,
        refNo: true,
        stage: true,
        customer: { select: { name: true } },
        lines: linesWithFactory,
        factoryPaid: { where: { voidedAt: null }, select: { factoryId: true, currency: true, amount: true } },
        expenses: factoryBorneExpenses,
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
        orders: { id: string; refNo: string; stage: string; customer: string; toPay: string; next: { label: string; due: string | null; open: string; status: string } | null }[];
      }
    >();
    const today = this.clock.today();
    for (const o of orders) {
      const factoryOf = new Map(o.lines.flatMap((l) => (l.factory ? [[l.factory.id, l.factory] as const] : [])));
      // What we owe each factory here, less what we paid and what it bears: factoryPosition, as on the order.
      for (const f of factoryPositionOf(o, fx).filter((r) => r.lines > 0)) {
        // Only orders with something still to pay count, so "paid X of Y" is about those.
        if (f.toPayMinor <= 0) continue;
        const factory = factoryOf.get(f.factoryId)!;
        const row = byFactory.get(f.key) ?? { factory, currency: f.currency, owedMinor: 0, paidMinor: 0, orders: [] };
        row.owedMinor += f.owedMinor;
        row.paidMinor += f.settledMinor;
        // The next part of its payment plan (advance, balance on the ready date…): when it is due.
        const plan = (await factoryPlansOf(this.prisma.db, o.id, s.sales.factoryAdvancePercent, today, s.reminders.dueSoonDays, fx)).find(
          (p) => `${p.factory.id}:${p.currency}` === f.key,
        );
        row.orders.push({ id: o.id, refNo: o.refNo, stage: o.stage, customer: o.customer.name, toPay: fromMinor(f.toPayMinor), next: plan?.next ?? null });
        byFactory.set(f.key, row);
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

  private expenseView(e: ExpenseRow) {
    return {
      id: e.id,
      order: e.order ?? null,
      orderId: e.orderId,
      customer: e.customer ?? null,
      deal: e.inquiry ?? null,
      factory: e.factory ?? null,
      account: e.account ?? null,
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
      receipt: e.receiptKey
        ? { name: e.receiptName ?? "receipt", type: e.receiptType ?? "application/octet-stream", size: e.receiptSize ?? 0 }
        : null,
      /** The order's step it belongs to. */
      step: (e.step as FlowStep | null) ?? null,
      borneBy: e.borneBy as ExpenseBearer,
      /** Paid by `paidBy` from their own money, and when we paid it back (from which account). */
      ownMoney: e.ownMoney,
      repaid: e.repaidOn ? { on: fromDbDate(e.repaidOn), account: e.repaidAccount ?? null } : null,
      recordedAt: e.createdAt,
      voided: e.voidedAt ? { at: e.voidedAt, reason: e.voidReason } : null,
    };
  }

  /**
   * Expenses for a period with their totals: ?from=&to= (dates), ?orderId=,
   * ?customerId=, ?category=, ?kind=order|customer|general (general: the
   * company's own, on no customer). The breakdown by kind leaves out the kind
   * filter and the one by customer the customer filter, so each still shows the
   * whole picture for the rest.
   */
  async listExpenses(
    user: SessionUser,
    q: {
      from?: ISODate;
      to?: ISODate;
      orderId?: string;
      inquiryId?: string;
      factoryId?: string;
      customerId?: string;
      category?: string;
      kind?: "order" | "customer" | "general";
      /** The list comes a page at a time; the totals are always for the whole period. */
      page?: number;
      pageSize?: number;
    },
  ) {
    this.assertExpenses(user);
    const { sales } = await this.settings.get();
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 100;
    const orderBy: Prisma.ExpenseOrderByWithRelationInput[] = [{ spentOn: "desc" }, { createdAt: "desc" }];
    // Light rows for the totals (every expense of the period), full ones only for the page shown.
    const rows = await this.prisma.db.expense.findMany({
      where: {
        ...(q.inquiryId ? { inquiryId: q.inquiryId } : {}),
        ...(q.factoryId ? { factoryId: q.factoryId } : {}),
        ...(q.orderId
          ? { orderId: q.orderId }
          : q.kind === "order"
            ? { orderId: { not: null } }
            : q.kind === "customer"
              ? { customerId: { not: null } }
              : q.kind === "general"
                ? { customerId: null, orderId: null }
                : {}),
        ...(q.from || q.to ? { spentOn: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      },
      select: {
        id: true,
        amount: true,
        rate: true,
        category: true,
        customerId: true,
        orderId: true,
        voidedAt: true,
        customer: { select: { id: true, name: true } },
      },
      orderBy,
    });
    type Light = (typeof rows)[number];
    const inMain = (e: Light) => convert(decimalToMinor(e.amount), Number(e.rate));
    const live = rows.filter((r) => !r.voidedAt);
    const byCustomerFilter = live.filter((e) => !q.customerId || e.customerId === q.customerId);
    const byCategoryFilter = live.filter((e) => !q.category || e.category === q.category);
    const shown = byCustomerFilter.filter((e) => !q.category || e.category === q.category);
    const sum = (list: Light[]) => list.reduce((t, e) => t + inMain(e), 0);

    const categories = new Map<string, { total: number; count: number }>();
    for (const e of byCustomerFilter) {
      const c = categories.get(e.category) ?? { total: 0, count: 0 };
      c.total += inMain(e);
      c.count += 1;
      categories.set(e.category, c);
    }
    const customers = new Map<string, { customer: { id: string; name: string }; total: number; count: number; orders: Set<string> }>();
    for (const e of byCategoryFilter) {
      if (!e.customer) continue;
      const c = customers.get(e.customer.id) ?? { customer: e.customer, total: 0, count: 0, orders: new Set<string>() };
      c.total += inMain(e);
      c.count += 1;
      if (e.orderId) c.orders.add(e.orderId);
      customers.set(e.customer.id, c);
    }
    return {
      currency: sales.currency,
      total: fromMinor(sum(shown)),
      count: shown.length,
      /** The company's own costs (on no customer) and the costs spent on customers, in what is shown. */
      company: fromMinor(sum(shown.filter((e) => !e.customerId))),
      customers: fromMinor(sum(shown.filter((e) => e.customerId))),
      byCategory: [...categories.entries()]
        .map(([category, c]) => ({ category, total: fromMinor(c.total), count: c.count }))
        .sort((a, b) => Number(b.total) - Number(a.total)),
      byCustomer: [...customers.values()]
        .map((c) => ({ customer: c.customer, total: fromMinor(c.total), count: c.count, orders: c.orders.size }))
        .sort((a, b) => Number(b.total) - Number(a.total)),
      ...(await (async () => {
        const listed = rows.filter((e) => (!q.customerId || e.customerId === q.customerId) && (!q.category || e.category === q.category));
        const ids = listed.slice((page - 1) * pageSize, page * pageSize).map((e) => e.id);
        const full = ids.length
          ? await this.prisma.db.expense.findMany({ where: { id: { in: ids } }, include: expenseInclude, orderBy })
          : [];
        /** `listed`: how many rows the list has (removed ones included), for the page links. */
        return { page, pageSize, listed: listed.length, rows: full.map((e) => this.expenseView(e)) };
      })()),
    };
  }

  private async expenseData(
    user: SessionUser,
    input: ExpenseInput,
    keepAccount?: string | null,
    before?: { step: string | null; borneBy: string; ownMoney: boolean; repaidOn: Date | null; repaidAccountId: string | null },
  ) {
    if (input.spentOn > this.clock.today()) throw new DomainError("The date cannot be in the future.");
    let order: { id: string; refNo: string } | null = null;
    let customerId = input.customerId ?? null;
    let inquiryId = input.inquiryId ?? null;
    if (input.orderId) {
      const o = await this.orders.load(user, input.orderId);
      if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
      if (customerId && customerId !== o.customerId) throw new DomainError(`Order ${o.refNo} is for another customer.`);
      if (inquiryId && inquiryId !== o.inquiryId) throw new DomainError(`Order ${o.refNo} is from another inquiry.`);
      order = { id: o.id, refNo: o.refNo };
      customerId = o.customerId;
      inquiryId = o.inquiryId;
    } else if (inquiryId) {
      const d = await this.prisma.db.inquiry.findFirst({
        where: { id: inquiryId, deletedAt: null },
        select: { refNo: true, customerId: true },
      });
      if (!d) throw new DomainError("That inquiry is not in the system any more.");
      if (customerId && customerId !== d.customerId) throw new DomainError(`Inquiry ${d.refNo} is for another customer.`);
      customerId = d.customerId;
    } else if (customerId) {
      const c = await this.prisma.db.customer.findFirst({ where: { id: customerId, deletedAt: null }, select: { id: true } });
      if (!c) throw new DomainError("That customer is not in the system any more.");
    }
    if (input.factoryId) {
      const f = await this.prisma.db.factory.findFirst({ where: { id: input.factoryId, deletedAt: null }, select: { id: true } });
      if (!f) throw new DomainError("That factory is not in the system any more.");
    }
    // On an order: its step (left out on a change: kept; on a new one: the usual step of its kind) and who bears it.
    const step = order ? (input.step === undefined ? (before ? before.step : (STEP_OF_CATEGORY[input.category] ?? null)) : input.step) : null;
    const borneBy = input.borneBy ?? (before?.borneBy as ExpenseBearer | undefined) ?? "us";
    if (borneBy !== "us" && !order) throw new DomainError("Only an order's expense can be charged to the customer or the factory.");
    if (borneBy === "factory") {
      if (!input.factoryId) throw new DomainError("Choose the factory that bears it.");
      const onOrder = await this.prisma.db.orderLine.count({ where: { orderId: order!.id, factoryId: input.factoryId } });
      if (!onOrder) throw new DomainError("That factory has nothing on this order, so nothing can be taken off what we owe it.");
    }
    const ownMoney = input.ownMoney ?? before?.ownMoney ?? false;
    if (ownMoney && !input.paidById) throw new DomainError("Say who paid it from their own money.");
    const { sales } = await this.settings.get();
    return {
      order,
      data: {
        step,
        borneBy,
        ownMoney,
        // Paid from someone's own money: no account of ours yet (the repayment says which one).
        ...(ownMoney ? {} : { repaidOn: null, repaidAccountId: null }),
        orderId: order?.id ?? null,
        customerId,
        inquiryId,
        factoryId: input.factoryId ?? null,
        category: input.category,
        description: input.description,
        amount: input.amount,
        currency: input.currency,
        rate: await this.rateFor(input.currency, sales.currency, input.rate),
        spentOn: toDbDate(input.spentOn),
        paidById: await this.activePerson(input.paidById),
        reference: input.reference,
        note: input.note,
        accountId: ownMoney
          ? null
          : await checkAccount(this.prisma.db, input.accountId, input.currency, keepAccount, await this.limits.allows("cash_book")),
      },
    };
  }

  async createExpense(user: SessionUser, input: ExpenseInput) {
    this.assertExpenses(user);
    const { order, data } = await this.expenseData(user, input);
    const e = await this.prisma.tx(async (tx) => {
      const row = await tx.expense.create({
        data: { ...data, recordedById: user.id },
        include: expenseInclude,
      });
      await this.expenseAudit(tx, user, row.id, order, `added ${input.description} ${formatMinor(toMinor(data.amount), input.currency)}`, "expense", {
        newValues: { step: data.step, borneBy: data.borneBy, ...(data.ownMoney ? { ownMoney: true } : {}) },
      });
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
    const e = await this.prisma.db.expense.findUnique({ where: { id }, include: expenseInclude });
    if (!e) throw new NotFoundError("Expense");
    if (e.voidedAt) throw new DomainError("This expense was removed.");
    return e;
  }

  /** Changing a recorded expense always says why. */
  async editExpense(user: SessionUser, id: string, input: ExpenseInput) {
    const e = await this.findExpense(user, id);
    const reason = requireReason(input.reason, "payment", "a recorded expense changes");
    const { order, data } = await this.expenseData(user, { ...input, rate: this.keptRate(input, e) }, e.accountId, e);
    const row = await this.prisma.tx(async (tx) => {
      const updated = await tx.expense.update({
        where: { id },
        data,
        include: expenseInclude,
      });
      await this.expenseAudit(tx, user, id, order ?? e.order, `changed the expense "${e.description}"`, "expense_edit", {
        reason,
        oldValues: {
          amount: `${e.currency} ${e.amount.toFixed(2)}`,
          category: e.category,
          spentOn: fromDbDate(e.spentOn),
          order: e.order?.refNo ?? null,
          deal: e.inquiry?.refNo ?? null,
          customer: e.customer?.name ?? null,
          factory: e.factory?.name ?? null,
          description: e.description,
          borneBy: e.borneBy,
        },
        newValues: {
          step: data.step,
          borneBy: data.borneBy,
          amount: `${data.currency} ${fromMinor(toMinor(data.amount))}`,
          category: data.category,
          spentOn: input.spentOn,
          order: order?.refNo ?? null,
          deal: updated.inquiry?.refNo ?? null,
          customer: updated.customer?.name ?? null,
          factory: updated.factory?.name ?? null,
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
        { reason, newValues: { step: e.step } },
      );
    });
    return { ok: true };
  }

  /**
   * Paying back someone who paid an expense from their own money: the day and
   * the account it left from (same currency). It leaves "To repay".
   */
  async repayExpense(user: SessionUser, id: string, input: RepayInput) {
    const e = await this.findExpense(user, id);
    if (!e.ownMoney) throw new DomainError("This expense was not paid from someone's own money.");
    if (e.repaidOn) throw new DomainError(`It was already repaid on ${fromDbDate(e.repaidOn)}.`);
    if (input.repaidOn > this.clock.today()) throw new DomainError("The date cannot be in the future.");
    if (input.repaidOn < fromDbDate(e.spentOn)) throw new DomainError("It cannot be repaid before it was spent.");
    const accountId = await checkAccount(this.prisma.db, input.accountId, e.currency, null, await this.limits.allows("cash_book"));
    const row = await this.prisma.tx(async (tx) => {
      const updated = await tx.expense.update({
        where: { id },
        data: { repaidOn: toDbDate(input.repaidOn), repaidAccountId: accountId },
        include: expenseInclude,
      });
      await this.expenseAudit(
        tx,
        user,
        id,
        e.order,
        `repaid ${e.paidBy?.name ?? "the person"} ${e.currency} ${e.amount.toFixed(2)} for "${e.description}"`,
        "expense_repay",
        { newValues: { step: e.step, repaidOn: input.repaidOn, account: updated.repaidAccount?.name ?? null } },
      );
      return updated;
    });
    return this.expenseView(row);
  }

  /* ---------------------------------------------------------------- receipts */

  /** A photo or PDF of the receipt or ticket; a new one replaces the old. */
  async attachReceipt(user: SessionUser, id: string, file: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
    const e = await this.findExpense(user, id);
    const ext = file.originalname.split(".").pop()?.toLowerCase() ?? "";
    if (!RECEIPT_EXTENSIONS.has(ext)) throw new DomainError("A receipt can be a photo (JPG, PNG, WEBP) or a PDF.");
    if (file.size > this.storage.maxBytes)
      throw new DomainError(`Files can be up to ${Math.round(this.storage.maxBytes / 1024 / 1024)} MB.`);
    const name = safeFileName(file.originalname);
    const key = this.storage.keyFor(`expenses/${id}/${randomUUID()}-${name}`);
    await this.storage.put(key, file.buffer, file.mimetype);
    try {
      const row = await this.prisma.tx(async (tx) => {
        const updated = await tx.expense.update({
          where: { id },
          data: { receiptKey: key, receiptName: name, receiptType: file.mimetype || "application/octet-stream", receiptSize: file.size },
          include: expenseInclude,
        });
        await this.expenseAudit(
          tx,
          user,
          id,
          e.order,
          `${e.receiptKey ? "replaced" : "added"} the receipt of "${e.description}"`,
          "expense_receipt",
          { newValues: { step: e.step } },
        );
        return updated;
      });
      if (e.receiptKey) await this.storage.delete(e.receiptKey).catch(() => undefined);
      return this.expenseView(row);
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
  }

  async receipt(user: SessionUser, id: string): Promise<{ stream: Readable; fileName: string; mimeType: string; size: number }> {
    this.assertExpenses(user);
    const e = await this.prisma.db.expense.findUnique({ where: { id } });
    if (!e?.receiptKey) throw new NotFoundError("Receipt");
    return {
      stream: await this.storage.get(e.receiptKey),
      fileName: e.receiptName ?? "receipt",
      mimeType: e.receiptType ?? "application/octet-stream",
      size: e.receiptSize ?? 0,
    };
  }

  async removeReceipt(user: SessionUser, id: string) {
    const e = await this.findExpense(user, id);
    if (!e.receiptKey) return { ok: true };
    await this.prisma.tx(async (tx) => {
      await tx.expense.update({ where: { id }, data: { receiptKey: null, receiptName: null, receiptType: null, receiptSize: null } });
      await this.expenseAudit(tx, user, id, e.order, `removed the receipt of "${e.description}"`, "expense_receipt", { newValues: { step: e.step } });
    });
    await this.storage.delete(e.receiptKey).catch(() => undefined);
    return { ok: true };
  }

  /* ---------------------------------------------------------------- profit & loss */

  /**
   * The company's profit & loss for a year, month by month, in the main currency.
   * - Earned: an order counts in the month it shipped — the part of its value
   *   whose lines have a cost, less the factory cost of its goods, the costs to
   *   reach the basis it was sold on, its expenses and the bank charges on its
   *   payments; less the general expenses of the month. Value on lines without a
   *   cost is shown apart, never as profit. Expenses on a cancelled order are
   *   general expenses of the month they were spent.
   * - Cash: what came in from customers that month (what arrived, without the
   *   bank charges), less what was paid to factories and all expenses paid that month.
   * Orders are turned into the main currency at the rate stored on them.
   */
  async profitAndLoss(user: SessionUser, year: number) {
    this.assertExpenses(user);
    // Profit after expenses: needs the expenses feature as well as Insights.
    await this.limits.require("expenses");
    const { sales } = await this.settings.get();
    const main = sales.currency;
    const from = toDbDate(`${year}-01-01`);
    const to = toDbDate(`${year}-12-31`);
    const fx = new MainMoney(main, sales.exchangeRates);
    const rated = { currency: true, mainCurrency: true, mainRate: true } as const;

    const [shipped, payments, factoryPaid, expenses] = await Promise.all([
      this.prisma.db.order.findMany({
        // Shipped this year: the earliest day one of its shipments left (narrowed below).
        where: { status: { not: "cancelled" }, shipments: { some: { departedOn: { gte: from, lte: to } } } },
        select: {
          id: true,
          refNo: true,
          ...rated,
          total: true,
          shipments: { select: { departedOn: true } },
          customer: { select: { name: true } },
          // Only those borne by us: the customer pays the others back, or they come off what we owe a factory.
          expenses: { where: { voidedAt: null, borneBy: "us" }, select: { amount: true, rate: true, category: true } },
          payments: { where: { voidedAt: null }, select: { bankCharges: true, currency: true } },
        },
      }),
      this.prisma.db.payment.findMany({
        where: { voidedAt: null, paidOn: { gte: from, lte: to } },
        select: { amount: true, bankCharges: true, currency: true, paidOn: true, order: { select: { status: true, ...rated } } },
      }),
      this.prisma.db.factoryPayment.findMany({
        where: { voidedAt: null, paidOn: { gte: from, lte: to } },
        select: { amount: true, rate: true, paidOn: true, order: { select: rated } },
      }),
      this.prisma.db.expense.findMany({
        where: { voidedAt: null, spentOn: { gte: from, lte: to } },
        select: { amount: true, rate: true, spentOn: true, orderId: true, order: { select: { status: true } } },
      }),
    ]);
    const costings = await costingsOf(
      this.prisma.db,
      shipped.map((o) => ({ id: o.id, totalMinor: decimalToMinor(o.total) })),
    );

    const months = Array.from({ length: 12 }, (_, i) => ({
      month: `${year}-${String(i + 1).padStart(2, "0")}`,
      earned: {
        revenue: 0,
        costedRevenue: 0,
        goodsCost: 0,
        basisCost: 0,
        orderExpenses: 0,
        bankCharges: 0,
        generalExpenses: 0,
        orders: 0,
        uncostedRevenue: 0,
      },
      cash: { in: 0, factories: 0, expenses: 0 },
    }));
    const monthOf = (d: Date) => months[d.getUTCMonth()]!;
    const profitOf = (e: (typeof months)[number]["earned"]) =>
      e.costedRevenue - e.goodsCost - e.basisCost - e.orderExpenses - e.bankCharges - e.generalExpenses;

    const orderRows: {
      id: string;
      refNo: string;
      customer: string;
      month: string;
      revenue: number;
      uncostedRevenue: number;
      goodsCost: number;
      basisCost: number;
      expenses: number;
      profit: number;
    }[] = [];
    for (const o of shipped) {
      const on = shippedOnOf(o.shipments.map((s) => ({ departedOn: fromDbDateOrNull(s.departedOn) })));
      if (!on || on < `${year}-01-01` || on > `${year}-12-31`) continue;
      const m = monthOf(toDbDate(on));
      const c = costings.get(o.id)!;
      const inMain = (minor: Minor) => fx.order(minor, o);
      const exp = o.expenses.reduce((t, e) => t + convert(decimalToMinor(e.amount), Number(e.rate)), 0);
      const basisPaid = o.expenses
        .filter((e) => paysBasis(e.category))
        .reduce((t, e) => t + convert(decimalToMinor(e.amount), Number(e.rate)), 0);
      const bank = inMain(o.payments.filter((p) => p.currency === o.currency).reduce((t, p) => t + decimalToMinor(p.bankCharges), 0));
      const revenue = inMain(c.revenueMinor);
      const costedRevenue = inMain(c.costedRevenueMinor);
      const goodsCost = inMain(c.goodsCostMinor);
      const basisCost = inMain(c.basisCostMinor);
      const p = orderMoney({
        revenueMinor: revenue,
        costedRevenueMinor: costedRevenue,
        goodsCostMinor: goodsCost,
        basisCostMinor: basisCost,
        receivedMinor: 0,
        factoryPaidMinor: 0,
        expensesMinor: exp,
        basisPaidMinor: basisPaid,
        bankChargesMinor: bank,
      });
      m.earned.revenue += revenue;
      m.earned.costedRevenue += costedRevenue;
      m.earned.uncostedRevenue += revenue - costedRevenue;
      m.earned.goodsCost += goodsCost;
      m.earned.basisCost += basisCost;
      m.earned.orderExpenses += p.expensesCountedMinor;
      m.earned.bankCharges += bank;
      m.earned.orders += 1;
      orderRows.push({
        id: o.id,
        refNo: o.refNo,
        customer: o.customer.name,
        month: m.month,
        revenue,
        uncostedRevenue: revenue - costedRevenue,
        goodsCost,
        basisCost,
        expenses: p.expensesCountedMinor + bank,
        profit: p.expectedMinor,
      });
    }
    for (const e of expenses) {
      const inMain = convert(decimalToMinor(e.amount), Number(e.rate));
      // The company's own, or spent on an order that was then cancelled: a general expense of the month.
      if (!e.orderId || e.order?.status === "cancelled") monthOf(e.spentOn).earned.generalExpenses += inMain;
      monthOf(e.spentOn).cash.expenses += inMain;
    }
    for (const p of payments) {
      // Cash in is what arrived; bank charges never reached us. (Old payments in another currency: at today's rate.)
      monthOf(p.paidOn).cash.in +=
        p.currency === p.order.currency ? fx.order(decimalToMinor(p.amount), p.order) : fx.live(decimalToMinor(p.amount), p.currency);
      // Bank charges on a cancelled order's payments: a general cost of the month (no shipped order carries them).
      if (p.order.status === "cancelled" && p.currency === p.order.currency)
        monthOf(p.paidOn).earned.bankCharges += fx.order(decimalToMinor(p.bankCharges), p.order);
    }
    for (const p of factoryPaid) monthOf(p.paidOn).cash.factories += fx.order(convert(decimalToMinor(p.amount), Number(p.rate)), p.order);

    const money = (n: number) => fromMinor(n);
    const earnedView = (e: (typeof months)[number]["earned"]) => ({
      orders: e.orders,
      revenue: money(e.revenue),
      /** The part of the value with a cost recorded: profit is worked out on it alone. */
      costedRevenue: money(e.costedRevenue),
      /** Value without a cost recorded: left out of profit. */
      uncostedRevenue: money(e.uncostedRevenue),
      goodsCost: money(e.goodsCost),
      /** Costs to reach the basis sold on (to the port, freight…), planned on the accepted option. */
      basisCost: money(e.basisCost),
      orderExpenses: money(e.orderExpenses),
      /** Taken by banks from customers' payments. */
      bankCharges: money(e.bankCharges),
      generalExpenses: money(e.generalExpenses),
      profit: money(profitOf(e)),
    });
    const rows = months.map((m) => ({
      month: m.month,
      earned: earnedView(m.earned),
      cash: {
        in: money(m.cash.in),
        factories: money(m.cash.factories),
        expenses: money(m.cash.expenses),
        net: money(m.cash.in - m.cash.factories - m.cash.expenses),
      },
    }));
    const total = months.reduce(
      (t, m) => {
        for (const k of Object.keys(t.earned) as (keyof typeof t.earned)[]) t.earned[k] += m.earned[k];
        for (const k of Object.keys(t.cash) as (keyof typeof t.cash)[]) t.cash[k] += m.cash[k];
        return t;
      },
      {
        earned: {
          revenue: 0,
          costedRevenue: 0,
          goodsCost: 0,
          basisCost: 0,
          orderExpenses: 0,
          bankCharges: 0,
          generalExpenses: 0,
          orders: 0,
          uncostedRevenue: 0,
        },
        cash: { in: 0, factories: 0, expenses: 0 },
      },
    );
    return {
      year,
      currency: main,
      months: rows,
      total: {
        earned: earnedView(total.earned),
        cash: {
          in: money(total.cash.in),
          factories: money(total.cash.factories),
          expenses: money(total.cash.expenses),
          net: money(total.cash.in - total.cash.factories - total.cash.expenses),
        },
      },
      orders: orderRows
        .sort((a, b) => b.profit - a.profit)
        .map((o) => ({
          ...o,
          revenue: money(o.revenue),
          uncostedRevenue: money(o.uncostedRevenue),
          goodsCost: money(o.goodsCost),
          basisCost: money(o.basisCost),
          expenses: money(o.expenses),
          profit: money(o.profit),
        })),
      missingRates: fx.missingRates,
    };
  }
}
