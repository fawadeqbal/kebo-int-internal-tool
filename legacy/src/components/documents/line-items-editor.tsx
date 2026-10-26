"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, controlClass, Field, Input } from "@/components/ui";
import { calculateTotals, formatCents, formatMoney } from "@/lib/utils/money";
import { costSummary, marginPercent, priceForMargin } from "@/lib/costing";
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
  vat: vatDefault = { rate: 0, included: false },
  initialTaxRate,
  currency = "USD",
  errors,
  priced = true,
  name = "items",
  sourceLabel,
  costing = false,
  placeholder = "e.g. Rotary tablet press, 35 stations, GMP, SS316",
}: {
  initialItems: EditableLine[];
  initialDiscount?: string;
  /** The VAT from Settings (never typed here): rate, whether prices include it, and whether the customer is exempt. */
  vat?: { rate: number; included: boolean; exempt?: boolean };
  /** Given: the VAT % can be changed on this document (starts from this value); whether prices include VAT stays the setting. */
  initialTaxRate?: string;
  currency?: string;
  errors?: Record<string, string[] | undefined>;
  /** false = requested items: no prices or totals. */
  priced?: boolean;
  name?: string;
  /** Shown on lines that came from the step before, e.g. "Requested". */
  sourceLabel?: string;
  /** Show our cost and margin per line (internal; never printed). */
  costing?: boolean;
  placeholder?: string;
}) {
  const [items, setItems] = useState<EditableLine[]>(
    initialItems.length ? initialItems : [emptyLine()],
  );
  const [discount, setDiscount] = useState(initialDiscount);
  const [taxRate, setTaxRate] = useState(
    initialTaxRate ?? String(vatDefault.rate),
  );
  const vat = useMemo(
    () =>
      initialTaxRate === undefined
        ? vatDefault
        : {
            ...vatDefault,
            rate: Math.min(Math.max(Number(taxRate) || 0, 0), 100),
          },
    [initialTaxRate, vatDefault, taxRate],
  );
  const [marginText, setMarginText] = useState<Record<number, string>>({});
  const [costOpen, setCostOpen] = useState<Set<number>>(
    () => new Set(initialItems.flatMap((l, i) => (l.unitCost ? [i] : []))),
  );
  const [codesOpen, setCodesOpen] = useState<Set<number>>(
    () =>
      new Set(initialItems.flatMap((l, i) => (l.model || l.hsCode ? [i] : []))),
  );
  const totals = useMemo(
    () =>
      calculateTotals(priced ? items : [], discount, vat.rate, vat.included),
    [items, discount, vat.rate, vat.included, priced],
  );
  const update = (i: number, patch: Partial<EditableLine>) =>
    setItems((prev) =>
      prev.map((it, j) => (j === i ? { ...it, ...patch } : it)),
    );
  const summary = useMemo(
    () =>
      costing
        ? costSummary(
            items
              .filter((i) => i.description.trim())
              .map((i) => ({
                quantity: i.quantity,
                unitPrice: i.unitPrice,
                unitCost: i.unitCost ?? null,
              })),
            vat,
          )
        : null,
    [items, costing, vat],
  );
  const setMargin = (i: number, text: string) => {
    setMarginText((m) => ({ ...m, [i]: text }));
    const cost = Number(items[i].unitCost);
    const m = Number(text);
    if (text !== "" && Number.isFinite(m) && m < 95 && cost > 0)
      update(i, { unitPrice: String(priceForMargin(cost, m, vat)) });
  };
  const remove = (i: number) => {
    setItems((prev) =>
      prev.length > 1 ? prev.filter((_, j) => j !== i) : prev,
    );
    setCodesOpen(
      (prev) =>
        new Set(
          [...prev].filter((j) => j !== i).map((j) => (j > i ? j - 1 : j)),
        ),
    );
  };
  const filled = items.filter(
    (i) => i.description.trim() || (priced && i.unitPrice),
  );

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
          <li
            key={i}
            className="grid gap-3 p-3 sm:grid-cols-[1.75rem_1fr_auto] sm:items-start"
          >
            <span className="hidden pt-2.5 text-sm text-muted tabular-nums sm:block">
              {i + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-2">
              <label className="sr-only" htmlFor={`${name}-desc-${i}`}>
                Item, line {i + 1}
              </label>
              {sourceLabel && item.sourceId && (
                <span className="text-[11px] font-medium text-muted">
                  {sourceLabel}
                </span>
              )}
              <textarea
                id={`${name}-desc-${i}`}
                rows={item.description.includes("\n") ? 3 : 1}
                value={item.description}
                onChange={(e) => update(i, { description: e.target.value })}
                placeholder={placeholder}
                className={cn(
                  controlClass,
                  "field-sizing-content min-h-10 resize-y py-2",
                )}
              />
              {codesOpen.has(i) ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    aria-label={`Brand / model, line ${i + 1}`}
                    placeholder="Brand / model"
                    value={item.model}
                    onChange={(e) => update(i, { model: e.target.value })}
                    maxLength={120}
                  />
                  {priced && (
                    <Input
                      aria-label={`HS code, line ${i + 1}`}
                      placeholder="HS code"
                      value={item.hsCode}
                      onChange={(e) => update(i, { hsCode: e.target.value })}
                      maxLength={20}
                    />
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCodesOpen((p) => new Set(p).add(i))}
                  className="self-start text-xs font-medium text-primary hover:underline"
                >
                  + {priced ? "Model / HS code" : "Brand / model"}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-start justify-end gap-2 sm:flex-nowrap">
              <div className="w-20">
                <label
                  className="mb-1 block text-[11px] text-muted sm:sr-only"
                  htmlFor={`${name}-qty-${i}`}
                >
                  Qty
                </label>
                <Input
                  id={`${name}-qty-${i}`}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={item.quantity}
                  onChange={(e) => update(i, { quantity: e.target.value })}
                  aria-label={`Quantity, line ${i + 1}`}
                />
              </div>
              <div className="w-24">
                <label
                  className="mb-1 block text-[11px] text-muted sm:sr-only"
                  htmlFor={`${name}-unit-${i}`}
                >
                  Unit
                </label>
                <Input
                  id={`${name}-unit-${i}`}
                  list="unit-options"
                  value={item.unit}
                  onChange={(e) => update(i, { unit: e.target.value })}
                  maxLength={20}
                  aria-label={`Unit, line ${i + 1}`}
                />
              </div>
              {priced && (
                <>
                  <div className="w-36">
                    <label
                      className="mb-1 block text-[11px] text-muted sm:sr-only"
                      htmlFor={`${name}-price-${i}`}
                    >
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
                  <p
                    className="w-32 pt-2.5 text-right text-sm font-medium tabular-nums sm:pt-2.5"
                    aria-label={`Amount, line ${i + 1}`}
                  >
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
            {priced && costing && costOpen.has(i) && (
              <div className="flex flex-wrap items-center justify-end gap-2 rounded-lg bg-surface-2 px-2 py-1.5 text-xs text-muted sm:col-span-2 sm:col-start-2">
                {item.costNote && (
                  <span className="mr-auto truncate">{item.costNote}</span>
                )}
                <label className="flex items-center gap-1.5">
                  Our cost
                  <Input
                    className="h-8 w-28 text-xs"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={item.unitCost ?? ""}
                    onChange={(e) => update(i, { unitCost: e.target.value })}
                    aria-label={`Our cost per unit, line ${i + 1}`}
                  />
                </label>
                <label className="flex items-center gap-1.5">
                  Margin
                  <Input
                    className="h-8 w-20 text-xs"
                    type="number"
                    step="0.1"
                    inputMode="decimal"
                    value={
                      marginText[i] ??
                      (item.unitCost && item.unitPrice
                        ? String(
                            marginPercent(
                              Number(item.unitPrice),
                              Number(item.unitCost),
                              vat,
                            ) ?? "",
                          )
                        : "")
                    }
                    onChange={(e) => setMargin(i, e.target.value)}
                    onBlur={() =>
                      setMarginText((m) => {
                        const next = { ...m };
                        delete next[i];
                        return next;
                      })
                    }
                    aria-label={`Margin %, line ${i + 1}`}
                  />
                  %
                </label>
              </div>
            )}
            {priced && costing && !costOpen.has(i) && (
              <button
                type="button"
                onClick={() => setCostOpen((p) => new Set(p).add(i))}
                className="justify-self-end text-xs font-medium text-primary hover:underline sm:col-span-2 sm:col-start-2"
              >
                + Our cost
              </button>
            )}
          </li>
        ))}
      </ol>
      {errors?.[name] && <p className="text-xs text-bad">{errors[name]![0]}</p>}
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setItems((prev) => [...prev, emptyLine()])}
        >
          <Plus aria-hidden /> {priced ? "Add line" : "Add another item"}
        </Button>
      </div>

      {priced && (
        <div className="ml-auto grid w-full max-w-sm gap-3 rounded-xl border border-line bg-surface-2/60 p-4">
          <div className="flex justify-between text-sm">
            <span className="text-muted">Subtotal</span>
            <span className="tabular">
              {formatCents(totals.subtotal, currency)}
            </span>
          </div>
          <Field
            label="Discount (amount)"
            htmlFor="discount"
            error={errors?.discount}
          >
            <Input
              id="discount"
              name="discount"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </Field>
          {initialTaxRate !== undefined && (
            <Field
              label="VAT (%)"
              htmlFor="taxRate"
              error={errors?.taxRate}
              hint={
                Number(taxRate) === vatDefault.rate
                  ? vatDefault.exempt
                    ? "This customer is VAT exempt"
                    : "The rate from Settings"
                  : `Settings: ${vatDefault.rate}%${vatDefault.exempt ? " (customer exempt)" : ""}. Changed for this quotation`
              }
            >
              <Input
                id="taxRate"
                name="taxRate"
                type="number"
                min="0"
                max="100"
                step="0.01"
                inputMode="decimal"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
              />
            </Field>
          )}
          {!vat.included && (vat.rate > 0 || vat.exempt) && (
            <div className="flex justify-between text-sm">
              <span className="text-muted">
                {vat.exempt && vat.rate === 0
                  ? "VAT (customer exempt)"
                  : `VAT ${vat.rate}%`}
              </span>
              <span className="tabular">
                {formatCents(totals.taxAmount, currency)}
              </span>
            </div>
          )}
          <div className="flex justify-between border-t border-line pt-3 text-base font-semibold text-text">
            <span>
              {vat.included && vat.rate > 0 ? "Total incl. VAT" : "Total"}
            </span>
            <span className="tabular">
              {formatCents(totals.total, currency)}
            </span>
          </div>
          {vat.included && (
            <div className="-mt-2 flex justify-between text-xs text-muted">
              <span>
                {vat.exempt && vat.rate === 0
                  ? "No VAT (customer exempt)"
                  : `of which VAT ${vat.rate}%`}
              </span>
              <span className="tabular">
                {formatCents(totals.taxAmount, currency)}
              </span>
            </div>
          )}
          <p className="text-xs text-muted">
            {vat.included ? "Prices include VAT" : "VAT is added on top"} (set
            by the super admin in Settings).
          </p>
          {summary && summary.costCents > 0 && (
            <div className="grid gap-1 rounded-lg border border-dashed border-line-strong p-3 text-xs">
              <p className="font-medium text-text-2">Internal, not printed</p>
              <div className="flex justify-between">
                <span className="text-muted">Our cost (incl. VAT)</span>
                <span className="tabular">
                  {formatCents(summary.costCents, currency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Profit before discount</span>
                <span
                  className={
                    summary.profitCents < 0
                      ? "font-medium text-bad tabular"
                      : "font-medium text-ok tabular"
                  }
                >
                  {formatCents(summary.profitCents, currency)} ·{" "}
                  {summary.marginPercent}%
                </span>
              </div>
              {summary.uncosted > 0 && (
                <p className="text-muted">
                  {summary.uncosted} line(s) without a cost (e.g. freight) are
                  left out.
                </p>
              )}
              {totals.discount > 0 && (
                <p className="text-muted">
                  After the discount:{" "}
                  {formatMoney(
                    (summary.profitCents - totals.discount) / 100,
                    currency,
                  )}{" "}
                  profit.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
