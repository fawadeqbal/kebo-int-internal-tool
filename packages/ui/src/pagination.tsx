import Link from "next/link";
import { cn } from "./cn";
import { buttonClass } from "./primitives";

export function buildHref(base: string, params: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) next.set(k, v);
  const qs = next.toString();
  return qs ? `${base}?${qs}` : base;
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
  const link = (p: number, label: string, disabled: boolean) => (
    <Link
      href={buildHref(base, params, { page: p > 1 ? String(p) : undefined })}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : undefined}
      className={cn(buttonClass("secondary", "sm"), disabled && "pointer-events-none opacity-50")}
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
        {link(page - 1, "Previous", page <= 1)}
        {link(page + 1, "Next", page >= pages)}
      </span>
    </nav>
  );
}

export function toPage(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
