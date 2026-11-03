import Link from "next/link";
import { cn } from "./cn";
import { buttonClass } from "./primitives";

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
}: {
  base: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize?: number;
  total: number;
  always?: boolean;
}) {
  if (!always && total <= pageSize && page <= 1) return null;
  return <Pagination base={base} params={params} page={page} pageSize={pageSize} total={total} />;
}

export function Pagination({
  base,
  params,
  page,
  pageSize,
  total,
}: {
  base: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const link = (p: number, label: string, disabled: boolean, variant: "ghost" | "secondary") => (
    <Link
      href={buildHref(base, params, { page: p > 1 ? String(p) : undefined })}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : undefined}
      className={cn(buttonClass(variant, "sm"), disabled && "pointer-events-none opacity-50")}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-xs text-muted">
      <span className="tabular">
        {from}–{to} of {total}
      </span>
      <span className="flex gap-2">
        {link(page - 1, "← Previous", page <= 1, "ghost")}
        {link(page + 1, "Next →", page >= pages, "secondary")}
      </span>
    </nav>
  );
}

export function toPage(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
