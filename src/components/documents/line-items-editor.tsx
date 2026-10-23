"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { calculateTotals, formatCents } from "@/lib/utils/money";

export interface EditableLine {
  description: string;
  quantity: string;
  unitPrice: string;
}

/** Line items with live totals. Uses the same calculation as the server, so what you see is what is saved. */
export function LineItemsEditor({
  initialItems,
  initialDiscount,
  initialTaxRate,
  currency,
  errors,
}: {
  initialItems: EditableLine[];
  initialDiscount: string;
  initialTaxRate: string;
  currency: string;
  errors?: Record<string, string[] | undefined>;
}) {
  const [items, setItems] = useState<EditableLine[]>(initialItems.length ? initialItems : [{ description: "", quantity: "1", unitPrice: "" }]);
  const [discount, setDiscount] = useState(initialDiscount);
  const [taxRate, setTaxRate] = useState(initialTaxRate);
  const totals = useMemo(() => calculateTotals(items, discount, taxRate), [items, discount, taxRate]);
  const update = (i: number, patch: Partial<EditableLine>) => setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name="items" value={JSON.stringify(items.filter((i) => i.description.trim() || i.unitPrice))} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="w-8 pb-2">#</th>
              <th className="pb-2">Description</th>
              <th className="w-24 pb-2">Qty</th>
              <th className="w-40 pb-2">Unit price</th>
              <th className="w-36 pb-2 text-right">Amount</th>
              <th className="w-10 pb-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} className="align-top">
                <td className="py-1.5 pt-4 text-muted">{i + 1}</td>
                <td className="py-1.5 pr-2">
                  <label className="sr-only" htmlFor={`desc-${i}`}>
                    Description, line {i + 1}
                  </label>
                  <textarea
                    id={`desc-${i}`}
                    rows={1}
                    value={item.description}
                    onChange={(e) => update(i, { description: e.target.value })}
                    placeholder="e.g. Rotary tablet press, 35 stations, GMP, SS316"
                    className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-100"
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <label className="sr-only" htmlFor={`qty-${i}`}>
                    Quantity, line {i + 1}
                  </label>
                  <Input id={`qty-${i}`} type="number" min="0" step="any" inputMode="decimal" value={item.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
                </td>
                <td className="py-1.5 pr-2">
                  <label className="sr-only" htmlFor={`price-${i}`}>
                    Unit price, line {i + 1}
                  </label>
                  <Input id={`price-${i}`} type="number" min="0" step="0.01" inputMode="decimal" value={item.unitPrice} onChange={(e) => update(i, { unitPrice: e.target.value })} placeholder="0.00" />
                </td>
                <td className="py-1.5 pt-4 text-right tabular-nums">{formatCents(totals.lines[i]?.lineTotal ?? 0, currency)}</td>
                <td className="py-1.5 pl-1 pt-2.5">
                  <button
                    type="button"
                    onClick={() => setItems((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))}
                    disabled={items.length === 1}
                    className="rounded-md p-1.5 text-muted hover:bg-red-50 hover:text-red-700 disabled:opacity-30"
                    aria-label={`Remove line ${i + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {errors?.items && <p className="text-xs font-medium text-red-600">{errors.items[0]}</p>}
      <div>
        <Button type="button" variant="secondary" size="sm" onClick={() => setItems((prev) => [...prev, { description: "", quantity: "1", unitPrice: "" }])}>
          <Plus className="h-4 w-4" aria-hidden /> Add line
        </Button>
      </div>

      <div className="ml-auto grid w-full max-w-sm gap-3 rounded-lg border border-line bg-canvas/50 p-4">
        <div className="flex justify-between text-sm">
          <span className="text-muted">Subtotal</span>
          <span className="tabular-nums">{formatCents(totals.subtotal, currency)}</span>
        </div>
        <Field label="Discount (amount)" htmlFor="discount" error={errors?.discount}>
          <Input id="discount" name="discount" type="number" min="0" step="0.01" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
        </Field>
        <Field label="Tax rate (%)" htmlFor="taxRate" error={errors?.taxRate} hint="0 if no tax applies">
          <Input id="taxRate" name="taxRate" type="number" min="0" max="100" step="0.01" inputMode="decimal" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
        </Field>
        <div className="flex justify-between text-sm">
          <span className="text-muted">Tax</span>
          <span className="tabular-nums">{formatCents(totals.taxAmount, currency)}</span>
        </div>
        <div className="flex justify-between border-t border-line pt-3 text-base font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{formatCents(totals.total, currency)}</span>
        </div>
      </div>
    </div>
  );
}
