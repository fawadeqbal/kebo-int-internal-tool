"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, ClipboardPaste, CornerDownRight, IndentDecrease, IndentIncrease, Plus, Trash2 } from "lucide-react";
import { lineNumbers } from "@kebo/shared";
import { Badge, Button, cn, Kbd, Textarea } from "@kebo/ui";
import type { DealFormItem } from "@/lib/types-deals";
import { rowKey } from "./form-bits";
import { parseList, type PastedItem } from "./paste-list";

/* ------------------------------------------------------------ list operations
 * Items are one flat list in display order; a part points at its item by key
 * and always sits right after it (after the item's other parts).
 */

export const blankItem = (parentKey: string | null = null): DealFormItem => ({
  id: null,
  key: rowKey(),
  description: "",
  model: "",
  quantity: "",
  unit: parentKey ? "sets" : "pcs",
  targetPrice: "",
  parentKey,
  priced: false,
});

const isBlank = (it: DealFormItem) => !it.id && !it.description.trim() && !it.model.trim() && !it.quantity.trim() && !it.targetPrice.trim();
const hasParts = (items: DealFormItem[], key: string) => items.some((x) => x.parentKey === key);
/** The index just after a row and, for an item, its parts. */
const blockEnd = (items: DealFormItem[], i: number) => {
  let j = i + 1;
  if (!items[i]!.parentKey) while (j < items.length && items[j]!.parentKey === items[i]!.key) j++;
  return j;
};
/** The item a row could become a part of: the nearest item above it. */
const itemAbove = (items: DealFormItem[], i: number) => {
  for (let j = i - 1; j >= 0; j--) if (!items[j]!.parentKey) return items[j]!;
  return null;
};
export const canIndent = (items: DealFormItem[], i: number) =>
  !items[i]!.parentKey && !hasParts(items, items[i]!.key) && !!itemAbove(items, i);

function indent(items: DealFormItem[], i: number) {
  if (!canIndent(items, i)) return items;
  const parent = itemAbove(items, i)!;
  return items.map((x, n) => (n === i ? { ...x, parentKey: parent.key, unit: x.unit } : x));
}

/** A part becomes an item where it stands; the parts below it (same item) become its parts, so nothing moves on screen. */
function outdent(items: DealFormItem[], i: number) {
  const row = items[i]!;
  if (!row.parentKey) return items;
  const old = row.parentKey;
  return items.map((x, n) => (n === i ? { ...x, parentKey: null } : n > i && x.parentKey === old ? { ...x, parentKey: row.key } : x));
}

/** Moves a row (an item with its parts) past its neighbour at the same level. */
function moveRow(items: DealFormItem[], i: number, by: -1 | 1) {
  const row = items[i]!;
  if (row.parentKey) {
    const j = i + by;
    if (items[j]?.parentKey !== row.parentKey) return items;
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  }
  const tops = items.map((x, n) => (x.parentKey ? -1 : n)).filter((n) => n >= 0);
  const at = tops.indexOf(i);
  const other = tops[at + by];
  if (other === undefined) return items;
  const [a, b] = by < 0 ? [other, i] : [i, other];
  const first = items.slice(a, blockEnd(items, a));
  const second = items.slice(b, blockEnd(items, b));
  return [...items.slice(0, a), ...second, ...first, ...items.slice(blockEnd(items, b))];
}

function removeRow(items: DealFormItem[], i: number) {
  const key = items[i]!.key;
  const left = items.filter((x) => x.key !== key && x.parentKey !== key);
  return left.length ? left : [blankItem()];
}

/**
 * Puts pasted rows after row i (or in its place when it is still empty). Parts
 * in the paste go under the item above them; pasting plain items into a part
 * row adds them as parts of the same item.
 */
function insertPasted(items: DealFormItem[], i: number, pasted: PastedItem[]) {
  const at = items[i]!;
  const intoPart = !!at.parentKey && !pasted.some((p) => p.part);
  let lastTop: string | null = intoPart ? at.parentKey : null;
  const rows = pasted.map((p) => {
    const parentKey = intoPart ? at.parentKey : p.part && lastTop ? lastTop : null;
    const row: DealFormItem = {
      ...blankItem(parentKey),
      description: p.description,
      model: p.model,
      quantity: p.quantity,
      unit: p.unit || (parentKey ? "sets" : "pcs"),
    };
    if (!parentKey) lastTop = row.key;
    return row;
  });
  if (isBlank(at) && !hasParts(items, at.key) && (!at.parentKey || intoPart)) {
    // An empty row is replaced by what was pasted.
    return { items: [...items.slice(0, i), ...rows, ...items.slice(i + 1)], first: rows[0]!.key };
  }
  // Pasting top-level rows after an item: keep that item's parts with it.
  const end = intoPart ? i + 1 : blockEnd(items, at.parentKey ? items.findIndex((x) => x.key === at.parentKey) : i);
  return { items: [...items.slice(0, end), ...rows, ...items.slice(end)], first: rows[0]!.key };
}

/** What gets saved: empty new rows are dropped, and parts point at their item by position. */
export function itemsPayload(items: DealFormItem[]) {
  const kept = items.filter((it) => !isBlank(it) || hasParts(items, it.key));
  const at = new Map(kept.map((it, n) => [it.key, n]));
  return kept.map((it) => ({
    id: it.id,
    partOf: it.parentKey ? (at.get(it.parentKey) ?? null) : null,
    description: it.description,
    model: it.model.trim() || null,
    quantity: it.quantity.replace(/,/g, "").trim(),
    unit: it.unit.trim() || "pcs",
    targetPrice: it.targetPrice.replace(/,/g, "").trim() || null,
  }));
}

/* ------------------------------------------------------------------- the table */

type Field = "description" | "model" | "quantity" | "unit" | "targetPrice";
const COLS = "sm:grid-cols-[2.5rem_minmax(0,1fr)_8.5rem_5rem_5.5rem_7rem_6.5rem]";

/**
 * The customer's items as a quick table: Enter adds a row, Tab on a new row
 * makes it a part of the item above (Shift+Tab undoes it), and a list pasted
 * from Excel, WhatsApp or an email becomes rows.
 */
export function ItemTable({ items, onChange, error }: { items: DealFormItem[]; onChange: (next: DealFormItem[]) => void; error?: string }) {
  const refs = useRef(new Map<string, HTMLElement>());
  /** Where the cursor goes after the next render (a new row, a row that changed level). */
  const pending = useRef<{ key: string; field: Field } | null>(null);
  const setFocus = (f: { key: string; field: Field }) => {
    pending.current = f;
  };
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  /** A multi-line paste into one description: offer to split it into rows. */
  const [offer, setOffer] = useState<{ key: string; before: string; rows: PastedItem[] } | null>(null);

  const numbers = lineNumbers(items.map((it) => ({ key: it.key, parentKey: it.parentKey })));
  const pasted = pasteText.trim() ? parseList(pasteText) : [];

  useEffect(() => {
    const f = pending.current;
    if (!f) return;
    pending.current = null;
    const el = refs.current.get(`${f.key}:${f.field}`);
    if (!el) return;
    el.focus();
    if ((el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement))
      el.setSelectionRange(el.value.length, el.value.length);
  });

  const update = (key: string, patch: Partial<DealFormItem>) => onChange(items.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const addAfter = (i: number, field: Field = "description") => {
    const row = items[i]!;
    const fresh = blankItem(row.parentKey);
    const at = row.parentKey ? i + 1 : blockEnd(items, i);
    onChange([...items.slice(0, at), fresh, ...items.slice(at)]);
    setFocus({ key: fresh.key, field });
  };
  const keepFocus = (key: string, field: Field) => setFocus({ key, field });

  const onKey = (e: KeyboardEvent<HTMLElement>, i: number, field: Field) => {
    const row = items[i]!;
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      // Enter on an empty part ends the parts, like a bulleted list.
      if (row.parentKey && isBlank(row)) {
        onChange(outdent(items, i));
        keepFocus(row.key, field);
      } else addAfter(i);
      return;
    }
    if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      onChange(e.key === "ArrowRight" ? indent(items, i) : outdent(items, i));
      keepFocus(row.key, field);
      return;
    }
    if (e.key === "Tab" && field === "description" && !row.description) {
      if (!e.shiftKey && canIndent(items, i)) {
        e.preventDefault();
        onChange(indent(items, i));
        keepFocus(row.key, field);
      } else if (e.shiftKey && row.parentKey) {
        e.preventDefault();
        onChange(outdent(items, i));
        keepFocus(row.key, field);
      }
      return;
    }
    if (e.key === "Backspace" && field === "description" && isBlank(row) && items.length > 1 && !hasParts(items, row.key)) {
      e.preventDefault();
      const prev = items[i - 1] ?? items[i + 1]!;
      onChange(removeRow(items, i));
      keepFocus(prev.key, "description");
      return;
    }
    // Up and down move between rows in the short fields, like a spreadsheet.
    if (field !== "description" && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const other = items[i + (e.key === "ArrowUp" ? -1 : 1)];
      if (other) {
        e.preventDefault();
        keepFocus(other.key, field);
      }
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement | HTMLInputElement>, i: number) => {
    const text = e.clipboardData.getData("text/plain");
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2 && !text.includes("\t")) return;
    const rows = parseList(text);
    if (!rows.length) return;
    if (text.includes("\t")) {
      // Cells from a spreadsheet are always rows.
      e.preventDefault();
      const r = insertPasted(items, i, rows);
      onChange(r.items);
      setFocus({ key: r.first, field: "description" });
      return;
    }
    // Several lines of plain text could be one long description: paste it, then offer to split.
    setOffer({ key: items[i]!.key, before: items[i]!.description, rows });
  };

  const splitOffer = () => {
    if (!offer) return;
    const i = items.findIndex((x) => x.key === offer.key);
    if (i < 0) return setOffer(null);
    const restored = items.map((x, n) => (n === i ? { ...x, description: offer.before } : x));
    const r = insertPasted(restored, i, offer.rows);
    onChange(r.items);
    setOffer(null);
    setFocus({ key: r.first, field: "description" });
  };

  const addPasted = () => {
    const r = insertPasted(items, topIndexForAppend(items), pasted);
    onChange(r.items);
    setPasteText("");
    setPasteOpen(false);
    setFocus({ key: r.first, field: "description" });
  };

  const bind = (it: DealFormItem, i: number, field: Field) => ({
    ref: (el: HTMLElement | null) => {
      if (el) refs.current.set(`${it.key}:${field}`, el);
      else refs.current.delete(`${it.key}:${field}`);
    },
    value: it[field],
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => onKey(e, i, field),
    onPaste: (e: ClipboardEvent<HTMLTextAreaElement | HTMLInputElement>) => onPaste(e, i),
  });

  const cell =
    "h-9 w-full rounded-md border border-line bg-surface px-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

  return (
    <div className="flex flex-col gap-3">
      <div role="table" aria-label="Items" className="flex flex-col gap-2 sm:gap-1">
        <div role="row" className={cn("hidden gap-2 px-1 text-xs font-medium text-muted sm:grid", COLS)}>
          <span role="columnheader">No.</span>
          <span role="columnheader">Description</span>
          <span role="columnheader">Model / part no.</span>
          <span role="columnheader" className="text-right">
            Qty
          </span>
          <span role="columnheader">Unit</span>
          <span role="columnheader" className="text-right">
            Target price
          </span>
          <span role="columnheader" className="sr-only">
            Actions
          </span>
        </div>
        {items.map((it, i) => {
          const no = numbers[i]!;
          const part = !!it.parentKey;
          const label = `${part ? "Part" : "Item"} ${no}`;
          const siblings = items.filter((x) => x.parentKey === it.parentKey);
          const at = siblings.indexOf(it);
          return (
            <div key={it.key} role="row" aria-label={label} className="flex flex-col gap-1">
              <div
                className={cn(
                  "grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2 rounded-lg border border-line p-2 sm:items-start sm:rounded-none sm:border-0 sm:p-1",
                  COLS,
                  part && "border-dashed",
                )}
              >
                <span role="cell" className={cn("pt-2 text-sm text-muted tabular", part && "pl-2")}>
                  {no}
                </span>
                <span role="cell" className={cn("flex min-w-0 items-start gap-1", part && "sm:pl-4")}>
                  {part && <CornerDownRight className="mt-2.5 size-3.5 shrink-0 text-muted" aria-hidden />}
                  <Textarea
                    {...bind(it, i, "description")}
                    aria-label={`${label} description`}
                    rows={Math.min(8, Math.max(1, it.description.split("\n").length))}
                    className="min-h-9 resize-none py-1.5 [field-sizing:content]"
                    placeholder={i === 0 ? "What it is: size, material, standard…" : part ? "A part of the item above" : "Next item"}
                    onChange={(e) => update(it.key, { description: e.target.value })}
                  />
                </span>
                <span role="cell" className="col-span-2 grid grid-cols-[minmax(0,1fr)_5rem_5rem] gap-2 sm:contents">
                  <input
                    {...bind(it, i, "model")}
                    aria-label={`${label} model or part number`}
                    placeholder="Model"
                    maxLength={120}
                    className={cell}
                    onChange={(e) => update(it.key, { model: e.target.value })}
                  />
                  <input
                    {...bind(it, i, "quantity")}
                    aria-label={`${label} quantity`}
                    placeholder="Qty"
                    inputMode="decimal"
                    className={cn(cell, "text-right tabular")}
                    onChange={(e) => update(it.key, { quantity: e.target.value })}
                  />
                  <input
                    {...bind(it, i, "unit")}
                    aria-label={`${label} unit`}
                    list="units"
                    maxLength={20}
                    className={cell}
                    onChange={(e) => update(it.key, { unit: e.target.value })}
                  />
                </span>
                <span role="cell" className="col-span-2 flex items-center gap-2 sm:col-span-1 sm:contents">
                  <input
                    {...bind(it, i, "targetPrice")}
                    aria-label={`${label} target price`}
                    placeholder="Target"
                    inputMode="decimal"
                    title="The customer's budget per unit, if they said"
                    className={cn(cell, "text-right tabular")}
                    onChange={(e) => update(it.key, { targetPrice: e.target.value })}
                  />
                  <span className="flex items-center justify-end gap-0.5 pt-0.5">
                    {it.priced && (
                      <span title="A factory has priced this: changing it will ask why" className="mr-1">
                        <Badge tone="info">Priced</Badge>
                      </span>
                    )}
                    {part ? (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => onChange(outdent(items, i))}
                        aria-label={`Make ${label} an item of its own`}
                        title="Make it an item (Alt+←)"
                      >
                        <IndentDecrease aria-hidden />
                      </Button>
                    ) : (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => onChange(indent(items, i))}
                        disabled={!canIndent(items, i)}
                        aria-label={`Make ${label} a part of the item above`}
                        title="Make it a part of the item above (Alt+→)"
                      >
                        <IndentIncrease aria-hidden />
                      </Button>
                    )}
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => onChange(moveRow(items, i, -1))}
                      disabled={at === 0}
                      aria-label={`Move ${label} up`}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => onChange(moveRow(items, i, 1))}
                      disabled={at === siblings.length - 1}
                      aria-label={`Move ${label} down`}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="danger-ghost"
                      onClick={() => onChange(removeRow(items, i))}
                      disabled={items.length === 1 && isBlank(it)}
                      aria-label={`Remove ${label}${hasParts(items, it.key) ? " and its parts" : ""}`}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </span>
                </span>
              </div>
              {offer?.key === it.key && (
                <div className="ml-10 flex flex-wrap items-center gap-2 rounded-md bg-info-soft px-3 py-2 text-sm">
                  <span>
                    You pasted {offer.rows.length} lines. Make {offer.rows.length === 1 ? "it a row" : `them ${offer.rows.length} rows`}?
                  </span>
                  <Button size="xs" variant="primary" onClick={splitOffer}>
                    Split into rows
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setOffer(null)}>
                    Keep as one description
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <datalist id="units">
        {["pcs", "sets", "kg", "tons", "m", "m²", "m³", "rolls", "cartons", "pairs", "litres"].map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      {error && <p className="text-xs text-bad">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => addAfter(topIndexForAppend(items))}>
          <Plus aria-hidden /> Add an item
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setPasteOpen((o) => !o)} aria-expanded={pasteOpen}>
          <ClipboardPaste aria-hidden /> Paste a list
        </Button>
        <p className="text-xs text-muted">
          <Kbd>Enter</Kbd> new row · <Kbd>Tab</Kbd> on a new row makes it a part · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line in a
          description
        </p>
      </div>

      {pasteOpen && (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3">
          <label htmlFor="paste-list" className="text-sm font-medium">
            Paste the customer&apos;s list
          </label>
          <p className="text-xs text-muted">
            From Excel, WhatsApp or an email: one item per line. A quantity at the end (&ldquo;× 200 pcs&rdquo;) is picked up; indented,
            bulleted or &ldquo;2.1&rdquo; lines become parts of the item above.
          </p>
          <Textarea
            id="paste-list"
            rows={6}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'Gate valve DN100 PN16 x 200 pcs\nBall valve 2" – 50 pcs\n  - handle, stainless'}
          />
          {pasted.length > 0 && (
            <ol className="max-h-48 overflow-auto rounded-md border border-line bg-surface text-sm">
              {pasted.map((p, n) => (
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
            <Button size="sm" variant="primary" onClick={addPasted} disabled={!pasted.length}>
              Add {pasted.length || ""} row{pasted.length === 1 ? "" : "s"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Add an item" adds a top-level row at the end: after the last item and its parts. */
function topIndexForAppend(items: DealFormItem[]) {
  for (let j = items.length - 1; j >= 0; j--) if (!items[j]!.parentKey) return j;
  return items.length - 1;
}
