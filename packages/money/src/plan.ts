import { roundHalfAway, type Minor } from "./core";
import { costDocLines } from "./profit";

/**
 * A customer payment plan: instalments (deposit, balance, or more) that add up
 * to the order total. Money received pays them in order, oldest first, so each
 * instalment shows how much of it is paid.
 */
export interface Instalment {
  amountMinor: Minor;
}

export interface PaidInstalment<T extends Instalment = Instalment> {
  item: T;
  paidMinor: Minor;
  /** Still to pay on this instalment. */
  openMinor: Minor;
}

export function payInstalments<T extends Instalment>(items: T[], settledMinor: Minor): PaidInstalment<T>[] {
  let left = Math.max(settledMinor, 0);
  return items.map((item) => {
    const paid = Math.min(left, Math.max(item.amountMinor, 0));
    left -= paid;
    return { item, paidMinor: paid, openMinor: item.amountMinor - paid };
  });
}

/** The sum of the instalments, to check it against the order total. */
export const planTotalMinor = (items: Instalment[]): Minor => items.reduce((s, i) => s + i.amountMinor, 0);

/**
 * One order's costing, in its currency: what it sells for, how much of that has
 * a cost recorded, and what the goods and the costs to reach the basis we sell
 * on (freight, transport to the port…) come to. The discount (lines less the
 * order total) is spread over the lines by amount, as on the quotation.
 */
export function orderCosting(
  lines: { lineTotalMinor: Minor; quantity: number | string; unitCostMinor: Minor | null }[],
  totalMinor: Minor,
  basisCostMinor: Minor = 0,
) {
  const linesSum = lines.reduce((t, l) => t + l.lineTotalMinor, 0);
  const costed = costDocLines({
    id: "order",
    discountMinor: Math.min(Math.max(linesSum - totalMinor, 0), Math.max(linesSum, 0)),
    lines: lines.map((l) => ({ docId: "order", ...l })),
  });
  let costedRevenue = 0;
  let goods = 0;
  for (const l of costed)
    if (l.costMinor !== null) {
      costedRevenue += l.revenueMinor;
      goods += l.costMinor;
    }
  return {
    revenueMinor: totalMinor,
    costedRevenueMinor: costedRevenue,
    /** Revenue on lines without a cost: left out of profit and shown apart. */
    uncostedRevenueMinor: totalMinor - costedRevenue,
    goodsCostMinor: goods,
    basisCostMinor: Math.max(Math.round(basisCostMinor), 0),
  };
}

/**
 * One order's profit, in one currency.
 * - Earned: the revenue that has a cost, less what its goods cost us (the
 *   factory prices on its lines), the costs to reach the basis we sell on, its
 *   expenses and the bank charges taken from the customer's payments. Revenue
 *   without a cost is never counted as profit: it is reported apart.
 * - Cash: what came in from the customer less what we paid the factories and
 *   the expenses paid so far.
 *
 * Freight and the like paid later (expenses of those kinds, `basisPaidMinor`)
 * pay for the costs already planned to reach the basis, so they are not
 * counted twice: up to the planned amount they are covered, beyond it they
 * are a cost like any other.
 */
export interface OrderMoneyFacts {
  /** What the order is worth (its total after discount). */
  revenueMinor: Minor;
  /** The part of the revenue whose lines have a cost. */
  costedRevenueMinor: Minor;
  /** Factory cost of the goods (lines with a cost). */
  goodsCostMinor: Minor;
  /** Planned costs to reach the basis we sell on (from the accepted option). */
  basisCostMinor?: Minor;
  receivedMinor: Minor;
  factoryPaidMinor: Minor;
  /** All the order's expenses. */
  expensesMinor: Minor;
  /** Of those, freight, transport and customs: they pay for the planned basis costs. */
  basisPaidMinor?: Minor;
  /** Taken by banks from the customer's payments. */
  bankChargesMinor?: Minor;
}

/**
 * An order's profit as named figures, the same on every screen (the order's
 * money, its Costs page, Reports, Insights, Leaks and the customer's account):
 * - grossOnQuote, "Profit on the quote": the revenue that has a cost less its
 *   goods and the planned costs to reach the basis (what the quotation promised);
 * - expected, "Profit now expected": that, less the expenses we bear beyond the
 *   planned costs and the bank charges taken from the customer's payments (the
 *   order's money page used to call it "earned");
 * - net, "After the deal's costs": expected less what was spent on the deal
 *   before it became the order (`beforeSaleMinor`);
 * - cash, "Cash so far": what came in less what we paid the factories and every
 *   expense paid so far.
 */
export function orderMoney(f: OrderMoneyFacts & { beforeSaleMinor?: Minor }) {
  const basis = Math.max(f.basisCostMinor ?? 0, 0);
  const covered = Math.min(basis, Math.max(f.basisPaidMinor ?? 0, 0), Math.max(f.expensesMinor, 0));
  const expenses = f.expensesMinor - covered;
  const bank = f.bankChargesMinor ?? 0;
  const grossOnQuote = f.costedRevenueMinor - f.goodsCostMinor - basis;
  const expected = grossOnQuote - expenses - bank;
  const margin = (m: Minor) => (f.costedRevenueMinor > 0 ? roundHalfAway((m / f.costedRevenueMinor) * 1000) / 10 : null);
  return {
    grossOnQuoteMinor: grossOnQuote,
    expectedMinor: expected,
    netMinor: expected - Math.max(f.beforeSaleMinor ?? 0, 0),
    cashMinor: f.receivedMinor - f.factoryPaidMinor - f.expensesMinor,
    uncostedRevenueMinor: f.revenueMinor - f.costedRevenueMinor,
    /** Expenses counted in the expected profit: those not already in the planned basis costs. */
    expensesCountedMinor: expenses,
    /** Expenses that paid for the planned basis costs (counted there). */
    coveredMinor: covered,
    /** Profit on the quote ÷ the revenue that has a cost, one decimal (half away from zero); null without any. */
    grossMarginPercent: margin(grossOnQuote),
    /** Expected profit ÷ the revenue that has a cost. */
    marginPercent: margin(expected),
    /** Share of the revenue whose factory cost is known, 0–100. */
    coveragePercent: f.revenueMinor > 0 ? Math.round((f.costedRevenueMinor / f.revenueMinor) * 100) : null,
  };
}

/** The labels of orderMoney's figures: one name for one figure on every screen. */
export const PROFIT_LABEL = {
  grossOnQuote: "Profit on the quote",
  expected: "Profit now expected",
  net: "After the deal's costs",
  cash: "Cash so far",
} as const;

/** orderMoney under its older names (earned = expected). */
export function orderProfit(f: OrderMoneyFacts) {
  const m = orderMoney(f);
  return {
    earnedMinor: m.expectedMinor,
    cashMinor: m.cashMinor,
    uncostedRevenueMinor: m.uncostedRevenueMinor,
    expensesCountedMinor: m.expensesCountedMinor,
    coveredMinor: m.coveredMinor,
    marginPercent: m.marginPercent,
    coveragePercent: m.coveragePercent,
  };
}
