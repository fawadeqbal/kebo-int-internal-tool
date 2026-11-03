import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, type Prisma } from "@kebo/database";
import { factoryUnitCostMinor, fromMinor, multiplyMinor, orderCosting, roundHalfAway, settle, type Minor } from "@kebo/money";
import {
  can,
  FLOW_STEPS,
  plannedAndSpent,
  type BasisStep,
  type ExpenseBearer,
  type ExpenseCategory,
  type FlowStep,
} from "@kebo/shared";
import { ForbiddenError } from "@kebo/utils";
import { LimitsService } from "../../common/company/limits.service";
import { PrismaService } from "../../database/prisma.service";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { OrdersService } from "../orders/orders.service";
import { convert, orderRate } from "./order-money";

const person = { select: { id: true, name: true } } as const;

/** Percent of `part` in `whole`, one decimal; null without a whole. */
const percent = (part: Minor, whole: Minor) => (whole > 0 ? roundHalfAway((part / whole) * 1000) / 10 : null);

/**
 * An order's costs (order flow v3, the Costs page): what the quote planned to
 * reach the price basis against what was spent, every expense with its step
 * and who bears it, the profit now expected, and who is still to be repaid.
 * Managers with the expenses feature only.
 */
@Injectable()
export class CostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly orders: OrdersService,
    private readonly limits: LimitsService,
  ) {}

  async forOrder(user: SessionUser, orderId: string) {
    if (!can(user, "expenses.manage")) throw new ForbiddenError("Only managers can see an order's costs and profit.");
    await this.limits.require("expenses");
    const base = await this.orders.load(user, orderId);
    const o = await this.prisma.db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        lines: { orderBy: { sortOrder: "asc" } },
        costs: true,
        payments: { where: { voidedAt: null } },
        expenses: {
          orderBy: [{ spentOn: "asc" }, { createdAt: "asc" }],
          include: {
            paidBy: person,
            factory: { select: { id: true, name: true } },
            account: { select: { id: true, name: true } },
            repaidAccount: { select: { id: true, name: true } },
            recordedBy: person,
          },
        },
      },
    });
    const { sales } = await this.settings.get();
    const perMain = orderRate(o, sales.currency, sales.exchangeRates);
    /** An expense in the order's currency: its amount at its own rate into the main currency, then at the order's rate. */
    const inOrder = (e: { amount: Prisma.Decimal; rate: Prisma.Decimal }) =>
      perMain === null ? 0 : roundHalfAway(convert(decimalToMinor(e.amount), Number(e.rate)) * perMain);

    const live = o.expenses.filter((e) => !e.voidedAt);
    const ours = live.filter((e) => e.borneBy === "us");
    const sum = (list: typeof live) => list.reduce((t, e) => t + inOrder(e), 0);

    const plan = plannedAndSpent(
      o.costs.map((c) => ({ step: c.step as BasisStep, costMinor: decimalToMinor(c.cost), note: c.note })),
      ours.map((e) => ({ category: e.category as ExpenseCategory, minor: inOrder(e) })),
    );

    // Profit as the quote saw it and as it stands: sale − factory − planned − not planned (− bank charges on payments).
    const totalMinor = decimalToMinor(o.total);
    const costing = orderCosting(
      o.lines.map((l) => ({
        lineTotalMinor: decimalToMinor(l.lineTotal),
        quantity: l.quantity.toString(),
        unitCostMinor: l.unitCost === null ? null : decimalToMinor(l.unitCost),
      })),
      totalMinor,
      plan.plannedMinor,
    );
    const position = settle(
      totalMinor,
      o.payments
        .filter((p) => p.currency === o.currency)
        .map((p) => ({ amountMinor: decimalToMinor(p.amount), bankChargesMinor: decimalToMinor(p.bankCharges) })),
    );
    const onQuote = costing.costedRevenueMinor - costing.goodsCostMinor - plan.plannedMinor;
    const expected = onQuote - plan.notPlannedMinor - position.bankChargesMinor;
    // What the factories charge for the goods, in their own currencies (prices frozen on the lines, with tax on top unless included).
    const factoryOwed = new Map<string, Minor>();
    for (const l of o.lines) {
      if (l.factoryUnitPrice === null || !l.factoryCurrency) continue;
      const unit = factoryUnitCostMinor(decimalToMinor(l.factoryUnitPrice), l.factoryTaxRate?.toString() ?? 0, l.factoryTaxIncluded);
      factoryOwed.set(l.factoryCurrency, (factoryOwed.get(l.factoryCurrency) ?? 0) + multiplyMinor(unit, l.quantity.toString()));
    }

    // Paid from someone's own money and not repaid yet: per person and currency.
    const repay = new Map<string, { person: { id: string; name: string }; currency: string; minor: Minor; items: { id: string; description: string; amount: string; spentOn: string }[] }>();
    for (const e of live) {
      if (!e.ownMoney || e.repaidOn || !e.paidBy) continue;
      const key = `${e.paidBy.id}:${e.currency}`;
      const r = repay.get(key) ?? { person: e.paidBy, currency: e.currency, minor: 0, items: [] };
      r.minor += decimalToMinor(e.amount);
      r.items.push({ id: e.id, description: e.description, amount: e.amount.toFixed(2), spentOn: fromDbDate(e.spentOn) });
      repay.set(key, r);
    }

    const missing = live.filter((e) => !e.receiptKey);
    const missingByCurrency = new Map<string, Minor>();
    for (const e of missing) missingByCurrency.set(e.currency, (missingByCurrency.get(e.currency) ?? 0) + decimalToMinor(e.amount));

    const steps = Object.fromEntries(
      FLOW_STEPS.map((s) => {
        const of = live.filter((e) => e.step === s);
        return [s, { count: of.length, spent: fromMinor(sum(of)) }];
      }),
    ) as Record<FlowStep, { count: number; spent: string }>;

    const bearer = (b: ExpenseBearer) => fromMinor(sum(live.filter((e) => e.borneBy === b)));

    return {
      orderId: o.id,
      refNo: o.refNo,
      currency: o.currency,
      mainCurrency: sales.currency,
      /** There is no rate between the order's currency and the main one: amounts cannot be added up. */
      missingRate: perMain === null ? o.currency : null,
      cancelled: base.status === "cancelled",
      canEdit: base.status !== "cancelled",
      totals: {
        planned: fromMinor(plan.plannedMinor),
        /** Everything spent on the order (whoever bears it). */
        spent: fromMinor(sum(live)),
        count: live.length,
        /** Borne by us and not covered by the plan: it cuts the profit. */
        notPlanned: fromMinor(plan.notPlannedMinor),
        notPlannedKinds: plan.rows.filter((r) => r.status === "not_planned" || r.status === "over").map((r) => r.label),
        receiptsMissing: missing.length,
        receiptsMissingAmounts: [...missingByCurrency].map(([currency, minor]) => ({ currency, amount: fromMinor(minor) })),
        borneByUs: bearer("us"),
        chargedToCustomer: bearer("customer"),
        takenOffFactory: bearer("factory"),
      },
      planned: plan.rows.map((r) => ({
        key: r.key,
        label: r.label,
        basisStep: r.basisStep,
        categories: r.categories,
        planned: r.plannedMinor === null ? null : fromMinor(r.plannedMinor),
        spent: fromMinor(r.spentMinor),
        difference: fromMinor(r.differenceMinor),
        status: r.status,
        note: r.note,
      })),
      steps,
      expenses: o.expenses.map((e) => ({
        id: e.id,
        category: e.category as ExpenseCategory,
        description: e.description,
        amount: e.amount.toFixed(2),
        currency: e.currency,
        rate: Number(e.rate),
        /** In the main currency at its rate, and in the order's currency at the order's rate. */
        inMain: fromMinor(convert(decimalToMinor(e.amount), Number(e.rate))),
        inOrder: fromMinor(inOrder(e)),
        spentOn: fromDbDate(e.spentOn),
        step: (e.step as FlowStep | null) ?? null,
        borneBy: e.borneBy as ExpenseBearer,
        factory: e.factory,
        paidBy: e.paidBy,
        account: e.account,
        ownMoney: e.ownMoney,
        repaid: e.repaidOn ? { on: fromDbDate(e.repaidOn), account: e.repaidAccount } : null,
        reference: e.reference,
        note: e.note,
        receipt: e.receiptKey
          ? { name: e.receiptName ?? "receipt", type: e.receiptType ?? "application/octet-stream", size: e.receiptSize ?? 0 }
          : null,
        recordedBy: e.recordedBy,
        recordedAt: e.createdAt,
        voided: e.voidedAt ? { at: e.voidedAt, reason: e.voidReason } : null,
      })),
      profit:
        perMain === null
          ? null
          : {
              /** The part of the sale whose lines have a cost (profit is worked out on it), and the rest. */
              sale: fromMinor(costing.costedRevenueMinor),
              uncosted: fromMinor(costing.uncostedRevenueMinor),
              factory: fromMinor(costing.goodsCostMinor),
              factoryOwed: [...factoryOwed].map(([currency, minor]) => ({ currency, amount: fromMinor(minor) })),
              planned: fromMinor(plan.plannedMinor),
              notPlanned: fromMinor(plan.notPlannedMinor),
              /** Taken by banks from the customer's payments. */
              bankCharges: fromMinor(position.bankChargesMinor),
              expected: fromMinor(expected),
              margin: percent(expected, costing.costedRevenueMinor),
              onQuote: fromMinor(onQuote),
              onQuoteMargin: percent(onQuote, costing.costedRevenueMinor),
            },
      toRepay: [...repay.values()].map((r) => ({ person: r.person, currency: r.currency, amount: fromMinor(r.minor), items: r.items })),
    };
  }
}
