"use client";

import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { Button, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { ThrowAwayConfirm, useBackGuard, useFocusTrap, useMounted } from "@/components/common/dialog";
import { lockScroll } from "@/lib/scroll-lock";
import type { LineColumn, LineRow, LineValues } from "./line-table";

/**
 * Lines on a phone (design "Lines on the phone", 16 Nov 2026): the sheet becomes a list, one line per row
 * (its number, its name, a grey line with the rest, a mark for what it still needs), and a line is typed
 * or changed in a window of its own, one line at a time (Prev / Next, Save & next, Add & next). The same
 * onAdd / onEdit / onMove / onRemove as the sheet, so every lines screen gets it at once.
 */

/** The units offered first as one-tap choices (any other can be typed). */
const QUICK_UNITS = ["pcs", "sets", "set", "units", "kg", "m", "lot"];

/** A line's price columns: an empty or 0 price is something the line still needs. */
const PRICE_KEYS = new Set(["unitPrice", "factoryPrice"]);
const isZero = (raw: string) => raw === "" || Number(raw.replace(/,/g, "")) === 0;

/** What a line still needs ("No qty", "No price"), or null when it has what it must have. */
export function lineNeeds(values: LineValues, columns: LineColumn[]): string | null {
  const c = columns.find((x) => x.required && !(values[x.key] ?? "").trim());
  if (c) return `No ${c.label.toLowerCase()}`;
  return columns.some((x) => x.input && PRICE_KEYS.has(x.key) && isZero((values[x.key] ?? "").trim())) ? "No price" : null;
}

/**
 * The grey line under a line's name: the quantity and unit, the model, the prices and totals, then the
 * rest (what it answers, another spec of…) by name. Empty values and 0 are left out.
 */
export function lineSummary(row: LineRow, columns: LineColumn[], values: LineValues): ReactNode[] {
  // The quantity first, then the price (what a line is for), the model, the totals, then the rest.
  const rank = (c: LineColumn) => (c.key === "quantity" ? 0 : c.input === "number" ? 1 : c.key === "model" ? 2 : !c.input ? 3 : 4);
  const out: ReactNode[] = [];
  for (const c of [...columns.slice(1)].sort((a, b) => rank(a) - rank(b))) {
    if (c.key === "unit") continue;
    const raw = (values[c.key] ?? "").trim();
    if (c.key === "quantity") {
      if (raw) out.push(`${raw} ${values.unit ?? ""}`.trim());
      continue;
    }
    if (c.input && (!raw || (c.input === "number" && isZero(raw)))) continue;
    const shown = c.format ? c.format(values, row) : c.options ? (c.options.find((o) => o.value === raw)?.label ?? raw) : raw;
    if (shown === null || shown === undefined || shown === "" || shown === "—") continue;
    out.push(
      c.key === "model" ? (
        shown
      ) : (
        <>
          {c.label} {shown}
        </>
      ),
    );
  }
  return out;
}

/** One line in the phone list: tap it to open it; ⋯ for what can be done to it. */
export function PhoneLineRow({
  no,
  kind,
  name,
  summary,
  needs,
  parts,
  badge,
  part,
  busy,
  onOpen,
  menu,
}: {
  no: string;
  /** "Item", "Line" or "Part": read before the number. */
  kind: string;
  name: string;
  summary: ReactNode[];
  needs: string | null;
  parts: number;
  badge?: ReactNode;
  part: boolean;
  busy: boolean;
  /** Opens it (none: shown only). */
  onOpen?: () => void;
  menu?: ReactNode;
}) {
  const body = (
    <>
      <span className="w-8 shrink-0 pt-0.5 text-[13px] font-semibold text-text-2 tabular">
        <span className="sr-only">{kind} </span>
        {no}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("truncate text-[15px] leading-snug", part ? "font-medium" : "font-semibold")}>{name || <span className="text-muted">No description yet</span>}</span>
        {summary.length > 0 && (
          <span className="line-clamp-2 text-[13px] text-text-2 [overflow-wrap:anywhere]">
            {summary.map((s, n) => (
              <Fragment key={n}>
                {n > 0 && " · "}
                {s}
              </Fragment>
            ))}
          </span>
        )}
        {(needs || parts > 0 || badge) && (
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {needs && <span className="rounded-md bg-warn-soft px-1.5 py-0.5 text-xs font-semibold text-warn">{needs}</span>}
            {parts > 0 && (
              <span className="text-xs font-semibold text-primary">
                {parts} part{parts === 1 ? "" : "s"}
              </span>
            )}
            {badge}
          </span>
        )}
      </span>
      {busy && <Loader2 className="mt-1 size-4 shrink-0 animate-spin text-muted" aria-label="Saving" />}
    </>
  );
  return (
    <li className={cn("flex items-stretch border-b border-line last:border-b-0", part && "bg-surface-2/50 pl-5")}>
      {onOpen ? (
        <button type="button" onClick={onOpen} className="flex min-h-16 min-w-0 flex-1 items-start gap-2 px-3 py-2.5 text-left active:bg-surface-2">
          {body}
        </button>
      ) : (
        <div className="flex min-h-16 min-w-0 flex-1 items-start gap-2 px-3 py-2.5">{body}</div>
      )}
      {menu}
    </li>
  );
}

/** One field of the line window, as big as a thumb needs (16 px text: a phone does not zoom in). */
function LineField({ c, id, value, set, error }: { c: LineColumn; id: string; value: string; set: (v: string) => void; error?: string }) {
  const big = "h-12 text-base";
  if (c.input === "unit") {
    const quick = [...new Set([value, ...QUICK_UNITS].filter(Boolean))];
    return (
      <Field label={c.label} htmlFor={id} required={!!c.required} error={error}>
        <span className="flex flex-col gap-2">
          <span role="group" aria-label={`${c.label}: quick choices`} className="flex flex-wrap gap-1.5">
            {quick.map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={value === u}
                onClick={() => set(u)}
                className="h-10 min-w-12 rounded-full border border-line bg-surface px-3.5 text-sm aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:font-semibold aria-pressed:text-primary"
              >
                {u}
              </button>
            ))}
          </span>
          <Input id={id} value={value} onChange={(e) => set(e.target.value)} maxLength={c.maxLength ?? 20} placeholder="Or type another unit" className={big} />
        </span>
      </Field>
    );
  }
  return (
    <Field label={c.label} htmlFor={id} required={!!c.required} error={error}>
      {c.input === "textarea" ? (
        <Textarea id={id} rows={3} value={value} onChange={(e) => set(e.target.value)} maxLength={c.maxLength ?? 2000} placeholder={c.placeholder} className="text-base" />
      ) : c.input === "select" ? (
        <Select id={id} value={value} onChange={(e) => set(e.target.value)} className={big}>
          {!c.options?.some((o) => o.value === "") && <option value="">—</option>}
          {c.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          id={id}
          value={value}
          onChange={(e) => set(e.target.value)}
          inputMode={c.input === "number" ? "decimal" : undefined}
          maxLength={c.maxLength}
          placeholder={c.placeholder}
          className={cn(big, c.input === "number" && "tabular")}
        />
      )}
    </Field>
  );
}

export type LineWindowThen = "close" | "next" | "prev";

/**
 * One line at a time, over the whole screen (a phone): its fields stacked, ‹ › to the line before or after,
 * Save & next (a saved line) or Add & next (a new one). ← (or the phone's Back) closes it, asking first when
 * something typed was not saved.
 */
export function LineWindow({
  title,
  sub,
  progress,
  columns,
  start,
  row,
  isNew,
  resetKey,
  hasPrev,
  hasNext,
  busy,
  added,
  problem,
  reason,
  onSave,
  onClose,
}: {
  title: string;
  sub?: string;
  /** How far through the lines (0–1): a thin bar under the title. */
  progress?: number;
  columns: LineColumn[];
  /** The values it starts from (a saved line's; a new line's starting values). */
  start: LineValues;
  /** The saved line (its computed values, such as the total, are shown under the fields). */
  row: LineRow | null;
  isNew: boolean;
  /** Changes when another line (or a fresh new one) is shown: the fields start again. */
  resetKey: string;
  hasPrev: boolean;
  hasNext: boolean;
  busy: boolean;
  /** "Added Tablet press": the line before was added (Add & next). */
  added?: string;
  /** What went wrong with the last save. */
  problem?: ReactNode;
  /** "Why?", when the change needs a reason. */
  reason?: ReactNode;
  /** Save (or add) and then close, or go on. A saved line that did not change just moves. */
  onSave: (values: LineValues, then: LineWindowThen) => void;
  onClose: () => void;
}) {
  const id = useId();
  const mounted = useMounted();
  const box = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const [v, setV] = useState<LineValues>(start);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState(false);
  const [seen, setSeen] = useState(resetKey);
  if (seen !== resetKey) {
    setSeen(resetKey);
    setV(start);
    setErrors({});
  }
  const inputs = columns.filter((c) => c.input);
  const computed = columns.filter((c) => !c.input && c.format);
  const changed = inputs.some((c) => (v[c.key] ?? "") !== (start[c.key] ?? ""));

  useFocusTrap(box, mounted);
  useEffect(() => lockScroll(), []);
  // A new line: the cursor in its first box; a saved one: on its title (no keyboard popping up).
  useEffect(() => {
    if (!mounted) return;
    if (isNew) document.getElementById(`${id}-${inputs[0]?.key}`)?.focus();
    else head.current?.focus({ preventScroll: true });
  }, [mounted, resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    if (busy) return;
    if (changed) setAsking(true);
    else onClose();
  };
  useBackGuard(close, () => !busy);

  const save = (then: LineWindowThen) => {
    if (busy) return;
    if (!changed) {
      if (isNew && then === "next") {
        // Nothing typed yet: say what to fill in.
        const first = inputs.find((c) => c.required) ?? inputs[0];
        if (first) setErrors({ [first.key]: first.required ?? "Type something first" });
        return;
      }
      return onSave(v, then);
    }
    const missing = Object.fromEntries(inputs.filter((c) => c.required && !(v[c.key] ?? "").trim()).map((c) => [c.key, c.required!]));
    setErrors(missing);
    if (Object.keys(missing).length) {
      document.getElementById(`${id}-${Object.keys(missing)[0]}`)?.focus();
      return;
    }
    onSave(v, then);
  };

  if (!mounted) return null;
  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      data-layer
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        close();
      }}
      className="fixed inset-0 z-[100] flex animate-in flex-col bg-surface"
    >
      <div className="flex min-h-14 items-center gap-1 border-b border-line py-1.5 pr-4 pl-1">
        <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={close} disabled={busy} className="size-11 rounded-full [&_svg]:size-[22px]">
          <ArrowLeft aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-title`} ref={head} tabIndex={-1} className="truncate text-lg font-semibold tracking-tight outline-none">
            {title}
          </h2>
          {sub && <p className="text-[13px] text-text-2">{sub}</p>}
        </div>
      </div>
      {progress !== undefined && (
        <div className="h-1 bg-line" aria-hidden>
          <div className="h-1 bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 *:shrink-0">
        {added && (
          <p role="status" className="rounded-lg bg-ok-soft px-3 py-2 text-sm font-medium text-ok">
            {added}
          </p>
        )}
        {inputs.map((c) => (
          <LineField key={c.key} c={c} id={`${id}-${c.key}`} value={v[c.key] ?? ""} set={(x) => setV((s) => ({ ...s, [c.key]: x }))} error={errors[c.key]} />
        ))}
        {computed.length > 0 && row && (
          <dl className="flex flex-col gap-1.5 rounded-lg bg-surface-2 px-3 py-2.5 text-sm">
            {computed.map((c) => (
              <div key={c.key} className="flex justify-between gap-3">
                <dt className="text-text-2">{c.label}</dt>
                <dd className="font-medium tabular">{c.format!({ ...row.values, ...v }, row)}</dd>
              </div>
            ))}
          </dl>
        )}
        {problem && (
          <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">
            {problem}
          </p>
        )}
        {reason}
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-surface px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {!isNew && (
          <>
            <Button variant="secondary" aria-label="Previous" onClick={() => save("prev")} disabled={!hasPrev || busy} className="size-10 px-0">
              <ChevronLeft aria-hidden />
            </Button>
            <Button variant="secondary" aria-label="Next" onClick={() => save("next")} disabled={!hasNext || busy} className="size-10 px-0">
              <ChevronRight aria-hidden />
            </Button>
          </>
        )}
        <span className="flex-1" />
        {isNew ? (
          <>
            <Button variant="secondary" onClick={() => save("close")} disabled={busy} className="h-10">
              Done
            </Button>
            <Button variant="primary" onClick={() => save("next")} disabled={busy} className="h-10">
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />} {busy ? "Adding…" : "Add & next"}
            </Button>
          </>
        ) : (
          <>
            <Button variant={hasNext ? "secondary" : "primary"} onClick={() => save("close")} disabled={busy} className="h-10">
              {busy ? "Saving…" : "Save"}
            </Button>
            {hasNext && (
              <Button variant="primary" onClick={() => save("next")} disabled={busy} className="h-10">
                Save &amp; next
              </Button>
            )}
          </>
        )}
      </div>
      {asking && (
        <ThrowAwayConfirm
          onKeep={() => setAsking(false)}
          onThrow={() => {
            setAsking(false);
            onClose();
          }}
        />
      )}
    </div>,
    document.body,
  );
}
