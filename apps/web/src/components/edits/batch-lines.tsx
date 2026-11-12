"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { lineNumbers } from "@kebo/shared";
import { Alert, Button } from "@kebo/ui";
import { PanelActions, PanelBody, useClosePanel, useReportDirty } from "@/components/common/panel";
import { LineTable, type LineColumn, type LineMove, type LineResult, type LineRow, type LineTableProps, type LineValues, type NewLine } from "@/components/lines/line-table";
import { insertLines, moveLine, removeLine } from "@/components/lines/local-lines";
import type { EditCard, EditRef } from "@/lib/types-edits";
import { useEditSave, type SaveResult } from "./use-edit-save";

/** The saved lines' own handlers (one change, one call), as the line table uses them. */
export type LineHandlers = Pick<LineTableProps, "onAdd" | "onEdit" | "onRemove" | "onMove">;

type Op =
  | { t: "add"; lines: NewLine[]; at: { afterKey: string | null; parentKey: string | null }; keys: string[] }
  | { t: "edit"; key: string; values: LineValues }
  | { t: "remove"; key: string }
  | { t: "move"; key: string; to: LineMove };

let seq = 0;
const tempKey = () => `new-${++seq}-${Date.now().toString(36)}`;

const firstLine = (v: string | undefined, max = 48) => {
  const s = (v ?? "").split("\n")[0]!.trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** Nothing there yet: empty, or a zero no one typed (a received quantity before anything came in). */
const blank = (v: string) => !v || /^0+(\.0+)?$/.test(v);

/**
 * What changed between the saved lines and the copy being edited, as people
 * read it ("2.1 · Qty 100 → 120", "Added 4 · Bolt M8"), and which saved lines changed.
 */
export function linesDiff(before: LineRow[], after: LineRow[], columns: LineColumn[]) {
  const shown = columns.filter((c) => c.input);
  const label = (c: LineColumn) => c.label || c.key;
  const noBefore = lineNumbers(before);
  const noAfter = lineNumbers(after);
  const was = new Map(before.map((r, i) => [r.key, { r, no: noBefore[i]! }]));
  const now = new Map(after.map((r, i) => [r.key, { r, no: noAfter[i]! }]));
  const changes: string[] = [];
  const keys = new Set<string>();
  let filledChanged = false;
  for (const [key, { r, no }] of was)
    if (!now.has(key)) {
      changes.push(`Removed ${no} · ${firstLine(r.values.description) || "a line"}`);
      filledChanged = true;
    }
  for (const [i, r] of after.entries()) {
    const old = was.get(r.key);
    if (!old) {
      changes.push(`Added ${noAfter[i]} · ${firstLine(r.values.description) || "a line"}`);
      continue;
    }
    const diffs: string[] = [];
    for (const c of shown) {
      const a = (old.r.values[c.key] ?? "").trim();
      const b = (r.values[c.key] ?? "").trim();
      if (a === b) continue;
      if (!blank(a)) filledChanged = true;
      const text = (v: string) => (c.options?.find((o) => o.value === v)?.label ?? firstLine(v, 32)) || "empty";
      diffs.push(`${label(c)} ${text(a)} → ${text(b)}`);
    }
    if (diffs.length) {
      keys.add(r.key);
      changes.push(`${noAfter[i]} · ${diffs.join(", ")}`);
    }
  }
  // The order (or which line a part belongs to) of the lines that stayed.
  const kept = (rows: LineRow[]) =>
    rows
      .filter((r) => was.has(r.key) && now.has(r.key))
      .map((r) => `${r.key}<${r.parentKey ?? ""}`)
      .join("|");
  if (kept(before) !== kept(after)) {
    changes.push("The order of the lines changed");
    filledChanged = true;
    for (const r of after) {
      const old = was.get(r.key);
      if (old && (old.r.parentKey !== r.parentKey || old.no !== now.get(r.key)!.no)) keys.add(r.key);
    }
  }
  const added = after.some((r) => !was.has(r.key));
  return { changes, keys: [...keys], filledChanged, added };
}

/**
 * Lines changed in the edit panel (wide), on a copy: nothing is saved until
 * Save changes, which sends every change at once (in the order they were made)
 * through the lines' own handlers. Cancel with changes asks first. The first
 * save of a card is plain; changing what was saved asks why (`plain`: never,
 * e.g. a draft), and the save is kept for the card's "Edited n×".
 */
export function BatchLines({
  rows: saved,
  columns,
  handlers,
  edit,
  card,
  plain,
  askOnAdd = true,
  footer,
  above,
  below,
  saveLabel = "Save changes",
  note,
  ...table
}: {
  rows: LineRow[];
  columns: LineColumn[];
  handlers: LineHandlers;
  /** Where the edit is kept (record and card); none: not counted. */
  edit?: EditRef;
  card?: EditCard | null;
  /** Saves without asking why (a draft, lines nothing uses yet). */
  plain?: boolean;
  /** Adding lines to a list that was saved counts as an edit (asks why); false: only changing saved values does. */
  askOnAdd?: boolean;
  /** Totals for the lines as they are being edited. */
  footer?: (rows: LineRow[]) => ReactNode;
  /** Above / below the table, inside the panel (a note, the start options: `add` puts lines in the copy). */
  above?: ReactNode | ((api: { rows: LineRow[]; add: (lines: NewLine[]) => void }) => ReactNode);
  below?: ReactNode;
  saveLabel?: string;
  /** Beside the buttons (e.g. "The quotation keeps its own copy"). */
  note?: ReactNode;
} & Omit<LineTableProps, "rows" | "columns" | "onAdd" | "onEdit" | "onRemove" | "onMove" | "footer" | "readOnly">) {
  const close = useClosePanel();
  const reportDirty = useReportDirty();
  const [rows, setRows] = useState<LineRow[]>(saved);
  const [ops, setOps] = useState<Op[]>([]);
  const savedKeys = useMemo(() => new Set(saved.map((r) => r.key)), [saved]);
  const { save, dialog, busy, error, setError } = useEditSave({ edit, card });
  // How far an interrupted save got: the changes already sent, and the new lines' saved keys.
  const progress = useRef<{ done: number; keys: Map<string, string>; seen: Set<string> }>({ done: 0, keys: new Map(), seen: new Set(savedKeys) });

  const diff = useMemo(() => linesDiff(saved, rows, columns), [saved, rows, columns]);
  const dirty = ops.length > 0 && diff.changes.length > 0;
  useEffect(() => {
    reportDirty(dirty);
    return () => reportDirty(null);
  }, [dirty, reportDirty]);

  const push = (op: Op) =>
    setOps((cur) => {
      if (op.t === "edit") {
        // A new line's values go with its add; a line's cells typed one after another are one change.
        const addAt = cur.findIndex((o) => o.t === "add" && o.keys.includes(op.key));
        if (addAt >= 0) {
          const a = cur[addAt] as Extract<Op, { t: "add" }>;
          const i = a.keys.indexOf(op.key);
          const lines = a.lines.map((l, n) => (n === i ? { ...l, values: { ...l.values, ...op.values } } : l));
          return cur.map((o, n) => (n === addAt ? { ...a, lines } : o));
        }
        const last = cur[cur.length - 1];
        if (last?.t === "edit" && last.key === op.key) return [...cur.slice(0, -1), { ...last, values: { ...last.values, ...op.values } }];
      }
      return [...cur, op];
    });

  const local: LineHandlers = {
    onAdd: async (lines, at) => {
      const fresh: LineRow[] = [];
      for (const l of lines)
        fresh.push({ key: tempKey(), parentKey: at.parentKey ?? (l.partOf !== null ? fresh[l.partOf]!.key : null), values: { ...l.values } });
      setRows((cur) => insertLines(cur, fresh, at));
      push({ t: "add", lines: lines.map((l) => ({ ...l, values: { ...l.values } })), at, keys: fresh.map((f) => f.key) });
      return { ok: true, keys: fresh.map((f) => f.key) };
    },
    onEdit: async (key, values) => {
      setRows((cur) => cur.map((r) => (r.key === key ? { ...r, values: { ...r.values, ...values } } : r)));
      push({ t: "edit", key, values });
      return { ok: true };
    },
    onRemove: async (key) => {
      setRows((cur) => removeLine(cur, key));
      push({ t: "remove", key });
      return { ok: true };
    },
    onMove: async (key, to): Promise<LineResult> => {
      const next = moveLine(rows, key, to);
      if (typeof next === "string") return { ok: false, message: next };
      setRows(next);
      push({ t: "move", key, to });
      return { ok: true };
    },
  };

  /** Sends the changes not sent yet, in order; stops at the first that fails (Save again goes on from there). */
  const run = async (reason?: string): Promise<SaveResult> => {
    const p = progress.current;
    const m = (k: string | null) => (k ? (p.keys.get(k) ?? k) : null);
    for (let i = p.done; i < ops.length; i++) {
      const op = ops[i]!;
      let r: LineResult;
      if (op.t === "add") {
        r = await handlers.onAdd(op.lines, { afterKey: m(op.at.afterKey), parentKey: m(op.at.parentKey) }, reason);
        if (r.ok) {
          const fresh = (r.keys ?? []).filter((k) => !p.seen.has(k));
          for (const k of fresh) p.seen.add(k);
          op.keys.forEach((t, n) => fresh[n] && p.keys.set(t, fresh[n]));
        }
      } else if (op.t === "edit") r = await handlers.onEdit(m(op.key)!, op.values, reason);
      else if (op.t === "remove") r = await handlers.onRemove(m(op.key)!, reason);
      else r = await handlers.onMove(m(op.key)!, op.to, reason);
      if (!r.ok) return { ok: false, message: r.message, reasonChoices: r.reasonChoices };
      p.done = i + 1;
    }
    return { ok: true };
  };

  const askWhy = !plain && saved.length > 0 && (diff.filledChanged || (askOnAdd && diff.added));
  const count = diff.changes.length;

  return (
    <PanelBody className="gap-3">
      {typeof above === "function" ? above({ rows, add: (lines) => void local.onAdd(lines, { afterKey: null, parentKey: null }) }) : above}
      <LineTable rows={rows} columns={columns} {...table} {...local} footer={footer?.(rows)} />
      {below}
      {error && <Alert tone="error">{error}</Alert>}
      <PanelActions>
        <Button
          size="sm"
          disabled={!dirty || busy}
          onClick={() => {
            setError(null);
            void save({ changes: diff.changes, keys: diff.keys, askWhy, run });
          }}
        >
          {busy ? "Saving…" : saveLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => close()} disabled={busy}>
          Cancel
        </Button>
        <span className="text-xs text-muted">
          {count ? `${count} change${count === 1 ? "" : "s"} not saved yet${askWhy ? " · Save asks why" : ""}` : "Nothing changed yet"}
        </span>
        {note && <span className="text-xs text-muted max-md:hidden">{note}</span>}
      </PanelActions>
      {dialog}
    </PanelBody>
  );
}
