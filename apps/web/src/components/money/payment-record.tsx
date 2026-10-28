"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@kebo/ui";

export interface RecordField {
  label: string;
  value: ReactNode;
  wide?: boolean;
}

/**
 * One payment in a list: a one-line summary that opens into the full record
 * (read only), with Change and Remove at the bottom for people who may.
 */
export function PaymentRecord({
  summary,
  sub,
  removed = false,
  fields,
  actions,
  label,
}: {
  summary: ReactNode;
  sub: ReactNode;
  removed?: boolean;
  fields: RecordField[];
  actions?: ReactNode;
  /** For screen readers: "Payment of USD 14,692.15 on 12 Oct 2026". */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className={cn("text-sm", removed && "text-muted")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${label}: ${open ? "hide" : "show"} the details`}
        className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface-2/60"
      >
        <span className="min-w-0">
          <span className="block">{summary}</span>
          <span className="block text-xs text-muted">{sub}</span>
        </span>
        <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-line bg-surface-2/40 px-3 py-3">
          <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-3">
            {fields.map((f) => (
              <div key={f.label} className={cn("min-w-0", f.wide && "sm:col-span-3")}>
                <dt className="text-xs text-muted">{f.label}</dt>
                <dd className="break-words">{f.value}</dd>
              </div>
            ))}
          </dl>
          {actions && <div className="mt-3 flex flex-wrap items-start gap-1 border-t border-line pt-3">{actions}</div>}
        </div>
      )}
    </li>
  );
}

export interface RecordColumn {
  label: string;
  align?: "right";
  /** Hidden below this screen size (the row's details still have it). */
  hideBelow?: "sm" | "md";
  /** e.g. "w-32" */
  width?: string;
}

export interface RecordRow {
  key: string;
  /** One cell per column. */
  cells: ReactNode[];
  fields: RecordField[];
  actions?: ReactNode;
  removed?: boolean;
  /** For screen readers: "Payment of USD 14,692.15 on 12 Oct 2026". */
  label: string;
}

const HIDE = { sm: "hidden sm:table-cell", md: "hidden md:table-cell" } as const;

/**
 * Payments as a table: one row each, a total row under them. A click on a row
 * opens its full record (read only) under it, with Change and Remove for
 * people who may; on a phone the less needed columns hide (the record has them).
 */
export function RecordTable({ label, columns, rows, foot }: { label: string; columns: RecordColumn[]; rows: RecordRow[]; foot?: ReactNode[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const cell = (c: RecordColumn | undefined) => cn("px-3 py-2.5 align-top", c?.align === "right" && "text-right tabular", c?.hideBelow && HIDE[c.hideBelow]);
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <table aria-label={label} data-fit="" className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-surface-2 text-left text-xs text-text-2">
            {columns.map((c) => (
              <th key={c.label} scope="col" className={cn(cell(c), "py-2 font-medium whitespace-nowrap", c.width)}>
                {c.label}
              </th>
            ))}
            <th scope="col" className="w-10 py-2">
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open === r.key;
            return [
              <tr
                key={r.key}
                onClick={() => setOpen(isOpen ? null : r.key)}
                className={cn("cursor-pointer border-t border-line hover:bg-surface-2/60", r.removed && "text-muted [&_td]:line-through", isOpen && "bg-surface-2/60")}
              >
                {r.cells.map((v, i) => (
                  <td key={i} className={cell(columns[i])}>
                    {v}
                  </td>
                ))}
                <td className="px-2 py-2 text-right align-top">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(isOpen ? null : r.key);
                    }}
                    aria-expanded={isOpen}
                    aria-label={`${r.label}: ${isOpen ? "hide" : "show"} the details`}
                    className="rounded p-1 text-muted hover:bg-surface-3 hover:text-text"
                  >
                    <ChevronDown className={cn("size-4 transition-transform", isOpen && "rotate-180")} aria-hidden />
                  </button>
                </td>
              </tr>,
              isOpen && (
                <tr key={`${r.key}-details`} className="border-t border-line bg-surface-2/40">
                  <td colSpan={columns.length + 1} className="px-3 py-3">
                    <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-3">
                      {r.fields.map((f) => (
                        <div key={f.label} className={cn("min-w-0", f.wide && "sm:col-span-3")}>
                          <dt className="text-xs text-muted">{f.label}</dt>
                          <dd className="break-words">{f.value}</dd>
                        </div>
                      ))}
                    </dl>
                    {r.actions && <div className="mt-3 flex flex-wrap items-start gap-1 border-t border-line pt-3">{r.actions}</div>}
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
        {foot && rows.length > 0 && (
          <tfoot>
            <tr className="border-t border-line bg-surface-2 font-semibold">
              {foot.map((f, i) => (
                <td key={i} className={cell(columns[i])}>
                  {f}
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
