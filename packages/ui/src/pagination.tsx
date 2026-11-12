import Link from "next/link";
import { cn } from "./cn";

export function buildHref(base: string, params: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) next.set(k, v);
  const qs = next.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Lists show this many rows a page (the API's default page size). */
export const PAGE_SIZE = 25;

/**
 * Pages, not endless scroll: "1–25 of 38", ← Previous and Next →, the page in
 * the URL (?page=2) with the list's other filters kept. Nothing when it all
 * fits on one page, unless `always`.
 */
export function Pager({
  base,
  params,
  page,
  pageSize = PAGE_SIZE,
  total,
  always,
  bare,
}: {
  base: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize?: number;
  total: number;
  always?: boolean;
  /** Under the list's card rather than inside it (board lists): no rule, no side padding. */
  bare?: boolean;
}) {
  if (!always && total <= pageSize && page <= 1) return null;
  return <Pagination base={base} params={params} page={page} pageSize={pageSize} total={total} bare={bare} />;
}

/** The page numbers to show: the first, the last, and the two either side of this one, with gaps. */
function pageList(page: number, pages: number): (number | null)[] {
  const want = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  if (pages <= 5) for (let p = 1; p <= pages; p++) want.add(p);
  const sorted = [...want].sort((a, b) => a - b);
  return sorted.flatMap((p, i) => (i > 0 && p - sorted[i - 1]! > 1 ? [null, p] : [p]));
}

export function Pagination({
  base,
  params,
  page,
  pageSize,
  total,
  bare,
}: {
  base: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
  bare?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const box = "inline-grid h-9 min-w-9 place-items-center rounded-[10px] border px-2 text-[13px] font-medium tabular transition-colors";
  const link = (p: number, label: string, aria: string, disabled: boolean) => (
    <Link
      key={aria}
      href={buildHref(base, params, { page: p > 1 ? String(p) : undefined })}
      aria-label={aria}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : undefined}
      className={cn(box, "border-line bg-surface text-text hover:bg-surface-2", disabled && "pointer-events-none opacity-50")}
    >
      {label}
    </Link>
  );
  return (
    <nav
      aria-label="Pagination"
      className={cn("flex items-center justify-between gap-3 text-[13px] text-muted", bare ? "mt-4" : "border-t border-line px-4 py-2.5")}
    >
      <span className="tabular">
        {from}–{to} of {total}
      </span>
      <span className="flex gap-1.5">
        {link(page - 1, "‹", "Previous page", page <= 1)}
        {pageList(page, pages).map((p, i) =>
          p === null ? (
            <span key={`gap-${i}`} className="inline-grid h-9 place-items-center px-1" aria-hidden>
              …
            </span>
          ) : p === page ? (
            <span key={p} aria-current="page" className={cn(box, "border-primary-solid bg-primary-solid font-semibold text-white")}>
              {p}
            </span>
          ) : (
            link(p, String(p), `Page ${p}`, false)
          ),
        )}
        {link(page + 1, "›", "Next page", page >= pages)}
      </span>
    </nav>
  );
}

export function toPage(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
