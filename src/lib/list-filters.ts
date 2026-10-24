/**
 * URL filters for every list, in one place. The list page and its PDF export
 * read the same parameters the same way, so the PDF always shows exactly the
 * rows (and the filter summary) the person was looking at.
 */
import { isUuid } from "@/lib/utils/ids";
import { formatDate } from "@/lib/utils/dates";
import { PRIORITY_LABEL, QUOTATION_STATUS_LABEL, SOURCE_LABEL } from "@/lib/labels";
import type { QuotationStatus } from "@/lib/db/schema";
import type { CustomerListFilters } from "@/modules/customers/repository";
import type { QuotationFilters } from "@/modules/quotations/repository";
import type { InvoiceFilters } from "@/modules/invoices/repository";
import type { parseQueryFilters } from "@/modules/queries/filters";

export type SearchParams = Record<string, string | string[] | undefined>;

/** A filter in use: shown as a removable chip, and listed on the PDF. */
export interface ActiveFilter {
  key: string;
  label: string;
  value: string;
  /** URL params to remove when the chip is removed. */
  clear: string[];
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const date = (v: string | string[] | undefined) => {
  const s = one(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
};
const range = (from?: string, to?: string) => `${from ? formatDate(from) : "…"} – ${to ? formatDate(to) : "…"}`;
const search = (v: string | string[] | undefined) => one(v)?.slice(0, 100);
type Person = { id: string; name: string };

/* ------------------------------------------------------------------ Inquiries */

export const INQUIRY_SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "required", label: "Needed-by date" },
  { value: "priority", label: "Priority" },
  { value: "updated", label: "Recently updated" },
];

export function inquiryActiveFilters(raw: ReturnType<typeof parseQueryFilters>["raw"], people: Person[], meId: string): ActiveFilter[] {
  const who = raw.assignee === "me" ? "Me" : raw.assignee === "unassigned" ? "Not assigned" : people.find((p) => p.id === raw.assignee)?.name;
  return [
    raw.assignee && { key: "assignee", label: "Handled by", value: raw.assignee === meId ? "Me" : (who ?? "Someone"), clear: ["assignee"] },
    raw.category && { key: "category", label: "Category", value: raw.category, clear: ["category"] },
    raw.source && { key: "source", label: "Via", value: SOURCE_LABEL[raw.source as keyof typeof SOURCE_LABEL], clear: ["source"] },
    raw.priority && { key: "priority", label: "Priority", value: PRIORITY_LABEL[raw.priority as keyof typeof PRIORITY_LABEL], clear: ["priority"] },
    (raw.from || raw.to) && { key: "dates", label: "Received", value: range(raw.from, raw.to), clear: ["from", "to"] },
    raw.sort && raw.sort !== "newest" && { key: "sort", label: "Sort", value: INQUIRY_SORTS.find((s) => s.value === raw.sort)?.label ?? raw.sort, clear: ["sort"] },
  ].filter(Boolean) as ActiveFilter[];
}

/* ------------------------------------------------------------------ Customers */

export const CUSTOMER_SHOW = [
  { value: "open", label: "With open inquiries" },
  { value: "unpaid", label: "With unpaid invoices" },
  { value: "none", label: "No inquiries yet" },
];
export const CUSTOMER_SORTS = [
  { value: "company", label: "Name (A–Z)" },
  { value: "recent", label: "Latest inquiry" },
];

export function parseCustomerParams(sp: SearchParams) {
  const q = search(sp.q);
  const sort: NonNullable<CustomerListFilters["sort"]> = one(sp.sort) === "recent" ? "recent" : "company";
  const hasValue = one(sp.has);
  const has = CUSTOMER_SHOW.some((s) => s.value === hasValue) ? (hasValue as CustomerListFilters["has"]) : undefined;
  const active = [
    has && { key: "has", label: "Show", value: CUSTOMER_SHOW.find((s) => s.value === has)!.label, clear: ["has"] },
    sort !== "company" && { key: "sort", label: "Sort", value: "Latest inquiry", clear: ["sort"] },
  ].filter(Boolean) as ActiveFilter[];
  return { filters: { q, sort, has }, params: { q, has, sort: sort === "company" ? undefined : sort }, active };
}

/* ------------------------------------------------------------------ Quotations */

export const QUOTATION_SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "expiry", label: "Valid-until date" },
  { value: "value", label: "Highest value" },
];
export const QUOTATION_STATUS_OPTIONS = [{ value: "expiring", label: "Waiting for the customer" }, ...Object.entries(QUOTATION_STATUS_LABEL).map(([value, label]) => ({ value, label }))];

export function parseQuotationParams(sp: SearchParams, people: Person[]) {
  const q = search(sp.q);
  const s = one(sp.status);
  const status = s && (s === "expiring" || s in QUOTATION_STATUS_LABEL) ? (s as QuotationStatus | "expiring") : undefined;
  const by = one(sp.by);
  const preparedBy = isUuid(by) ? by : undefined;
  const from = date(sp.from);
  const to = date(sp.to);
  const sortValue = one(sp.sort);
  const sort = QUOTATION_SORTS.some((x) => x.value === sortValue) && sortValue !== "newest" ? (sortValue as QuotationFilters["sort"]) : undefined;
  const active = [
    status && { key: "status", label: "Status", value: QUOTATION_STATUS_OPTIONS.find((o) => o.value === status)!.label, clear: ["status"] },
    preparedBy && { key: "by", label: "Prepared by", value: people.find((p) => p.id === preparedBy)?.name ?? "Someone", clear: ["by"] },
    (from || to) && { key: "dates", label: "Created", value: range(from, to), clear: ["from", "to"] },
    sort && { key: "sort", label: "Sort", value: QUOTATION_SORTS.find((x) => x.value === sort)!.label, clear: ["sort"] },
  ].filter(Boolean) as ActiveFilter[];
  return { filters: { q, status, preparedBy, from, to, sort }, params: { q, status, by: preparedBy, from, to, sort }, active };
}

/* ------------------------------------------------------------------ Invoices */

export const INVOICE_STATUSES: Record<NonNullable<InvoiceFilters["status"]>, string> = {
  outstanding: "Outstanding (unpaid + partial)",
  overdue: "Overdue",
  unpaid: "Unpaid",
  partially_paid: "Partially paid",
  paid: "Paid",
  cancelled: "Cancelled",
};
export const INVOICE_SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "due", label: "Payment due date" },
  { value: "balance", label: "Largest balance" },
];

export function parseInvoiceParams(sp: SearchParams) {
  const q = search(sp.q);
  const s = one(sp.status);
  const status = s && s in INVOICE_STATUSES ? (s as InvoiceFilters["status"]) : undefined;
  const from = date(sp.from);
  const to = date(sp.to);
  const sortValue = one(sp.sort);
  const sort = INVOICE_SORTS.some((x) => x.value === sortValue) && sortValue !== "newest" ? (sortValue as InvoiceFilters["sort"]) : undefined;
  const active = [
    status && { key: "status", label: "Status", value: INVOICE_STATUSES[status], clear: ["status"] },
    (from || to) && { key: "dates", label: "Issued", value: range(from, to), clear: ["from", "to"] },
    sort && { key: "sort", label: "Sort", value: INVOICE_SORTS.find((x) => x.value === sort)!.label, clear: ["sort"] },
  ].filter(Boolean) as ActiveFilter[];
  return { filters: { q, status, from, to, sort }, params: { q, status, from, to, sort }, active };
}

/* ------------------------------------------------------------------ Audit log */

export const AUDIT_TYPES = ["query", "customer", "quotation", "invoice", "packing_list", "payment", "attachment", "user", "settings", "export"];
export const auditTypeLabel = (t: string) => (t === "query" ? "Inquiry" : t === "packing_list" ? "Packing list" : t[0].toUpperCase() + t.slice(1));

export function parseAuditParams(sp: SearchParams, people: Person[]) {
  const t = one(sp.type);
  const type = t && AUDIT_TYPES.includes(t) ? t : undefined;
  const w = one(sp.who);
  const who = isUuid(w) ? w : undefined;
  const from = date(sp.from);
  const to = date(sp.to);
  const active = [
    type && { key: "type", label: "Record", value: auditTypeLabel(type), clear: ["type"] },
    who && { key: "who", label: "Person", value: people.find((p) => p.id === who)?.name ?? "Someone", clear: ["who"] },
    (from || to) && { key: "dates", label: "When", value: range(from, to), clear: ["from", "to"] },
  ].filter(Boolean) as ActiveFilter[];
  return { filters: { entityType: type, userId: who, from, to }, params: { type, who, from, to }, active };
}

/** "Status: Overdue · Issued: 01 Jan 2026 – …" for the PDF header. */
export function describeFilters(active: ActiveFilter[], q?: string) {
  const parts = [...(q ? [`Search: “${q}”`] : []), ...active.map((a) => `${a.label}: ${a.value}`)];
  return parts.length ? parts.join("  ·  ") : "No filters (all records)";
}
