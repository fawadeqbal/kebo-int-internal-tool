/*
 * A record's title (canvas "RFQ Desk — the pieces", row "Every page's top on a phone", board "The title is a name from
 * the data, never a number"; design rule 3): what the record is about, in words, from its own data — the goods for an
 * inquiry, an order and a purchase order; who it is for or from for a quotation and an offer; what it was for a
 * payment; the name for a customer or a supplier. Its number is never the title: it goes small under it, with what
 * kind of record it is (`recordLine`), and stays in search, lists and papers. Said once here, so every page header,
 * browser tab and list names a record the same way.
 */

/** What each kind of record is called on the small line under its title ("Inquiry · RFQ-2026-0010"). */
export const RECORD_KIND = {
  inquiry: "Inquiry",
  offer: "Supplier offer",
  quotation: "Quotation",
  order: "Order",
  purchaseOrder: "Purchase order",
  customer: "Customer",
  supplier: "Supplier",
} as const;

/** "Inquiry · RFQ-2026-0010": what the record is and its number, the small line under its title. */
export const recordLine = (kind: string, number?: string | null): string => [kind, number].filter(Boolean).join(" · ");

/** An item: a part is under another item (its parent, or a number like "2.1"). */
type Item = { description?: string | null; parentId?: string | null; no?: string | null };

/** "Blister packing machine + 1 more": the first item's name and how many more items (parts are not counted). */
export function itemsTitle(items: readonly Item[] | null | undefined): string | null {
  const top = (items ?? []).filter((i) => !i.parentId && !i.no?.includes(".") && i.description?.trim());
  if (!top.length) return null;
  const first = top[0]!.description!.trim();
  return top.length > 1 ? `${first} + ${top.length - 1} more` : first;
}

const said = (s?: string | null) => s?.trim() || null;

/** Each record's title from its data; each ends in words, never in a number. */
export const RECORD_TITLE = {
  /** Its title; else its first item; else who it is from. */
  inquiry: (x: { title?: string | null; items?: readonly Item[] | null; customer?: string | null }): string =>
    said(x.title) ?? itemsTitle(x.items) ?? (x.customer ? `Inquiry from ${x.customer}` : "Inquiry"),
  /** Who it is for, and its option when the inquiry has more than one. */
  quotation: (x: { customer: string; option?: string | null }): string => `Quotation for ${x.customer}${x.option ? ` · Option ${x.option}` : ""}`,
  /** What was sold: the inquiry's title, else its first item; else who it is for. */
  order: (x: { title?: string | null; items?: readonly Item[] | null; customer?: string | null }): string =>
    said(x.title) ?? itemsTitle(x.items) ?? (x.customer ? `Order for ${x.customer}` : "Order"),
  /** What we buy; else who from. */
  purchaseOrder: (x: { items?: readonly Item[] | null; supplier: string }): string => itemsTitle(x.items) ?? `Purchase from ${x.supplier}`,
} as const;

/** A payment's title: what it was, and who it was from or to ("Deposit from Al-Shifa Pharma", "Tea gift set"). */
export const PAYMENT_TITLE = {
  /** Money a customer sent: the plan's part it pays ("Deposit"), else "Payment". */
  received: (party?: string | null, part?: string | null): string => `${part ?? "Payment"} from ${party ?? "a customer"}`,
  fromCredit: (party?: string | null, part?: string | null): string => `${part ?? "Payment"} from ${party ? `${party}'s` : "the customer's"} credit`,
  refund: (party?: string | null): string => `Refund to ${party ?? "a customer"}`,
  /** Money we paid a supplier. */
  paid: (party?: string | null, part?: string | null): string => `${part ?? "Payment"} to ${party ?? "a supplier"}`,
  /** Its own words; else its category. */
  expense: (description?: string | null, category?: string | null): string => said(description) ?? said(category) ?? "Expense",
  transfer: (from: string, to: string): string => `${from} to ${to}`,
} as const;
