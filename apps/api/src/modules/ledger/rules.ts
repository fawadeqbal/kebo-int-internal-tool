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

export interface PaymentDoc {
  id: string;
  ref: string;
  kind: PaymentKind;
  order: { id: string; refNo: string; customerId: string; currency: string; rate: number | null };
  amountMinor: Minor;
  bankChargesMinor: Minor;
  currency: string;
  receivedMinor: Minor;
  receivedCurrency: string;
  rate: number;
  accountId: string | null;
  paidOn: ISODate;
  method: string;
  /** Part of one transfer over several orders: the transfer posts it. */
  inReceipt: boolean;
  voided: { on: ISODate; reason: string | null } | null;
}

/**
 * Money in on one order: into the account (what arrived, in its currency), the bank charges the customer paid on
 * the way, and off what the customer owes (amount + bank charges, in the order's currency). Paid from the
 * customer's credit: off their credit instead of into an account.
 */
export function paymentPlan(p: PaymentDoc, ctx: RuleCtx): DocPlan {
  const d = dims({ orderId: p.order.id, customerId: p.order.customerId });
  const base = { sourceType: "payment" as const, sourceId: p.id, mode: "full" as const, voided: p.voided };
  if (p.inReceipt) return { ...base, voided: null, parts: [] };
  const counted = p.amountMinor + p.bankChargesMinor;
  const customer: Line = { account: acc.customer(p.order.customerId), side: "credit", minor: counted, currency: p.currency, rate: null };
  if (p.method === "credit") {
    const rate = p.order.rate;
    return {
      ...base,
      parts: [
        {
          part: "",
          date: p.paidOn,
          type: "credit",
          ref: p.ref,
          memo: `Paid from the customer's credit for ${p.order.refNo}`,
          dims: d,
          lines: [
            { account: acc.credit(p.order.customerId), side: "debit", minor: p.amountMinor, currency: p.currency, rate },
            { ...customer, rate },
          ],
        },
      ],
    };
  }
  const rates = pairRates(ctx.main, p.receivedCurrency, p.currency, p.rate, p.order.rate);
  const lines: Line[] = [
    {
      ...moneyLine(p.accountId, p.receivedCurrency),
      side: "debit",
      minor: p.receivedMinor,
      currency: p.receivedCurrency,
      rate: rates.arrived,
    },
  ];
  if (p.bankChargesMinor > 0)
    lines.push({ account: "bank_charges", side: "debit", minor: p.bankChargesMinor, currency: p.currency, rate: rates.counted });
  lines.push({ ...customer, rate: rates.counted, takesRest: p.receivedCurrency === ctx.main || p.currency === ctx.main });
  return {
    ...base,
    parts: [
      {
        part: "",
        date: p.paidOn,
        type: "money_in",
        ref: p.ref,
        memo: `${PAYMENT_KIND_LABEL[p.kind] ?? "Payment"} for ${p.order.refNo}${p.bankChargesMinor ? " (with bank charges)" : ""}`,
        dims: d,
        lines,
      },
    ],
  };
}

export interface ReceiptDoc {
  id: string;
  ref: string;
  customerId: string;
  receivedMinor: Minor;
  receivedCurrency: string;
  currency: string;
  rate: number;
  accountId: string | null;
  paidOn: ISODate;
  /** The orders' own rate (the first order's), for the credit and the orders' lines. */
  orderRate: number | null;
  payments: { orderId: string; refNo: string; amountMinor: Minor; bankChargesMinor: Minor; voided: boolean }[];
  credits: { amountMinor: Minor; voided: boolean }[];
  voided: { on: ISODate; reason: string | null } | null;
}

/** One transfer from a customer over several orders: into the account once, off each order, the rest to their credit. */
export function receiptPlan(r: ReceiptDoc, ctx: RuleCtx): DocPlan {
  const rates = pairRates(ctx.main, r.receivedCurrency, r.currency, r.rate, r.orderRate ?? liveRate(ctx, r.currency));
  // A removed transfer: its payments and credit were removed with it, so the posting is as it stood.
  const removed = !!r.voided;
  const payments = r.payments.filter((p) => removed || !p.voided);
  const credits = r.credits.filter((c) => removed || !c.voided);
  const lines: Line[] = [
    {
      ...moneyLine(r.accountId, r.receivedCurrency),
      side: "debit",
      minor: r.receivedMinor,
      currency: r.receivedCurrency,
      rate: rates.arrived,
    },
  ];
  for (const p of payments) {
    if (p.bankChargesMinor > 0)
      lines.push({
        account: "bank_charges",
        side: "debit",
        minor: p.bankChargesMinor,
        currency: r.currency,
        rate: rates.counted,
        orderId: p.orderId,
      });
    lines.push({
      account: acc.customer(r.customerId),
      side: "credit",
      minor: p.amountMinor + p.bankChargesMinor,
      currency: r.currency,
      rate: rates.counted,
      orderId: p.orderId,
    });
  }
  const creditMinor = credits.reduce((t, c) => t + c.amountMinor, 0);
  if (creditMinor > 0)
    lines.push({ account: acc.credit(r.customerId), side: "credit", minor: creditMinor, currency: r.currency, rate: rates.counted });
  const refs = [...new Set(payments.map((p) => p.refNo))];
  return {
    sourceType: "receipt",
    sourceId: r.id,
    mode: "full",
    voided: r.voided,
    parts: [
      {
        part: "",
        date: r.paidOn,
        type: "money_in",
        ref: r.ref,
        memo: refs.length
          ? `One transfer for ${refs.join(", ")}${creditMinor ? ", the rest to credit" : ""}`
          : "Money in, kept as the customer's credit",
        dims: dims({ customerId: r.customerId, orderId: refs.length === 1 ? payments[0]!.orderId : null }),
        lines,
      },
    ],
  };
}

export interface CreditDoc {
  id: string;
  kind: string;
  customerId: string;
  amountMinor: Minor;
  currency: string;
  order: { id: string; refNo: string; rate: number | null; currency: string } | null;
  accountId: string | null;
  on: ISODate;
  note: string | null;
  /** Posted by its transfer (credit left over) or its payment (credit used). */
  postedElsewhere: boolean;
  voided: { on: ISODate; reason: string | null } | null;
}

/**
 * The customer's credit outside a transfer or a payment: kept from a cancelled order (off what they owed on it,
 * onto their credit), refunded (off their credit, out of an account), or kept as a cancellation fee (income).
 */
export function creditPlan(c: CreditDoc, ctx: RuleCtx): DocPlan {
  const base = {
    sourceType: "credit" as const,
    sourceId: c.id,
    mode: "full" as const,
    voided: c.voided,
    allocRef: { prefix: "CR", year: Number(c.on.slice(0, 4)) },
  };
  if (c.postedElsewhere || !["in", "refund", "fee"].includes(c.kind)) return { ...base, voided: null, parts: [] };
  const rate = c.order && c.order.currency === c.currency ? c.order.rate : liveRate(ctx, c.currency);
  const d = dims({ customerId: c.customerId, orderId: c.order?.id ?? null });
  const customer: Line = { account: acc.customer(c.customerId), side: "debit", minor: c.amountMinor, currency: c.currency, rate };
  const part = (type: LedgerEntryType, memo: string, lines: Line[]): Part => ({
    part: "",
    date: c.on,
    type,
    ref: "",
    memo,
    dims: d,
    lines,
  });
  if (c.kind === "in")
    return {
      ...base,
      parts: [
        part("credit", c.order ? `Kept from cancelled ${c.order.refNo} as credit` : (c.note ?? "Credit"), [
          customer,
          { account: acc.credit(c.customerId), side: "credit", minor: c.amountMinor, currency: c.currency, rate },
        ]),
      ],
    };
  if (c.kind === "fee")
    return {
      ...base,
      parts: [
        part("credit", c.order ? `Cancellation fee kept on ${c.order.refNo}` : "Cancellation fee kept", [
          customer,
          { account: "sales", side: "credit", minor: c.amountMinor, currency: c.currency, rate },
        ]),
      ],
    };
  return {
    ...base,
    parts: [
      part("money_out", c.note ?? "Credit refunded", [
        { account: acc.credit(c.customerId), side: "debit", minor: c.amountMinor, currency: c.currency, rate },
        { ...moneyLine(c.accountId, c.currency), side: "credit", minor: c.amountMinor, currency: c.currency, rate },
      ]),
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
    sourceType: "factory_payment",
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
  repaidOn: ISODate | null;
  repaidAccountId: string | null;
  order: {
    id: string;
    refNo: string;
    customerId: string;
    currency: string;
    rate: number | null;
    cancelled: boolean;
    /** Money paid to the factories was written off when it was cancelled (cancelFactoryMoney "loss"). */
    lossOnCancel: boolean;
    /** What each factory's lines owe on the order (to pick the currency an expense it bears counts in). */
    factoryCurrencies: Map<string, string[]>;
  } | null;
  step: string | null;
  voided: { on: ISODate; reason: string | null } | null;
}

/**
 * An expense: the cost (by kind), paid from an account (or "not on an account"), or from a person's own money
 * (we owe it back until it is repaid: a second posting on that day). Charged to the customer: they owe it too
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
    e.borneBy === "us" &&
    e.step === "factory"
  );
  const from: Line = staff
    ? { account: acc.staff(staff.id), side: "credit", minor: e.amountMinor, currency: e.currency, rate: ownRate }
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
    sourceType: "transfer",
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
