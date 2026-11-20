"use client";

import type { DealItem } from "@/lib/types";
import { ITEM_COLUMNS } from "./items-sheet";
import { LinesExcel } from "./lines-view";

const rowsOf = (items: DealItem[]) =>
  items.map((it) => ({
    key: it.id,
    parentKey: it.parentId,
    values: { description: it.description, model: it.model ?? "", quantity: it.quantity, unit: it.unit, targetPrice: it.targetPrice ?? "" },
  }));

/** "What they need" header's Excel: the customer's items as a file. */
export function ItemsExcel({ items }: { items: DealItem[] }) {
  return <LinesExcel name="Customer items" noun="items" rows={rowsOf(items)} columns={ITEM_COLUMNS} numbers={items.map((it) => it.no)} />;
}
