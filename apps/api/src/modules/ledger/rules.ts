import { divideMinor, expenseIn, factoryPosition, type Minor, type Rates } from "@kebo/money";
import {
  EXPENSE_CATEGORY_LABEL,
  ledgerAccount as acc,
  PAYMENT_KIND_LABEL,
  type ExpenseCategory,
  type LedgerEntryType,
  type LedgerSource,
  type PaymentKind,
} from "@kebo/shared";
import type { ISODate } from "@kebo/utils";

/**
 * What each document posts, worked out from the document as it stands now (pure: no database). The posting
 * service compares this with what is already posted for the document and writes only the difference.
 *
 * Every amount is in minor units of its currency. A line's main-currency amount is its amount ÷ its rate
 * (units of its currency per one unit of the main currency), unless it is given; a posting's debits and credits
 * are made equal in the main currency by an "Exchange difference" line when rates or rounding leave a gap.
 */

export type Side = "debit" | "credit";

export interface Dims {
  orderId: string | null;
  customerId: string | null;
  factoryId: string | null;
  /** The person whose own money it was (staff, to repay). */
  userId: string | null;
}

export interface Line extends Partial<Dims> {
  account: string;
  side: Side;
  minor: Minor;
  currency: string;
  /** Units of `currency` per one unit of the main currency; null: not known (its main amount is 0). */
  rate: number | string | null;
  /** The main-currency amount when it is not amount ÷ rate (exchange differences). */
  baseMinor?: Minor;
  /** Its main amount is whatever makes the posting balance (the other side of a single conversion). */
  takesRest?: boolean;
  moneyAccountId?: string | null;
  memo?: string;
}

/** One posting of a document: an expense has two (spent, and repaid to the person later). */
export interface Part {
  part: string;
  date: ISODate;
  type: LedgerEntryType;
  ref: string;
  memo: string;
  dims: Dims;
  lines: Line[];
}

export interface DocPlan {
  sourceType: LedgerSource;
  sourceId: string;
  /**
   * full: a change reverses what was posted and posts it again (money in and out, expenses, transfers);
   * delta: a change posts the difference (an order, a factory's part, an account's opening balance).
   */
  mode: "full" | "delta";
  /** Compared in the main currency too (exchange differences, whose amounts are 0 in the party's currency). */
  compareBase?: boolean;
  /** What the document posts when it stands (also when it was removed: posted, then reversed, on a rebuild). */
  parts: Part[];
  /** Removed (voided, cancelled): everything posted is reversed, on that day, with that reason. */
  voided: { on: ISODate; reason: string | null } | null;
  /** A number to give the document when it has none yet (EX-2026-0001…): kept from its first posting. */
  allocRef?: { prefix: string; year: number };
}

export interface RuleCtx {
  main: string;
  rates: Rates;
  /** The expenses module: without it nothing is charged to a customer or taken off a factory (as positionOf). */
  expensesOn: boolean;
}

/* ---------------------------------------------------------------- rates */

/** Units of `currency` per one unit of the main currency at the Settings rate; null when there is none. */
export function liveRate(ctx: RuleCtx, currency: string): number | null {
  if (currency === ctx.main) return 1;
  const r = ctx.rates[currency];
  return typeof r === "number" && r > 0 ? r : null;
}

/** The main-currency amount of a line. */
export function baseOf(l: Pick<Line, "minor" | "rate" | "baseMinor">): Minor {
  if (l.baseMinor !== undefined) return l.baseMinor;
  if (l.rate === null || l.rate === undefined || !(Number(l.rate) > 0)) return 0;
  return divideMinor(l.minor, typeof l.rate === "number" ? String(l.rate) : l.rate);
}

/** A rate kept to 14 decimals, as the column holds it. */
const r14 = (n: number) => Math.round(n * 1e14) / 1e14;

/**
 * The rates of money that arrived in one currency and counts in another: `rate` is units of the arrived currency
 * per one of the counted one. The counted currency's rate to the main: 1 when it is the main; the inverse when
 * the money arrived in the main; else `fallback` (the order's own rate).
 */
export function pairRates(main: string, arrived: string, counted: string, rate: number, fallback: number | null) {
  if (counted === main) return { counted: 1, arrived: arrived === main ? 1 : rate };
  if (arrived === main) return { counted: rate > 0 ? r14(1 / rate) : null, arrived: 1 };
  if (arrived === counted) return { counted: fallback, arrived: fallback };
  return { counted: fallback, arrived: fallback === null ? null : r14(rate * fallback) };
}

/* ---------------------------------------------------------------- documents */

export interface OrderDoc {
  id: string;
  refNo: string;
  customerId: string;
  currency: string;
  totalMinor: Minor;
  orderedOn: ISODate;
  /** Units of the order's currency per one of the main (orderRate). */
  rate: number | null;
  cancelled: { on: ISODate; reason: string | null } | null;
}

const NO_DIMS: Dims = { orderId: null, customerId: null, factoryId: null, userId: null };
const dims = (d: Partial<Dims>): Dims => ({ ...NO_DIMS, ...d });

/** The customer owes the order total from the day it is confirmed; cancelling reverses it. */
export function orderPlan(o: OrderDoc): DocPlan {
  const d = dims({ orderId: o.id, customerId: o.customerId });
  return {
    sourceType: "order",
    sourceId: o.id,
    mode: "delta",
    voided: o.cancelled,
    parts:
      o.totalMinor > 0
        ? [
            {
              part: "",
              date: o.orderedOn,
              type: "order",
              ref: o.refNo,
              memo: `Order ${o.refNo}`,
              dims: d,
              lines: [
                { account: acc.customer(o.customerId), side: "debit", minor: o.totalMinor, currency: o.currency, rate: o.rate },
                { account: "sales", side: "credit", minor: o.totalMinor, currency: o.currency, rate: o.rate },
              ],
            },
          ]
        : [],
  };
}

export interface FactoryLineDoc {
  factoryId: string;
  currency: string;
  unitPriceMinor: Minor;
  taxRate: string | number;
  taxIncluded: boolean;
  quantity: string | number;
}

/**
 * What we owe one factory on an order: what its lines owe (factoryPosition's "owed", with tax), in each of its
 * currencies, from the day the order was made. Referenced by the purchase order's number, else the order's and
 * the factory's names.
 */
export function purchasePlan(
  o: OrderDoc,
  factory: { id: string; name: string },
  lines: FactoryLineDoc[],
  ref: string,
  ctx: RuleCtx,
): DocPlan {
  const owing = factoryPosition(
    lines.filter((l) => l.factoryId === factory.id),
    [],
    [],
    { main: ctx.main, rates: ctx.rates },
  );
  const d = dims({ orderId: o.id, customerId: o.customerId, factoryId: factory.id });
  const out: Line[] = [];
  for (const r of owing) {
    if (r.owedMinor <= 0) continue;
    const rate = liveRate(ctx, r.currency);
    out.push({ account: "goods_cost", side: "debit", minor: r.owedMinor, currency: r.currency, rate });
    out.push({ account: acc.factory(factory.id), side: "credit", minor: r.owedMinor, currency: r.currency, rate });
  }
  return {
    sourceType: "purchase_order",
    sourceId: `${o.id}:${factory.id}`,
    mode: "delta",
    voided: o.cancelled,
    parts: out.length
      ? [
          {
            part: "",
            date: o.orderedOn,
            type: "purchase_order",
            ref,
            memo: `Goods from ${factory.name} for ${o.refNo}`,
            dims: d,
            lines: out,
          },
        ]
      : [],
  };
}

/** Where money is: one of our accounts, else "not on an account" in its currency. */
export const moneyLine = (accountId: string | null, currency: string): Pick<Line, "account" | "moneyAccountId"> =>
  accountId ? { account: acc.money(accountId), moneyAccountId: accountId } : { account: acc.noAccount(currency), moneyAccountId: null };

/** One order's part of a payment entry, as the ledger needs it. */
export interface AllocationLine {
  id: string;
  /** Its receipt's number (RC-…-n). */
  ref: string;
  kind: PaymentKind;
  order: { id: string; refNo: string; customerId: string; currency: string; rate: number | null };
  amountMinor: Minor;
  bankChargesMinor: Minor;
  /** Removed (when the movement stands: released, its order cancelled). */
  voided: boolean;
}

export interface MovementDoc {
  id: string;
  /** Its receipts' numbers (the first, "+n" for more); "" for money that pays no order (numbered CR-…). */
  ref: string;
  direction: "in" | "out";
  partyId: string;
  amountMinor: Minor;
  currency: string;
  allocCurrency: string;
  /** Units of `currency` per one of `allocCurrency`. */
  rate: number;
  /** What it counts as in allocCurrency. */
  allocatableMinor: Minor;
  accountId: string | null;
  valueDate: ISODate;
  /** The orders' own rate (the first order's), for the credit and the orders' lines. */
  orderRate: number | null;
  /** What it paid when it was recorded (not later, from credit), removed or not. */
  parts: AllocationLine[];
  voided: { on: ISODate; reason: string | null } | null;
}

/**
 * A payment entry. Money in: into the account (what arrived, in its currency), the bank charges the customer
 * paid on the way, off each order it paid when recorded (amount + bank charges, in the orders' currency), the
 * rest to the customer's credit. Money out (a refund): off their credit, out of the account.
 */
export function movementPlan(m: MovementDoc, ctx: RuleCtx): DocPlan {
  const base = { sourceType: "movement" as const, sourceId: m.id, mode: "full" as const, voided: m.voided };
  const allocRef = m.ref ? undefined : { prefix: "CR", year: Number(m.valueDate.slice(0, 4)) };
  if (m.direction === "out") {
    const rate = liveRate(ctx, m.currency);
    return {
      ...base,
      allocRef,
      parts: [
        {
          part: "",
          date: m.valueDate,
          type: "money_out",
          ref: m.ref,
          memo: "Credit refunded",
          dims: dims({ customerId: m.partyId }),
          lines: [
            { account: acc.credit(m.partyId), side: "debit", minor: m.amountMinor, currency: m.currency, rate },
            { ...moneyLine(m.accountId, m.currency), side: "credit", minor: m.amountMinor, currency: m.currency, rate },
          ],
        },
      ],
    };
  }
  const rates = pairRates(ctx.main, m.currency, m.allocCurrency, m.rate, m.orderRate ?? liveRate(ctx, m.allocCurrency));
  const lines: Line[] = [{ ...moneyLine(m.accountId, m.currency), side: "debit", minor: m.amountMinor, currency: m.currency, rate: rates.arrived }];
  // A part released later (its order cancelled) still paid the order on this day: the release posts its own.
  for (const p of m.parts) {
    if (p.bankChargesMinor > 0)
      lines.push({ account: "bank_charges", side: "debit", minor: p.bankChargesMinor, currency: m.allocCurrency, rate: rates.counted, orderId: p.order.id });
    lines.push({
      account: acc.customer(m.partyId),
      side: "credit",
      minor: p.amountMinor + p.bankChargesMinor,
      currency: m.allocCurrency,
      rate: rates.counted,
      orderId: p.order.id,
    });
  }
  const creditMinor = m.allocatableMinor - m.parts.reduce((t, p) => t + p.amountMinor, 0);
  if (creditMinor > 0)
    lines.push({ account: acc.credit(m.partyId), side: "credit", minor: creditMinor, currency: m.allocCurrency, rate: rates.counted });
  // One conversion (the money arrived in, or counts in, the main currency): the customer's side takes the rest.
  if (m.parts.length === 1 && creditMinor <= 0 && (m.currency === ctx.main || m.allocCurrency === ctx.main))
    lines[lines.length - 1] = { ...lines[lines.length - 1]!, takesRest: true };
  const refs = [...new Set(m.parts.map((p) => p.order.refNo))];
  const one = m.parts.length === 1 ? m.parts[0]! : null;
  return {
    ...base,
    allocRef,
    parts: [
      {
        part: "",
        date: m.valueDate,
        type: "money_in",
        ref: m.ref,
        memo: one
          ? `${PAYMENT_KIND_LABEL[one.kind] ?? "Payment"} for ${one.order.refNo}${one.bankChargesMinor ? " (with bank charges)" : ""}${creditMinor > 0 ? ", the rest to credit" : ""}`
          : refs.length
            ? `One transfer for ${refs.join(", ")}${creditMinor > 0 ? ", the rest to credit" : ""}`
            : "Money in, kept as the customer's credit",
        dims: dims({ customerId: m.partyId, orderId: refs.length === 1 ? m.parts[0]!.order.id : null }),
        lines,
      },
    ],
  };
}

export interface AllocationDoc {
  id: string;
  ref: string;
  target: "order" | "purchase" | "refund" | "fee";
  partyId: string;
  /** Made after its movement, from the customer's credit. */
  later: boolean;
  /** In the movement's alloc currency. */
  amountMinor: Minor;
  bankChargesMinor: Minor;
  currency: string;
  order: { id: string; refNo: string; rate: number | null } | null;
  on: ISODate;
  note: string | null;
  /** Its movement was removed: everything is reversed by the movement. */
  movementVoided: boolean;
  voided: { on: ISODate; reason: string | null } | null;
}

/**
 * What an allocation posts by itself (the rest is its movement's):
 * - paid from the customer's credit later: off their credit, off what they owe on the order;
 * - kept as a fee later: off their credit, into sales;
 * - made with its movement and released (its order cancelled, the movement stands): back off what the order
 *   settled (amount + bank charges) onto their credit, the bank charges no longer ours;
 * - a refund's part: posted by its money out.
 */
export function allocationPlan(a: AllocationDoc, ctx: RuleCtx): DocPlan {
  const base = { sourceType: "allocation" as const, sourceId: a.id, mode: "full" as const, voided: a.voided };
  const none = { ...base, voided: null, parts: [] };
  // A supplier payment's part is posted by its money out, like a refund's.
  if (a.movementVoided || a.target === "refund" || a.target === "purchase") return none;
  const rate = a.order?.rate ?? liveRate(ctx, a.currency);
  const d = dims({ customerId: a.partyId, orderId: a.order?.id ?? null });
  const credit = acc.credit(a.partyId);
  if (!a.later) {
    if (!a.voided || !a.order) return none;
    const lines: Line[] = [
      { account: acc.customer(a.partyId), side: "debit", minor: a.amountMinor + a.bankChargesMinor, currency: a.currency, rate },
      { account: credit, side: "credit", minor: a.amountMinor, currency: a.currency, rate },
    ];
    if (a.bankChargesMinor > 0) lines.push({ account: "bank_charges", side: "credit", minor: a.bankChargesMinor, currency: a.currency, rate });
    return {
      ...none,
      parts: [{ part: "", date: a.voided.on, type: "credit", ref: a.ref, memo: `Kept from cancelled ${a.order.refNo} as credit`, dims: d, lines }],
    };
  }
  if (a.target === "fee")
    return {
      ...base,
      allocRef: { prefix: "CR", year: Number(a.on.slice(0, 4)) },
      parts: [
        {
          part: "",
          date: a.on,
          type: "credit",
          ref: "",
          memo: a.note ?? "Cancellation fee kept",
          dims: d,
          lines: [
            { account: credit, side: "debit", minor: a.amountMinor, currency: a.currency, rate },
            { account: "sales", side: "credit", minor: a.amountMinor, currency: a.currency, rate },
          ],
        },
      ],
    };
  return {
    ...base,
    parts: [
      {
        part: "",
        date: a.on,
        type: "credit",
        ref: a.ref,
        memo: `Paid from the customer's credit for ${a.order?.refNo ?? ""}`,
        dims: d,
        lines: [
          { account: credit, side: "debit", minor: a.amountMinor, currency: a.currency, rate },
          { account: acc.customer(a.partyId), side: "credit", minor: a.amountMinor, currency: a.currency, rate },
        ],
      },
    ],
  };
}

export interface FactoryPaymentDoc {
  id: string;
  ref: string;
  kind: PaymentKind;
  order: { id: string; refNo: string; customerId: string; currency: string; rate: number | null };
  factory: { id: string; name: string };
  amountMinor: Minor;
  currency: string;
  /** Units of its currency per one of the order's. */
  rate: number;
  accountId: string | null;
  paidOn: ISODate;
  voided: { on: ISODate; reason: string | null } | null;
}

/** Money out to a factory: off what we owe it on the order, out of the account, in the currency we paid in. */
export function factoryPaymentPlan(p: FactoryPaymentDoc, ctx: RuleCtx): DocPlan {
  const rate =
    p.currency === ctx.main
      ? 1
      : p.order.currency === ctx.main
        ? p.rate
        : p.order.currency === p.currency
          ? p.order.rate
          : p.order.rate === null
            ? null
            : r14(p.rate * p.order.rate);
  return {
    sourceType: "movement",
    sourceId: p.id,
    mode: "full",
    voided: p.voided,
    parts: [
      {
        part: "",
        date: p.paidOn,
        type: "money_out",
        ref: p.ref,
        memo: `${PAYMENT_KIND_LABEL[p.kind] ?? "Payment"} to ${p.factory.name} for ${p.order.refNo}`,
        dims: dims({ orderId: p.order.id, customerId: p.order.customerId, factoryId: p.factory.id }),
        lines: [
          { account: acc.factory(p.factory.id), side: "debit", minor: p.amountMinor, currency: p.currency, rate },
          { ...moneyLine(p.accountId, p.currency), side: "credit", minor: p.amountMinor, currency: p.currency, rate },
        ],
      },
    ],
  };
}

export interface ExpenseDoc {
  id: string;
  category: string;
  description: string;
  amountMinor: Minor;
  currency: string;
  /** Units of its currency per one of the main when it was spent. */
  rate: number | string;
  spentOn: ISODate;
  customerId: string | null;
  factoryId: string | null;
  paidBy: { id: string; name: string } | null;
  accountId: string | null;
  borneBy: string;
  ownMoney: boolean;
  /** A bill known before it is paid: we owe it (to `payee`) until `repaidOn`. */
  payLater: boolean;
  payee: string | null;
  repaidOn: ISODate | null;
  repaidAccountId: string | null;
  order: {
    id: string;
    refNo: string;
    customerId: string;
    currency: string;
    rate: number | null;
    cancelled: boolean;
    /** Money paid to the factories was written off when it was cancelled (order_cancellations.factory_money "loss"). */
    lossOnCancel: boolean;
    /** What each factory's lines owe on the order (to pick the currency an expense it bears counts in). */
    factoryCurrencies: Map<string, string[]>;
  } | null;
  step: string | null;
  voided: { on: ISODate; reason: string | null } | null;
}

/**
 * An expense: the cost (by kind), paid from an account (or "not on an account"), or from a person's own money
 * (we owe it back until it is repaid: a second posting on that day), or a bill known before it is paid (it
 * sits in "Bills to pay" until it is paid: a second posting on that day). Charged to the customer: they owe it too
 * (in the order's currency, as positionOf counts it). Borne by a factory: taken off what we owe it (in its
 * currency, as factoryPosition counts it). On a cancelled order neither: the order owes nothing any more. The
 * money paid to a factory and lost when the order was cancelled comes off what the factory owed us back.
 */
export function expensePlan(e: ExpenseDoc, ctx: RuleCtx): DocPlan {
  const ownRate = e.currency === ctx.main ? 1 : e.rate;
  const staff = e.ownMoney && e.paidBy ? e.paidBy : null;
  const o = e.order;
  const d = dims({ orderId: o?.id ?? null, customerId: o?.customerId ?? e.customerId, factoryId: e.factoryId, userId: staff?.id ?? null });
  const label = EXPENSE_CATEGORY_LABEL[e.category as ExpenseCategory] ?? e.category;
  const lossOnCancel = !!(
    o?.cancelled &&
    o.lossOnCancel &&
    e.factoryId &&
    !e.accountId &&
    !e.ownMoney &&
    !e.payLater &&
    e.borneBy === "us" &&
    e.step === "factory"
  );
  const bill = e.payLater && !staff;
  const from: Line = staff
    ? { account: acc.staff(staff.id), side: "credit", minor: e.amountMinor, currency: e.currency, rate: ownRate }
    : bill
      ? { account: "bills", side: "credit", minor: e.amountMinor, currency: e.currency, rate: ownRate }
      : lossOnCancel
      ? { account: acc.factory(e.factoryId!), side: "credit", minor: e.amountMinor, currency: e.currency, rate: ownRate }
      : { ...moneyLine(e.accountId, e.currency), side: "credit", minor: e.amountMinor, currency: e.currency, rate: ownRate };
  const lines: Line[] = [
    { account: acc.expense(e.category), side: "debit", minor: e.amountMinor, currency: e.currency, rate: ownRate },
    from,
  ];
  const recovered: Line = { account: "expenses_recovered", side: "credit", minor: e.amountMinor, currency: e.currency, rate: ownRate };
  let memo = `${label}: ${e.description}`;
  if (ctx.expensesOn && o && !o.cancelled && e.borneBy === "customer") {
    const m = expenseIn({ amountMinor: e.amountMinor, currency: e.currency, rate: String(e.rate) }, o.currency, o.rate);
    if (m !== null && m > 0) {
      lines.push(
        { account: acc.customer(o.customerId), side: "debit", minor: m, currency: o.currency, rate: o.rate, takesRest: true },
        recovered,
      );
      memo += " (charged to the customer)";
    }
  }
  if (ctx.expensesOn && o && !o.cancelled && e.borneBy === "factory" && e.factoryId) {
    // Its currency when the factory is owed in it, else the factory's first currency (A→Z), as factoryPosition.
    const owedIn = [...(o.factoryCurrencies.get(e.factoryId) ?? [])].sort();
    const target = owedIn.includes(e.currency) ? e.currency : owedIn[0];
    if (target) {
      const per = liveRate(ctx, target);
      const m = expenseIn({ amountMinor: e.amountMinor, currency: e.currency, rate: String(e.rate) }, target, per);
      if (m !== null && m > 0) {
        lines.push({ account: acc.factory(e.factoryId), side: "debit", minor: m, currency: target, rate: per, takesRest: true }, recovered);
        memo += " (the factory bears it)";
      }
    }
  }
  const parts: Part[] = [{ part: "", date: e.spentOn, type: "expense", ref: "", memo, dims: d, lines }];
  if (staff && e.repaidOn)
    parts.push({
      part: "repaid",
      date: e.repaidOn,
      type: "money_out",
      ref: "",
      memo: `Repaid to ${staff.name}: ${e.description}`,
      dims: d,
      lines: [
        { account: acc.staff(staff.id), side: "debit", minor: e.amountMinor, currency: e.currency, rate: ownRate },
        { ...moneyLine(e.repaidAccountId, e.currency), side: "credit", minor: e.amountMinor, currency: e.currency, rate: ownRate },
      ],
    });
  if (bill && e.repaidOn)
    parts.push({
      part: "paid",
      date: e.repaidOn,
      type: "money_out",
      ref: "",
      memo: `Paid${e.payee ? ` ${e.payee}` : ""}: ${e.description}`,
      dims: d,
      lines: [
        { account: "bills", side: "debit", minor: e.amountMinor, currency: e.currency, rate: ownRate },
        { ...moneyLine(e.repaidAccountId, e.currency), side: "credit", minor: e.amountMinor, currency: e.currency, rate: ownRate },
      ],
    });
  return {
    sourceType: "expense",
    sourceId: e.id,
    mode: "full",
    voided: e.voided,
    parts,
    allocRef: { prefix: "EX", year: Number(e.spentOn.slice(0, 4)) },
  };
}

export interface TransferDoc {
  id: string;
  from: { id: string; currency: string };
  to: { id: string; currency: string };
  outMinor: Minor;
  inMinor: Minor;
  on: ISODate;
  note: string | null;
  voided: { on: ISODate; reason: string | null } | null;
}

/** Money moved between two of our accounts; in different currencies, the difference at today's rates shows as an exchange difference. */
export function transferPlan(t: TransferDoc, ctx: RuleCtx): DocPlan {
  const toRate = liveRate(ctx, t.to.currency);
  const fromRate = liveRate(ctx, t.from.currency);
  return {
    sourceType: "movement",
    sourceId: t.id,
    mode: "full",
    voided: t.voided,
    allocRef: { prefix: "TR", year: Number(t.on.slice(0, 4)) },
    parts: [
      {
        part: "",
        date: t.on,
        type: "transfer",
        ref: "",
        memo: t.note ?? "Moved between our accounts",
        dims: NO_DIMS,
        // A currency without a Settings rate takes the other side's value (the rate the money was changed at).
        lines: [
          {
            account: acc.money(t.to.id),
            moneyAccountId: t.to.id,
            side: "debit",
            minor: t.inMinor,
            currency: t.to.currency,
            rate: toRate,
            takesRest: toRate === null && fromRate !== null,
          },
          {
            account: acc.money(t.from.id),
            moneyAccountId: t.from.id,
            side: "credit",
            minor: t.outMinor,
            currency: t.from.currency,
            rate: fromRate,
            takesRest: fromRate === null && toRate !== null,
          },
        ],
      },
    ],
  };
}

/**
 * A money account's opening balance, on its opening day. The cash book counts what moved from that day on, so
 * anything posted on the account before it is already in the opening balance: the opening line is the balance
 * less those (`beforeMinor`), and the account's ledger balance is the cash book's.
 */
export function openingPlan(
  a: { id: string; name: string; currency: string; openingMinor: Minor; openingOn: ISODate; beforeMinor: Minor },
  ctx: RuleCtx,
): DocPlan {
  const net = a.openingMinor - a.beforeMinor;
  const rate = liveRate(ctx, a.currency);
  return {
    sourceType: "account",
    sourceId: a.id,
    mode: "delta",
    voided: null,
    parts: net
      ? [
          {
            part: "",
            date: a.openingOn,
            type: "opening",
            ref: "Opening balance",
            memo: `Opening balance of ${a.name}`,
            dims: NO_DIMS,
            lines: [
              {
                account: acc.money(a.id),
                moneyAccountId: a.id,
                side: net > 0 ? "debit" : "credit",
                minor: Math.abs(net),
                currency: a.currency,
                rate,
              },
              { account: "opening", side: net > 0 ? "credit" : "debit", minor: Math.abs(net), currency: a.currency, rate },
            ],
          },
        ]
      : [],
  };
}

/**
 * The exchange difference of an order with its customer, or of a factory's part in one currency: once it is
 * settled in its own currency (the balance is 0) and its main-currency value is not, the rest is posted as an
 * exchange difference (a gain when we got more than it was worth when it was posted, a loss when less).
 */
export function fxPlan(
  source: "fx_order" | "fx_factory",
  sourceId: string,
  a: { account: string; currency: string; dims: Dims; ref: string; memo: string },
  sums: { minor: Minor; baseMinor: Minor; rows: number; lastDate: ISODate | null },
  main: string,
): DocPlan {
  const plan: DocPlan = { sourceType: source, sourceId, mode: "full", compareBase: true, voided: null, parts: [] };
  if (sums.rows < 2 || sums.minor !== 0 || sums.baseMinor === 0 || !sums.lastDate) return plan;
  const rest = sums.baseMinor;
  // The party's side (0 in its own currency) brings its main amount to 0; the difference goes to fx_diff.
  plan.parts.push({
    part: "",
    date: sums.lastDate,
    type: "fx",
    ref: a.ref,
    memo: a.memo,
    dims: a.dims,
    lines: [
      { account: a.account, side: rest > 0 ? "credit" : "debit", minor: 0, currency: a.currency, rate: null, baseMinor: Math.abs(rest) },
      { account: "fx_diff", side: rest > 0 ? "debit" : "credit", minor: Math.abs(rest), currency: main, rate: 1 },
    ],
  });
  return plan;
}
