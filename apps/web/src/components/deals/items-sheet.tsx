"use client";

import { useMemo, useState } from "react";
import { Badge } from "@kebo/ui";
import type { LineRow } from "@/components/lines/line-table";
import { localLineHandlers } from "@/components/lines/local-lines";
import { linesDiff } from "@/components/edits/batch-lines";
import type { DealItem } from "@/lib/types";
import { rowKey } from "./form-bits";

import { ITEM_COLUMNS } from "@/components/lines/item-columns";

export { ITEM_COLUMNS };

/** One of the customer's items while it is typed (a saved one keeps its id, so factory prices stay linked). */
export interface ItemState {
  id: string | null;
  key: string;
  parentKey: string | null;
  description: string;
  model: string;
  quantity: string;
  unit: string;
  targetPrice: string;
  /** A factory has priced it: changing it asks why. */
  priced: boolean;
}

const stateOf = (items: DealItem[]): ItemState[] =>
  items.map((it) => ({
    id: it.id,
    key: it.id,
    parentKey: it.parentId,
    description: it.description,
    model: it.model ?? "",
    quantity: it.quantity,
    unit: it.unit,
    targetPrice: it.targetPrice ?? "",
    priced: it.priced,
  }));

const rowsOf = (list: ItemState[]): LineRow[] =>
  list.map((it) => ({
    key: it.key,
    parentKey: it.parentKey,
    values: { description: it.description, model: it.model, quantity: it.quantity, unit: it.unit, targetPrice: it.targetPrice },
    badge: it.priced ? (
      <span className="ml-1 align-middle" title="A supplier has priced this: changing it will ask why">
        <Badge tone="info">Priced</Badge>
      </span>
    ) : undefined,
  }));

/**
 * The customer's items on a copy, for the line table (type, paste a list, Excel): what changed since they
 * were saved, and whether saving asks why (a saved list changed, or a line added to it).
 */
export function useItemRows(items: DealItem[]) {
  const [list, setList] = useState<ItemState[]>(() => stateOf(items));
  const handlers = localLineHandlers(
    list,
    (fn) => setList((r) => fn(r)),
    (values, parentKey) => ({
      id: null,
      key: rowKey(),
      parentKey,
      description: values.description ?? "",
      model: values.model ?? "",
      quantity: values.quantity ?? "",
      unit: values.unit || (parentKey ? "sets" : "pcs"),
      targetPrice: values.targetPrice ?? "",
      priced: false,
    }),
    (row, values) => ({ ...row, ...values }),
  );
  const saved = useMemo(() => rowsOf(stateOf(items)), [items]);
  const rows = useMemo(() => rowsOf(list), [list]);
  const diff = useMemo(() => linesDiff(saved, rows, ITEM_COLUMNS), [saved, rows]);
  return {
    list,
    rows,
    handlers,
    /** Back to the saved list (Undo on the window's Changes step). */
    reset: () => setList(stateOf(items)),
    diff,
    dirty: diff.changes.length > 0,
    askWhy: items.length > 0 && (diff.filledChanged || diff.added),
  };
}

/** The items as the API takes them: a saved one by its id, a part naming its item by its place in the list. */
export function itemsBody(list: ItemState[]) {
  const at = new Map(list.map((it, n) => [it.key, n]));
  return list.map((it) => ({
    id: it.id,
    partOf: it.parentKey ? (at.get(it.parentKey) ?? null) : null,
    description: it.description,
    model: it.model.trim() || null,
    quantity: it.quantity.replace(/,/g, "").trim(),
    unit: it.unit.trim() || "pcs",
    targetPrice: it.targetPrice.replace(/,/g, "").trim() || null,
  }));
}
