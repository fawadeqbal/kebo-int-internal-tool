import { Injectable } from "@nestjs/common";
import { liveFile, livePart, decimalToMinor, fromDbDate, type Prisma } from "@kebo/database";
import { fromMinor, multiplyMinor, orderCosting, orderMoney, roundHalfAway, toMinor, type Minor } from "@kebo/money";
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
import { factoryPositionOf, fxOf, positionOf, supplierPaidRelation } from "../billing/api";

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
        allocations: { where: livePart },
        receivables: { orderBy: { sortOrder: "asc" }, select: { amount: true, part: true } },
        supplierPaid: supplierPaidRelation,
        expenses: {
          orderBy: [{ spentOn: "asc" }, { createdAt: "asc" }],
          include: {
            paidBy: person,
            factory: { select: { id: true, name: true } },
            account: { select: { id: true, name: true } },
            repaidAccount: { select: { id: true, name: true } },
            files: liveFile,
            recordedBy: person,
          },
        },
      },
    });
    const settings = await this.settings.get();
    const { sales } = settings;
    const fx = fxOf(settings, await this.limits.allows("expenses"));
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
    // The same position and profit as the order's money: one function each.
    const position = positionOf(o, fx);
    // A bill known and not paid yet, or paid by someone and not paid back: a cost already, not our cash yet.
    const owing = (e: (typeof live)[number]) => (e.payLater || e.ownMoney) && !e.repaidOn;
    const goodsPaidMinor = o.supplierPaid.filter((p) => !p.voidedAt).reduce((t, p) => t + convert(decimalToMinor(p.share), Number(p.movement.rate)), 0);
    const m = orderMoney({
      ...costing,
      receivedMinor: position.receivedMinor,
      factoryPaidMinor: goodsPaidMinor,
      expensesMinor: plan.spentMinor,
      expensesUnpaidMinor: sum(ours.filter((e) => e.payLater && !e.repaidOn)),
      basisPaidMinor: plan.coveredMinor,
      bankChargesMinor: position.bankChargesMinor,
    });
    const onQuote = m.grossOnQuoteMinor;
    const expected = m.expectedMinor;
    // What the factories charge for the goods, in their own currencies (prices frozen on the lines, with tax on top unless
    // included), and what is still to pay them after our payments and the expenses they bear: factoryPosition.
    const factoryOwed = new Map<string, { owed: Minor; toPay: Minor }>();
    const factoryRows = factoryPositionOf(o, fx).filter((x) => x.lines > 0);
    for (const r of factoryRows) {
      const cur = factoryOwed.get(r.currency) ?? { owed: 0, toPay: 0 };
      factoryOwed.set(r.currency, { owed: cur.owed + r.owedMinor, toPay: cur.toPay + r.toPayMinor });
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

    const missing = live.filter((e) => !e.files.length);
    const missingByCurrency = new Map<string, Minor>();
    for (const e of missing) missingByCurrency.set(e.currency, (missingByCurrency.get(e.currency) ?? 0) + decimalToMinor(e.amount));

    const steps = Object.fromEntries(
      FLOW_STEPS.map((s) => {
        const of = live.filter((e) => e.step === s);
        return [s, { count: of.length, spent: fromMinor(sum(of)) }];
      }),
    ) as Record<FlowStep, { count: number; spent: string }>;

    const bearer = (b: ExpenseBearer) => fromMinor(sum(live.filter((e) => e.borneBy === b)));

    /* ----- The cost sheet (money, step 2): every cost the order has, known or paid, in one list. */
    const factoryNames = new Map(
      (await this.prisma.db.party.findMany({ where: { id: { in: [...new Set(factoryRows.map((r) => r.factoryId))] } }, select: { id: true, name: true } })).map((f) => [f.id, f.name]),
    );
    // What each factory's goods cost in the order's currency (the lines' cost, as profit counts it).
    const goodsOf = new Map<string, Minor>();
    for (const l of o.lines)
      if (l.unitCost !== null) goodsOf.set(l.factoryId ?? "", (goodsOf.get(l.factoryId ?? "") ?? 0) + multiplyMinor(decimalToMinor(l.unitCost), l.quantity.toString()));
    type Row = {
      key: string;
      kind: "goods" | "cost" | "bank" | "estimate";
      label: string;
      category: ExpenseCategory | null;
      owedTo: string | null;
      /** Where it comes from: the factory order, a shipment, the customer's payments, the quotation, or typed here. */
      from: "factory" | "shipment" | "payment" | "quotation" | "typed";
      amount: string;
      currency: string;
      /** In the order's currency (null: no rate). */
      inOrder: string | null;
      /** Paid and still to pay, in its own currency. */
      paid: string;
      toPay: string;
      /** The same two in the order's currency, as the sheet adds them up (null: not ours to bear, or no rate). */
      paidInOrder: string | null;
      toPayInOrder: string | null;
      state: "paid" | "part_paid" | "to_pay" | "to_repay" | "estimate";
      /** Counted in the order's profit: ours to bear. The others are charged to the customer or taken off a factory. */
      borneBy: ExpenseBearer;
      expenseId: string | null;
      on: string | null;
    };
    const rows: Row[] = [];
    const seen = new Set<string>();
    // What was paid to each factory (per currency), in the order's currency at each payment's own rate.
    const paidTo = new Map<string, Minor>();
    for (const p of o.supplierPaid.filter((x) => !x.voidedAt)) {
      const k = `${p.movement.partyId}:${p.movement.currency}`;
      paidTo.set(k, (paidTo.get(k) ?? 0) + convert(decimalToMinor(p.share), Number(p.movement.rate)));
    }
    for (const r of factoryRows) {
      // A factory owed in two currencies: its goods cost in the order's currency shows once, on its first row.
      const first = !seen.has(r.factoryId);
      seen.add(r.factoryId);
      const cost = first ? (goodsOf.get(r.factoryId) ?? null) : null;
      // Settled in the factory's currency is paid in full here too, whatever the rates did between the payments.
      const paidHere = cost === null ? null : r.toPayMinor <= 0 ? cost : Math.min(paidTo.get(r.key) ?? 0, cost);
      rows.push({
        key: `goods:${r.key}`,
        kind: "goods",
        label: "Goods",
        category: null,
        owedTo: factoryNames.get(r.factoryId) ?? "The factory",
        from: "factory",
        amount: fromMinor(r.owedMinor),
        currency: r.currency,
        inOrder: first && goodsOf.has(r.factoryId) ? fromMinor(goodsOf.get(r.factoryId)!) : null,
        paid: fromMinor(Math.min(r.settledMinor, r.owedMinor)),
        toPay: fromMinor(r.toPayMinor),
        paidInOrder: paidHere === null ? null : fromMinor(paidHere),
        toPayInOrder: paidHere === null ? null : fromMinor(cost! - paidHere),
        state: r.toPayMinor <= 0 ? "paid" : r.settledMinor > 0 ? "part_paid" : "to_pay",
        borneBy: "us",
        expenseId: null,
        on: null,
      });
    }
    // Goods with a cost and no factory price to pay (a line costed by hand): counted, nothing to pay here.
    const goodsListed = [...seen].reduce((t, id) => t + (goodsOf.get(id) ?? 0), 0);
    if (costing.goodsCostMinor - goodsListed > 0)
      rows.push({
        key: "goods:other",
        kind: "goods",
        label: "Goods",
        category: null,
        owedTo: null,
        from: "factory",
        amount: fromMinor(costing.goodsCostMinor - goodsListed),
        currency: o.currency,
        inOrder: fromMinor(costing.goodsCostMinor - goodsListed),
        paid: "0.00",
        toPay: "0.00",
        paidInOrder: "0.00",
        toPayInOrder: "0.00",
        state: "estimate",
        borneBy: "us",
        expenseId: null,
        on: null,
      });
    for (const e of live) {
      const open = owing(e);
      const counted = e.borneBy === "us" && perMain !== null;
      rows.push({
        key: e.id,
        kind: "cost",
        label: e.description,
        category: e.category as ExpenseCategory,
        owedTo: e.payee ?? e.factory?.name ?? (e.ownMoney ? (e.paidBy?.name ?? null) : null),
        from: e.source?.startsWith("shipment:") ? "shipment" : "typed",
        amount: e.amount.toFixed(2),
        currency: e.currency,
        inOrder: perMain === null ? null : fromMinor(inOrder(e)),
        paid: open ? "0.00" : e.amount.toFixed(2),
        toPay: open ? e.amount.toFixed(2) : "0.00",
        paidInOrder: counted ? fromMinor(open ? 0 : inOrder(e)) : null,
        toPayInOrder: counted ? fromMinor(open ? inOrder(e) : 0) : null,
        state: !open ? "paid" : e.ownMoney ? "to_repay" : "to_pay",
        borneBy: e.borneBy as ExpenseBearer,
        expenseId: e.id,
        on: fromDbDate(e.repaidOn ?? e.spentOn),
      });
    }
    if (position.bankChargesMinor > 0)
      rows.push({
        key: "bank",
        kind: "bank",
        label: "Bank charges on the customer's payments",
        category: "bank_charges",
        owedTo: null,
        from: "payment",
        amount: fromMinor(position.bankChargesMinor),
        currency: o.currency,
        inOrder: fromMinor(position.bankChargesMinor),
        paid: fromMinor(position.bankChargesMinor),
        toPay: "0.00",
        paidInOrder: fromMinor(position.bankChargesMinor),
        toPayInOrder: "0.00",
        state: "paid",
        borneBy: "us",
        expenseId: null,
        on: null,
      });
    // What the quotation set aside to reach the price basis and no real cost has taken the place of yet: counted until one does.
    const estimateMinor = Math.max(plan.plannedMinor - plan.coveredMinor, 0);
    if (estimateMinor > 0)
      rows.push({
        key: "estimate",
        kind: "estimate",
        label: plan.rows.filter((r) => r.plannedMinor !== null && (r.status === "not_spent" || r.status === "within")).map((r) => r.label).join(", ") || "Costs to reach the price basis",
        category: null,
        owedTo: null,
        from: "quotation",
        amount: fromMinor(estimateMinor),
        currency: o.currency,
        inOrder: fromMinor(estimateMinor),
        paid: "0.00",
        toPay: "0.00",
        paidInOrder: "0.00",
        toPayInOrder: "0.00",
        state: "estimate",
        borneBy: "us",
        expenseId: null,
        on: null,
      });
    // Everything the profit takes off the sale, and what of it is paid: goods, our costs, bank charges.
    const costsMinor = costing.costedRevenueMinor - expected;
    const added = (k: "paidInOrder" | "toPayInOrder") => rows.reduce((t, r) => t + (r.borneBy === "us" && r[k] !== null ? toMinor(r[k]!) : 0), 0);
    const paidMinor = added("paidInOrder");

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
        payLater: e.payLater,
        payee: e.payee,
        source: e.source,
        repaid: e.repaidOn ? { on: fromDbDate(e.repaidOn), account: e.repaidAccount } : null,
        reference: e.reference,
        note: e.note,
        receipt: e.files[0] ? { id: e.files[0].id, name: e.files[0].fileName, type: e.files[0].mimeType, size: e.files[0].size } : null,
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
              factoryOwed: [...factoryOwed].map(([currency, f]) => ({ currency, amount: fromMinor(f.owed), toPay: fromMinor(f.toPay) })),
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
      /** The cost sheet: every cost of the order in one list, with the four figures above it (in the order's currency). */
      sheet: {
        rows,
        total: fromMinor(totalMinor),
        costs: perMain === null ? null : fromMinor(costsMinor),
        paid: perMain === null ? null : fromMinor(paidMinor),
        toPay: perMain === null ? null : fromMinor(added("toPayInOrder")),
        profit: perMain === null ? null : fromMinor(expected),
        margin: perMain === null ? null : percent(expected, costing.costedRevenueMinor),
        /** Order value on lines without a cost: left out of profit. */
        uncosted: fromMinor(costing.uncostedRevenueMinor),
      },
    };
  }
}
