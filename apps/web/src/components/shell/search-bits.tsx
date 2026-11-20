import { Building2, ClipboardList, Factory, FileText, Package, ShoppingCart, Wallet, type LucideIcon } from "lucide-react";
import { SEARCH_KIND_LABEL, type SearchKind } from "@kebo/shared";
import { cn, RefCode } from "@kebo/ui";

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
          <mark key={i} className="rounded-[3px] bg-warn-soft px-px text-inherit">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}

/**
 * One thing found, in words first (the top bar's list, a phone's search, the Search page alike): what it is — its
 * title or name, bold, on up to two lines — then under it its number as the number pill, and who and when. The
 * number is there to be recognised and searched by, never ahead of the words (phone 21 Nov: "RFQ-2026-0013 ·
 * Centrifugal w…" left no room for what the inquiry was).
 */
export function ResultText({ title, refNo, sub, q, size = "md" }: { title: string; refNo?: string | null; sub: string; q: string; size?: "md" | "lg" }) {
  return (
    <span className="min-w-0 flex-1">
      <span className={cn("line-clamp-2 font-semibold text-text", size === "lg" ? "text-lead" : "text-md")}>
        <Marked text={title} q={q} />
      </span>
      {(refNo || sub) && (
        <span className={cn("mt-0.5 flex min-w-0 items-center gap-1.5 text-text-2", size === "lg" ? "text-md" : "text-xs")}>
          {refNo && (
            <RefCode className="shrink-0 py-0 text-2xs">
              <Marked text={refNo} q={q} />
            </RefCode>
          )}
          {sub && (
            <span className="min-w-0 truncate">
              <Marked text={sub} q={q} />
            </span>
          )}
        </span>
      )}
    </span>
  );
}
