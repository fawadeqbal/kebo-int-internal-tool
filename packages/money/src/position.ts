import { divideMinor, multiplyMinor, percentOfMinor, roundHalfAway, type Minor } from "./core";
import { factoryUnitCostMinor, fxRate, type Rates } from "./costing";
import { settle, type PaymentLike, type SettlementStatus } from "./settlement";

/**
 * Where an order stands with its customer, worked out in one place for every
 * screen, paper, reminder and report (and, the same rule, in SQL: see the
 * API's money/due.ts):
 *
 *   due = order total + expenses charged to the customer − settled
 *
 * where settled is what arrived plus the bank charges taken on the way (the
 * customer paid them). The deposit is the payment plan's deposit row (so a plan
 * edited to 50% asks for 50%); an order without one falls back to the deposit
 * % accepted on the quotation.
 */
export interface PositionPlanItem {
  amountMinor: Minor;
  /** deposit | balance (built from the route), null when typed by hand. */
  part: string | null;
}

export interface OrderPositionInput {
  totalMinor: Minor;
  /** Payments in the order's currency that count (not voided). */
  payments: PaymentLike[];
  /** The customer's payment plan; its deposit row(s) set the deposit. */
  plan?: PositionPlanItem[] | null;
  /** The deposit % as accepted: the deposit when the plan has no deposit row. */
  depositPercent: number;
  /** Expenses charged to the customer, in the order's currency: added to what they owe. */
  chargedMinor?: Minor;
  /** A shortfall this small counts as paid. */
  toleranceMinor?: Minor;
}

export interface OrderPosition {
  /** The order total (what was accepted). */
  totalMinor: Minor;
  /** Expenses charged to the customer, added to the balance. */
  chargedMinor: Minor;
  /** Total + charged: everything the customer owes on the order. */
  owedMinor: Minor;
  /** What arrived. */
  receivedMinor: Minor;
  /** Taken by banks on the way (counted as paid). */
  bankChargesMinor: Minor;
  /** Received + bank charges. */
  settledMinor: Minor;
  /** Still due (0 when paid, within the tolerance, or overpaid). */
  dueMinor: Minor;
  /** Paid beyond what is owed. */
  overpaidMinor: Minor;
  /** The deposit asked for. */
  depositMinor: Minor;
  /** The deposit as a % of the total: the accepted % unless the plan says otherwise (50 after a plan edited to 50%). */
  depositPercent: number;
  /** The deposit comes from the plan's deposit row. */
  depositFromPlan: boolean;
  /** Still missing on the deposit. */
  depositOutstandingMinor: Minor;
  /** The deposit is in (with no deposit: everything is paid). */
  depositReceived: boolean;
  status: SettlementStatus;
}

export function orderPosition(input: OrderPositionInput): OrderPosition {
  const total = input.totalMinor;
  const charged = Math.max(Math.round(input.chargedMinor ?? 0), 0);
  const owed = total + charged;
  const s = settle(owed, input.payments, 0, input.toleranceMinor ?? 0);
  const accepted = Math.min(Math.max(Number(input.depositPercent) || 0, 0), 100);
  const fromPercent = percentOfMinor(total, accepted);
  const rows = (input.plan ?? []).filter((p) => p.part === "deposit");
  const planDeposit = rows.length ? rows.reduce((t, p) => t + p.amountMinor, 0) : null;
  const deposit = Math.max(planDeposit ?? fromPercent, 0);
  const depositPercent =
    planDeposit === null || planDeposit === fromPercent ? accepted : total > 0 ? roundHalfAway((deposit * 10_000) / total) / 100 : accepted;
  let status = s.status;
  // "Deposit paid" while the order itself is not paid yet; with only a charge open it is partly paid.
  if (status === "partly_paid" && deposit > 0 && s.settledMinor >= deposit && s.settledMinor < total) status = "deposit_paid";
  const due = s.outstandingMinor;
  return {
    totalMinor: total,
    chargedMinor: charged,
    owedMinor: owed,
    receivedMinor: s.receivedMinor,
    bankChargesMinor: s.bankChargesMinor,
    settledMinor: s.settledMinor,
    dueMinor: due,
    overpaidMinor: Math.max(s.settledMinor - owed, 0),
    depositMinor: deposit,
    depositPercent,
    depositFromPlan: planDeposit !== null,
    depositOutstandingMinor: Math.max(deposit - s.settledMinor, 0),
    depositReceived: deposit > 0 ? s.settledMinor >= deposit : due === 0,
    status,
  };
}

/** Rates as Settings keeps them: the main currency and "1 unit of it buys N units of X". */
export interface Fx {
  main: string;
  rates: Rates;
}

/**
 * An expense in another currency → the currency `to`: the expense's own amount
 * when it is in that currency already; otherwise at its own rate into the main
 * currency (units of its currency per one unit of the main), then at `perMain`
 * (units of `to` per one unit of the main). Exact, rounded half away from zero
 * at each step, the same as round(round(amount × 100 ÷ rate) × perMain) in SQL.
 * null when `perMain` is not known.
 */
export function expenseIn(e: { amountMinor: Minor; currency: string; rate: number | string }, to: string, perMain: number | string | null): Minor | null {
  if (e.currency === to) return e.amountMinor;
  if (perMain === null || !(Number(perMain) > 0)) return null;
  return multiplyMinor(divideMinor(e.amountMinor, e.rate), perMain);
}

/* ---------------------------------------------------------------- factories */

export interface FactoryLineFacts {
  factoryId: string;
  /** The factory's currency (frozen on the line). */
  currency: string;
  unitPriceMinor: Minor;
  taxRate: number | string;
  taxIncluded: boolean;
  quantity: number | string;
}

export interface FactoryPaidFacts {
  factoryId: string;
  currency: string;
  amountMinor: Minor;
}

/** An expense the factory bears: taken off what we owe it. */
export interface FactoryBorneFacts {
  factoryId: string;
  currency: string;
  amountMinor: Minor;
  /** Units of its currency per one unit of the main currency when it was spent. */
  rate: number | string;
}

export interface FactoryOwing {
  /** "factoryId:currency". */
  key: string;
  factoryId: string;
  currency: string;
  /** What its lines cost us (price with tax unless included, × quantity). */
  owedMinor: Minor;
  lines: number;
  /** What we paid it in this currency. */
  paidMinor: Minor;
  /** Expenses it bears, in this currency. */
  takenOffMinor: Minor;
  /** Paid + taken off. */
  settledMinor: Minor;
  /** Still to pay (never below 0). */
  toPayMinor: Minor;
  /** Settled beyond what its prices add up to. */
  overpaidMinor: Minor;
}

/**
 * What we owe each factory on an order, in the factory's currency, and where it
 * stands: owed (with tax, through factoryUnitCostMinor) − paid − expenses it
 * bears. One row per factory and currency, in the order of the lines (then
 * factories only paid, owed 0). An expense the factory bears counts against its
 * row in the expense's currency, else its row in the first currency (A→Z); in
 * another currency it is turned at its own rate into the main currency, then at
 * the Settings rate into the row's (left out when that rate is missing).
 */
export function factoryPosition(lines: FactoryLineFacts[], paid: FactoryPaidFacts[], borne: FactoryBorneFacts[], fx: Fx): FactoryOwing[] {
  const rows = new Map<string, FactoryOwing>();
  const row = (factoryId: string, currency: string) => {
    const key = `${factoryId}:${currency}`;
    let r = rows.get(key);
    if (!r) {
      r = { key, factoryId, currency, owedMinor: 0, lines: 0, paidMinor: 0, takenOffMinor: 0, settledMinor: 0, toPayMinor: 0, overpaidMinor: 0 };
      rows.set(key, r);
    }
    return r;
  };
  for (const l of lines) {
    const r = row(l.factoryId, l.currency);
    r.owedMinor += multiplyMinor(factoryUnitCostMinor(l.unitPriceMinor, l.taxRate, l.taxIncluded), l.quantity);
    r.lines += 1;
  }
  // Expenses count only against what its lines owe (before the rows of factories only paid are added).
  for (const e of borne) {
    const mine = [...rows.values()].filter((r) => r.factoryId === e.factoryId);
    const target = mine.find((r) => r.currency === e.currency) ?? [...mine].sort((a, b) => a.currency.localeCompare(b.currency))[0];
    if (!target) continue;
    const per = target.currency === fx.main ? 1 : fxRate(target.currency, fx.main, fx.main, fx.rates);
    const minor = expenseIn(e, target.currency, per);
    if (minor !== null) target.takenOffMinor += minor;
  }
  for (const p of paid) row(p.factoryId, p.currency).paidMinor += p.amountMinor;
  for (const r of rows.values()) {
    r.settledMinor = r.paidMinor + r.takenOffMinor;
    r.toPayMinor = Math.max(r.owedMinor - r.settledMinor, 0);
    r.overpaidMinor = r.owedMinor > 0 ? Math.max(r.settledMinor - r.owedMinor, 0) : 0;
  }
  return [...rows.values()];
}
