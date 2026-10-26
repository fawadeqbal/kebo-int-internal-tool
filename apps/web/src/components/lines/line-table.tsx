"use client";

import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  CornerDownRight,
  IndentDecrease,
  IndentIncrease,
  Loader2,
  MessageCircleQuestion,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { lineNumbers } from "@kebo/shared";
import { Button, cn, Input, Kbd, Textarea } from "@kebo/ui";
import { parseList, type PastedItem } from "@/components/deals/paste-list";

/* ---------------------------------------------------------------- types */

export type LineValues = Record<string, string>;

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
  input?: "textarea" | "number" | "text" | "select";
  options?: { value: string; label: string }[];
  placeholder?: string;
  /** <datalist> id for suggestions (units). */
  list?: string;
  maxLength?: number;
  /** The value for a new row (unit "pcs", tax "13"). */
  initial?: string | ((parentKey: string | null) => string);
  /** How a saved row shows the value. */
  format?: (values: LineValues, row: LineRow) => ReactNode;
  /** Must be filled in before a row is added or saved. */
  required?: string;
  /** Hidden on phones in saved rows (shown when the row is opened). */
  phoneHidden?: boolean;
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

const missing = (v: LineValues, columns: LineColumn[]) => columns.find((c) => c.required && !v[c.key]?.trim());

/* ---------------------------------------------------------------- the table */

type Pending = { run: (reason: string) => Promise<LineResult>; message: string; choices: string[] };
type Removed = { label: string; lines: NewLine[]; at: { afterKey: string | null; parentKey: string | null } };

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
}: LineTableProps) {
  const numbers = useMemo(() => lineNumbers(rows.map((r) => ({ key: r.key, parentKey: r.parentKey }))), [rows]);
  const grid = `2.75rem ${columns.map((c) => c.width).join(" ")} 5.5rem`;
  const editable = columns.filter((c) => c.input);

  // Adding: where the entry row is (at the end, or under a line), and what is typed in it.
  const [entryAt, setEntryAt] = useState<{ afterKey: string | null; parentKey: string | null }>({ afterKey: null, parentKey: null });
  const [entry, setEntry] = useState<LineValues>(() => initialValues(columns, null));
  const [adding, setAdding] = useState<LineValues[]>([]);
  // Changing one saved row.
  const [editing, setEditing] = useState<{ key: string; values: LineValues } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [removed, setRemoved] = useState<Removed | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [offer, setOffer] = useState<{ before: string; items: PastedItem[] } | null>(null);
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

  /* ---------- changing a saved row */

  const open = (row: LineRow) => {
    if (readOnly) return;
    if (editing && editing.key !== row.key) void save(); // keep what was typed in the other row
    setMenu(null);
    setEditing({ key: row.key, values: { ...row.values } });
    focus(`${row.key}:${editable[0]!.key}`);
  };

  const save = async () => {
    if (!editing) return;
    const row = rows.find((r) => r.key === editing.key);
    if (!row) return setEditing(null);
    const changed = Object.fromEntries(Object.entries(editing.values).filter(([k, v]) => (row.values[k] ?? "") !== v));
    if (!Object.keys(changed).length) return setEditing(null);
    const lack = missing(editing.values, columns);
    if (lack) {
      setMessage(lack.required!);
      return;
    }
    const key = editing.key;
    await run(
      key,
      (reason) => onEdit(key, changed, reason),
      () => setEditing((e) => (e?.key === key ? null : e)),
    );
  };

  const rowKeyDown = (e: KeyboardEvent<HTMLElement>, row: LineRow, col: LineColumn, i: number) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      void save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(null);
    } else if (col.input !== "textarea" && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      // Like a spreadsheet: the same column in the row above or below.
      const other = rows[i + (e.key === "ArrowUp" ? -1 : 1)];
      if (!other) return;
      e.preventDefault();
      void save().then(() => {
        setEditing({ key: other.key, values: { ...other.values } });
        focus(`${other.key}:${col.key}`);
      });
    }
  };

  const remove = async (row: LineRow, i: number) => {
    setMenu(null);
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
        setEditing((e) => (e?.key === row.key ? null : e));
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

  const move = async (row: LineRow, to: LineMove) => {
    setMenu(null);
    await run(row.key, (reason) => onMove(row.key, to, reason));
  };

  const duplicate = async (row: LineRow) => {
    setMenu(null);
    await run(row.key, (reason) => onAdd([{ values: row.values, partOf: null }], { afterKey: row.key, parentKey: row.parentKey }, reason));
  };

  /* ---------- what is shown */

  const q = query.trim().toLowerCase();
  const matches = (r: LineRow) => !q || Object.values(r.values).some((v) => v.toLowerCase().includes(q));
  const visible = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => {
      if (q) return matches(r) || rows.some((p) => p.parentKey === r.key && matches(p));
      return !(r.parentKey && folded.has(r.parentKey));
    });
  const anyParts = rows.some((r) => r.parentKey);
  const entryIndex = entryAt.afterKey ? rows.findIndex((r) => r.key === entryAt.afterKey) : -1;
  // An inline entry row goes after its line (and the line's parts when it adds whole lines).
  const anchor = entryIndex < 0 ? null : entryAt.parentKey ? entryIndex : blockEnd(rows, entryIndex) - 1;
  // Hidden by a search or folded parts: the new row shows at the end instead.
  const entryAfter = anchor !== null && visible.some((v) => v.i === anchor) ? anchor : null;

  const rowLabel = (i: number) => `${rows[i]!.parentKey ? "Part" : noun[0]!.toUpperCase() + noun.slice(1)} ${numbers[i]}`;

  // Only one new-row line exists: after a line (inline) or at the end.
  const inline = entryAfter !== null;
  const entryRow = readOnly ? null : (
    <div
      key="entry"
      className={cn(
        "grid items-start gap-x-2 gap-y-1.5 border-t border-dashed border-line bg-surface-2/40 px-1 py-1.5 max-sm:!grid-cols-1",
        inline && "border-y border-primary/40 bg-primary-soft/30",
      )}
      style={{ gridTemplateColumns: grid }}
      role="row"
      aria-label={`New ${entryAt.parentKey ? `part of ${parentLabel(entryAt.parentKey)}` : noun}`}
    >
      <span className="flex items-center gap-1 pt-2 text-xs text-muted">
        {entryAt.parentKey ? (
          <button
            type="button"
            onClick={() => toPart(false)}
            className="flex items-center gap-0.5 rounded px-1 text-primary hover:bg-primary-soft"
            title="Make it a whole line (Shift+Tab)"
          >
            <CornerDownRight className="size-3.5" aria-hidden />
            {parentLabel(entryAt.parentKey)}.
          </button>
        ) : (
          <Plus className="ml-1 size-4" aria-hidden />
        )}
      </span>
      {columns.map((c) =>
        c.input ? (
          <Cell
            key={c.key}
            col={c}
            value={entry[c.key] ?? ""}
            onChange={(v) => setEntry((s) => ({ ...s, [c.key]: v }))}
            onKeyDown={(e) => entryKey(e, c)}
            onPaste={c.input === "textarea" ? entryPaste : undefined}
            inputRef={ref(entryCell(c.key))}
            label={`New ${noun}: ${c.label}`}
            placeholder={
              c.input === "textarea"
                ? entryAt.parentKey
                  ? `A part of ${noun} ${parentLabel(entryAt.parentKey)} — Enter adds it`
                  : rows.length
                    ? `Next ${noun} — type and press Enter`
                    : `First ${noun} — type and press Enter, or paste a list`
                : c.placeholder
            }
          />
        ) : (
          <span key={c.key} className="max-sm:hidden" />
        ),
      )}
      <span className="flex items-center justify-end gap-0.5 pt-0.5">
        {busy === "entry" && <Loader2 className="size-4 animate-spin text-muted" aria-label="Saving" />}
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
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => setEntryAt({ afterKey: null, parentKey: null })}
            aria-label="Stop adding here"
            title="Esc"
          >
            <X aria-hidden />
          </Button>
        )}
      </span>
      {offer && (
        <div className="col-span-full flex flex-wrap items-center gap-2 rounded-md bg-info-soft px-3 py-2 text-sm">
          <span>
            {offer.items.length} lines pasted. Make them {offer.items.length} {noun}s?
          </span>
          <Button
            size="xs"
            variant="primary"
            onClick={() => void addPasted(offer.items).then(() => setEntry((v) => ({ ...v, description: offer.before })))}
          >
            Add {offer.items.length} {noun}s
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setOffer(null)}>
            Keep as one description
          </Button>
        </div>
      )}
      {adding.map((v, n) => (
        <div key={n} className="col-span-full flex items-center gap-2 px-1 text-sm text-muted">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> {(v.description ?? "").split("\n")[0]}
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      {(rows.length > 8 || anyParts || tools || !readOnly) && (
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
          {tools}
        </div>
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

      <div role="table" aria-label={`${noun[0]!.toUpperCase()}${noun.slice(1)}s`} className="rounded-lg border border-line">
        <div
          role="row"
          className="sticky top-14 z-10 grid gap-x-2 rounded-t-lg border-b border-line bg-surface-2 px-1 py-2 text-xs font-medium text-muted max-sm:hidden"
          style={{ gridTemplateColumns: grid }}
        >
          <span role="columnheader" className="pl-1">
            No.
          </span>
          {columns.map((c) => (
            <span key={c.key} role="columnheader" className={cn(c.align === "right" && "text-right")}>
              {c.label}
            </span>
          ))}
          <span role="columnheader" className="sr-only">
            Actions
          </span>
        </div>

        {rows.length === 0 && readOnly && <p className="px-3 py-6 text-center text-sm text-muted">{empty ?? `No ${noun}s yet.`}</p>}
        {rows.length === 0 && !readOnly && empty && <div className="px-3 pt-3 text-sm text-muted">{empty}</div>}
        {q && !visible.length && <p className="px-3 py-4 text-sm text-muted">Nothing matches &ldquo;{query}&rdquo;.</p>}

        {visible.map(({ r, i }) => {
          const no = numbers[i]!;
          const part = !!r.parentKey;
          const label = rowLabel(i);
          const parts = rows.filter((p) => p.parentKey === r.key).length;
          const isEditing = editing?.key === r.key;
          const siblings = rows.filter((x) => x.parentKey === r.parentKey);
          const at = siblings.indexOf(r);
          return (
            <div key={r.key}>
              <div
                role="row"
                aria-label={label}
                className={cn(
                  "group grid items-start gap-x-2 gap-y-1 border-t border-line px-1 py-1.5 first:border-t-0 max-sm:!grid-cols-[2.75rem_minmax(0,1fr)]",
                  isEditing ? "bg-primary-soft/40" : !readOnly && "cursor-pointer hover:bg-surface-2/60",
                  part && !isEditing && "bg-surface-2/20",
                )}
                style={{ gridTemplateColumns: grid }}
                onClick={(e) => {
                  if (isEditing || (e.target as HTMLElement).closest("button,a,input,textarea,select")) return;
                  open(r);
                }}
              >
                <span role="cell" className={cn("flex items-center gap-0.5 pt-1.5 text-sm text-muted tabular", part && "pl-2")}>
                  {parts > 0 && !q ? (
                    <button
                      type="button"
                      className="-ml-1 rounded p-0.5 hover:bg-surface-3"
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
                      {folded.has(r.key) ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                    </button>
                  ) : null}
                  {no}
                </span>
                {columns.map((c, n) =>
                  isEditing && c.input ? (
                    <Cell
                      key={c.key}
                      col={c}
                      value={editing.values[c.key] ?? ""}
                      onChange={(v) => setEditing((s) => s && { ...s, values: { ...s.values, [c.key]: v } })}
                      onKeyDown={(e) => rowKeyDown(e, r, c, i)}
                      inputRef={ref(`${r.key}:${c.key}`)}
                      label={`${label}: ${c.label}`}
                      indent={n === 0 && part}
                    />
                  ) : (
                    <span
                      key={c.key}
                      role="cell"
                      className={cn(
                        "min-w-0 py-1.5 text-sm",
                        c.align === "right" && "text-right tabular",
                        // On a phone the other columns show as one short line under the description.
                        n === 0 ? "max-sm:col-start-2" : "max-sm:hidden",
                      )}
                    >
                      {n === 0 ? (
                        <span className={cn("flex items-start gap-1", part && "pl-3")}>
                          {part && <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden />}
                          <span className="min-w-0">
                            <span className="line-clamp-3 whitespace-pre-line">{c.format ? c.format(r.values, r) : r.values[c.key]}</span>
                            {r.badge}
                            <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-text-2 sm:hidden">
                              {columns.slice(1).map((x) =>
                                x.phoneHidden || !(x.format || (r.values[x.key] ?? "").trim()) ? null : (
                                  <span key={x.key}>
                                    <span className="text-muted">{x.label} </span>
                                    {x.format ? x.format(r.values, r) : r.values[x.key]}
                                  </span>
                                ),
                              )}
                            </span>
                          </span>
                        </span>
                      ) : (
                        <>{c.format ? c.format(r.values, r) : r.values[c.key] || <span className="text-muted">—</span>}</>
                      )}
                    </span>
                  ),
                )}
                <span role="cell" className="relative flex items-start justify-end gap-0.5 pt-0.5 max-sm:col-start-2 max-sm:justify-start">
                  {busy === r.key && <Loader2 className="mt-1 size-4 animate-spin text-muted" aria-label="Saving" />}
                  {readOnly ? null : isEditing ? (
                    <>
                      <Button
                        size="icon-xs"
                        variant="primary"
                        onClick={() => void save()}
                        aria-label={`Save ${label}`}
                        title="Save (Enter)"
                      >
                        <Check aria-hidden />
                      </Button>
                      <Button size="icon-xs" variant="ghost" onClick={() => setEditing(null)} aria-label="Cancel" title="Cancel (Esc)">
                        <X aria-hidden />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => open(r)}
                        aria-label={`Change ${label}`}
                        className="sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                      >
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="danger-ghost"
                        onClick={() => void remove(r, i)}
                        aria-label={`Remove ${label}${parts ? ` and its ${parts} parts` : ""}`}
                        className="sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                      >
                        <Trash2 aria-hidden />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => setMenu(menu === r.key ? null : r.key)}
                        aria-label={`More for ${label}`}
                        aria-expanded={menu === r.key}
                      >
                        <MoreHorizontal aria-hidden />
                      </Button>
                    </>
                  )}
                  {menu === r.key && (
                    <RowMenu onClose={() => setMenu(null)}>
                      {!part && !flat && (
                        <MenuItem
                          icon={<Plus />}
                          onClick={() => {
                            setMenu(null);
                            const lastPart = [...rows].reverse().find((x) => x.parentKey === r.key);
                            setEntryAt({ afterKey: lastPart?.key ?? r.key, parentKey: r.key });
                            setEntry(initialValues(columns, r.key));
                            focus(entryCell(editable[0]!.key));
                          }}
                        >
                          Add a part
                        </MenuItem>
                      )}
                      <MenuItem
                        icon={<Plus />}
                        onClick={() => {
                          setMenu(null);
                          setEntryAt({ afterKey: r.key, parentKey: r.parentKey });
                          setEntry(initialValues(columns, r.parentKey));
                          focus(entryCell(editable[0]!.key));
                        }}
                      >
                        Add {part ? "a part" : an(noun)} below
                      </MenuItem>
                      {flat ? null : part ? (
                        <MenuItem icon={<IndentDecrease />} onClick={() => void move(r, "outdent")}>
                          Make it {an(noun)} of its own
                        </MenuItem>
                      ) : (
                        <MenuItem icon={<IndentIncrease />} onClick={() => void move(r, "indent")} disabled={!canIndent(rows, i)}>
                          Make it a part of {numbers[rows.indexOf(lineAbove(rows, i) ?? r)]}
                        </MenuItem>
                      )}
                      <MenuItem icon={<ArrowUp />} onClick={() => void move(r, "up")} disabled={at === 0}>
                        Move up
                      </MenuItem>
                      <MenuItem icon={<ArrowDown />} onClick={() => void move(r, "down")} disabled={at === siblings.length - 1}>
                        Move down
                      </MenuItem>
                      <MenuItem icon={<Copy />} onClick={() => void duplicate(r)}>
                        Duplicate
                      </MenuItem>
                    </RowMenu>
                  )}
                </span>
              </div>
              {entryAfter === i && entryRow}
            </div>
          );
        })}

        {entryAfter === null && entryRow}
        {footer && <div className="rounded-b-lg border-t border-line bg-surface lg:sticky lg:bottom-0">{footer}</div>}
      </div>

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
                  setEditing(null);
                }}
              />
            )}
            {message && (
              <p
                role="alert"
                className="flex items-center justify-between gap-2 rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad shadow-pop"
              >
                {message}
                <button type="button" onClick={() => setMessage(null)} aria-label="Close" className="text-muted">
                  <X className="size-4" />
                </button>
              </p>
            )}

            {removed && (
              <div
                role="status"
                className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-pop"
              >
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
        <p className="text-xs text-muted">
          <Kbd>Enter</Kbd> adds{flat ? "" : " · "}
          {!flat && (
            <>
              <Kbd>Tab</Kbd> on an empty new row makes it a part
            </>
          )}{" "}
          · click {an(noun)} to change it · <Kbd>Esc</Kbd> cancels
        </p>
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

function Cell({
  col,
  value,
  onChange,
  onKeyDown,
  onPaste,
  inputRef,
  label,
  placeholder,
  indent,
}: {
  col: LineColumn;
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onPaste?: (e: ClipboardEvent<HTMLTextAreaElement | HTMLInputElement>) => void;
  inputRef: (el: HTMLElement | null) => void;
  label: string;
  placeholder?: string;
  indent?: boolean;
}) {
  const cls = cn(
    "h-8 w-full min-w-0 rounded-md border border-line bg-surface px-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 max-sm:col-start-2",
    col.align === "right" && "text-right tabular",
  );
  if (col.input === "textarea")
    return (
      <span className={cn("min-w-0 max-sm:col-start-2", indent && "pl-3")}>
        <Textarea
          ref={inputRef}
          aria-label={label}
          value={value}
          rows={Math.min(6, Math.max(1, value.split("\n").length))}
          maxLength={col.maxLength ?? 2000}
          placeholder={placeholder ?? col.placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className="min-h-8 resize-none py-1 text-sm [field-sizing:content]"
        />
      </span>
    );
  if (col.input === "select")
    return (
      <select
        ref={inputRef}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        className={cn(cls, "pr-6")}
      >
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
      list={col.list}
      maxLength={col.maxLength}
      placeholder={placeholder ?? col.placeholder ?? col.label}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      className={cls}
    />
  );
}

function RowMenu({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && onClose();
    const esc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    box.current?.querySelector("button")?.focus();
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  return (
    <div
      ref={box}
      role="menu"
      className="absolute top-full right-0 z-30 mt-1 flex w-60 flex-col rounded-lg border border-line bg-surface p-1 text-left shadow-pop"
    >
      {children}
    </div>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:text-muted"
    >
      {icon}
      {children}
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
          {items.map((p, n) => (
            <li
              key={n}
              className={cn("flex justify-between gap-3 border-b border-line px-2 py-1 last:border-0", p.part && "pl-6 text-text-2")}
            >
              <span className="truncate">
                {p.part && <CornerDownRight className="mr-1 inline size-3 text-muted" aria-hidden />}
                {p.description}
                {p.model && <span className="text-muted"> · {p.model}</span>}
              </span>
              <span className="shrink-0 text-muted tabular">{p.quantity ? `${p.quantity} ${p.unit}`.trim() : "no qty"}</span>
            </li>
          ))}
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
