"use client";

import { useState, type ReactNode } from "react";
import { Lock, Plus } from "lucide-react";
import { costSummary, documentTotals, formatMinor, fromMinor, marginPercent, priceForMargin, toMinor } from "@kebo/money";
import {
  BALANCE_TERMS,
  BALANCE_TERMS_LABEL,
  INCOTERMS,
  LINE_TYPE_LABEL,
  LINE_TYPES,
  type BalanceTerms,
  type Incoterm,
  type LineType,
} from "@kebo/shared";
import { Button, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { RevisionDraft } from "@/lib/types-deals";
import { ErrorText, MiniLabel, move, numberText, RowButtons, rowKey } from "./form-bits";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

interface LineState {
  key: string;
  requestedItemId: string | null;
  factoryQuoteLineId: string | null;
  fxRate: number | null;
  type: LineType;
  description: string;
  model: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  unitCost: string;
}

interface EditorState {
  currency: string;
  incoterm: Incoterm;
  incotermPlace: string;
  depositPercent: string;
  balanceTerms: BalanceTerms;
  leadTime: string;
  validUntil: string;
  discount: string;
  terms: string;
  notes: string;
  lines: LineState[];
}

const str = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(v));

function fromDraft(d: RevisionDraft): EditorState {
  return {
    currency: d.currency,
    incoterm: d.incoterm,
    incotermPlace: str(d.incotermPlace),
    depositPercent: str(d.depositPercent),
    balanceTerms: d.balanceTerms,
    leadTime: str(d.leadTime),
    validUntil: d.validUntil,
    discount: Number(d.discount) ? Number(d.discount).toFixed(2) : "",
    terms: str(d.terms),
    notes: str(d.notes),
    lines: d.lines.map((l, i) => ({
      key: `line-${i}`,
      requestedItemId: l.requestedItemId,
      factoryQuoteLineId: l.factoryQuoteLineId,
      fxRate: l.fxRate,
      type: l.type,
      description: l.description,
      model: str(l.model),
      quantity: str(l.quantity),
      unit: l.unit,
      unitPrice: Number(l.unitPrice).toFixed(2),
      unitCost: l.unitCost === null ? "" : Number(l.unitCost).toFixed(2),
    })),
  };
}

function payload(s: EditorState, showCosts: boolean) {
  return {
    currency: s.currency.trim().toUpperCase(),
    incoterm: s.incoterm,
    incotermPlace: s.incotermPlace,
    depositPercent: numberText(s.depositPercent),
    balanceTerms: s.balanceTerms,
    leadTime: s.leadTime,
    validUntil: s.validUntil,
    discount: numberText(s.discount),
    terms: s.terms,
    notes: s.notes,
    lines: s.lines.map((l) => ({
      requestedItemId: l.requestedItemId,
      type: l.type,
      description: l.description,
      model: l.model,
      quantity: numberText(l.quantity),
      unit: l.unit.trim() || "pcs",
      unitPrice: numberText(l.unitPrice),
      ...(showCosts ? { unitCost: numberText(l.unitCost) || null, factoryQuoteLineId: l.factoryQuoteLineId, fxRate: l.fxRate } : {}),
    })),
  };
}

const valid = (v: string) => v.trim() !== "" && Number.isFinite(Number(numberText(v)));

/**
 * The editor for a draft revision: terms, lines and live totals worked out
 * with the API's own maths (@kebo/money). People who may see costs also get
 * each line's cost and margin, a "price from margin" helper, and the internal
 * costing box.
 */
export function RevisionEditor({
  action,
  number,
  initial,
  showCosts,
  defaultMargin,
  submitLabel,
  onDone,
  requireChanges,
  footer,
  onCancel,
}: {
  action: Action;
  number: number;
  initial: RevisionDraft;
  showCosts: boolean;
  defaultMargin: number;
  submitLabel: string;
  onDone?: () => void;
  /** Saving needs a change (editing an existing draft). */
  requireChanges?: boolean;
  /** Shown under the form, e.g. the draft's own actions; told whether there are unsaved changes. */
  footer?: (dirty: boolean) => ReactNode;
  onCancel?: () => void;
}) {
  const [s, setS] = useState<EditorState>(() => fromDraft(initial));
  const [saved, setSaved] = useState(() => JSON.stringify(fromDraft(initial)));
  const [margin, setMargin] = useState(String(defaultMargin));
  const dirty = JSON.stringify(s) !== saved;
  const update = (fn: (st: EditorState) => EditorState) => setS(fn);
  const set = <K extends keyof EditorState>(k: K, v: EditorState[K]) => update((st) => ({ ...st, [k]: v }));
  const setLine = (i: number, patch: Partial<LineState>) =>
    update((st) => ({ ...st, lines: st.lines.map((l, n) => (n === i ? { ...l, ...patch } : l)) }));

  const currency = /^[A-Za-z]{3}$/.test(s.currency.trim()) ? s.currency.trim().toUpperCase() : "—";
  const totals = documentTotals(
    s.lines.map((l) => ({ quantity: numberText(l.quantity) || 0, unitPrice: numberText(l.unitPrice) || 0 })),
    numberText(s.discount) || 0,
  );
  const costing = showCosts
    ? costSummary(
        s.lines.map((l) => ({
          quantity: numberText(l.quantity) || 0,
          unitPriceMinor: toMinor(numberText(l.unitPrice)),
          unitCostMinor: valid(l.unitCost) ? toMinor(numberText(l.unitCost)) : null,
        })),
        totals.discount,
      )
    : null;
  const fmt = (minor: number) => formatMinor(minor, currency);
  const costed = s.lines.filter((l) => valid(l.unitCost)).length;
  const marginNumber = Number(numberText(margin));
  const marginOk = margin.trim() !== "" && Number.isFinite(marginNumber) && marginNumber >= 0 && marginNumber < 100;

  const applyMargin = () => {
    if (!marginOk) return;
    update((st) => ({
      ...st,
      lines: st.lines.map((l) =>
        valid(l.unitCost) ? { ...l, unitPrice: fromMinor(priceForMargin(toMinor(numberText(l.unitCost)), marginNumber)) } : l,
      ),
    }));
  };

  return (
    <>
      <ActionForm
        action={action}
        onDone={() => {
          setSaved(JSON.stringify(s));
          onDone?.();
        }}
        className="flex flex-col gap-5"
      >
        {(st) => (
          <>
            <input type="hidden" name="payload" value={JSON.stringify(payload(s, showCosts))} />

            <section aria-label="Terms" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Currency" htmlFor={`cur-${number}`} error={st.errors?.currency}>
                <Input
                  id={`cur-${number}`}
                  value={s.currency}
                  maxLength={3}
                  className="uppercase"
                  onChange={(e) => set("currency", e.target.value.toUpperCase())}
                />
              </Field>
              <Field label="Incoterm" htmlFor={`inco-${number}`} error={st.errors?.incoterm}>
                <Select id={`inco-${number}`} value={s.incoterm} onChange={(e) => set("incoterm", e.target.value as Incoterm)}>
                  {INCOTERMS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Place"
                htmlFor={`place-${number}`}
                optional
                error={st.errors?.incotermPlace}
                hint="Port or place for the Incoterm"
              >
                <Input
                  id={`place-${number}`}
                  value={s.incotermPlace}
                  maxLength={80}
                  placeholder="e.g. Qingdao"
                  onChange={(e) => set("incotermPlace", e.target.value)}
                />
              </Field>
              <Field label="Valid until" htmlFor={`valid-${number}`} error={st.errors?.validUntil}>
                <Input id={`valid-${number}`} type="date" value={s.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
              </Field>
              <Field label="Deposit %" htmlFor={`dep-${number}`} error={st.errors?.depositPercent}>
                <Input
                  id={`dep-${number}`}
                  inputMode="decimal"
                  className="tabular"
                  value={s.depositPercent}
                  onChange={(e) => set("depositPercent", e.target.value)}
                />
              </Field>
              <Field label="Balance" htmlFor={`bal-${number}`} error={st.errors?.balanceTerms}>
                <Select id={`bal-${number}`} value={s.balanceTerms} onChange={(e) => set("balanceTerms", e.target.value as BalanceTerms)}>
                  {BALANCE_TERMS.map((b) => (
                    <option key={b} value={b}>
                      {BALANCE_TERMS_LABEL[b]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Lead time" htmlFor={`lead-${number}`} optional error={st.errors?.leadTime} className="sm:col-span-2">
                <Input
                  id={`lead-${number}`}
                  value={s.leadTime}
                  maxLength={120}
                  placeholder="e.g. 30 days after deposit"
                  onChange={(e) => set("leadTime", e.target.value)}
                />
              </Field>
            </section>

            <section aria-label="Lines">
              <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
                <h3 className="text-sm font-semibold">Lines</h3>
                {showCosts && (
                  <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-line px-3 py-2">
                    <div>
                      <label htmlFor={`margin-${number}`} className="mb-1 block text-xs text-muted">
                        Set prices from a margin of
                      </label>
                      <div className="flex items-center gap-1.5">
                        <Input
                          id={`margin-${number}`}
                          inputMode="decimal"
                          className="h-8 w-20 tabular"
                          value={margin}
                          onChange={(e) => setMargin(e.target.value)}
                        />
                        <span className="text-sm text-muted">%</span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={applyMargin}
                      disabled={!marginOk || costed === 0}
                      title={costed === 0 ? "No line has a cost yet" : undefined}
                    >
                      Apply to {costed} line{costed === 1 ? "" : "s"} with a cost
                    </Button>
                  </div>
                )}
              </div>
              <ol className="flex flex-col gap-3">
                {s.lines.map((l, i) => {
                  const price = toMinor(numberText(l.unitPrice));
                  const lineMargin =
                    showCosts && valid(l.unitCost) && price > 0 ? marginPercent(price, toMinor(numberText(l.unitCost))) : null;
                  return (
                    <li key={l.key} className="rounded-lg border border-line p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-muted">
                            {l.requestedItemId && initial.itemNumbers?.[l.requestedItemId]
                              ? `${initial.itemNumbers[l.requestedItemId]!.includes(".") ? "Part" : "Item"} ${initial.itemNumbers[l.requestedItemId]}`
                              : `Line ${i + 1}`}
                          </span>
                          <label htmlFor={`type-${l.key}`} className="sr-only">
                            Line type
                          </label>
                          <Select
                            id={`type-${l.key}`}
                            compact
                            className="w-48"
                            value={l.type}
                            onChange={(e) => setLine(i, { type: e.target.value as LineType })}
                          >
                            {LINE_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {LINE_TYPE_LABEL[t]}
                              </option>
                            ))}
                          </Select>
                        </div>
                        <RowButtons
                          index={i}
                          count={s.lines.length}
                          label={`line ${i + 1}`}
                          onMove={(to) => update((x) => ({ ...x, lines: move(x.lines, i, to) }))}
                          onRemove={() => update((x) => ({ ...x, lines: x.lines.filter((_, n) => n !== i) }))}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-12">
                        <div className="col-span-2 sm:col-span-12">
                          <MiniLabel htmlFor={`desc-${l.key}`}>Description (printed)</MiniLabel>
                          <Textarea
                            id={`desc-${l.key}`}
                            rows={2}
                            className="min-h-0"
                            value={l.description}
                            onChange={(e) => setLine(i, { description: e.target.value })}
                          />
                        </div>
                        <div className="col-span-2 sm:col-span-5">
                          <MiniLabel htmlFor={`model-${l.key}`}>Model</MiniLabel>
                          <Input
                            id={`model-${l.key}`}
                            value={l.model}
                            maxLength={120}
                            onChange={(e) => setLine(i, { model: e.target.value })}
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <MiniLabel htmlFor={`qty-${l.key}`}>Quantity</MiniLabel>
                          <Input
                            id={`qty-${l.key}`}
                            inputMode="decimal"
                            className="tabular"
                            value={l.quantity}
                            onChange={(e) => setLine(i, { quantity: e.target.value })}
                          />
                        </div>
                        <div className="sm:col-span-1">
                          <MiniLabel htmlFor={`unit-${l.key}`}>Unit</MiniLabel>
                          <Input
                            id={`unit-${l.key}`}
                            value={l.unit}
                            maxLength={20}
                            onChange={(e) => setLine(i, { unit: e.target.value })}
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <MiniLabel htmlFor={`price-${l.key}`}>Unit price</MiniLabel>
                          <Input
                            id={`price-${l.key}`}
                            inputMode="decimal"
                            className="tabular"
                            value={l.unitPrice}
                            onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                          />
                        </div>
                        <div className="flex flex-col justify-end text-right sm:col-span-2">
                          <span className="mb-1 block text-xs text-muted">Line total</span>
                          <span className="flex h-9 items-center justify-end text-sm font-semibold tabular">
                            {fmt(totals.lines[i]?.lineTotal ?? 0)}
                          </span>
                        </div>
                        {showCosts && (
                          <div className="col-span-2 flex flex-wrap items-end gap-3 rounded-md bg-surface-2/70 px-2.5 py-2 sm:col-span-12">
                            <div className="w-36">
                              <MiniLabel htmlFor={`cost-${l.key}`}>Our unit cost</MiniLabel>
                              <Input
                                id={`cost-${l.key}`}
                                inputMode="decimal"
                                className="h-8 tabular"
                                value={l.unitCost}
                                placeholder="No cost"
                                onChange={(e) => setLine(i, { unitCost: e.target.value })}
                              />
                            </div>
                            <p className="flex h-8 items-center gap-1.5 text-sm">
                              <span className="text-muted">Margin</span>
                              <span
                                className={cn(
                                  "font-semibold tabular",
                                  lineMargin === null
                                    ? "text-muted"
                                    : lineMargin < 0
                                      ? "text-bad"
                                      : lineMargin < 5
                                        ? "text-warn"
                                        : "text-ok",
                                )}
                              >
                                {lineMargin === null ? "—" : `${lineMargin.toFixed(1)}%`}
                              </span>
                            </p>
                            {valid(l.unitCost) && marginOk && (
                              <Button
                                size="xs"
                                variant="ghost"
                                className="mb-0.5"
                                onClick={() =>
                                  setLine(i, { unitPrice: fromMinor(priceForMargin(toMinor(numberText(l.unitCost)), marginNumber)) })
                                }
                              >
                                Price at {marginNumber}% margin
                              </Button>
                            )}
                            {l.factoryQuoteLineId && <span className="mb-1.5 ml-auto text-xs text-muted">from a factory price</span>}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
              <ErrorText error={st.errors?.lines} />
              <div className="mt-3">
                <Button
                  size="sm"
                  onClick={() =>
                    update((x) => ({
                      ...x,
                      lines: [
                        ...x.lines,
                        {
                          key: rowKey(),
                          requestedItemId: null,
                          factoryQuoteLineId: null,
                          fxRate: null,
                          type: "charge",
                          description: "",
                          model: "",
                          quantity: "1",
                          unit: "lot",
                          unitPrice: "",
                          unitCost: "",
                        },
                      ],
                    }))
                  }
                >
                  <Plus aria-hidden /> Add a line
                </Button>
                <span className="ml-2 text-xs text-muted">e.g. freight, inspection, samples</span>
              </div>
            </section>

            <section aria-label="Totals" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="grid content-start gap-4">
                <Field label="Terms" htmlFor={`terms-${number}`} optional error={st.errors?.terms} hint="Printed on the quotation">
                  <Textarea id={`terms-${number}`} rows={3} value={s.terms} onChange={(e) => set("terms", e.target.value)} />
                </Field>
                <Field label="Notes" htmlFor={`notes-${number}`} optional error={st.errors?.notes}>
                  <Textarea
                    id={`notes-${number}`}
                    rows={2}
                    className="min-h-0"
                    value={s.notes}
                    onChange={(e) => set("notes", e.target.value)}
                  />
                </Field>
              </div>
              <div className="flex flex-col gap-3">
                <dl className="rounded-lg border border-line p-3 text-sm">
                  <div className="flex justify-between py-1">
                    <dt className="text-muted">Subtotal</dt>
                    <dd className="tabular">{fmt(totals.subtotal)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-1">
                    <dt>
                      <label htmlFor={`disc-${number}`} className="text-muted">
                        Discount
                      </label>
                    </dt>
                    <dd>
                      <Input
                        id={`disc-${number}`}
                        inputMode="decimal"
                        className="h-8 w-32 text-right tabular"
                        value={s.discount}
                        placeholder="0.00"
                        onChange={(e) => set("discount", e.target.value)}
                        aria-invalid={!!st.errors?.discount || undefined}
                      />
                    </dd>
                  </div>
                  <ErrorText error={st.errors?.discount} />
                  <div className="mt-1 flex justify-between border-t border-line pt-2 text-base font-semibold">
                    <dt>Total</dt>
                    <dd className="tabular">{fmt(totals.total)}</dd>
                  </div>
                </dl>
                {costing && (
                  <CostingBox
                    currency={currency}
                    cost={costing.costMinor}
                    sales={costing.salesMinor}
                    profit={costing.profitMinor}
                    margin={costing.marginPercent}
                    uncosted={costing.uncostedLines}
                  />
                )}
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton pendingText="Saving…" disabled={requireChanges && !dirty}>
                {submitLabel}
              </SubmitButton>
              {onCancel && (
                <Button variant="ghost" onClick={onCancel}>
                  Cancel
                </Button>
              )}
              {dirty && requireChanges && <span className="text-xs text-warn">Unsaved changes</span>}
            </div>
          </>
        )}
      </ActionForm>
      {footer?.(dirty)}
    </>
  );
}

/** Cost, sales, profit and margin of a revision. Internal: never printed. */
export function CostingBox({
  currency,
  cost,
  sales,
  profit,
  margin,
  uncosted,
}: {
  currency: string;
  cost: number;
  sales: number;
  profit: number;
  margin: number | null;
  uncosted: number;
}) {
  const fmt = (minor: number) => formatMinor(minor, currency);
  return (
    <div className="rounded-lg border border-dashed border-money/40 bg-money-soft/50 p-3 text-sm">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-money">
        <Lock className="size-3.5" aria-hidden /> Internal costing — never printed
      </p>
      <dl>
        <div className="flex justify-between py-0.5">
          <dt className="text-text-2">Cost</dt>
          <dd className="tabular">{fmt(cost)}</dd>
        </div>
        <div className="flex justify-between py-0.5">
          <dt className="text-text-2" title="After the discount">
            Sales <span className="text-xs text-muted">after discount</span>
          </dt>
          <dd className="tabular">{fmt(sales)}</dd>
        </div>
        <div className="flex justify-between py-0.5 font-semibold">
          <dt>Profit</dt>
          <dd className={cn("tabular", profit < 0 && "text-bad")}>{fmt(profit)}</dd>
        </div>
        <div className="flex justify-between py-0.5">
          <dt className="text-text-2">Margin</dt>
          <dd className={cn("font-semibold tabular", margin !== null && margin < 0 && "text-bad")}>
            {margin === null ? "—" : `${margin.toFixed(1)}%`}
          </dd>
        </div>
      </dl>
      {uncosted > 0 && (
        <p className="mt-1.5 text-xs text-muted">
          {uncosted} line{uncosted === 1 ? " has" : "s have"} no cost and {uncosted === 1 ? "is" : "are"} left out.
        </p>
      )}
    </div>
  );
}
