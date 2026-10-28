"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  IndentDecrease,
  IndentIncrease,
  Loader2,
  Keyboard,
  ListPlus,
  MessageCircleQuestion,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { lineNumbers } from "@kebo/shared";
import { Button, cn, Input, Kbd, Textarea } from "@kebo/ui";
import { parseList, type PastedItem } from "@/components/deals/paste-list";
import { FloatingMenu } from "@/components/common/floating";
import { ExcelMenu } from "@/components/sheets/excel-menu";
import { lineExport, linesFromSheet, lineTemplate, type SheetLines } from "@/components/sheets/line-sheets";

/* ---------------------------------------------------------------- types */

export type LineValues = Record<string, string>;

/** The units offered in a unit column's dropdown; "Other…" lets people type any other. */
export const UNITS = ["pcs", "sets", "units", "kg", "tons", "m", "m²", "m³", "rolls", "cartons", "boxes", "bags", "pairs", "litres", "drums", "lot"];
const OTHER_UNIT = "__other__";
/** Picked from a list (no typing into the cell). */
const isChoice = (c: LineColumn) => c.input === "select" || c.input === "unit";

/** One row as the table shows it, in display order (parts right after their line). */
export interface LineRow {
  key: string;
  parentKey: string | null;
  values: LineValues;
  /** Shown after the description (e.g. "Priced", "In R1"). */
  badge?: ReactNode;
}

export interface LineColumn {
  key: string;
  label: string;
  /** CSS grid track, e.g. "minmax(0,1fr)" or "6rem". */
  width: string;
  align?: "right";
  /** How it is typed: a growing text box (description), a number, a short text or a choice. Without `input` it is shown only. */
  input?: "textarea" | "number" | "text" | "select" | "unit";
  options?: { value: string; label: string }[];
  placeholder?: string;
  maxLength?: number;
  /** The value for a new row (unit "pcs", tax "13"). */
  initial?: string | ((parentKey: string | null) => string);
  /** How a saved row shows the value. */
  format?: (values: LineValues, row: LineRow) => ReactNode;
  /** Must be filled in before a row is added or saved. */
  required?: string;
  /** Hidden on phones in saved rows (shown when the row is opened). */
  phoneHidden?: boolean;
  /** A choice column in an Excel file: each value as written there (by default each option's label). */
  sheetChoices?: { value: string; text: string }[];
}

/** What a change returned: done, or a message; `reasonChoices` when the change needs a reason first. */
export type LineResult = { ok: true; keys?: string[] } | { ok: false; message: string; reasonChoices?: string[] };

export type LineMove = "up" | "down" | "indent" | "outdent";

/** A row to add: its values, and (for a pasted list) which earlier new row it is a part of. */
export interface NewLine {
  values: LineValues;
  partOf: number | null;
}

export interface LineTableProps {
  rows: LineRow[];
  columns: LineColumn[];
  /** "line" / "item": used in labels ("Add a line", "Remove line 2.1"). */
  noun?: string;
  /** Lines to add after `afterKey` (or at the end), at that row's level or as parts of `parentKey`. */
  onAdd: (lines: NewLine[], at: { afterKey: string | null; parentKey: string | null }, reason?: string) => Promise<LineResult>;
  onEdit: (key: string, values: LineValues, reason?: string) => Promise<LineResult>;
  onRemove: (key: string, reason?: string) => Promise<LineResult>;
  onMove: (key: string, to: LineMove, reason?: string) => Promise<LineResult>;
  /** Shown only (a sent quotation, someone else's deal). */
  readOnly?: boolean;
  /** Totals and anything else under the table (stays in view while scrolling on a wide screen). */
  footer?: ReactNode;
  /** Shown when there are no rows yet. */
  empty?: ReactNode;
  /** Shown in the toolbar (e.g. "Copy lines from another factory"). */
  tools?: ReactNode;
  /** Error from the surrounding form (e.g. "Enter a quantity"). */
  error?: string;
  /** No parts (charges): one level only. */
  flat?: boolean;
  /**
   * The Excel button: export the lines, and (when lines can be added here and
   * `upload` is not false) download a template and upload a filled one. An
   * upload only adds lines, after a look at them; it never changes the ones here.
   */
  sheet?: { name: string; upload?: boolean; templateRows?: { no: string; values: LineValues }[] };
}

/* ---------------------------------------------------------------- helpers */

/** "a line", "an item". */
const an = (noun: string) => `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;

const blockEnd = (rows: LineRow[], i: number) => {
  let j = i + 1;
  if (!rows[i]!.parentKey) while (j < rows.length && rows[j]!.parentKey === rows[i]!.key) j++;
  return j;
};
const lineAbove = (rows: LineRow[], i: number) => {
  for (let j = i - 1; j >= 0; j--) if (!rows[j]!.parentKey) return rows[j]!;
  return null;
};
const hasParts = (rows: LineRow[], key: string) => rows.some((r) => r.parentKey === key);
export const canIndent = (rows: LineRow[], i: number) => !rows[i]!.parentKey && !hasParts(rows, rows[i]!.key) && !!lineAbove(rows, i);

/** A pasted item as values for these columns (description, model, quantity, unit when the table has them). */
const pastedValues = (p: PastedItem, columns: LineColumn[], parentKey: string | null): LineValues => {
  const v = initialValues(columns, parentKey);
  for (const k of ["description", "model", "quantity", "unit"] as const) if (k in v && p[k]) v[k] = p[k];
  return v;
};

export function initialValues(columns: LineColumn[], parentKey: string | null): LineValues {
  const v: LineValues = {};
  for (const c of columns) if (c.input) v[c.key] = typeof c.initial === "function" ? c.initial(parentKey) : (c.initial ?? "");
  return v;
}

const initialOf = (c: LineColumn, parentKey: string | null) => (typeof c.initial === "function" ? c.initial(parentKey) : (c.initial ?? ""));
/** Nothing typed yet (only the starting values, such as the unit). */
const isBlank = (v: LineValues, columns: LineColumn[], parentKey: string | null = null) =>
  columns.every((c) => !c.input || c.input === "select" || !(v[c.key] ?? "").trim() || v[c.key] === initialOf(c, parentKey));

/** How a pasted list will be numbered: 1, 1.1, 1.2, 2 … (a part before any line is a line). */
const pastedNumbers = (items: PastedItem[]) => {
  let top = 0;
  let sub = 0;
  return items.map((p) => {
    if (p.part && top > 0) return `${top}.${++sub}`;
    sub = 0;
    return String(++top);
  });
};

const missing = (v: LineValues, columns: LineColumn[]) => columns.find((c) => c.required && !v[c.key]?.trim());

/* ---------------------------------------------------------------- the table */

type Pending = { run: (reason: string) => Promise<LineResult>; message: string; choices: string[] };
type Removed = { label: string; lines: NewLine[]; at: { afterKey: string | null; parentKey: string | null } };
/** Something that can be done to a row; `short` is the toolbar's label, `hint` its key. */
type RowActionKey = "below" | "part" | "out" | "in" | "up" | "down" | "dup" | "del";
type RowAction = { key: RowActionKey; icon: ReactNode; label: string; short: string; hint?: string; disabled?: boolean; danger?: boolean };

/**
 * Lines as a quick table for long lists (100+ lines). Saved lines are compact
 * read-only rows; click one (or ✎) to change it in place — Enter saves, Esc
 * cancels. The row at the bottom adds lines: type and press Enter; Tab on an
 * empty new row makes it a part of the line above. A list pasted from Excel,
 * WhatsApp or an email becomes rows. Each change is saved as it is made;
 * a removed line can be put back with Undo.
 */
export function LineTable({
  rows,
  columns,
  noun = "line",
  onAdd,
  onEdit,
  onRemove,
  onMove,
  readOnly,
  footer,
  empty,
  tools,
  error,
  flat,
  sheet,
}: LineTableProps) {
  const numbers = useMemo(() => lineNumbers(rows.map((r) => ({ key: r.key, parentKey: r.parentKey }))), [rows]);
  const editable = columns.filter((c) => c.input);

  // Adding: where the entry row is (at the end, or under a line), and what is typed in it.
  const [entryAt, setEntryAt] = useState<{ afterKey: string | null; parentKey: string | null }>({ afterKey: null, parentKey: null });
  const [entry, setEntry] = useState<LineValues>(() => initialValues(columns, null));
  const [adding, setAdding] = useState<LineValues[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [removed, setRemoved] = useState<Removed | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  /** A row's actions opened by a right-click (or the menu key), where the pointer was. */
  const [ctx, setCtx] = useState<{ row: string; x: number; y: number } | null>(null);
  const closeCtx = useCallback(() => setCtx(null), []);
  const ctxAnchor = useCallback(
    () =>
      ctx
        ? ({
            getBoundingClientRect: () => new DOMRect(ctx.x, ctx.y, 0, 0),
            contains: () => false,
            focus: () => gridRef.current?.focus({ preventScroll: true }),
          } as unknown as HTMLElement)
        : null,
    [ctx],
  );
  const menuId = useId().replace(/:/g, "");
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [offer, setOffer] = useState<{ before: string; items: PastedItem[] } | null>(null);
  const [fromFile, setFromFile] = useState<{ file: string; read: SheetLines } | null>(null);
  const focusNext = useRef<string | null>(null);
  /** Tab pressed while the line above was still being saved: it becomes a part once it is. */
  const partNext = useRef(false);
  const cells = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    const el = cells.current.get(target);
    if (!el) return;
    el.focus();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) el.setSelectionRange(el.value.length, el.value.length);
  });
  const focus = (cell: string) => {
    focusNext.current = cell;
  };
  const ref = (cell: string) => (el: HTMLElement | null) => {
    if (el) cells.current.set(cell, el);
    else cells.current.delete(cell);
  };

  /** Runs a change; when it needs a reason, asks and runs it again with the answer. `done` runs once it went through. */
  const run = async (
    key: string,
    fn: (reason?: string) => Promise<LineResult>,
    done?: (r: LineResult & { ok: true }) => void,
    reason?: string,
  ): Promise<LineResult> => {
    setBusy(key);
    setMessage(null);
    const r = await fn(reason);
    setBusy(null);
    if (!r.ok && r.reasonChoices) {
      setPending({ run: (why) => run(key, fn, done, why), message: r.message, choices: r.reasonChoices });
      return r;
    }
    setPending(null);
    if (r.ok) done?.(r);
    else setMessage(r.message);
    return r;
  };

  /* ---------- adding */

  const parentLabel = (parentKey: string | null) => (parentKey ? numbers[rows.findIndex((r) => r.key === parentKey)] : null);
  const entryCell = (k: string) => `entry:${k}`;

  const add = async (lines: NewLine[], at = entryAt) => {
    setAdding((a) => [...a, ...lines.map((l) => l.values)]);
    const r = await run(
      "entry",
      (reason) => onAdd(lines, at, reason),
      (ok) => {
        // The new row may move under what was just added: keep the cursor in it.
        focus(entryCell(editable[0]!.key));
        // Keep adding right after what was just added (at the same level).
        const last = ok.keys?.[ok.keys.length - 1];
        if (last && partNext.current && !at.parentKey && lines.length === 1) {
          partNext.current = false;
          setEntryAt({ afterKey: last, parentKey: last });
        } else if (last && (at.afterKey !== null || at.parentKey !== null)) setEntryAt({ afterKey: last, parentKey: at.parentKey });
      },
    );
    setAdding((a) => a.slice(lines.length));
    return r;
  };

  const submitEntry = async () => {
    const lack = missing(entry, columns);
    if (lack) {
      setMessage(lack.required!);
      focus(entryCell(lack.key));
      return;
    }
    const values = entry;
    setEntry(initialValues(columns, entryAt.parentKey));
    focus(entryCell(editable[0]!.key));
    const r = await add([{ values, partOf: null }]);
    if (!r.ok) setEntry(values); // nothing lost: put it back to fix
  };

  const toPart = (on: boolean) => {
    if (flat) return;
    if (on) {
      const at = entryAt.afterKey ? rows.findIndex((r) => r.key === entryAt.afterKey) : rows.length;
      const above = lineAbove(rows, at === rows.length ? rows.length : at + 1);
      if (!above) return;
      setEntryAt({ afterKey: entryAt.afterKey, parentKey: above.key });
      setEntry((v) => ({
        ...v,
        ...Object.fromEntries(
          columns
            .filter((c) => typeof c.initial === "function")
            .map((c) => [c.key, (c.initial as (p: string | null) => string)(above.key)]),
        ),
      }));
    } else setEntryAt({ afterKey: entryAt.afterKey, parentKey: null });
  };

  const entryKey = (e: KeyboardEvent<HTMLElement>, col: LineColumn) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (isBlank(entry, columns, entryAt.parentKey)) {
        // Enter on an empty part row goes back to whole lines, like a bulleted list.
        if (entryAt.parentKey) toPart(false);
        return;
      }
      void submitEntry();
    } else if (e.key === "Tab" && col.input === "textarea" && !entry[col.key]) {
      if (!e.shiftKey && !entryAt.parentKey && adding.length > 0 && !flat) {
        // The line above is still being saved: make this a part of it once it is.
        e.preventDefault();
        partNext.current = true;
      } else if (!e.shiftKey && !entryAt.parentKey && lineAbove(rows, rows.length) !== null) {
        e.preventDefault();
        toPart(true);
      } else if (e.shiftKey && entryAt.parentKey) {
        e.preventDefault();
        toPart(false);
      }
    } else if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      toPart(e.key === "ArrowRight");
    } else if (e.key === "Escape" && (entryAt.afterKey || entryAt.parentKey)) {
      setEntryAt({ afterKey: null, parentKey: null });
    }
  };

  const entryPaste = (e: ClipboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const text = e.clipboardData.getData("text/plain");
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2 && !text.includes("\t")) return;
    const items = parseList(text);
    if (!items.length) return;
    if (text.includes("\t")) {
      e.preventDefault();
      void addPasted(items);
    } else setOffer({ before: entry.description ?? "", items });
  };

  /** Adds the good rows of an uploaded file at the end (a part whose line was left out is left out too). */
  const addFromFile = async (read: SheetLines) => {
    const good = read.lines.filter((l) => !l.problem);
    const index = new Map<number, number>();
    good.forEach((l, n) => index.set(read.lines.indexOf(l), n));
    const lines: NewLine[] = good.map((l) => ({ values: l.values, partOf: l.partOf === null ? null : (index.get(l.partOf) ?? null) }));
    const r = await add(lines, { afterKey: null, parentKey: null });
    if (r.ok) setFromFile(null);
  };

  const addPasted = async (items: PastedItem[]) => {
    const under = entryAt.parentKey;
    const lines: NewLine[] = [];
    let lastTop: number | null = null;
    for (const p of items) {
      const partOf = !under && p.part && lastTop !== null ? lastTop : null;
      lines.push({ values: pastedValues(p, columns, under ?? (partOf !== null ? "part" : null)), partOf });
      if (partOf === null) lastTop = lines.length - 1;
    }
    const r = await add(lines);
    if (r.ok) {
      setPasteOpen(false);
      setPasteText("");
      setOffer(null);
      setEntry(initialValues(columns, under));
    }
  };

  /* ---------- the grid: one cell selected, typed into like a spreadsheet */

  const [sel, setSel] = useState<{ row: string; col: string } | null>(null);
  /** The cell being typed into (a saved row's cell; the new row's cells are always open). */
  const [cell, setCellState] = useState<{ row: string; col: string; value: string } | null>(null);
  // The same, read when it is saved: a blur right after Enter must not save it twice.
  const open = useRef<typeof cell>(null);
  const setCell = (v: typeof cell | ((x: typeof cell) => typeof cell)) => {
    const next = typeof v === "function" ? v(open.current) : v;
    open.current = next;
    setCellState(next);
  };
  /** What a cell shows while its change is being saved. */
  const [shown, setShown] = useState<Map<string, string>>(new Map());
  const gridRef = useRef<HTMLDivElement>(null);
  const cellId = (row: string, col: string) => `${row}:${col}`;
  const ctxRow = ctx ? (rows.find((x) => x.key === ctx.row) ?? null) : null;
  const selRow = sel && sel.row !== "entry" ? (rows.find((r) => r.key === sel.row) ?? null) : null;

  const q = query.trim().toLowerCase();
  const matches = (r: LineRow) => !q || Object.values(r.values).some((v) => v.toLowerCase().includes(q));
  const visible = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => {
      if (q) return matches(r) || rows.some((p) => p.parentKey === r.key && matches(p));
      return !(r.parentKey && folded.has(r.parentKey));
    });
  const anyParts = rows.some((r) => r.parentKey);
  /** Lines can come from an Excel file here (a template, then the filled file). */
  const canUpload = !!sheet && !readOnly && sheet.upload !== false;
  const entryIndex = entryAt.afterKey ? rows.findIndex((r) => r.key === entryAt.afterKey) : -1;
  // An inline new row goes after its line (and the line's parts when it adds whole lines).
  const anchor = entryIndex < 0 ? null : entryAt.parentKey ? entryIndex : blockEnd(rows, entryIndex) - 1;
  // Hidden by a search or folded parts: the new row shows at the end instead.
  const entryAfter = anchor !== null && visible.some((v) => v.i === anchor) ? anchor : null;
  const inline = entryAfter !== null;
  const rowLabel = (i: number) => `${rows[i]!.parentKey ? "Part" : noun[0]!.toUpperCase() + noun.slice(1)} ${numbers[i]}`;

  /** Rows in the order the grid shows them, the new row included. */
  const order: string[] = [];
  for (const { r, i } of visible) {
    order.push(r.key);
    if (entryAfter === i) order.push("entry");
  }
  if (!readOnly && entryAfter === null) order.push("entry");

  const valueOf = (row: LineRow, col: string) => shown.get(cellId(row.key, col)) ?? row.values[col] ?? "";

  /** Puts the keyboard on the grid (or on the new row's box) for the selected cell. */
  const select = (row: string, col: string) => {
    setSel({ row, col });
    const c = columns.find((x) => x.key === col);
    if (row === "entry" && c?.input) focus(entryCell(col));
    else requestAnimationFrame(() => gridRef.current?.focus({ preventScroll: true }));
  };

  const step = (from: { row: string; col: string }, dir: "up" | "down" | "left" | "right" | "next" | "prev") => {
    const ri = order.indexOf(from.row);
    const ci = columns.findIndex((c) => c.key === from.col);
    let r = ri;
    let c = ci;
    if (dir === "up") r = Math.max(0, ri - 1);
    else if (dir === "down") r = Math.min(order.length - 1, ri + 1);
    else if (dir === "left") c = Math.max(0, ci - 1);
    else if (dir === "right") c = Math.min(columns.length - 1, ci + 1);
    else if (dir === "next") {
      if (ci < columns.length - 1) c = ci + 1;
      else if (ri < order.length - 1) [r, c] = [ri + 1, 0];
    } else if (dir === "prev") {
      if (ci > 0) c = ci - 1;
      else if (ri > 0) [r, c] = [ri - 1, columns.length - 1];
    }
    if (order[r] === undefined) return;
    select(order[r]!, columns[c]!.key);
  };

  /** Start typing into a saved cell: with what it holds, or with the key pressed (which replaces it). */
  const edit = (rowKey: string, colKey: string, typed?: string) => {
    if (readOnly) return;
    const row = rows.find((r) => r.key === rowKey);
    const col = columns.find((c) => c.key === colKey);
    if (!row || !col?.input) return;
    setMenu(null);
    setSel({ row: rowKey, col: colKey });
    setCell({ row: rowKey, col: colKey, value: typed ?? valueOf(row, colKey) });
    focus(cellId(rowKey, colKey));
  };

  /** Save one cell (only if it changed); it shows the new value while saving. */
  const saveValue = (rowKey: string, colKey: string, value: string) => {
    const row = rows.find((r) => r.key === rowKey);
    const col = columns.find((x) => x.key === colKey);
    if (!row || !col || value === (row.values[colKey] ?? "")) return;
    if (col.required && !value.trim()) {
      setMessage(col.required);
      return;
    }
    const id = cellId(rowKey, colKey);
    setShown((m) => new Map(m).set(id, value));
    void run(rowKey, (reason) => onEdit(rowKey, { [colKey]: value }, reason)).then(() =>
      setShown((m) => {
        const n = new Map(m);
        n.delete(id);
        return n;
      }),
    );
  };


  /** Save the cell being typed into, then move. */
  const commit = (move?: "down" | "up" | "next" | "prev") => {
    const c = open.current;
    if (!c) return;
    open.current = null;
    setCell(null);
    if (move) step(c, move);
    else requestAnimationFrame(() => gridRef.current?.focus({ preventScroll: true }));
    saveValue(c.row, c.col, c.value);
  };

  const cellKeyDown = (e: KeyboardEvent<HTMLElement>, col: LineColumn) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      commit("down");
    } else if (e.key === "Tab") {
      e.preventDefault();
      commit(e.shiftKey ? "prev" : "next");
    } else if (e.key === "Escape") {
      e.preventDefault();
      open.current = null;
      setCell(null);
      requestAnimationFrame(() => gridRef.current?.focus({ preventScroll: true }));
    } else if (col.input !== "textarea" && !isChoice(col) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      commit(e.key === "ArrowUp" ? "up" : "down");
    }
  };

  /** Keys on the grid when a cell is selected but not being typed into. */
  const gridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!sel || cell || sel.row === "entry" || e.target !== gridRef.current) return;
    const col = columns.find((c) => c.key === sel.col);
    const row = rows.find((r) => r.key === sel.row);
    if (!col || !row) return;
    const k = e.key;
    const i = rows.indexOf(row);
    const mod = e.ctrlKey || e.metaKey;
    // Row actions, with the keys spreadsheets use.
    if (!readOnly) {
      const siblings = rows.filter((x) => x.parentKey === row.parentKey);
      const at = siblings.indexOf(row);
      if (mod && k === "Enter") {
        e.preventDefault();
        insertBelow(row);
        return;
      }
      if (e.altKey && e.shiftKey && (k === "ArrowRight" || k === "ArrowLeft")) {
        e.preventDefault();
        if (flat) return;
        if (k === "ArrowRight" && canIndent(rows, i)) void move(row, "indent");
        else if (k === "ArrowLeft" && row.parentKey) void move(row, "outdent");
        return;
      }
      if (e.altKey && !e.shiftKey && (k === "ArrowUp" || k === "ArrowDown")) {
        e.preventDefault();
        if (k === "ArrowUp" ? at > 0 : at < siblings.length - 1) void move(row, k === "ArrowUp" ? "up" : "down");
        return;
      }
      if (mod && k.toLowerCase() === "d") {
        e.preventDefault();
        void duplicate(row);
        return;
      }
      if (mod && (k === "Delete" || k === "Backspace" || k === "-")) {
        e.preventDefault();
        void remove(row, i);
        return;
      }
      if (k === "ContextMenu" || (e.shiftKey && k === "F10")) {
        e.preventDefault();
        const box = gridRef.current?.querySelector(`[data-cell="${CSS.escape(cellId(row.key, col.key))}"]`)?.getBoundingClientRect();
        setCtx({ row: row.key, x: box ? box.left + 12 : 0, y: box ? box.bottom : 0 });
        return;
      }
    }
    if (k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight") {
      e.preventDefault();
      step(sel, k === "ArrowUp" ? "up" : k === "ArrowDown" ? "down" : k === "ArrowLeft" ? "left" : "right");
    } else if (k === "Tab") {
      e.preventDefault();
      step(sel, e.shiftKey ? "prev" : "next");
    } else if (k === "Enter" || k === "F2") {
      e.preventDefault();
      edit(sel.row, sel.col);
    } else if ((k === "Delete" || k === "Backspace") && col.input && !isChoice(col)) {
      e.preventDefault();
      if (valueOf(row, col.key)) saveValue(row.key, col.key, "");
    } else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "c") {
      e.preventDefault();
      void navigator.clipboard?.writeText(valueOf(row, col.key));
    } else if (k === "Escape") {
      setSel(null);
    } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && col.input && !isChoice(col)) {
      // Typing on a selected cell replaces what it holds, like a spreadsheet.
      e.preventDefault();
      edit(sel.row, sel.col, k);
    }
  };

  const remove = async (row: LineRow, i: number) => {
    setMenu(null);
    setCtx(null);
    const block = [row, ...rows.filter((r) => r.parentKey === row.key)];
    const before = rows[i - 1];
    const removedRow = {
      label: `${noun} ${numbers[i]}${block.length > 1 ? ` and its ${block.length - 1} part${block.length === 2 ? "" : "s"}` : ""}`,
      lines: block.map((b, n) => ({ values: b.values, partOf: n === 0 ? null : 0 })),
      at: row.parentKey
        ? { afterKey: before && before.key !== row.parentKey ? before.key : row.parentKey, parentKey: row.parentKey }
        : { afterKey: lineBefore(rows, i)?.key ?? null, parentKey: null },
    };
    await run(
      row.key,
      (reason) => onRemove(row.key, reason),
      () => {
        setCell((c) => (c?.row === row.key ? null : c));
        setSel((s) => (s?.row === row.key ? null : s));
        setRemoved(removedRow);
      },
    );
  };

  const undo = async () => {
    if (!removed) return;
    const { lines, at } = removed;
    setRemoved(null);
    // The first line has no line before it to go after: it comes back at the end.
    await run("entry", (reason) => onAdd(lines, at, reason));
  };

  const backToGrid = () => requestAnimationFrame(() => gridRef.current?.focus({ preventScroll: true }));

  const move = async (row: LineRow, to: LineMove) => {
    setMenu(null);
    setCtx(null);
    await run(row.key, (reason) => onMove(row.key, to, reason));
    backToGrid();
  };

  const duplicate = async (row: LineRow) => {
    setMenu(null);
    setCtx(null);
    await run(row.key, (reason) => onAdd([{ values: row.values, partOf: null }], { afterKey: row.key, parentKey: row.parentKey }, reason));
    backToGrid();
  };

  /** Opens the new row right under this one (after its parts), at its level. */
  const insertBelow = (row: LineRow) => {
    setMenu(null);
    setCtx(null);
    setEntryAt({ afterKey: row.key, parentKey: row.parentKey });
    setEntry(initialValues(columns, row.parentKey));
    focus(entryCell(editable[0]!.key));
  };

  /** Opens the new row as the next part of this line. */
  const addPartTo = (row: LineRow) => {
    setMenu(null);
    setCtx(null);
    const lastPart = [...rows].reverse().find((x) => x.parentKey === row.key);
    setEntryAt({ afterKey: lastPart?.key ?? row.key, parentKey: row.key });
    setEntry(initialValues(columns, row.key));
    focus(entryCell(editable[0]!.key));
  };

  /** Does a row action (from the ⋯ menu, the right-click menu or the toolbar). */
  const act = (key: RowActionKey, r: LineRow) => {
    if (key === "below") insertBelow(r);
    else if (key === "part") addPartTo(r);
    else if (key === "out") void move(r, "outdent");
    else if (key === "in") void move(r, "indent");
    else if (key === "up" || key === "down") void move(r, key);
    else if (key === "dup") void duplicate(r);
    else void remove(r, rows.indexOf(r));
  };

  /** Everything that can be done to a row: the same in the ⋯ menu, the right-click menu and the toolbar. */
  const actionsFor = (r: LineRow): RowAction[] => {
    const i = rows.indexOf(r);
    const part = !!r.parentKey;
    const parts = rows.filter((p) => p.parentKey === r.key).length;
    const siblings = rows.filter((x) => x.parentKey === r.parentKey);
    const at = siblings.indexOf(r);
    const list: RowAction[] = [
      { key: "below", icon: <Plus />, label: `Insert ${part ? "a part" : an(noun)} below`, short: "Insert below", hint: "Ctrl+Enter" },
    ];
    if (!flat && !part) list.push({ key: "part", icon: <ListPlus />, label: "Add a part to it", short: "Add a part" });
    if (!flat)
      list.push(
        part
          ? { key: "out", icon: <IndentDecrease />, label: `Make it ${an(noun)} of its own`, short: "Move out", hint: "Alt+Shift+←" }
          : {
              key: "in",
              icon: <IndentIncrease />,
              label: canIndent(rows, i) ? `Make it a part of ${numbers[rows.indexOf(lineAbove(rows, i)!)]}` : "Make it a part",
              short: "Make a part",
              hint: "Alt+Shift+→",
              disabled: !canIndent(rows, i),
            },
      );
    list.push(
      { key: "up", icon: <ArrowUp />, label: "Move up", short: "Up", hint: "Alt+↑", disabled: at === 0 },
      { key: "down", icon: <ArrowDown />, label: "Move down", short: "Down", hint: "Alt+↓", disabled: at === siblings.length - 1 },
      { key: "dup", icon: <Copy />, label: "Duplicate", short: "Duplicate", hint: "Ctrl+D" },
      {
        key: "del",
        icon: <Trash2 />,
        label: `Delete${parts ? ` with its ${parts} part${parts === 1 ? "" : "s"}` : ""}`,
        short: "Delete",
        hint: "Ctrl+Del",
        danger: true,
      },
    );
    return list;
  };

  /* ---------- what is shown */

  // Fixed widths stay; flexible ones (the description) take the rest, with a floor so the grid scrolls sideways on a phone like a sheet.
  const widthOf = (w: string) => (/fr|minmax|auto/.test(w) ? undefined : w);
  const flexible = columns.filter((c) => !widthOf(c.width)).length;
  const fixedRem = columns.reduce((t, c) => t + (widthOf(c.width) ? parseFloat(c.width) : 0), 0);
  const minWidth = `${3 + fixedRem + flexible * 16 + (readOnly ? 0 : 3)}rem`;
  const cellBase = "h-9 border border-line px-2 align-middle text-sm";

  // The number the new row will get: "24", or "1.3" when it is a part (the number says it, as in a sheet).
  const nextNo = (() => {
    if (entryAt.parentKey) {
      const kids = rows.filter((x) => x.parentKey === entryAt.parentKey);
      const after = entryAt.afterKey === entryAt.parentKey ? -1 : entryAt.afterKey ? kids.findIndex((x) => x.key === entryAt.afterKey) : kids.length - 1;
      return `${parentLabel(entryAt.parentKey)}.${after + 2}`;
    }
    const tops = rows.filter((x) => !x.parentKey);
    if (entryAt.afterKey) {
      const a = rows.find((x) => x.key === entryAt.afterKey);
      const top = a?.parentKey ? rows.find((x) => x.key === a.parentKey) : a;
      if (top) return String(tops.indexOf(top) + 2);
    }
    return String(tops.length + 1);
  })();
  const canBePart = !flat && (entryAt.parentKey !== null || lineAbove(rows, entryIndex >= 0 ? blockEnd(rows, entryIndex) : rows.length) !== null);

  const entryRow = readOnly ? null : (
    <tr key="entry" aria-label={`New ${entryAt.parentKey ? `part of ${parentLabel(entryAt.parentKey)}` : noun}`} className={cn(inline ? "bg-primary-soft/30" : "bg-surface")}>
      <td className={cn(cellBase, "bg-surface-2 px-1 text-center text-xs tabular")}>
        {canBePart ? (
          <button
            type="button"
            onClick={() => toPart(!entryAt.parentKey)}
            className={cn("rounded px-1 font-medium hover:bg-primary-soft", entryAt.parentKey ? "text-primary" : "text-muted")}
            title={entryAt.parentKey ? `Part ${nextNo}: click (or Shift+Tab) to make it ${an(noun)} of its own` : `New ${noun} ${nextNo}: click (or Tab) to make it a part of the ${noun} above`}
            aria-label={entryAt.parentKey ? `New part ${nextNo}; make it ${an(noun)} of its own` : `New ${noun} ${nextNo}; make it a part`}
          >
            {nextNo}
          </button>
        ) : (
          <span className="text-muted">{nextNo}</span>
        )}
      </td>
      {columns.map((c) => (
        <td
          key={c.key}
          className={cn(cellBase, "p-0", sel?.row === "entry" && sel.col === c.key && "outline-2 -outline-offset-2 outline-primary has-[:focus]:outline-transparent")}
          onMouseDown={() => setSel({ row: "entry", col: c.key })}
        >
          {c.input ? (
            <GridInput
              col={c}
              value={entry[c.key] ?? ""}
              onChange={(v) => setEntry((s) => ({ ...s, [c.key]: v }))}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp" && c.input !== "textarea" && !isChoice(c)) {
                  const above = order[order.indexOf("entry") - 1];
                  if (above) {
                    e.preventDefault();
                    select(above, c.key);
                    return;
                  }
                }
                entryKey(e, c);
              }}
              onFocus={() => setSel({ row: "entry", col: c.key })}
              onPaste={c.input === "textarea" ? entryPaste : undefined}
              inputRef={ref(entryCell(c.key))}
              label={`New ${noun}: ${c.label}`}
              placeholder={
                c.input === "textarea"
                  ? entryAt.parentKey
                    ? `A part of ${noun} ${parentLabel(entryAt.parentKey)} — Enter adds it`
                    : rows.length
                      ? `New ${noun}: type, Enter adds it`
                      : `First ${noun}: type, or paste rows from Excel`
                  : c.placeholder
              }
            />
          ) : null}
        </td>
      ))}
      <td className={cn(cellBase, "px-1 text-center")}>
        {busy === "entry" ? (
          <Loader2 className="mx-auto size-4 animate-spin text-muted" aria-label="Saving" />
        ) : (
          <span className="flex justify-center gap-0.5">
            <Button
              size="icon-xs"
              variant="primary"
              onClick={() => void submitEntry()}
              aria-label={`Add the ${noun}`}
              title="Add (Enter)"
              disabled={isBlank(entry, columns, entryAt.parentKey)}
            >
              <Check aria-hidden />
            </Button>
            {inline && (
              <Button size="icon-xs" variant="ghost" onClick={() => setEntryAt({ afterKey: null, parentKey: null })} aria-label="Stop adding here" title="Esc">
                <X aria-hidden />
              </Button>
            )}
          </span>
        )}
      </td>
    </tr>
  );

  return (
    <div className="flex flex-col gap-2">
      {(rows.length > 8 || anyParts || tools || !readOnly || sheet) && (
        <div className="flex flex-wrap items-center gap-2">
          {rows.length > 8 && (
            <div className="relative min-w-0 flex-1 basis-48">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Find in ${rows.length} ${noun}s…`}
                aria-label={`Find ${an(noun)}`}
                className="h-8 pl-8"
                onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
              />
            </div>
          )}
          {anyParts && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setFolded((f) => (f.size ? new Set() : new Set(rows.filter((r) => hasParts(rows, r.key)).map((r) => r.key))))}
            >
              {folded.size ? <ChevronRight aria-hidden /> : <ChevronDown aria-hidden />} {folded.size ? "Show all parts" : "Hide parts"}
            </Button>
          )}
          {!readOnly && (
            <Button size="xs" variant="ghost" onClick={() => setPasteOpen((o) => !o)} aria-expanded={pasteOpen}>
              <ClipboardPaste aria-hidden /> Paste a list
            </Button>
          )}
          {sheet && (
            <ExcelMenu
              noun={`${noun}s`}
              template={
                canUpload
                  ? () => lineTemplate({ name: `${sheet.name} - template`, columns, noun, flat, rows: sheet.templateRows })
                  : undefined
              }
              onUpload={
                canUpload
                  ? (read, file) => {
                      setPasteOpen(false);
                      setFromFile({ file, read: linesFromSheet(read, { columns, flat, initial: (p) => initialValues(columns, p) }) });
                    }
                  : undefined
              }
              exportSheet={rows.length ? () => lineExport({ name: sheet.name, columns, rows, numbers }) : undefined}
            />
          )}
          {tools}
        </div>
      )}

      {fromFile && (
        <FilePanel
          file={fromFile.file}
          read={fromFile.read}
          noun={noun}
          already={rows.length}
          busy={busy === "entry"}
          onAdd={() => void addFromFile(fromFile.read)}
          onCancel={() => setFromFile(null)}
        />
      )}

      {pasteOpen && (
        <PastePanel
          text={pasteText}
          setText={setPasteText}
          noun={noun}
          onAdd={(items) => void addPasted(items)}
          onCancel={() => setPasteOpen(false)}
          busy={busy === "entry"}
        />
      )}

      {!readOnly && (
        // Like a sheet's toolbar: what can be done to the selected row, always in the same place.
        <div
          role="toolbar"
          aria-label={selRow ? `Actions for ${rowLabel(rows.indexOf(selRow))}` : "Row actions"}
          className="flex min-h-9 flex-wrap items-center gap-0.5 rounded-lg border border-line bg-surface-2/60 px-1.5 py-1"
        >
          {selRow ? (
            <>
              <span className="mr-1 px-1 text-xs font-medium text-text-2 tabular">{rowLabel(rows.indexOf(selRow))}</span>
              {actionsFor(selRow).map((a) => (
                <Button
                  key={a.key}
                  size="xs"
                  variant={a.danger ? "danger-ghost" : "ghost"}
                  onClick={() => act(a.key, selRow)}
                  disabled={a.disabled || busy === selRow.key}
                  title={a.hint ? `${a.label} (${a.hint})` : a.label}
                  aria-label={a.label}
                >
                  {a.icon}
                  <span className="hidden sm:inline">{a.short}</span>
                </Button>
              ))}
            </>
          ) : (
            <span className="px-1 text-xs text-muted">Select a row (click its number) or right-click it to insert, make a part, move, duplicate or delete.</span>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div
          ref={gridRef}
          tabIndex={-1}
          onKeyDown={gridKeyDown}
          className="relative overflow-x-auto outline-none"
          aria-label={`${noun[0]!.toUpperCase()}${noun.slice(1)}s`}
          role="region"
        >
          <table role="grid" aria-rowcount={rows.length + 1} className="w-full border-collapse [&_tr>*:first-child]:border-l-0 [&_tr>*:last-child]:border-r-0" style={{ minWidth }}>
            <colgroup>
              <col style={{ width: "3rem" }} />
              {columns.map((c) => (
                <col key={c.key} style={{ width: widthOf(c.width) }} />
              ))}
              {!readOnly && <col style={{ width: "3rem" }} />}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="h-8 border border-t-0 border-line bg-surface-2 px-1 text-center text-xs font-medium text-muted">
                  No.
                </th>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={cn("h-8 border border-t-0 border-line bg-surface-2 px-2 text-left text-xs font-medium whitespace-nowrap text-text-2", c.align === "right" && "text-right")}
                  >
                    {c.label}
                  </th>
                ))}
                {!readOnly && (
                  <th scope="col" className="h-8 border border-t-0 border-line bg-surface-2">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && readOnly && (
                <tr>
                  <td colSpan={columns.length + 1} className="px-3 py-6 text-center text-sm text-muted">
                    {empty ?? `No ${noun}s yet.`}
                  </td>
                </tr>
              )}
              {rows.length === 0 && !readOnly && empty && (
                <tr>
                  <td colSpan={columns.length + 2} className="px-3 py-2 text-sm text-muted">
                    {empty}
                  </td>
                </tr>
              )}
              {q && !visible.length && (
                <tr>
                  <td colSpan={columns.length + 2} className="px-3 py-4 text-sm text-muted">
                    Nothing matches &ldquo;{query}&rdquo;.
                  </td>
                </tr>
              )}
              {visible.map(({ r, i }) => {
                const no = numbers[i]!;
                const label = rowLabel(i);
                const parts = rows.filter((p) => p.parentKey === r.key).length;
                const rowSelected = sel?.row === r.key;
                return [
                  <tr
                    key={r.key}
                    aria-label={label}
                    aria-rowindex={i + 1}
                    className={cn("group", rowSelected && "bg-primary-soft/20")}
                    onContextMenu={(e) => {
                      if (readOnly || cell) return;
                      e.preventDefault();
                      setSel((s) => (s?.row === r.key ? s : { row: r.key, col: (editable[0] ?? columns[0]!).key }));
                      setCtx({ row: r.key, x: e.clientX, y: e.clientY });
                    }}
                  >
                    <th
                      scope="row"
                      className={cn(
                        cellBase,
                        "relative bg-surface-2 px-1 text-center text-xs font-normal whitespace-nowrap text-muted tabular",
                        !readOnly && "cursor-pointer hover:bg-surface-3",
                        rowSelected && "bg-primary-soft text-primary hover:bg-primary-soft",
                      )}
                      title={readOnly ? undefined : "Select the row; right-click for its actions"}
                      onMouseDown={(e) => {
                        if (readOnly || (e.target as HTMLElement).closest("button")) return;
                        e.preventDefault();
                        if (cell) commit();
                        select(r.key, (editable[0] ?? columns[0]!).key);
                        gridRef.current?.focus({ preventScroll: true }); // now, so a shortcut pressed right after works
                      }}
                    >
                      <span className="inline-flex items-center gap-0.5">
                        {parts > 0 && !q ? (
                          // At the edge, so a click on the number itself selects the row.
                          <button
                            type="button"
                            className="absolute top-1/2 left-0 -translate-y-1/2 rounded p-0.5 text-muted hover:bg-surface-3"
                            aria-label={folded.has(r.key) ? `Show the ${parts} parts of ${no}` : `Hide the parts of ${no}`}
                            aria-expanded={!folded.has(r.key)}
                            onClick={() =>
                              setFolded((f) => {
                                const n = new Set(f);
                                if (n.has(r.key)) n.delete(r.key);
                                else n.add(r.key);
                                return n;
                              })
                            }
                          >
                            {folded.has(r.key) ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                          </button>
                        ) : null}
                        {no}
                      </span>
                    </th>
                    {columns.map((c, n) => {
                      const isSel = sel?.row === r.key && sel.col === c.key;
                      const isEditing = cell?.row === r.key && cell.col === c.key;
                      const value = valueOf(r, c.key);
                      return (
                        <td
                          key={c.key}
                          role="gridcell"
                          aria-selected={isSel}
                          aria-readonly={!c.input || readOnly}
                          title={!readOnly && c.input && isSel && !isEditing ? "Type, or press Enter, to change it" : undefined}
                          data-cell={cellId(r.key, c.key)}
                          className={cn(
                            cellBase,
                            isEditing ? "p-0" : "py-1",
                            c.align === "right" && "text-right tabular",
                            isSel && !isEditing && "outline-2 -outline-offset-2 outline-primary",
                            !readOnly && c.input && "cursor-cell",
                            !c.input && !isEditing && "bg-surface-2/40 text-text-2",
                          )}
                          onMouseDown={(e) => {
                            if (isEditing || (e.target as HTMLElement).closest("button,a,input,textarea,select")) return;
                            e.preventDefault();
                            if (cell) commit();
                            // A dropdown opens with one click, as in a sheet; other cells take a second click (or typing).
                            if (isSel || (isChoice(c) && !readOnly)) edit(r.key, c.key);
                            else select(r.key, c.key);
                          }}
                          onDoubleClick={() => edit(r.key, c.key)}
                        >
                          {isEditing ? (
                            <GridInput
                              col={c}
                              value={cell.value}
                              onChange={(v) => setCell((x) => x && { ...x, value: v })}
                              onPick={(v) => {
                                // A choice from a dropdown is saved at once, as in a sheet.
                                setCell((x) => x && { ...x, value: v });
                                commit();
                              }}
                              autoOpen
                              onKeyDown={(e) => cellKeyDown(e, c)}
                              onBlur={() => commit()}
                              inputRef={ref(cellId(r.key, c.key))}
                              label={`${label}: ${c.label}`}
                            />
                          ) : n === 0 ? (
                            <span className="block min-w-0">
                              <span className="line-clamp-3 whitespace-pre-line">{c.format ? c.format({ ...r.values, [c.key]: value }, r) : value}</span>
                              {r.badge}
                            </span>
                          ) : isChoice(c) && !readOnly ? (
                            <span className="flex items-center justify-between gap-1">
                              <span className="min-w-0 truncate">
                                {c.format ? c.format(Object.fromEntries(columns.map((x) => [x.key, valueOf(r, x.key)])), r) : value || <span className="text-muted">—</span>}
                              </span>
                              <ChevronDown className="size-3.5 shrink-0 text-muted" aria-hidden />
                            </span>
                          ) : c.format ? (
                            c.format(Object.fromEntries(columns.map((x) => [x.key, valueOf(r, x.key)])), r)
                          ) : (
                            value || <span className="text-muted">—</span>
                          )}
                        </td>
                      );
                    })}
                    {!readOnly && (
                      <td className={cn(cellBase, "relative px-1 text-center")}>
                        {busy === r.key ? (
                          <Loader2 className="mx-auto size-4 animate-spin text-muted" aria-label="Saving" />
                        ) : (
                          <Button
                            id={`rowmenu-${menuId}-${r.key}`}
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => setMenu(menu === r.key ? null : r.key)}
                            aria-label={`More for ${label}`}
                            aria-haspopup="menu"
                            aria-expanded={menu === r.key}
                            className={cn(!rowSelected && menu !== r.key && "sm:opacity-40 sm:group-hover:opacity-100")}
                          >
                            <MoreHorizontal aria-hidden />
                          </Button>
                        )}
                        {menu === r.key && (
                          <RowMenu onClose={closeMenu} anchorId={`rowmenu-${menuId}-${r.key}`} label={label}>
                            {actionsFor(r).map((a) => (
                              <MenuItem key={a.key} icon={a.icon} onClick={() => act(a.key, r)} disabled={a.disabled} danger={a.danger} hint={a.hint}>
                                {a.label}
                              </MenuItem>
                            ))}
                          </RowMenu>
                        )}
                      </td>
                    )}
                  </tr>,
                  entryAfter === i ? entryRow : null,
                ];
              })}
              {entryAfter === null && entryRow}
            </tbody>
          </table>
        </div>
        {(offer || adding.length > 0) && (
          <div className="flex flex-col gap-1.5 border-t border-line px-3 py-2">
            {offer && (
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-info-soft px-3 py-2 text-sm">
                <span>
                  {offer.items.length} lines pasted. Make them {offer.items.length} {noun}s?
                </span>
                <Button size="xs" variant="primary" onClick={() => void addPasted(offer.items).then(() => setEntry((v) => ({ ...v, description: offer.before })))}>
                  Add {offer.items.length} {noun}s
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setOffer(null)}>
                  Keep as one description
                </Button>
              </div>
            )}
            {adding.map((v, n) => (
              <div key={n} className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> {(v.description ?? "").split("\n")[0]}
              </div>
            ))}
          </div>
        )}
        {footer && <div className="border-t border-line bg-surface lg:sticky lg:bottom-0">{footer}</div>}
      </div>

      {ctxRow && (
        <FloatingMenu anchor={ctxAnchor} onClose={closeCtx} label={rowLabel(rows.indexOf(ctxRow))} width={260} align="start">
          {actionsFor(ctxRow).map((a) => (
            <MenuItem key={a.key} icon={a.icon} onClick={() => act(a.key, ctxRow)} disabled={a.disabled} danger={a.danger} hint={a.hint}>
              {a.label}
            </MenuItem>
          ))}
        </FloatingMenu>
      )}

      {error && <p className="text-xs text-bad">{error}</p>}
      {/* Notices stay in view at the bottom of the screen: with 100+ lines the row may be far from the top. */}
      {(pending || message || removed) && (
        <div className="fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 lg:bottom-6 lg:pl-60">
          <div className="flex w-full max-w-2xl flex-col gap-2">
            {pending && (
              <ReasonBox
                pending={pending}
                onCancel={() => {
                  setPending(null);
                  setCell(null);
                }}
              />
            )}
            {message && (
              <p role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad shadow-pop">
                {message}
                <button type="button" onClick={() => setMessage(null)} aria-label="Close" className="text-muted">
                  <X className="size-4" />
                </button>
              </p>
            )}

            {removed && (
              <div role="status" className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-pop">
                <span>Removed {removed.label}.</span>
                <span className="flex gap-1">
                  <Button size="xs" variant="secondary" onClick={() => void undo()}>
                    Undo
                  </Button>
                  <Button size="icon-xs" variant="ghost" onClick={() => setRemoved(null)} aria-label="Close">
                    <X aria-hidden />
                  </Button>
                </span>
              </div>
            )}
          </div>
        </div>
      )}
      {!readOnly && (
        <div className="text-xs text-muted">
          <p>
            Works like a sheet: click a cell and type, <Kbd>Enter</Kbd> saves and goes down, paste rows from Excel into the last row.
            {flat ? "" : <> A number like 1.1 is a part of line 1: <Kbd>Tab</Kbd> on an empty new row (or a click on its number) makes it one.</>}
          </p>
          <details className="mt-1">
            <summary className="inline-flex cursor-pointer items-center gap-1 rounded hover:text-text">
              <Keyboard className="size-3.5" aria-hidden /> Keyboard
            </summary>
            <ul className="mt-1 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              <li><Kbd>Enter</Kbd> or <Kbd>F2</Kbd> change the cell · <Kbd>Esc</Kbd> cancel</li>
              <li><Kbd>Tab</Kbd> and arrows move · <Kbd>Delete</Kbd> clears the cell</li>
              <li><Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> insert a row below</li>
              {!flat && (
                <li>
                  <Kbd>Alt</Kbd>+<Kbd>Shift</Kbd>+<Kbd>→</Kbd> make it a part · <Kbd>←</Kbd> move it out
                </li>
              )}
              <li><Kbd>Alt</Kbd>+<Kbd>↑</Kbd>/<Kbd>↓</Kbd> move the row</li>
              <li><Kbd>Ctrl</Kbd>+<Kbd>D</Kbd> duplicate · <Kbd>Ctrl</Kbd>+<Kbd>Del</Kbd> delete the row</li>
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}

/** The line before row i at the same level (for putting a removed line back). */
function lineBefore(rows: LineRow[], i: number) {
  for (let j = i - 1; j >= 0; j--) if (!rows[j]!.parentKey) return rows[j]!;
  return null;
}

/* ---------------------------------------------------------------- pieces */

/** A box that fills its grid cell, with no frame of its own (the cell is the frame). */
function GridInput({
  col,
  value,
  onChange,
  onPick,
  autoOpen,
  onKeyDown,
  onPaste,
  onFocus,
  onBlur,
  inputRef,
  label,
  placeholder,
}: {
  col: LineColumn;
  value: string;
  onChange: (v: string) => void;
  /** A choice made in a dropdown (saved cells save it at once); else onChange. */
  onPick?: (v: string) => void;
  /** Open the dropdown as soon as it shows (a saved cell clicked to change). */
  autoOpen?: boolean;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onPaste?: (e: ClipboardEvent<HTMLTextAreaElement | HTMLInputElement>) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  inputRef: (el: HTMLElement | null) => void;
  label: string;
  placeholder?: string;
}) {
  const cls = cn(
    "block h-9 w-full min-w-0 border-0 bg-transparent px-2 text-sm outline-none placeholder:text-muted/70 focus:bg-surface focus:ring-2 focus:ring-primary focus:ring-inset",
    col.align === "right" && "text-right tabular",
  );
  if (col.input === "textarea")
    return (
      <textarea
        ref={inputRef}
        aria-label={label}
        value={value}
        rows={1}
        maxLength={col.maxLength ?? 2000}
        placeholder={placeholder ?? col.placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onFocus={onFocus}
        onBlur={onBlur}
        className={cn(cls, "min-h-9 resize-none py-2 leading-5 [field-sizing:content]")}
      />
    );
  if (col.input === "unit")
    return (
      <UnitInput
        value={value}
        onChange={onChange}
        onPick={onPick ?? onChange}
        autoOpen={autoOpen}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        inputRef={inputRef}
        label={label}
        maxLength={col.maxLength}
        className={cls}
      />
    );
  if (col.input === "select")
    return (
      <select ref={inputRef} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} onFocus={onFocus} onBlur={onBlur} className={cn(cls, "pr-6")}>
        {col.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  return (
    <input
      ref={inputRef}
      aria-label={label}
      value={value}
      inputMode={col.input === "number" ? "decimal" : undefined}
      maxLength={col.maxLength}
      placeholder={placeholder ?? col.placeholder ?? col.label}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onFocus={onFocus}
      onBlur={onBlur}
      className={cls}
    />
  );
}

/**
 * The unit: a dropdown of the usual units. "Other…" turns it into a box to
 * type any unit; a unit that is not in the list shows as its own choice.
 */
function UnitInput({
  value,
  onChange,
  onPick,
  autoOpen,
  onKeyDown,
  onFocus,
  onBlur,
  inputRef,
  label,
  maxLength,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (v: string) => void;
  autoOpen?: boolean;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  inputRef: (el: HTMLElement | null) => void;
  label: string;
  maxLength?: number;
  className: string;
}) {
  const [typing, setTyping] = useState(false);
  const own = useRef<HTMLSelectElement | HTMLInputElement | null>(null);
  const setRef = (el: HTMLSelectElement | HTMLInputElement | null) => {
    own.current = el;
    inputRef(el);
  };
  useEffect(() => {
    const el = own.current;
    if (typing && el instanceof HTMLInputElement) {
      el.focus();
      el.select();
    } else if (autoOpen && el instanceof HTMLSelectElement) {
      try {
        el.showPicker();
      } catch {
        // Not every browser opens it from here; a click on it does.
      }
    }
  }, [typing, autoOpen]);
  if (typing)
    return (
      <input
        ref={setRef}
        aria-label={`${label} (type it)`}
        value={value}
        maxLength={maxLength ?? 20}
        placeholder="Type a unit"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !value.trim()) {
            e.preventDefault();
            setTyping(false);
            return;
          }
          onKeyDown(e);
        }}
        onFocus={onFocus}
        onBlur={onBlur}
        className={className}
      />
    );
  const known = UNITS.includes(value);
  return (
    <select
      ref={setRef}
      aria-label={label}
      value={value}
      onChange={(e) => {
        if (e.target.value === OTHER_UNIT) setTyping(true);
        else onPick(e.target.value);
      }}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={(e) => {
        // Switching to "Other…" is not leaving the cell.
        if (e.target.value !== OTHER_UNIT && !typing) onBlur?.();
      }}
      className={cn(className, "cursor-pointer pr-5")}
    >
      {!value && <option value="">—</option>}
      {!known && value && <option value={value}>{value}</option>}
      {UNITS.map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
      <option value={OTHER_UNIT}>Other…</option>
    </select>
  );
}

function RowMenu({ children, onClose, anchorId, label }: { children: ReactNode; onClose: () => void; anchorId: string; label: string }) {
  return (
    <FloatingMenu anchor={() => document.getElementById(anchorId)} onClose={onClose} label={label} width={240}>
      {children}
    </FloatingMenu>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  disabled,
  danger,
  hint,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Its key, shown on the right as in a desktop menu. */
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:text-muted",
        danger && "border-t border-line text-bad hover:bg-bad-soft [&_svg]:text-bad",
      )}
    >
      {icon}
      <span className="flex-1 text-left">{children}</span>
      {hint && <span className="ml-3 hidden text-xs text-muted sm:inline">{hint}</span>}
    </button>
  );
}

function ReasonBox({ pending, onCancel }: { pending: Pending; onCancel: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const go = async () => {
    setBusy(true);
    await pending.run(value.trim());
    setBusy(false);
  };
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-lg border border-info/30 bg-info-soft p-3 text-sm shadow-pop">
      <div className="flex items-start gap-2">
        <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <div>
          <span className="block font-medium">Why?</span>
          <span className="text-text-2">{pending.message} It is kept in the history.</span>
        </div>
      </div>
      {pending.choices.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick reasons">
          {pending.choices.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={value === c}
              onClick={() => setValue(c)}
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs hover:border-line-strong aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary"
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          ref={input}
          aria-label="Reason"
          maxLength={500}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (value.trim()) void go();
            }
          }}
          placeholder="Choose above or write the reason"
          className="min-w-0 flex-1 basis-56"
        />
        <Button size="sm" variant="primary" onClick={() => void go()} disabled={!value.trim() || busy}>
          {busy ? "Saving…" : "Save with this reason"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function PastePanel({
  text,
  setText,
  noun,
  onAdd,
  onCancel,
  busy,
}: {
  text: string;
  setText: (v: string) => void;
  noun: string;
  onAdd: (items: PastedItem[]) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const items = text.trim() ? parseList(text) : [];
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3">
      <label htmlFor="paste-lines" className="text-sm font-medium">
        Paste a list
      </label>
      <p className="text-xs text-muted">
        From Excel, WhatsApp or an email: one {noun} per line. A quantity at the end (&ldquo;× 200 pcs&rdquo;) is picked up; indented,
        bulleted or &ldquo;2.1&rdquo; lines become parts of the {noun} above.
      </p>
      <Textarea
        id="paste-lines"
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Gate valve DN100 PN16 x 200 pcs\nBall valve 2" – 50 pcs\n  - handle, stainless'}
      />
      {items.length > 0 && (
        <ol className="max-h-48 overflow-auto rounded-md border border-line bg-surface text-sm">
          {pastedNumbers(items).map((no, n) => {
            const p = items[n]!;
            return (
            <li key={n} className="flex justify-between gap-3 border-b border-line px-2 py-1 last:border-0">
              <span className="truncate">
                <span className="mr-2 inline-block w-8 text-xs text-muted tabular">{no}</span>
                {p.description}
                {p.model && <span className="text-muted"> · {p.model}</span>}
              </span>
              <span className="shrink-0 text-muted tabular">{p.quantity ? `${p.quantity} ${p.unit}`.trim() : "no qty"}</span>
            </li>
            );
          })}
        </ol>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={() => onAdd(items)} disabled={!items.length || busy}>
          {busy ? "Adding…" : `Add ${items.length || ""} ${noun}${items.length === 1 ? "" : "s"}`}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** The rows of an uploaded file, to look at before they are added (the good ones; each problem says why). */
function FilePanel({
  file,
  read,
  noun,
  already,
  busy,
  onAdd,
  onCancel,
}: {
  file: string;
  read: SheetLines;
  noun: string;
  /** Lines already here: the new ones go after them. */
  already: number;
  busy: boolean;
  onAdd: () => void;
  onCancel: () => void;
}) {
  const good = read.lines.filter((l) => !l.problem).length;
  const bad = read.lines.length - good;
  const plural = (k: number) => `${k} ${noun}${k === 1 ? "" : "s"}`;
  return (
    <div role="region" aria-label={`Lines from ${file}`} className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary-soft/20 p-3">
      <p className="text-sm font-medium">From {file}</p>
      {read.error ? (
        <p className="text-sm text-bad">{read.error}</p>
      ) : (
        <>
          <p className="text-xs text-text-2">
            {plural(good)} to add{already ? `, after the ${already} already here` : ""}.
            {bad > 0 && <span className="text-bad"> {plural(bad)} with a problem {bad === 1 ? "is" : "are"} left out: fix the file and upload it again, or type {bad === 1 ? "it" : "them"} in.</span>}
            {read.unused.length > 0 && <span className="text-muted"> Not used: {read.unused.map((h) => `“${h}”`).join(", ")}.</span>}
          </p>
          <ol className="max-h-72 overflow-auto rounded-md border border-line bg-surface text-sm">
            {read.lines.map((l) => (
              <li key={l.fileRow} className={cn("flex justify-between gap-3 border-b border-line px-2 py-1 last:border-0", l.problem && "bg-bad-soft/50")}>
                <span className="min-w-0">
                  <span className="mr-2 inline-block w-8 text-xs text-muted tabular">{l.problem ? "—" : l.no}</span>
                  <span className={cn(l.partOf !== null && "pl-3")}>{(l.values.description ?? "").split("\n")[0] || <span className="text-muted">(no description)</span>}</span>
                  {l.values.model && <span className="text-muted"> · {l.values.model}</span>}
                  {l.problem && (
                    <span className="block text-xs text-bad">
                      Row {l.fileRow}: {l.problem}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-muted tabular">{l.values.quantity ? `${l.values.quantity} ${l.values.unit ?? ""}`.trim() : ""}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="flex gap-2">
        {!read.error && (
          <Button size="sm" variant="primary" onClick={onAdd} disabled={!good || busy}>
            {busy ? "Adding…" : `Add ${plural(good)}`}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {read.error ? "Close" : "Cancel"}
        </Button>
      </div>
    </div>
  );
}
