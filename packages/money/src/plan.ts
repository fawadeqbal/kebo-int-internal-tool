import type { Minor } from "./core";

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
 * One order's profit, in one currency.
 * - Earned: what the order is worth less what its goods cost us (from the
 *   factory prices on its lines) and its expenses.
 * - Cash: what came in from the customer less what we paid the factories and
 *   the expenses paid so far.
 */
export interface OrderMoneyFacts {
  revenueMinor: Minor;
  /** Factory cost of the goods (lines with a cost); null parts are reported apart. */
  goodsCostMinor: Minor;
  /** Revenue on lines that have no cost recorded. */
  uncostedRevenueMinor: Minor;
  receivedMinor: Minor;
  factoryPaidMinor: Minor;
  expensesMinor: Minor;
}

export function orderProfit(f: OrderMoneyFacts) {
  const earned = f.revenueMinor - f.goodsCostMinor - f.expensesMinor;
  const cash = f.receivedMinor - f.factoryPaidMinor - f.expensesMinor;
  const costed = f.revenueMinor - f.uncostedRevenueMinor;
  return {
    earnedMinor: earned,
    cashMinor: cash,
    /** Earned profit ÷ revenue, one decimal; null without revenue. */
    marginPercent: f.revenueMinor > 0 ? Math.round((earned / f.revenueMinor) * 1000) / 10 : null,
    /** Share of the revenue whose factory cost is known, 0–100. */
    coveragePercent: f.revenueMinor > 0 ? Math.round((costed / f.revenueMinor) * 100) : null,
  };
}
