import { Building2, ClipboardList, Factory, FileText, Package, ShoppingCart, Wallet, type LucideIcon } from "lucide-react";
import { SEARCH_KIND_LABEL, type SearchKind } from "@kebo/shared";

/** Each kind's icon, the same in the top bar's list, on a phone and on Search. */
export const SEARCH_ICON: Record<SearchKind, LucideIcon> = {
  customers: Building2,
  suppliers: Factory,
  inquiries: ClipboardList,
  quotations: FileText,
  orders: Package,
  purchase_orders: ShoppingCart,
  payments: Wallet,
};

const KIND_ONE: Record<SearchKind, string> = {
  customers: "customer",
  suppliers: "supplier",
  inquiries: "inquiry",
  quotations: "quotation",
  orders: "order",
  purchase_orders: "purchase order",
  payments: "payment",
};
/** "Order", "Purchase order": what one record of a kind is. */
export const kindOne = (kind: SearchKind) => KIND_ONE[kind].charAt(0).toUpperCase() + KIND_ONE[kind].slice(1);
/** "1 customer", "4 inquiries": a kind with its count. */
export const kindCount = (kind: SearchKind, n: number) => `${n} ${n === 1 ? KIND_ONE[kind] : SEARCH_KIND_LABEL[kind].toLowerCase()}`;

/** Search's address for some words, and a kind. */
export const searchHref = (q: string, kind?: SearchKind) => `/search?${new URLSearchParams({ q, ...(kind ? { kind } : {}) })}`;

/** The words found, marked in a line. */
export function Marked({ text, q }: { text: string; q: string }) {
  const t = q.trim();
  if (t.length < 2) return <>{text}</>;
  const parts = text.split(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <mark key={i} className="rounded-[3px] bg-[#fff2c2] px-px text-inherit dark:bg-[#5c4a12]">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}
