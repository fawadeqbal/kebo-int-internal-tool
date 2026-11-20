"use client";

import { Fragment, useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, MoreHorizontal, Plus } from "lucide-react";
import { Button, cn, Field, Input, Select, Textarea, Badge, Notice, capsClass, Dash } from "@kebo/ui";
import { FIT_VIEW, ThrowAwayConfirm, useBackGuard, useFocusTrap, useMounted } from "@/components/common/dialog";
import { lockScroll } from "@/lib/scroll-lock";
import { FloatingMenu } from "@/components/common/floating";
import { UNITS } from "./units";
import type { LineColumn, LineRow, LineValues } from "./line-table";

/**
 * Lines on a phone (design "Lines on the phone", 16 Nov 2026): the sheet becomes a list, one line per row
 * (its number, its name, a grey line with the rest, a mark for what it still needs), and a line is typed
 * or changed in a window of its own, one line at a time (Prev / Next, Save & next, Add & next). The same
 * onAdd / onEdit / onMove / onRemove as the sheet, so every lines screen gets it at once.
 */

/** A line's price columns: an empty or 0 price is something the line still needs. */
const PRICE_KEYS = new Set(["unitPrice", "factoryPrice"]);
const isZero = (raw: string) => raw === "" || Number(raw.replace(/,/g, "")) === 0;

/**
 * What a line still needs ("No qty", "No price"), or null when it has what it must have. A part without a price is
 * fine (it is in its item's price).
 */
export function lineNeeds(values: LineValues, columns: LineColumn[], part = false): string | null {
  const c = columns.find((x) => x.required && !(values[x.key] ?? "").trim());
  if (c) return `No ${c.label.toLowerCase()}`;
  return !part && columns.some((x) => x.input && PRICE_KEYS.has(x.key) && isZero((values[x.key] ?? "").trim())) ? "No price" : null;
}

/** 1,850.00: a price as the phone row says it (up to 4 decimals when it has them). */
const priceText = (raw: string) => {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : raw;
};

/**
 * What a phone row says (design "Items on a small phone", the item line): the model under the name; the grey line —
 * how many, × the unit price when it has one, then the rest by name (a tax of its own, another spec of…); and the
 * amount on the right (the line's computed total, when it has a price). Empty values and 0 are left out.
 */
export function linePhoneParts(
  row: LineRow,
  columns: LineColumn[],
  values: LineValues,
  /** The price is typed in the row itself (PhonePriceBox): the grey line says only how many. */
  priceInRow = false,
): { under: ReactNode; line: ReactNode[]; amount: ReactNode } {
  const priceCol = columns.find((c) => c.input && PRICE_KEYS.has(c.key));
  const price = priceCol ? (values[priceCol.key] ?? "").trim() : "";
  const priced = !!priceCol && !isZero(price);
  // The amount: the last column worked out from the others, on the right (a line without a price has none).
  const totalCol = [...columns].reverse().find((c) => !c.input && c.align === "right" && c.format);
  const amount = totalCol && (!priceCol || priced) ? totalCol.format!(values, row) : null;
  const model = (values.model ?? "").trim();
  const line: ReactNode[] = [];
  const qty = (values.quantity ?? "").trim();
  if (priceInRow) {
    if (qty) line.push(`${qty} ${values.unit ?? ""}`.trim());
  } else if (qty || priced) line.push(`${qty ? `${qty} ${values.unit ?? ""}`.trim() : ""}${priced ? `${qty ? " × " : ""}${priceText(price)}` : ""}`);
  const rank = (c: LineColumn) => (c.input === "number" ? 1 : !c.input ? 3 : 4);
  for (const c of [...columns.slice(1)].sort((a, b) => rank(a) - rank(b))) {
    if (["unit", "quantity", "model"].includes(c.key) || c === priceCol || c === totalCol) continue;
    const raw = (values[c.key] ?? "").trim();
    if (c.summary) {
      const said = c.summary(values, row);
      if (said !== null && said !== undefined && said !== "") line.push(said);
      continue;
    }
    if (c.input && (!raw || (c.input === "number" && isZero(raw)))) continue;
    const shown = c.format
      ? c.format(values, row)
      : c.options
        ? (c.options.find((o) => o.value === raw)?.label ?? raw)
        : c.input === "number" && /price/i.test(c.key)
          ? priceText(raw)
          : raw;
    if (shown === null || shown === undefined || shown === "" || shown === "—") continue;
    line.push(
      <>
        {c.label} {shown}
      </>,
    );
  }
  return { under: model || null, line, amount };
}

/** The column whose value is typed in a phone row itself: the unit price (or the supplier price). */
export const phonePriceColumn = (columns: LineColumn[]) => columns.find((c) => c.input && PRICE_KEYS.has(c.key)) ?? null;

/**
 * A price typed right in an item's line on a phone (canvas "Items on a small phone"; asked 19 Nov: pricing an item
 * must not take a tap, a sheet and a window). Figures on the right, the whole value selected on focus, the number
 * keys; Enter (or ↓) goes to the next line's price, Shift+Enter (↑) to the one above. Shown tidy (1,850.00) while not
 * typed in. `onChange`: every key goes up at once (an editor that saves later); else `onCommit` when the box is left
 * with a new value (a list that saves each change).
 */
export function PhonePriceBox({
  value,
  onChange,
  onCommit,
  label,
  index,
  group,
  className,
  needed = true,
  ...props
}: Omit<ComponentProps<"input">, "value" | "onChange"> & {
  value: string;
  onChange?: (v: string) => void;
  onCommit?: (v: string) => void;
  /** "Unit price for 2.1". */
  label: string;
  /** Its place in the list and the list's name: Enter moves to the next box of the same list. */
  index: number;
  group: string;
  /** Empty is something to fill in (an item); a part is priced in its item, so its empty box is quiet. */
  needed?: boolean;
}) {
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState(value);
  const live = !!onChange;
  const raw = live || !typing ? value : draft;
  const n = Number(raw.replace(/,/g, ""));
  // Not typed in: tidy figures, and nothing at all for 0 (its place says Price).
  const shown = typing ? raw : raw.trim() === "" || (Number.isFinite(n) && n === 0) ? "" : Number.isFinite(n) ? priceText(raw) : raw;
  const go = (to: number) => document.querySelector<HTMLInputElement>(`[data-price-row="${group}:${to}"]`)?.focus();
  return (
    <input
      {...props}
      aria-label={label}
      data-price-row={`${group}:${index}`}
      inputMode="decimal"
      enterKeyHint="next"
      autoComplete="off"
      placeholder="Price"
      value={shown}
      className={cn(
        "h-11 w-36 min-w-0 shrink-0 rounded-lg border bg-surface px-3 text-right text-base tabular outline-none placeholder:text-muted/80 focus:border-primary focus:ring-2 focus:ring-primary/30",
        needed && isZero(raw.trim()) ? "border-action/50" : "border-line-strong",
        className,
      )}
      onFocus={(e) => {
        setDraft(isZero(value.trim()) ? "" : value);
        setTyping(true);
        const el = e.currentTarget;
        requestAnimationFrame(() => el.select());
      }}
      onBlur={() => {
        setTyping(false);
        // Emptied, or 0 typed, where it was 0: nothing changed.
        if (!live && draft !== value && !(isZero(draft.trim()) && isZero(value.trim()))) onCommit?.(draft);
      }}
      onChange={(e) => (live ? onChange!(e.target.value) : setDraft(e.target.value))}
      onKeyDown={(e) => {
        props.onKeyDown?.(e);
        if (e.defaultPrevented) return;
        const to = e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey) ? index + 1 : e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey) ? index - 1 : null;
        if (to === null) return;
        e.preventDefault();
        const next = document.querySelector<HTMLInputElement>(`[data-price-row="${group}:${to}"]`);
        if (next) go(to);
        else e.currentTarget.blur();
      }}
    />
  );
}

/**
 * One item in the phone list (design "Items on a small phone", the item line): its number, its name (two lines at
 * most), the model under it, then how many × the unit price on the left and the amount on the right; what it still
 * needs (No price) where the amount goes. A part is right under its item and in line with it — its number where the
 * item's is, a little lighter — with no indent. A tap opens what can be done to it (its sheet: Edit first), never
 * the window by itself; pressing and holding starts Select. In Select, a tap ticks it.
 */
export function PhoneLineRow({
  no,
  kind,
  name,
  under,
  line,
  amount,
  needs,
  fresh,
  lineKey,
  rowId,
  badge,
  part,
  busy,
  onOpen,
  onHold,
  open,
  pick,
  dup,
  field,
  note,
}: {
  /**
   * A box typed in right in the row (PhonePriceBox): on the right of the line that says how many, the amount
   * under it. The rest of the row still opens its sheet.
   */
  field?: ReactNode;
  /** With a field: on the left of the amount ("margin 15.0%"). */
  note?: ReactNode;
  /** Select mode: a tick box; a tap ticks it (instead of opening the sheet). */
  pick?: { on: boolean; toggle: () => void };
  /** "Same as 1?": it looks like an earlier line. */
  dup?: string | null;
  no: string;
  /** "Item", "Line" or "Part": read before the number. */
  kind: string;
  name: string;
  /** Under the name (the model). */
  under?: ReactNode;
  /** The grey line: how many × the price, then the rest. */
  line: ReactNode[];
  /** On the right (the line's amount). */
  amount?: ReactNode;
  needs: string | null;
  /** Just added: lit until the next window opens. */
  fresh?: boolean;
  /** Its key, to bring it into view once added. */
  lineKey?: string;
  /** The row's own id (its sheet opens from it). */
  rowId?: string;
  badge?: ReactNode;
  part: boolean;
  busy: boolean;
  /** Opens its sheet (none: shown only). */
  onOpen?: () => void;
  /** Pressed and held: start Select with it ticked. */
  onHold?: () => void;
  /** Its sheet is open. */
  open?: boolean;
}) {
  const held = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const hold = onHold
    ? {
        onPointerDown: () => {
          held.current = false;
          stop();
          timer.current = setTimeout(() => {
            held.current = true;
            onHold();
          }, 550);
        },
        onPointerUp: stop,
        onPointerLeave: stop,
        onPointerCancel: stop,
        onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
      }
    : {};
  useEffect(() => stop, []);
  const missingMark = needs && <span className="shrink-0 rounded-md bg-warn-soft px-1.5 py-0.5 text-xs font-semibold text-warn">{needs}</span>;
  const body = (
    <>
      {pick && (
        <span aria-hidden className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border-[1.5px]", pick.on ? "border-primary-solid bg-primary-solid text-white" : "border-line-strong bg-surface")}>
          {pick.on && <Check className="size-3.5" strokeWidth={3} />}
        </span>
      )}
      <span className={cn("w-[34px] shrink-0 pt-0.5 text-md tabular", part ? "font-medium text-muted" : "font-semibold text-text-2")}>
        <span className="sr-only">{kind} </span>
        {no}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("line-clamp-2 text-lead leading-snug [overflow-wrap:anywhere]", part ? "font-medium" : "font-semibold")}>{name || <span className="text-muted">No description yet</span>}</span>
        {under && <span className="truncate text-xs text-muted">{under}</span>}
        {(line.length > 0 || amount || needs) && (
          <span className="mt-1 flex items-baseline justify-between gap-2 text-md text-text-2 tabular">
            <span className="line-clamp-2 min-w-0 [overflow-wrap:anywhere]">
              {line.map((s, n) => (
                <Fragment key={n}>
                  {n > 0 && " · "}
                  {s}
                </Fragment>
              ))}
            </span>
            {amount ? <span className="shrink-0 text-sm font-bold whitespace-nowrap text-text">{amount}</span> : missingMark}
          </span>
        )}
        {(dup || badge || (needs && amount)) && (
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {dup && <span className="rounded-md bg-warn-soft px-1.5 py-0.5 text-xs font-semibold text-warn">{dup}</span>}
            {amount && missingMark}
            {badge}
          </span>
        )}
      </span>
      {busy ? (
        <Loader2 className="mt-1 size-4 shrink-0 animate-spin text-muted" aria-label="Saving" />
      ) : (
        !pick && onOpen && <MoreHorizontal aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
      )}
    </>
  );
  const box = "flex min-h-16 min-w-0 flex-1 items-start gap-1.5 py-2.5 pr-2.5 pl-3 text-left";
  if (field && !pick) {
    // The row with a box in it: the box is its own (a button cannot hold a box), so the row's tap is a button laid
    // under the words, and the words let the tap through to it.
    const words = (
      <>
        <span className={cn("w-[34px] shrink-0 pt-0.5 text-md tabular", part ? "font-medium text-muted" : "font-semibold text-text-2")}>
          <span className="sr-only">{kind} </span>
          {no}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-start gap-1.5">
            <span className={cn("line-clamp-2 min-w-0 flex-1 text-lead leading-snug [overflow-wrap:anywhere]", part ? "font-medium" : "font-semibold")}>
              {name || <span className="text-muted">No description yet</span>}
            </span>
            {busy ? (
              <Loader2 className="mt-1 size-4 shrink-0 animate-spin text-muted" aria-label="Saving" />
            ) : (
              onOpen && <MoreHorizontal aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
            )}
          </span>
          {under && <span className="truncate text-xs text-muted">{under}</span>}
          <span className="mt-1.5 flex items-center justify-between gap-2">
            <span className="line-clamp-2 min-w-0 text-md text-text-2 tabular [overflow-wrap:anywhere]">
              {line.map((s, n) => (
                <Fragment key={n}>
                  {n > 0 && " · "}
                  {s}
                </Fragment>
              ))}
            </span>
            <span className="pointer-events-auto relative z-[1]">{field}</span>
          </span>
          <span className="mt-1 flex items-baseline justify-between gap-2 text-xs tabular">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              {note}
              {dup && <span className="rounded-md bg-warn-soft px-1.5 py-0.5 text-xs font-semibold text-warn">{dup}</span>}
              {needs && needs !== "No price" && missingMark}
              {badge}
            </span>
            <span className="shrink-0 text-sm font-bold whitespace-nowrap text-text">{amount || <Dash />}</span>
          </span>
        </span>
      </>
    );
    return (
      <li
        data-line={lineKey}
        className={cn(
          "relative flex scroll-mt-40 scroll-mb-24 items-stretch border-b border-line last:border-b-0",
          dup && "bg-warn-soft/40",
          open && "bg-surface-2",
          fresh && "bg-primary-soft/60 shadow-[inset_3px_0_0_var(--color-primary-solid)]",
        )}
      >
        {onOpen && (
          <button
            id={rowId}
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`${kind} ${no} ${name || "No description yet"}`}
            onClick={() => (held.current ? (held.current = false) : onOpen())}
            {...hold}
            className="absolute inset-0 select-none active:bg-surface-2 [-webkit-touch-callout:none]"
          />
        )}
        <div className={cn(box, "pointer-events-none relative")}>{words}</div>
      </li>
    );
  }
  return (
    <li
      data-line={lineKey}
      className={cn(
        "flex scroll-mt-40 scroll-mb-24 items-stretch border-b border-line last:border-b-0",
        dup && !pick?.on && "bg-warn-soft/40",
        pick?.on && "bg-primary-soft/50",
        open && "bg-surface-2",
        fresh && !pick && "bg-primary-soft/60 shadow-[inset_3px_0_0_var(--color-primary-solid)]",
      )}
    >
      {pick ? (
        <button type="button" role="checkbox" aria-checked={pick.on} onClick={pick.toggle} className={cn(box, "active:bg-surface-2")}>
          {body}
        </button>
      ) : onOpen ? (
        <button
          id={rowId}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => (held.current ? (held.current = false) : onOpen())}
          {...hold}
          className={cn(box, "select-none active:bg-surface-2 [-webkit-touch-callout:none]")}
        >
          {body}
        </button>
      ) : (
        <div className={box}>{body}</div>
      )}
    </li>
  );
}

/** One field of the line window, as big as a thumb needs (16 px text: a phone does not zoom in). */
function LineField({ c, id, value, set, error, used }: { c: LineColumn; id: string; value: string; set: (v: string) => void; error?: string; used?: string[] }) {
  const big = "h-12 text-base";
  if (c.input === "unit") return <UnitPicker c={c} id={id} value={value} set={set} error={error} used={used ?? []} />;
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

/**
 * The unit on a phone (design 18 Nov): one dropdown — a sheet with the units used here first, then every unit,
 * and Other… at its foot. Other… turns the box into one to type your own; ▾ beside it goes back to the list.
 */
function UnitPicker({ c, id, value, set, error, used }: { c: LineColumn; id: string; value: string; set: (v: string) => void; error?: string; used: string[] }) {
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (typing) box.current?.focus();
  }, [typing]);
  const here = [...new Set([...used, value].map((u) => u.trim()).filter(Boolean))];
  const rest = UNITS.filter((u) => !here.includes(u));
  const pick = (u: string) => {
    set(u);
    setTyping(false);
    setOpen(false);
    button.current?.focus();
  };
  const option = (u: string) => (
    <button
      key={u}
      type="button"
      role="menuitemradio"
      aria-checked={value === u}
      onClick={() => pick(u)}
      className="flex min-h-12 items-center justify-between gap-3 rounded-md px-2.5 text-left text-base aria-checked:bg-primary-soft/60 aria-checked:font-semibold aria-checked:text-primary hover:bg-surface-2"
    >
      {u}
      {value === u && <Check aria-hidden className="size-4" />}
    </button>
  );
  const group = (title: string) => <p className={cn(capsClass, "px-2.5 pt-2 pb-1")}>{title}</p>;
  return (
    <Field label={c.label} htmlFor={id} required={!!c.required} error={error}>
      {typing ? (
        <span className="flex gap-2">
          <Input ref={box} id={id} value={value} onChange={(e) => set(e.target.value)} maxLength={c.maxLength ?? 20} className="min-w-0 flex-1 text-base" />
          <Button size="lg"
            ref={button}
            variant="secondary"
            aria-label="Pick from the list"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="aspect-square shrink-0 px-0"
          >
            <ChevronDown aria-hidden />
          </Button>
        </span>
      ) : (
        <button
          ref={button}
          id={id}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex h-12 w-full items-center justify-between gap-2 rounded-[10px] border border-line-strong bg-surface px-3 text-left text-base shadow-card focus-visible:border-primary-solid focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className="min-w-0 truncate">{value || <Dash />}</span>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-muted" />
        </button>
      )}
      {open && (
        <FloatingMenu anchor={() => button.current} onClose={() => setOpen(false)} label={c.label} width={240}>
          {here.length > 0 && group("Used here")}
          {here.map(option)}
          {group("All units")}
          {rest.map(option)}
          {/* Other… stays at the foot of the sheet, however far the list scrolls. */}
          <div className="sticky -bottom-3 -mx-2 mt-1 border-t border-line bg-surface px-2 pt-1 pb-3">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setTyping(true);
              }}
              className="flex min-h-12 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-base font-semibold text-primary hover:bg-primary-soft"
            >
              <Plus aria-hidden className="size-4" /> Other…
            </button>
          </div>
        </FloatingMenu>
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
  partOf,
  nextLabel = "Add & next",
  usedUnits,
}: {
  /** The units already used in these lines: first in the unit's list. */
  usedUnits?: string[];
  /**
   * A new part (design 18 Nov): what it goes under, shown above its fields, and a way to make it an item
   * instead. There is nothing to pick: + Part on a line opens it already under that line.
   */
  partOf?: { no: string; name: string; onMakeItem: () => void };
  /** The strong button of a new line: "Add & next", "Add & next part". */
  nextLabel?: string;
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
  // A new line turned from an item into a part (or back): what was not typed yet follows (the unit: pcs → sets).
  const startKey = JSON.stringify(start);
  const [seenStart, setSeenStart] = useState({ key: startKey, start });
  if (seen !== resetKey) {
    setSeen(resetKey);
    setSeenStart({ key: startKey, start });
    setV(start);
    setErrors({});
  } else if (seenStart.key !== startKey) {
    const prev = seenStart.start;
    setSeenStart({ key: startKey, start });
    setV((cur) => Object.fromEntries([...new Set([...Object.keys(cur), ...Object.keys(start)])].map((k) => [k, (cur[k] ?? "") === (prev[k] ?? "") ? (start[k] ?? "") : (cur[k] ?? "")])));
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
      if (isNew) {
        // Nothing typed yet: say what to fill in.
        const first = inputs.find((c) => c.required) ?? inputs[0];
        if (first) {
          setErrors({ [first.key]: first.required ?? "Type something first" });
          document.getElementById(`${id}-${first.key}`)?.focus();
        }
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
      className={cn("fixed inset-0 z-[100] flex animate-in flex-col bg-surface", FIT_VIEW)}
    >
      {/* Its name on top; Cancel at the bottom, beside Add or Save (canvas row "Cancel, not ✕"). */}
      <div className="flex min-h-15 items-center gap-1.5 border-b border-line py-1.5 pr-4 pl-4">
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-title`} ref={head} tabIndex={-1} className="truncate text-lg font-semibold tracking-tight outline-none">
            {title}
          </h2>
          {sub && <p className="text-md text-text-2">{sub}</p>}
        </div>
      </div>
      {progress !== undefined && (
        <div className="h-1 bg-line" aria-hidden>
          <div className="h-1 bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 *:shrink-0">
        {added && (
          <p role="status" className="flex items-center gap-2 rounded-[10px] bg-ok-soft px-3 py-2.5 text-sm font-semibold text-ok">
            <Check aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
            <span className="min-w-0 truncate">{added}</span>
          </p>
        )}
        {partOf && (
          <div className="flex items-center gap-2.5 rounded-[10px] border border-line bg-surface-2 px-3 py-2.5 text-sm">
            <Badge size="sm" tone="primary">Part of {partOf.no}</Badge>
            <span className="min-w-0 flex-1 truncate">{partOf.name}</span>
            <button type="button" onClick={partOf.onMakeItem} className="-my-2 -mr-1.5 shrink-0 rounded-md px-1.5 py-2 text-md font-semibold text-primary hover:bg-primary-soft">
              Make it an item
            </button>
          </div>
        )}
        {inputs.map((c, n) => {
          const field = (x: LineColumn) => (
            <LineField key={x.key} c={x} id={`${id}-${x.key}`} value={v[x.key] ?? ""} set={(val) => setV((s) => ({ ...s, [x.key]: val }))} error={errors[x.key]} used={usedUnits} />
          );
          // The quantity and its unit side by side (design 18 Nov).
          if (c.key === "quantity" && inputs[n + 1]?.input === "unit")
            return (
              <div key={c.key} className="grid grid-cols-2 items-start gap-3">
                {field(c)}
                {field(inputs[n + 1]!)}
              </div>
            );
          if (c.input === "unit" && inputs[n - 1]?.key === "quantity") return null;
          return field(c);
        })}
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
          <Notice tone="bad">{problem}</Notice>
        )}
        {reason}
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-surface px-3 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {!isNew && (
          <>
            <Button size="lg" variant="secondary" aria-label="Previous" onClick={() => save("prev")} disabled={!hasPrev || busy} className="aspect-square shrink-0 px-0">
              <ChevronLeft aria-hidden />
            </Button>
            <Button size="lg" variant="secondary" aria-label="Next" onClick={() => save("next")} disabled={!hasNext || busy} className="aspect-square shrink-0 px-0">
              <ChevronRight aria-hidden />
            </Button>
          </>
        )}
        <Button variant="secondary" data-window-cancel="" onClick={close} disabled={busy} className={cn(isNew ? "shrink-0 px-3.5" : "flex-1")}>
          Cancel
        </Button>
        {isNew ? (
          // Add (adds it and closes) and the strong Add & next (the next one opens, ready to type), side by side.
          <>
            <Button variant="soft" onClick={() => save("close")} disabled={busy} className="flex-1">
              Add
            </Button>
            <Button size="lg" variant="primary" onClick={() => save("next")} disabled={busy} className="flex-[1.4]">
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />} {busy ? "Adding…" : nextLabel}
            </Button>
          </>
        ) : (
          // Save (and close); › beside ‹ saves and opens the next one.
          <Button size="lg" variant="primary" onClick={() => save("close")} disabled={busy} className="flex-1">
            {busy ? "Saving…" : "Save"}
          </Button>
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
