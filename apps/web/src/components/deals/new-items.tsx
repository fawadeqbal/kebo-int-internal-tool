"use client";

import { type ClipboardEvent, type KeyboardEvent } from "react";
import { Trash2 } from "lucide-react";
import { lineNumbers } from "@kebo/shared";
import { Button, cn } from "@kebo/ui";
import type { DealFormItem } from "@/lib/types-deals";
import { rowKey } from "./form-bits";

const cell = "h-[38px] w-full rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] outline-none focus:border-primary focus:ring-2 focus:ring-ring/30";

export const blankItem = (parentKey: string | null = null): DealFormItem => ({
  id: null,
  key: rowKey(),
  parentKey,
  description: "",
  model: "",
  quantity: "1",
  unit: parentKey ? "set" : "pc",
  targetPrice: "",
  priced: false,
});

/** Parts sit right after their main item (and its other parts), so the numbers read 1, 1.1, 1.2, 2… */
function tidy(items: DealFormItem[]): DealFormItem[] {
  const mains = items.filter((i) => !i.parentKey || !items.some((m) => m.key === i.parentKey));
  return mains.flatMap((m) => [{ ...m, parentKey: null }, ...items.filter((i) => i.parentKey === m.key)]);
}

/** Rows pasted from Excel: description, model, qty, unit, target price (tab separated). */
function pasted(text: string): DealFormItem[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.split("\t"))
    .filter((c) => c.some((x) => x.trim()))
    .map(([description = "", model = "", quantity = "1", unit = "pc", target = ""]) => ({
      ...blankItem(),
      description: description.trim(),
      model: model.trim(),
      quantity: quantity.replace(/,/g, "").trim() || "1",
      unit: unit.trim() || "pc",
      targetPrice: target.replace(/[^\d.]/g, ""),
    }));
}

/** Enter in a cell must not save the whole inquiry. */
const noSubmit = (e: KeyboardEvent) => {
  if (e.key === "Enter") e.preventDefault();
};

/**
 * The new inquiry's item list as the board draws it: one row per item with
 * Description, Model, Part of, Qty, Unit and Target price. Rows pasted from
 * Excel into a description become rows.
 */
export function NewItems({
  items,
  onChange,
  currency,
  error,
}: {
  items: DealFormItem[];
  onChange: (items: DealFormItem[]) => void;
  currency: string;
  error?: string;
}) {
  const numbers = lineNumbers(items.map((i) => ({ key: i.key, parentKey: i.parentKey })));
  const set = (key: string, patch: Partial<DealFormItem>) => onChange(tidy(items.map((i) => (i.key === key ? { ...i, ...patch } : i))));
  const remove = (key: string) => onChange(tidy(items.filter((i) => i.key !== key).map((i) => (i.parentKey === key ? { ...i, parentKey: null } : i))));
  const paste = (key: string) => (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const rows = pasted(text);
    const at = items.findIndex((i) => i.key === key);
    const here = items[at];
    const keep = here && (here.description || here.model) ? [here] : [];
    onChange(tidy([...items.slice(0, at), ...keep, ...rows, ...items.slice(at + 1)]));
  };
  const mains = items.filter((i) => !i.parentKey);

  return (
    <div onKeyDown={noSubmit}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead>
            <tr className="bg-surface-2 text-left text-muted">
              <th scope="col" className="w-10 px-2 py-2.5 font-semibold">#</th>
              <th scope="col" className="w-[30%] px-2 py-2.5 font-semibold">Description *</th>
              <th scope="col" className="px-2 py-2.5 font-semibold">Model</th>
              <th scope="col" className="w-[150px] px-2 py-2.5 font-semibold">Part of</th>
              <th scope="col" className="w-[90px] px-2 py-2.5 text-right font-semibold">Qty *</th>
              <th scope="col" className="w-[90px] px-2 py-2.5 font-semibold">Unit</th>
              <th scope="col" className="w-[120px] px-2 py-2.5 text-right font-semibold">Target price</th>
              <th className="w-11" />
            </tr>
          </thead>
          <tbody>
            {items.map((it, n) => {
              const hasParts = items.some((x) => x.parentKey === it.key);
              const label = `item ${numbers[n]}`;
              return (
                <tr key={it.key} className="border-t border-line">
                  <td className="p-2">{numbers[n]}</td>
                  <td className="p-2">
                    <input
                      className={cell}
                      aria-label={`Description of ${label}`}
                      value={it.description}
                      maxLength={2000}
                      onChange={(e) => set(it.key, { description: e.target.value })}
                      onPaste={paste(it.key)}
                    />
                  </td>
                  <td className="p-2">
                    <input className={cell} aria-label={`Model of ${label}`} value={it.model} maxLength={120} onChange={(e) => set(it.key, { model: e.target.value })} />
                  </td>
                  <td className="p-2">
                    <select
                      className={cn(cell, "px-1.5", it.parentKey && "bg-surface-2")}
                      aria-label={`${label} is part of`}
                      value={it.parentKey ?? ""}
                      disabled={hasParts}
                      title={hasParts ? "This item has parts of its own" : undefined}
                      onChange={(e) => set(it.key, { parentKey: e.target.value || null, unit: it.unit })}
                    >
                      <option value="">— (main item)</option>
                      {mains
                        .filter((m) => m.key !== it.key)
                        .map((m) => (
                          <option key={m.key} value={m.key}>
                            {numbers[items.indexOf(m)]} · {m.description || "(no description)"}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="p-2">
                    <input
                      className={cn(cell, "text-right")}
                      inputMode="decimal"
                      aria-label={`Quantity of ${label}`}
                      value={it.quantity}
                      onChange={(e) => set(it.key, { quantity: e.target.value })}
                    />
                  </td>
                  <td className="p-2">
                    <input className={cell} aria-label={`Unit of ${label}`} value={it.unit} maxLength={20} onChange={(e) => set(it.key, { unit: e.target.value })} />
                  </td>
                  <td className="p-2">
                    <input
                      className={cn(cell, "text-right")}
                      inputMode="decimal"
                      placeholder={currency}
                      aria-label={`Target price of ${label}`}
                      value={it.targetPrice}
                      onChange={(e) => set(it.key, { targetPrice: e.target.value })}
                    />
                  </td>
                  <td className="p-2">
                    <Button size="icon-xs" variant="ghost" onClick={() => remove(it.key)} aria-label={`Remove ${label}`}>
                      <Trash2 aria-hidden />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <p className="pt-2 text-xs text-bad">{error}</p>}
      <div className="pt-2.5">
        <Button size="sm" variant="secondary" onClick={() => onChange([...items, blankItem()])}>
          + Add item
        </Button>
      </div>
    </div>
  );
}
