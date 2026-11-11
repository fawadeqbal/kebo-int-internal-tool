import type { AgeingBucket, LedgerPartyKind, PaperDoc } from "@kebo/shared";

/** Who a ledger row is with. */
export interface LedgerWith {
  kind: LedgerPartyKind;
  id: string;
  name: string;
}

/** One ledger row (GET /ledger/entries, /ledger/entries/:id, /ledger/parties/…). */
export interface LedgerRow {
  id: string;
  entryNo: number;
  groupId: string;
  date: string;
  postedAt: string;
  type: string;
  typeLabel: string;
  source: { type: string; id: string };
  ref: string;
  account: string;
  accountLabel: string;
  debit: string;
  credit: string;
  currency: string;
  rate: number | null;
  debitBase: string;
  creditBase: string;
  with: LedgerWith | null;
  order: { id: string; refNo: string } | null;
  memo: string;
  reason: string | null;
  reversesId: string | null;
  correction: boolean;
}

export interface LedgerListRow extends LedgerRow {
  side: "debit" | "credit";
  counter: { account: string; label: string } | null;
  /** Reversed (removed or changed): the day and why. */
  removed: { on: string | null; reason: string | null } | null;
}

export interface LedgerEntries {
  mainCurrency: string;
  rows: LedgerListRow[];
  total: number;
  page: number;
  pageSize: number;
  totals: { debit: string; credit: string; balanced: boolean; entries: number };
  byCurrency: { currency: string; debit: string; credit: string }[];
}

export interface LedgerEntry {
  groupId: string;
  entryNo: number;
  date: string;
  postedAt: string;
  type: string;
  typeLabel: string;
  ref: string;
  memo: string;
  reason: string | null;
  postedBy: { id: string; name: string } | null;
  rows: LedgerRow[];
  totals: { debit: string; credit: string };
  reversedBy: { groupId: string; entryNo: number; date: string; reason: string | null }[];
  reverses: { groupId: string; entryNo: number; date: string } | null;
  related: { groupId: string; entryNo: number; date: string; type: string; reason: string | null }[];
  source: {
    type: string;
    id: string;
    orderId: string | null;
    customerId: string | null;
    factoryId: string | null;
    userId: string | null;
    label: string;
    /** The payment on an order it is (its receipt prints from it). */
    partId?: string | null;
    /** Its proof or receipt, opened at /files/<id>. */
    file: { id: string; name: string } | null;
    recordedBy: string | null;
    approvedBy: string | null;
    settles: string | null;
    removed: { at: string; reason: string | null } | null;
  };
}

export interface AgeingItem {
  orderId: string | null;
  refNo: string | null;
  label: string;
  dueOn: string | null;
  currency: string;
  amount: string;
  base: string;
}

export interface AgeingBucketView {
  bucket: AgeingBucket;
  label: string;
  base: string;
  items: AgeingItem[];
}

export interface LedgerParty {
  party: { kind: LedgerPartyKind; id: string; name: string; country: string | null };
  account: string;
  from: string;
  to: string;
  mainCurrency: string;
  sign: string;
  currencies: { currency: string; opening: string; closing: string }[];
  opening: { base: string };
  closing: { base: string };
  totals: { debit: string; credit: string; debitBase: string; creditBase: string };
  rows: (LedgerRow & { balance: string; balanceBase: string; removed: boolean })[];
  credit: { currency: string; amount: string }[];
  ageing: { total: string; buckets: AgeingBucketView[] };
}

export interface LedgerAgeing {
  side: "receivable" | "payable" | "staff";
  today: string;
  mainCurrency: string;
  buckets: { bucket: AgeingBucket; label: string; base: string }[];
  total: string;
  rows: {
    party: { kind: LedgerPartyKind; id: string; name: string };
    total: string;
    buckets: Record<AgeingBucket, string>;
    byCurrency: { currency: string; amount: string }[];
  }[];
}

export interface LedgerAccounts {
  mainCurrency: string;
  groups: {
    group: string;
    base: string;
    accounts: {
      account: string;
      label: string;
      kind: string;
      id: string | null;
      balances: { currency: string; balance: string }[];
      base: string;
      rows: number;
    }[];
  }[];
  totals: { debit: string; credit: string; balanced: boolean };
  check: { checkedAt: string | null; differences: number } | null;
}

/** A statement of account as a paper (KeboDoc). */
export interface LedgerStatement {
  doc: Omit<PaperDoc, "kind"> & { kind: "statement" };
  party: { kind: LedgerPartyKind; id: string; name: string };
  from: string;
  to: string;
  currency: string;
  currencies: string[];
  issued: boolean;
  share: { fileName: string; message: string };
}
