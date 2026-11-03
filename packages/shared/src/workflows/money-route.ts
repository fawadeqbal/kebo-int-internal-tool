import { divideMinor, multiplyMinor, payInstalments, percentOfMinor, splitDeposit, formatMinor, type Minor } from "@kebo/money";
import { addDays, daysBetween, type ISODate } from "@kebo/utils";
import type { BalanceTerms, PaymentRoute } from "../enums";
import { paymentSentenceOf } from "./quotation";

/**
 * Money v2 (order flow v3, phase 5), the rules shared by the API, the web and
 * the phone app:
 * - a payment in any currency counts on the order at the rate agreed;
 * - one transfer pays several orders, oldest due first; the rest is credit;
 * - the payment route builds the plan (deposit + balance per route);
 * - an LC is checked against the order;
 * - the factory is paid on a plan (advance on order, balance on the ready date).
 * Nothing here touches the database.
 */

/* ---------------------------------------------------------------- any currency */

/**
 * What a payment counts as on the order: received ÷ rate (units of the received
 * currency per one unit of the order's currency), exactly, to the cent. Same
 * currency: the amount itself.
 */
export function countsAsMinor(receivedMinor: Minor, rate: number | string, sameCurrency = false): Minor {
  return sameCurrency ? receivedMinor : divideMinor(receivedMinor, rate);
}

/** The received-currency amount for a part of a payment (order currency × rate), to the cent. */
export const receivedForMinor = (orderMinor: Minor, rate: number | string, sameCurrency = false): Minor =>
  sameCurrency ? orderMinor : multiplyMinor(orderMinor, rate);

/* ---------------------------------------------------------------- one route builds the plan */

export const BALANCE_WHENS = ["before_shipment", "against_bl_copy"] as const;
export type BalanceWhen = (typeof BALANCE_WHENS)[number];
export const BALANCE_WHEN_LABEL: Record<BalanceWhen, string> = {
  before_shipment: "Before shipment",
  against_bl_copy: "Against the B/L copy",
};

export const LC_TERMS = ["at_sight", "deferred"] as const;
export type LcTerms = (typeof LC_TERMS)[number];
export const LC_TERMS_LABEL: Record<LcTerms, string> = { at_sight: "At sight", deferred: "Deferred" };

export const PLAN_PARTS = ["deposit", "balance"] as const;
export type PlanPart = (typeof PLAN_PARTS)[number];

/** The route's terms as stored on the order. */
export interface RouteTerms {
  route: PaymentRoute | null;
  balanceWhen: BalanceWhen | null;
  lcTerms: LcTerms | null;
  lcDays: number | null;
}

/** One instalment of a plan built from the route. */
export interface RoutePlanItem {
  label: string;
  amountMinor: Minor;
  dueOn: ISODate | null;
  part: PlanPart;
  /** after_papers: due `dueDays` after the papers reached the customer's bank. */
  dueRule: "after_papers" | null;
  dueDays: number | null;
}

/** "LC, deferred 90 days", "Informal, against the B/L copy" (route not chosen: the old terms). */
export function routeSummary(t: RouteTerms): string | null {
  if (t.route === "letter_of_credit")
    return t.lcTerms === "deferred" ? `LC, deferred ${t.lcDays ?? 0} days` : "LC at sight";
  if (t.route === "bank_contract") return "Bank contract, through the banks";
  if (t.route === "informal") return t.balanceWhen === "against_bl_copy" ? "Informal, against the B/L copy" : "Informal, before shipment";
  return null;
}

/** The balance's name in the plan, per route. */
export function balanceLabel(t: RouteTerms, depositPercent: number): string {
  if (depositPercent <= 0) return "Payment";
  if (t.route === "letter_of_credit") return "Balance through the LC";
  if (t.route === "bank_contract") return "Balance through the banks";
  if (t.route === "informal") return t.balanceWhen === "against_bl_copy" ? "Balance against B/L copy" : "Balance before shipment";
  return "Balance";
}

/** How a part is paid ("T/T", "LC, deferred 90 days"), for the plan table. */
export function planHow(part: string | null, t: RouteTerms): string {
  if (part === "deposit") return t.route === "informal" ? "Cash or transfer" : "T/T";
  if (part === "balance") {
    if (t.route === "letter_of_credit") return t.lcTerms === "deferred" ? `LC, deferred ${t.lcDays ?? 0} days` : "LC at sight";
    if (t.route === "bank_contract") return "Bank contract";
    if (t.route === "informal") return t.balanceWhen === "against_bl_copy" ? "Against B/L copy" : "Before shipment";
  }
  return "";
}

/** "90 days after the papers", "when the papers reach their bank": when an undated part falls due. */
export function planWhen(item: { part: string | null; dueRule: string | null; dueDays: number | null }, t: RouteTerms): string {
  if (item.dueRule === "after_papers") return item.dueDays ? `${item.dueDays} days after the papers` : "when the papers reach their bank";
  if (item.part === "balance") {
    if (t.route === "bank_contract") return "when the banks present the papers";
    if (t.route === "informal" && t.balanceWhen === "against_bl_copy") return "against the B/L copy";
    if (t.route === "informal") return "before shipment";
  }
  return "";
}

/**
 * The plan an order's route builds: the deposit (dated a few days after the
 * order) and the balance part of the route. An LC's balance is due when the
 * papers reach the customer's bank (at sight) or N days after (deferred); its
 * date follows that bank step. Informal and bank-contract balances are dated
 * when the ready or ship date is known (as before).
 */
export function routePlan(
  totalMinor: Minor,
  depositPercent: number,
  t: RouteTerms,
  orderedOn: ISODate,
  depositDays: number,
  papersReachedOn: ISODate | null = null,
): RoutePlanItem[] {
  const { deposit, balance } = splitDeposit(totalMinor, depositPercent);
  const items: RoutePlanItem[] = [];
  if (deposit > 0)
    items.push({ label: `Deposit ${depositPercent}%`, amountMinor: deposit, dueOn: addDays(orderedOn, depositDays), part: "deposit", dueRule: null, dueDays: null });
  if (balance > 0) {
    const lc = t.route === "letter_of_credit";
    const days = lc ? (t.lcTerms === "deferred" ? Math.max(t.lcDays ?? 0, 0) : 0) : null;
    items.push({
      label: balanceLabel(t, deposit > 0 ? depositPercent : 0),
      amountMinor: balance,
      dueOn: lc && papersReachedOn ? addDays(papersReachedOn, days ?? 0) : null,
      part: "balance",
      dueRule: lc ? "after_papers" : null,
      dueDays: days,
    });
  }
  return items;
}

export interface StoredPlanItem {
  id: string;
  label: string;
  amountMinor: Minor;
  dueOn: ISODate | null;
}

/**
 * Rebuilding the plan when the route changes: the instalments already paid in
 * full stay as they are (payments stay too); the rest is replaced by the new
 * route's parts for what is left (the new parts are taken in order, less what
 * the kept ones already cover).
 */
export function rebuildPlan<T extends StoredPlanItem>(existing: T[], settledMinor: Minor, fresh: RoutePlanItem[]): { keep: T[]; add: RoutePlanItem[] } {
  const paid = payInstalments(existing, settledMinor);
  const keep: T[] = [];
  for (const p of paid) {
    if (p.openMinor > 0) break;
    keep.push(p.item);
  }
  let covered = keep.reduce((t, k) => t + k.amountMinor, 0);
  const add: RoutePlanItem[] = [];
  for (const f of fresh) {
    if (covered >= f.amountMinor) {
      covered -= f.amountMinor;
      continue;
    }
    add.push({ ...f, amountMinor: f.amountMinor - covered });
    covered = 0;
  }
  return { keep, add };
}

/**
 * The balance terms the route now means, from the terms as accepted (Order.balanceTerms stays as the
 * quotation said: nothing writes it after the order is made). No route yet: the accepted terms.
 */
export function balanceTermsOf(t: RouteTerms, current: BalanceTerms): BalanceTerms {
  if (t.route === "letter_of_credit") return "letter_of_credit";
  if (t.route === "informal") return t.balanceWhen ?? (current === "letter_of_credit" ? "before_shipment" : current);
  if (t.route === "bank_contract") return current === "letter_of_credit" ? "against_bl_copy" : current;
  return current;
}

/**
 * The route is still what the quotation said: no route chosen yet, an LC for "letter of credit", an
 * informal route with the same "before shipment" / "against B/L copy". While it is, the quotation's own
 * payment text may be printed on the papers; once it differs, only if someone chooses to.
 */
export function routeAsAccepted(t: RouteTerms, accepted: BalanceTerms): boolean {
  if (!t.route) return true;
  if (accepted === "letter_of_credit") return t.route === "letter_of_credit";
  if (accepted === "before_shipment" || accepted === "against_bl_copy")
    return t.route === "informal" && (t.balanceWhen ?? "before_shipment") === accepted;
  return false;
}

/** "LC at sight", "Informal, against the B/L copy", "Bank contract": the route in a few words (the accepted terms without one). */
export function routeWords(t: RouteTerms, accepted: BalanceTerms): string {
  return routeSummary(t) ?? BALANCE_TERMS_WORDS[accepted];
}
const BALANCE_TERMS_WORDS: Record<BalanceTerms, string> = {
  before_shipment: "balance before shipment",
  against_bl_copy: "balance against B/L copy",
  after_arrival: "balance after arrival",
  letter_of_credit: "letter of credit",
};

/**
 * The payment sentence on the proforma, the sales contract and the payment requests, from the route
 * (route, balance when, LC terms and days) and the deposit the plan asks for. Before a route is chosen:
 * the terms as accepted, worded as the quotation was.
 *   "Our usual payment is made by 30% Advance deposit and 70% before shipment."
 *   "Our usual payment is made by 30% Advance deposit and 70% by irrevocable letter of credit at sight."
 */
export function routePaymentSentence(depositPercent: number, t: RouteTerms, accepted: BalanceTerms): string {
  if (!t.route) return paymentSentenceOf(depositPercent, accepted);
  if (t.route === "informal") return paymentSentenceOf(depositPercent, t.balanceWhen === "against_bl_copy" ? "against_bl_copy" : "before_shipment");
  const how =
    t.route === "letter_of_credit"
      ? t.lcTerms === "deferred"
        ? `by irrevocable letter of credit, payable ${t.lcDays ?? 0} days after the documents reach the buyer's bank`
        : "by irrevocable letter of credit at sight"
      : "through the banks against the shipping documents";
  if (depositPercent <= 0) return `Payment: 100% ${how}.`;
  if (depositPercent >= 100) return "Our usual payment is made by 100% Advance payment.";
  return `Our usual payment is made by ${depositPercent}% Advance deposit and ${100 - depositPercent}% ${how}.`;
}

/** The route's terms an order starts with from its balance terms (an informal order "against B/L copy"). */
export function balanceWhenOf(terms: BalanceTerms): BalanceWhen | null {
  return terms === "before_shipment" || terms === "against_bl_copy" ? terms : null;
}

/* ---------------------------------------------------------------- LC checks */

export interface LcCheck {
  key: "amount" | "currency" | "ship_by" | "expiry";
  label: string;
  /** null: not known yet (data missing). */
  ok: boolean | null;
  detail: string;
}

/**
 * The LC against the order: the amount covers the balance, it is in the
 * order's currency, the latest ship date is not before the factory's ready
 * date, and the papers can reach the bank before it expires (ETA, else the
 * latest ship date, plus the courier days).
 */
export function lcChecks(i: {
  currency: string;
  /** What the LC must cover (the plan's LC part, else the balance). */
  balanceMinor: Minor;
  lc: { amount: string | null; currency: string | null; latestShipOn: ISODate | null; expiresOn: ISODate | null } | null;
  readyOn: ISODate | null;
  eta: ISODate | null;
  courierDays: number;
}): LcCheck[] {
  const lc = i.lc;
  const amountMinor = lc?.amount ? Math.round(Number(lc.amount) * 100) : null;
  const money = (m: Minor, c: string) => formatMinor(m, c);
  const checks: LcCheck[] = [];
  checks.push({
    key: "amount",
    label: "LC amount covers the balance",
    ok: amountMinor === null ? null : amountMinor >= i.balanceMinor,
    detail:
      amountMinor === null
        ? `needs the LC amount · balance ${money(i.balanceMinor, i.currency)}`
        : amountMinor >= i.balanceMinor
          ? `${money(amountMinor, lc!.currency ?? i.currency)} ${amountMinor === i.balanceMinor ? "=" : "≥"} balance`
          : `${money(amountMinor, lc!.currency ?? i.currency)} is short of the balance ${money(i.balanceMinor, i.currency)} · ask for an amendment`,
  });
  checks.push({
    key: "currency",
    label: "LC currency is the order's",
    ok: lc?.currency ? lc.currency === i.currency : null,
    detail: lc?.currency ? (lc.currency === i.currency ? lc.currency : `LC in ${lc.currency}, order in ${i.currency} · ask for an amendment`) : "needs the LC currency",
  });
  const ship = lc?.latestShipOn ?? null;
  checks.push({
    key: "ship_by",
    label: "Ship-by date is after the factory's ready date",
    ok: ship && i.readyOn ? ship >= i.readyOn : null,
    detail:
      ship && i.readyOn
        ? ship >= i.readyOn
          ? `LC ship by ${ship} · factory ready ${i.readyOn}`
          : `LC ship by ${ship} · factory ready ${i.readyOn} · ask for an amendment`
        : !ship
          ? "needs the LC's latest ship date"
          : "needs the factory's ready date",
  });
  const from = i.eta ?? ship;
  const reach = from ? addDays(from, i.courierDays) : null;
  checks.push({
    key: "expiry",
    label: "Papers can reach the bank before the LC expires",
    ok: lc?.expiresOn && reach ? reach <= lc.expiresOn : null,
    detail:
      lc?.expiresOn && reach
        ? `expires ${lc.expiresOn} · ${i.eta ? `ETA ${i.eta}` : `ship by ${ship}`} + courier ${i.courierDays} days${reach > lc.expiresOn ? " · ask for an amendment" : ""}`
        : !lc?.expiresOn
          ? "needs the LC's expiry date"
          : "needs the ETA or the latest ship date",
  });
  return checks;
}

/** "3 of 4 match" (checks without data yet count as not matching). */
export const lcChecksLine = (checks: LcCheck[]) => `${checks.filter((c) => c.ok === true).length} of ${checks.length} match`;

/* ---------------------------------------------------------------- split, credit */

export interface OpenOrder {
  id: string;
  /** The next unpaid instalment's date (null: none dated). */
  dueOn: ISODate | null;
  orderedOn: ISODate;
  openMinor: Minor;
}

/**
 * One transfer over the customer's open orders: the oldest due first (undated
 * last, then by order date), each taking what it still owes; the rest is left
 * over (the customer's credit).
 */
export function allocateOldestFirst(orders: OpenOrder[], amountMinor: Minor): { takes: { id: string; takesMinor: Minor }[]; leftMinor: Minor } {
  const sorted = [...orders].sort(
    (a, b) => (a.dueOn ?? "9999-12-31").localeCompare(b.dueOn ?? "9999-12-31") || a.orderedOn.localeCompare(b.orderedOn) || a.id.localeCompare(b.id),
  );
  let left = Math.max(amountMinor, 0);
  const takes = sorted.map((o) => {
    const t = Math.min(left, Math.max(o.openMinor, 0));
    left -= t;
    return { id: o.id, takesMinor: t };
  });
  return { takes, leftMinor: left };
}

export const CREDIT_KINDS = ["in", "used", "refund", "fee"] as const;
export type CreditKind = (typeof CREDIT_KINDS)[number];
export const CREDIT_KIND_LABEL: Record<CreditKind, string> = { in: "Credit", used: "Used on an order", refund: "Refunded", fee: "Kept as a fee" };

/** The customer's credit per currency: in − used − refund (a fee is income, not credit). */
export function creditBalances(rows: { kind: string; amountMinor: Minor; currency: string }[]): Record<string, Minor> {
  const out: Record<string, Minor> = {};
  for (const r of rows) {
    const sign = r.kind === "in" ? 1 : r.kind === "used" || r.kind === "refund" ? -1 : 0;
    if (!sign) continue;
    out[r.currency] = (out[r.currency] ?? 0) + sign * r.amountMinor;
  }
  return out;
}

/* ---------------------------------------------------------------- cancelled with money in */

export const CANCEL_CUSTOMER_MONEY = ["credit", "refund", "fee"] as const;
export type CancelCustomerMoney = (typeof CANCEL_CUSTOMER_MONEY)[number];
export const CANCEL_CUSTOMER_MONEY_LABEL: Record<CancelCustomerMoney, string> = {
  credit: "Kept as the customer's credit",
  refund: "Refunded",
  fee: "Kept as a cancellation fee",
};
export const CANCEL_FACTORY_MONEY = ["refund_due", "loss"] as const;
export type CancelFactoryMoney = (typeof CANCEL_FACTORY_MONEY)[number];
export const CANCEL_FACTORY_MONEY_LABEL: Record<CancelFactoryMoney, string> = {
  refund_due: "Refund expected from the factory",
  loss: "A loss on this order",
};

/* ---------------------------------------------------------------- factory payment plan */

export const FACTORY_DUE_RULES = ["on_order", "on_ready", "fixed"] as const;
export type FactoryDueRule = (typeof FACTORY_DUE_RULES)[number];
export const FACTORY_DUE_RULE_LABEL: Record<FactoryDueRule, string> = {
  on_order: "when ordered",
  on_ready: "ready date",
  fixed: "fixed date",
};

export interface FactoryPlanRow {
  label: string;
  percent: number | null;
  amountMinor: Minor;
  dueRule: FactoryDueRule;
  dueOn: ISODate | null;
}

/** The plan a factory starts with: an advance (percent) when we order, the balance on the ready date. */
export function defaultFactoryPlan(owedMinor: Minor, advancePercent: number): FactoryPlanRow[] {
  const p = Math.min(Math.max(advancePercent, 0), 100);
  const advance = percentOfMinor(owedMinor, p);
  const rows: FactoryPlanRow[] = [];
  if (advance > 0) rows.push({ label: `Advance ${p}%`, percent: p, amountMinor: advance, dueRule: "on_order", dueOn: null });
  if (owedMinor - advance > 0 || !rows.length)
    rows.push({ label: advance > 0 ? `Balance ${Math.round((100 - p) * 100) / 100}%` : "Payment", percent: advance > 0 ? 100 - p : 100, amountMinor: owedMinor - advance, dueRule: "on_ready", dueOn: null });
  return rows;
}

export type FactoryPlanStatus = "paid" | "part" | "due" | "late" | "later";
export const FACTORY_PLAN_STATUS_LABEL: Record<FactoryPlanStatus, string> = { paid: "Paid", part: "Part paid", due: "Due", late: "Late", later: "Not due yet" };

/** A row's date: when ordered (the factory order date), the order's ready date (moves with it), or the fixed date. */
export function factoryDueOn(row: { dueRule: string; dueOn: ISODate | null }, orderedOn: ISODate | null, readyOn: ISODate | null): ISODate | null {
  if (row.dueRule === "on_order") return orderedOn;
  if (row.dueRule === "on_ready") return readyOn;
  return row.dueOn;
}

/**
 * Each plan row with what is paid on it (payments to the factory pay the rows
 * in order) and where it stands today: paid, part paid, due (within the
 * due-soon window), late, or not due yet.
 */
export function factoryPlanStatus<T extends FactoryPlanRow>(
  rows: T[],
  paidMinor: Minor,
  orderedOn: ISODate | null,
  readyOn: ISODate | null,
  today: ISODate,
  soonDays: number,
) {
  return payInstalments(rows, paidMinor).map(({ item, paidMinor: paid, openMinor }) => {
    const due = factoryDueOn(item, orderedOn, readyOn);
    const status: FactoryPlanStatus =
      openMinor <= 0 ? "paid" : due && due < today ? "late" : due && due <= addDays(today, soonDays) ? "due" : paid > 0 ? "part" : "later";
    return { ...item, due, paidMinor: paid, openMinor: Math.max(openMinor, 0), status, inDays: due ? daysBetween(today, due) : null };
  });
}
