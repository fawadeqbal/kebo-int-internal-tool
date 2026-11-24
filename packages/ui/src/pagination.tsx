import Link from "next/link";
import { cn } from "./cn";
import { Pending } from "./pending";

export function buildHref(base: string, params: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) next.set(k, v);
  const qs = next.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Lists show this many rows a page (the API's default page size). */
export const PAGE_SIZE = 25;
/** The page sizes one can choose (?size=); the API never sends more than the last. */
export const PAGE_SIZES = [10, 25, 50, 100] as const;

/** The page size the address asks for (?size=50), else the list's own. */
export function toPageSize(value: string | undefined, fallback: number = PAGE_SIZE): number {
  const n = Number(value);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : fallback;
}

/**
 * Pager — one way through a long list (canvas "Pager", 21 Nov). The list asks the server for one page; this goes
 * under it: "26–50 of 204", the pages (the first, the last, two either side), and how many a page (?size=). The page
 * is in the address (?page=2) with the list's other filters kept, so Back and a shared link land on it; the page asked
 * for spins while it comes. On a phone: "Show 25 more" (the next ones under those shown, the place kept) until 100,
 * then ‹ n / N ›. `compact` (a record's tab): 10 a page, ‹ › only. Nothing when it all fits, unless `always`.
 */
export function Pager({
  base,
  params,
  page,
  pageSize = PAGE_SIZE,
  total,
  always,
  bare,
  compact,
}: {
  base: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize?: number;
  total: number;
  always?: boolean;
  /** Under the list's card rather than inside it (board lists): no rule, no side padding. */
  bare?: boolean;
  /** Inside a record's tab: ‹ › only, no sizes. */
  compact?: boolean;
}) {
  if (!always && total <= pageSize && page <= 1) return null;
  return <Pagination base={base} params={params} page={page} pageSize={pageSize} total={total} bare={bare} compact={compact} />;
}

/** The page numbers to show: the first, the last, and the two either side of this one, with gaps. */
function pageList(page: number, pages: number): (number | null)[] {
  const want = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  if (pages <= 5) for (let p = 1; p <= pages; p++) want.add(p);
  const sorted = [...want].sort((a, b) => a - b);
  return sorted.flatMap((p, i) => (i > 0 && p - sorted[i - 1]! > 1 ? [null, p] : [p]));
}

/** The pager's row (Pager draws it; not used on its own). */
function Pagination({
  base,
  params,
  page,
  pageSize,
  total,
  bare,
  compact,
}: {
  base: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
  bare?: boolean;
  compact?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const keep = { ...params, page: undefined, size: undefined };
  const sized = pageSize !== PAGE_SIZE && !compact ? String(pageSize) : undefined;
  const href = (patch: Record<string, string | undefined>) => buildHref(base, keep, { size: sized, ...patch });
  const box = "inline-grid h-9 min-w-9 place-items-center rounded-[10px] border px-2 text-md font-medium tabular transition-colors";
  const link = (p: number, label: string, aria: string, disabled: boolean, extra?: string) => (
    <Link
      key={aria}
      href={href({ page: p > 1 ? String(p) : undefined })}
      aria-label={aria}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : undefined}
      className={cn(box, "relative border-line bg-surface text-text hover:bg-surface-2", disabled && "pointer-events-none opacity-50", extra)}
    >
      {label}
      <span className="pointer-events-none absolute -top-1 -right-1 empty:hidden">
        <Pending />
      </span>
    </Link>
  );
  // A phone, on the first page and under 100 a page: the next ones come under these.
  const more = !compact && page === 1 && pageSize < 100 && to < total;
  const next = Math.min(100, pageSize + PAGE_SIZE);
  return (
    <nav
      aria-label="Pagination"
      className={cn("flex flex-wrap items-center justify-between gap-3 text-md text-muted", bare ? "mt-4" : "border-t border-line px-4 py-2.5")}
    >
      {more && (
        <Link
          href={href({ size: String(next) })}
          scroll={false}
          className="relative grid h-11 w-full place-items-center rounded-xl border border-line bg-surface font-semibold text-text active:bg-surface-2 sm:hidden"
        >
          Show {Math.min(next - pageSize, total - to)} more
          <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 empty:hidden">
            <Pending />
          </span>
        </Link>
      )}
      {/* Past the last page (an old link, a list that shrank): said, with the way to the last one (review 24 Nov:
          "24951–599 of 599" over an empty table). */}
      {page > pages ? (
        <span className={cn(more && "max-sm:w-full max-sm:text-center")}>
          Page {page} is past the end ({total}).{" "}
          <Link href={href({ page: pages > 1 ? String(pages) : undefined })} className="font-semibold text-primary underline underline-offset-2">
            Go to page {pages}
          </Link>
        </span>
      ) : (
        <span className={cn("tabular", more && "max-sm:w-full max-sm:text-center")}>
          <b className="font-semibold text-text">
            {from}–{to}
          </b>{" "}
          of {total}
        </span>
      )}
      <span className={cn("flex gap-1.5", more && "max-sm:hidden")}>
        {link(page - 1, "‹", "Previous page", page <= 1)}
        {!compact &&
          pageList(page, pages).map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} className="inline-grid h-9 place-items-center px-1 max-sm:hidden" aria-hidden>
                …
              </span>
            ) : p === page ? (
              <span key={p} aria-current="page" className={cn(box, "border-primary-solid bg-primary-solid font-semibold text-primary-fg")}>
                {p}
              </span>
            ) : (
              // On a phone only ‹ this page ›: every number would not fit on a small screen.
              link(p, String(p), `Page ${p}`, false, "max-sm:hidden")
            ),
          )}
        {link(page + 1, "›", "Next page", page >= pages)}
      </span>
      {!compact && total > PAGE_SIZES[0] && (
        // How many a page: a laptop's choice (a phone grows the page with Show more).
        <span className="flex items-center gap-1 max-sm:hidden" aria-label="Rows a page">
          {PAGE_SIZES.map((n) =>
            n === pageSize ? (
              <span key={n} aria-current="true" className="rounded-md bg-surface-2 px-2 py-1 font-semibold text-text tabular">
                {n}
              </span>
            ) : (
              <Link key={n} href={buildHref(base, keep, { size: n === PAGE_SIZE ? undefined : String(n) })} className="rounded-md px-2 py-1 tabular hover:bg-surface-2 hover:text-text">
                {n}
              </Link>
            ),
          )}
          <span className="ml-1">a page</span>
        </span>
      )}
    </nav>
  );
}

export function toPage(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
