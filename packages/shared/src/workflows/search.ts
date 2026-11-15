import { z } from "zod";
import type { Tone } from "../labels";

/**
 * Search everything (design "search everything"): one box finds customers, suppliers, inquiries,
 * quotations, orders, purchase orders and payments, each kind only as far as the person may see it,
 * and a number typed whole opens its record straight away.
 */
export const SEARCH_KINDS = ["customers", "suppliers", "inquiries", "quotations", "orders", "purchase_orders", "payments"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];
export const SEARCH_KIND_LABEL: Record<SearchKind, string> = {
  customers: "Customers",
  suppliers: "Suppliers",
  inquiries: "Inquiries",
  quotations: "Quotations",
  orders: "Orders",
  purchase_orders: "Purchase orders",
  payments: "Payments",
};

/** GET /search?q=kabul&kind=orders&limit=3 (limit 0: only how many of each kind). */
export const searchQuery = z.object({
  q: z.string().trim().max(100).default(""),
  kind: z.enum(SEARCH_KINDS).optional(),
  limit: z.coerce.number().int().min(0).max(50).default(3),
});
export type SearchQuery = z.infer<typeof searchQuery>;

/** One thing found: what it is, a line about it, where it stands, and its page. */
export interface SearchItem {
  kind: SearchKind;
  id: string;
  title: string;
  sub: string;
  badge: { label: string; tone: Tone } | null;
  href: string;
}

export interface SearchResult {
  q: string;
  /** A number typed whole (RFQ-2026-0583, SO-2026-0004, PR-2026-0004-2…): the record it opens. */
  exact: { kind: SearchKind; label: string; href: string } | null;
  /** Kinds in order, each with how many were found and the first of them. */
  groups: { kind: SearchKind; total: number; items: SearchItem[] }[];
}
