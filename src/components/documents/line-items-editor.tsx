"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, controlClass, Field, Input } from "@/components/ui";
import { calculateTotals, formatCents } from "@/lib/utils/money";
import { emptyLine, UNITS, type EditableLine } from "@/lib/line-items";
import { cn } from "@/lib/utils/cn";

export type { EditableLine };

/**
 * The one line editor, used for what the customer needs (no prices) and for
 * quotations and invoices (with prices and live totals, calculated exactly as
 * the server does). Each line: the item (first line = name, then details),
 * quantity and unit; brand/model and HS code sit behind "Model / HS code".
 */
export function LineItemsEditor({
  initialItems,
  initialDiscount = "0",
  initialTaxRate = "0",
  currency = "USD",
  errors,
  priced = true,
  name = "items",
  sourceLabel,
  placeholder = "e.g. Rotary tablet press, 35 stations, GMP, SS316",
}: {
  initialItems: EditableLine[];
  initialDiscount?: string;
  initialTaxRate?: string;
  currency?: string;
  errors?: Record<string, string[] | undefined>;
  /** false = requested items: no prices or totals. */
  priced?: boolean;
  name?: string;
  /** Shown on lines that came from the step before, e.g. "Requested". */
  sourceLabel?: string;
  placeholder?: string;
}) {
  const [items, setItems] = useState<EditableLine[]>(initialItems.length ? initialItems : [emptyLine()]);
  const [discount, setDiscount] = useState(initialDiscount);
  const [taxRate, setTaxRate] = useState(initialTaxRate);
  const [codesOpen, setCodesOpen] = useState<Set<number>>(() => new Set(initialItems.flatMap((l, i) => (l.model || l.hsCode ? [i] : []))));
  const totals = useMemo(() => calculateTotals(priced ? items : [], discount, taxRate), [items, discount, taxRate, priced]);
  const update = (i: number, patch: Partial<EditableLine>) => setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const remove = (i: number) => {
    setItems((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev));
    setCodesOpen((prev) => new Set([...prev].filter((j) => j !== i).map((j) => (j > i ? j - 1 : j))));
  };
  const filled = items.filter((i) => i.description.trim() || (priced && i.unitPrice));

  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name={name} value={JSON.stringify(filled)} />
      <datalist id="unit-options">
        {UNITS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      <ol className="flex flex-col divide-y divide-line rounded-xl border border-line">
        {items.map((item, i) => (
          <li key={i} className="grid gap-3 p-3 sm:grid-cols-[1.75rem_1fr_auto] sm:items-start">
            <span className="hidden pt-2.5 text-sm text-muted tabular-nums sm:block">{i + 1}</span>
            <div className="flex min-w-0 flex-col gap-2">
              <label className="sr-only" htmlFor={`${name}-desc-${i}`}>
                Item, line {i + 1}
              </label>
              {sourceLabel && item.sourceId && <span className="text-[11px] font-medium text-muted">{sourceLabel}</span>}
              <textarea
                id={`${name}-desc-${i}`}
                rows={item.description.includes("\n") ? 3 : 1}
                value={item.description}
                onChange={(e) => update(i, { description: e.target.value })}
                placeholder={placeholder}
                className={cn(controlClass, "field-sizing-content min-h-10 resize-y py-2")}
              />
              {codesOpen.has(i) ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input aria-label={`Brand / model, line ${i + 1}`} placeholder="Brand / model" value={item.model} onChange={(e) => update(i, { model: e.target.value })} maxLength={120} />
                  {priced && <Input aria-label={`HS code, line ${i + 1}`} placeholder="HS code" value={item.hsCode} onChange={(e) => update(i, { hsCode: e.target.value })} maxLength={20} />}
                </div>
              ) : (
                <button type="button" onClick={() => setCodesOpen((p) => new Set(p).add(i))} className="self-start text-xs font-medium text-primary hover:underline">
                  + {priced ? "Model / HS code" : "Brand / model"}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-start gap-2 sm:flex-nowrap">
              <div className="w-20">
                <label className="mb-1 block text-[11px] text-muted sm:sr-only" htmlFor={`${name}-qty-${i}`}>
                  Qty
                </label>
                <Input id={`${name}-qty-${i}`} type="number" min="0" step="any" inputMode="decimal" value={item.quantity} onChange={(e) => update(i, { quantity: e.target.value })} aria-label={`Quantity, line ${i + 1}`} />
              </div>
              <div className="w-24">
                <label className="mb-1 block text-[11px] text-muted sm:sr-only" htmlFor={`${name}-unit-${i}`}>
                  Unit
                </label>
                <Input id={`${name}-unit-${i}`} list="unit-options" value={item.unit} onChange={(e) => update(i, { unit: e.target.value })} maxLength={20} aria-label={`Unit, line ${i + 1}`} />
              </div>
              {priced && (
                <>
                  <div className="w-36">
                    <label className="mb-1 block text-[11px] text-muted sm:sr-only" htmlFor={`${name}-price-${i}`}>
                      Unit price
                    </label>
                    <Input
                      id={`${name}-price-${i}`}
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={item.unitPrice}
                      onChange={(e) => update(i, { unitPrice: e.target.value })}
                      placeholder="Unit price"
                      aria-label={`Unit price, line ${i + 1}`}
                    />
                  </div>
                  <p className="w-32 pt-2.5 text-right text-sm font-medium tabular-nums sm:pt-2.5" aria-label={`Amount, line ${i + 1}`}>
                    {formatCents(totals.lines[i]?.lineTotal ?? 0, currency)}
                  </p>
                </>
              )}
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={items.length === 1}
                className="mt-1.5 rounded-md p-1.5 text-muted hover:bg-bad-soft hover:text-bad disabled:opacity-30"
                aria-label={`Remove line ${i + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ol>
      {errors?.[name] && <p className="text-xs text-bad">{errors[name]![0]}</p>}
      <div>
        <Button type="button" variant="secondary" size="sm" onClick={() => setItems((prev) => [...prev, emptyLine()])}>
          <Plus aria-hidden /> {priced ? "Add line" : "Add another item"}
        </Button>
      </div>

      {priced && (
        <div className="ml-auto grid w-full max-w-sm gap-3 rounded-xl border border-line bg-surface-2/60 p-4">
          <div className="flex justify-between text-sm">
            <span className="text-muted">Subtotal</span>
            <span className="tabular">{formatCents(totals.subtotal, currency)}</span>
          </div>
          <Field label="Discount (amount)" htmlFor="discount" error={errors?.discount}>
            <Input id="discount" name="discount" type="number" min="0" step="0.01" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </Field>
          <Field label="Tax rate (%)" htmlFor="taxRate" error={errors?.taxRate} hint="0 if no tax applies">
            <Input id="taxRate" name="taxRate" type="number" min="0" max="100" step="0.01" inputMode="decimal" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
          </Field>
          <div className="flex justify-between text-sm">
            <span className="text-muted">Tax</span>
            <span className="tabular">{formatCents(totals.taxAmount, currency)}</span>
          </div>
          <div className="flex justify-between border-t border-line pt-3 text-base font-semibold text-text">
            <span>Total</span>
            <span className="tabular">{formatCents(totals.total, currency)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
