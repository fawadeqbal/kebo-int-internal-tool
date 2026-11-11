import { EXPENSE_CATEGORY_LABEL } from "../labels";
import type { ExpenseCategory } from "../enums";

/**
 * The ledger (Finance › Ledger): every money record posted from its document, never typed. Saving,
 * changing, approving or removing a document writes its rows; rows are never changed or deleted (a change
 * is a correction: the old rows reversed and the new ones posted; a removal is a reversal, kept visible).
 * There is no chart of accounts to set up: the accounts are fixed and named by key.
 */

/** What posted an entry. */
export const LEDGER_ENTRY_TYPES = [
  "order",
  "purchase_order",
  "money_in",
  "money_out",
  "transfer",
  "expense",
  "credit",
  "correction",
  "opening",
  "fx",
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export const LEDGER_ENTRY_TYPE_LABEL: Record<LedgerEntryType, string> = {
  order: "Order",
  purchase_order: "Purchase order",
  money_in: "Money in",
  money_out: "Money out",
  transfer: "Transfer",
  expense: "Expense",
  credit: "Credit",
  correction: "Correction",
  opening: "Opening balance",
  fx: "Exchange difference",
};

/** The document a posting comes from. */
export const LEDGER_SOURCES = [
  "order",
  "purchase_order",
  /** Money in or out with a customer (a payment entry): into or out of an account, off their orders, the rest their credit. */
  "movement",
  /** What a payment entry pays later, from the customer's credit: an order, a fee; or its order cancelled (released). */
  "allocation",
  "factory_payment",
  "expense",
  "transfer",
  "account",
  "fx_order",
  "fx_factory",
] as const;
export type LedgerSource = (typeof LEDGER_SOURCES)[number];

/** The fixed accounts that are not one per record. */
export const LEDGER_FIXED_ACCOUNTS = ["sales", "goods_cost", "bank_charges", "fx_diff", "expenses_recovered", "opening"] as const;
export type LedgerFixedAccount = (typeof LEDGER_FIXED_ACCOUNTS)[number];

export const LEDGER_FIXED_ACCOUNT_LABEL: Record<LedgerFixedAccount, string> = {
  sales: "Sales",
  goods_cost: "Goods cost",
  bank_charges: "Bank charges",
  fx_diff: "Exchange difference",
  expenses_recovered: "Expenses recovered",
  opening: "Opening balances",
};

/** The kinds of account, as the key starts ("money:…", "customer:…"); fixed ones are their own kind. */
export type LedgerAccountKind = "money" | "customer" | "credit" | "factory" | "staff" | "expense" | LedgerFixedAccount;

/** Account keys: one per money account (or "not on an account" per currency), customer, factory, person, expense kind. */
export const ledgerAccount = {
  money: (id: string) => `money:${id}`,
  noAccount: (currency: string) => `money:none:${currency}`,
  customer: (id: string) => `customer:${id}`,
  credit: (customerId: string) => `credit:${customerId}`,
  factory: (id: string) => `factory:${id}`,
  staff: (userId: string) => `staff:${userId}`,
  expense: (category: string) => `expense:${category}`,
} as const;

/** "customer:…" → { kind: customer, id }; "sales" → { kind: sales, id: null }; "money:none:USD" → { kind: money, id: null, currency: USD }. */
export function parseLedgerAccount(key: string): { kind: LedgerAccountKind; id: string | null; currency?: string } {
  const [kind, id, rest] = key.split(":");
  if (kind === "money" && id === "none") return { kind: "money", id: null, currency: rest };
  return { kind: kind as LedgerAccountKind, id: id ?? null };
}

/** The name of an account, given the names of the records its key points at. */
export function ledgerAccountLabel(
  key: string,
  names: { money?: Map<string, string>; customer?: Map<string, string>; factory?: Map<string, string>; user?: Map<string, string> } = {},
): string {
  const a = parseLedgerAccount(key);
  switch (a.kind) {
    case "money":
      return a.id ? (names.money?.get(a.id) ?? "Money account") : `Not on an account (${a.currency})`;
    case "customer":
      return names.customer?.get(a.id ?? "") ?? "Customer";
    case "credit":
      return `Credit · ${names.customer?.get(a.id ?? "") ?? "customer"}`;
    case "factory":
      return names.factory?.get(a.id ?? "") ?? "Factory";
    case "staff":
      return `${names.user?.get(a.id ?? "") ?? "Staff"} (to repay)`;
    case "expense":
      return `Expenses · ${EXPENSE_CATEGORY_LABEL[a.id as ExpenseCategory] ?? a.id}`;
    default:
      return LEDGER_FIXED_ACCOUNT_LABEL[a.kind as LedgerFixedAccount] ?? key;
  }
}

/** The group an account is shown under in "By account". */
export const LEDGER_ACCOUNT_GROUP: Record<LedgerAccountKind, string> = {
  money: "Money",
  customer: "Customers",
  credit: "Customer credit",
  factory: "Factories",
  staff: "Staff (to repay)",
  expense: "Expenses",
  sales: "Sales",
  goods_cost: "Goods cost",
  bank_charges: "Expenses",
  fx_diff: "Exchange difference",
  expenses_recovered: "Expenses recovered",
  opening: "Opening balances",
};

/** Parties with their own ledger page. */
export const LEDGER_PARTY_KINDS = ["customer", "factory", "staff"] as const;
export type LedgerPartyKind = (typeof LEDGER_PARTY_KINDS)[number];

/** Ageing buckets: by how late an open amount is, from its plan row's due date. */
export const AGEING_BUCKETS = ["not_due", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

export const AGEING_BUCKET_LABEL: Record<AgeingBucket, string> = {
  not_due: "Not due yet",
  d1_30: "1–30 days late",
  d31_60: "31–60 days",
  d61_90: "61–90 days",
  d90_plus: "90+ days",
};

/** The bucket of an amount due on `dueOn` (null: no date yet, so not due), seen on `today`. */
export function ageingBucket(dueOn: string | null, today: string): AgeingBucket {
  if (!dueOn || dueOn >= today) return "not_due";
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueOn}T00:00:00Z`)) / 86_400_000);
  return days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "d90_plus";
}
