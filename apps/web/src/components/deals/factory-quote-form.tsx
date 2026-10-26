"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Factory, Loader2, Plus } from "lucide-react";
import { convertMinor, formatMinor, fxRate, toMinor, unitCostMinor } from "@kebo/money";
import { costSentence, DEFAULT_FACTORY_VAT, REBATE_CHOICES, TAX_CHOICES } from "@kebo/shared";
import { Button, cn, controlClass, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PercentChoice } from "@/components/common/percent-choice";
import type { ActionState } from "@/lib/actions";
import type { FactoryOption, FactoryQuoteView, SourcingView } from "@/lib/types-deals";
import { ErrorText, MiniLabel, move, numberText, RowButtons, rowKey } from "./form-bits";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** The export rebate remembered for an HS code: null the first time, undefined when it cannot be checked. */
export type HsLookup = (code: string) => Promise<{ rebateRate: number; description: string | null } | null | undefined>;

const TAX_OPTIONS = TAX_CHOICES.map((value) => ({ value }));
const REBATE_OPTIONS = REBATE_CHOICES.map((value) => ({ value }));
const cleanHs = (v: string) => v.replace(/\s+/g, "");

interface LineState {
  key: string;
  id: string | null;
  requestedItemId: string;
  description: string;
  model: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  hsCode: string;
  rebateRate: string;
  /** The HS code last looked up, and what was found (client only). */
  hsChecked: string;
  hsKnown: { rebateRate: number; description: string | null } | null;
  hsNew: boolean;
}

interface QuoteState {
  factory: { id: string | null; name: string } | null;
  reference: string;
  currency: string;
  /** Tax % added on top of the prices (they are without tax). */
  vatRate: string;
  receivedOn: string;
  validUntil: string;
  priceBasis: string;
  leadTime: string;
  moq: string;
  paymentTerms: string;
  notes: string;
  lines: LineState[];
}

type Item = SourcingView["items"][number];

// Keys of the first rows are fixed (from the item), so the server and browser render the same ids.
const blankHs = { hsChecked: "", hsKnown: null, hsNew: false };

const lineFromItem = (it: Item): LineState => ({
  key: `item-${it.id}`,
  id: null,
  requestedItemId: it.id,
  description: it.description,
  model: it.model ?? "",
  quantity: it.quantity,
  unit: it.unit,
  unitPrice: "",
  hsCode: "",
  rebateRate: "",
  ...blankHs,
});

function initialState(quote: FactoryQuoteView | null, items: Item[], today: string): QuoteState {
  if (quote)
    return {
      factory: { id: quote.factory.id, name: quote.factory.name },
      reference: quote.reference ?? "",
      currency: quote.currency,
      vatRate: String(quote.vatRate),
      receivedOn: quote.receivedOn,
      validUntil: quote.validUntil ?? "",
      priceBasis: quote.priceBasis ?? "",
      leadTime: quote.leadTime ?? "",
      moq: quote.moq ?? "",
      paymentTerms: quote.paymentTerms ?? "",
      notes: quote.notes ?? "",
      lines: quote.lines.map((l) => ({
        key: l.id,
        id: l.id,
        requestedItemId: l.requestedItemId ?? "",
        description: l.description,
        model: l.model ?? "",
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
        hsCode: l.hsCode ?? "",
        rebateRate: String(l.rebateRate),
        ...blankHs,
        // A saved code is not looked up again unless it changes.
        hsChecked: l.hsCode ?? "",
      })),
    };
  return {
    factory: null,
    reference: "",
    currency: "CNY",
    vatRate: String(DEFAULT_FACTORY_VAT),
    receivedOn: today,
    validUntil: "",
    priceBasis: "",
    leadTime: "",
    moq: "",
    paymentTerms: "",
    notes: "",
    lines: items.map((it) => lineFromItem(it)),
  };
}

function payload(s: QuoteState) {
  return {
    factoryId: s.factory?.id ?? null,
    newFactoryName: s.factory && !s.factory.id ? s.factory.name : null,
    reference: s.reference,
    receivedOn: s.receivedOn,
    validUntil: s.validUntil || null,
    currency: s.currency.trim().toUpperCase(),
    vatRate: numberText(s.vatRate),
    priceBasis: s.priceBasis,
    leadTime: s.leadTime,
    moq: s.moq,
    paymentTerms: s.paymentTerms,
    notes: s.notes,
    lines: s.lines.map((l) => ({
      id: l.id,
      requestedItemId: l.requestedItemId || null,
      description: l.description,
      model: l.model,
      quantity: numberText(l.quantity),
      unit: l.unit.trim() || "pcs",
      unitPrice: numberText(l.unitPrice),
      hsCode: cleanHs(l.hsCode) || null,
      rebateRate: numberText(l.rebateRate),
    })),
  };
}

/** Choose a known factory, or type a new one's name (it is added to the factory list on save). */
function FactoryPicker({ value, onChange, search, error }: { value: QuoteState["factory"]; onChange: (f: QuoteState["factory"], known?: FactoryOption) => void; search: (q: string) => Promise<FactoryOption[]>; error?: string[] }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<FactoryOption[]>([]);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const call = useRef(0);

  useEffect(() => {
    if (!open) return;
    const n = ++call.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const found = await search(q);
      if (n !== call.current) return;
      setRows(found);
      setLoading(false);
    }, 200);
    return () => clearTimeout(t);
  }, [q, open, search]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (value)
    return (
      <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2/50 px-3 py-2">
        <Factory className="size-4 shrink-0 text-muted" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {value.name}
          {!value.id && <span className="ml-2 text-xs font-normal text-primary">new factory — added when you save</span>}
        </p>
        <Button size="xs" variant="ghost" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    );

  const typed = q.trim();
  const exact = rows.some((r) => r.name.toLowerCase() === typed.toLowerCase());
  return (
    <div ref={box} className="relative">
      <input
        id="factory"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-invalid={!!error || undefined}
        autoComplete="off"
        value={q}
        placeholder="Search factories or type a new name…"
        className={cn(controlClass, "h-9 pr-9")}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (rows[0] && rows[0].name.toLowerCase() === typed.toLowerCase()) onChange({ id: rows[0].id, name: rows[0].name }, rows[0]);
            else if (typed) onChange({ id: null, name: typed });
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {loading && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted" aria-hidden />}
      {open && (
        <ul id={`${id}-list`} role="listbox" aria-label="Factories" className="absolute top-full right-0 left-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-pop">
          {rows.map((f) => (
            <li
              key={f.id}
              role="option"
              aria-selected={false}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange({ id: f.id, name: f.name }, f);
              }}
              className="cursor-pointer rounded-lg px-2.5 py-2 hover:bg-surface-2"
            >
              <p className="truncate text-sm font-medium">{f.name}</p>
              {f.contactPerson && <p className="truncate text-xs text-muted">{f.contactPerson}</p>}
            </li>
          ))}
          {typed && !exact && (
            <li
              role="option"
              aria-selected={false}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange({ id: null, name: typed });
              }}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-primary hover:bg-surface-2"
            >
              <Plus className="size-4" aria-hidden /> Add “{typed}” as a new factory
            </li>
          )}
          {!loading && !rows.length && !typed && <li className="px-2.5 py-3 text-sm text-muted">No factories yet: type the name of the first one.</li>}
        </ul>
      )}
    </div>
  );
}

/**
 * One factory's prices for this deal: who, in what currency, the tax % added
 * on top (prices are always without tax), and a price per requested item with
 * its HS code and export rebate. Each line explains itself as you type
 * ("CNY 100.00 + 13% tax = CNY 113.00 · 13% rebate back · your cost CNY 100.00")
 * with the same maths as the API, plus the cost in the selling currency.
 */
export function FactoryQuoteForm({
  action,
  quote,
  items,
  today,
  mainCurrency,
  rates,
  searchFactories,
  lookupHsCode,
  onDone,
}: {
  action: Action;
  quote: FactoryQuoteView | null;
  items: Item[];
  today: string;
  mainCurrency: string;
  rates: Record<string, number>;
  searchFactories: (q: string) => Promise<FactoryOption[]>;
  lookupHsCode: HsLookup;
  onDone: () => void;
}) {
  const [s, setS] = useState<QuoteState>(() => initialState(quote, items, today));
  const set = <K extends keyof QuoteState>(k: K, v: QuoteState[K]) => setS((st) => ({ ...st, [k]: v }));
  const setLine = (i: number, patch: Partial<LineState>) => setS((st) => ({ ...st, lines: st.lines.map((l, n) => (n === i ? { ...l, ...patch } : l)) }));
  const currency = s.currency.trim().toUpperCase();
  const rate = /^[A-Z]{3}$/.test(currency) ? fxRate(currency, mainCurrency, mainCurrency, rates) : null;
  const known = [mainCurrency, ...Object.keys(rates)];

  const vatRate = Number(numberText(s.vatRate)) || 0;
  const setLineByKey = (key: string, patch: Partial<LineState>) => setS((st) => ({ ...st, lines: st.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  /** A line's cost in the factory's currency (price + tax − rebate) and in the selling currency; null without a price. */
  const costOf = (l: LineState) => {
    const price = numberText(l.unitPrice);
    if (!price || !Number.isFinite(Number(price))) return null;
    const unitPriceMinor = toMinor(price);
    const rebateRate = Number(numberText(l.rebateRate)) || 0;
    const costMinor = unitCostMinor({ unitPriceMinor, vatRate, pricesIncludeVat: false, rebateRate });
    return {
      sentence: costSentence({ unitPriceMinor, vatRate, rebateRate, costMinor, currency: currency || "—" }),
      landed: rate === null ? null : convertMinor(costMinor, rate),
    };
  };

  /** When an HS code is typed, start from the rebate remembered for it. */
  const checkHs = async (key: string, typed: string) => {
    const code = cleanHs(typed);
    const line = s.lines.find((l) => l.key === key);
    if (!line || code === line.hsChecked) return;
    if (!/^[0-9.]{2,20}$/.test(code)) return setLineByKey(key, { ...blankHs, hsChecked: code });
    const found = await lookupHsCode(code);
    setS((st) => ({
      ...st,
      lines: st.lines.map((l) => {
        if (l.key !== key || cleanHs(l.hsCode) !== code) return l;
        if (found === undefined) return { ...l, ...blankHs };
        if (found === null) return { ...l, hsChecked: code, hsKnown: null, hsNew: true };
        return { ...l, hsChecked: code, hsKnown: found, hsNew: false, rebateRate: String(found.rebateRate) };
      }),
    }));
  };

  const linkItem = (i: number, itemId: string) => {
    const it = items.find((x) => x.id === itemId);
    setS((st) => ({
      ...st,
      lines: st.lines.map((l, n) => {
        if (n !== i) return l;
        if (!it) return { ...l, requestedItemId: "" };
        const fresh = !l.description.trim() || items.some((x) => x.description === l.description);
        return fresh ? { ...l, requestedItemId: it.id, description: it.description, model: it.model ?? "", quantity: it.quantity, unit: it.unit } : { ...l, requestedItemId: it.id };
      }),
    }));
  };

  return (
    <ActionForm action={action} onDone={onDone} className="flex flex-col gap-4">
      {(st) => (
        <>
          <input type="hidden" name="payload" value={JSON.stringify(payload(s))} />
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Factory" htmlFor="factory" error={st.errors?.factoryId ?? st.errors?.newFactoryName} className="md:col-span-2">
              <FactoryPicker
                value={s.factory}
                search={searchFactories}
                error={st.errors?.factoryId}
                onChange={(f) => set("factory", f)}
              />
            </Field>
            <Field label="Their reference" htmlFor="reference" optional error={st.errors?.reference}>
              <Input id="reference" value={s.reference} onChange={(e) => set("reference", e.target.value)} maxLength={80} placeholder="Quote no." />
            </Field>
            <Field label="Currency" htmlFor="currency" error={st.errors?.currency} hint={rate === null && /^[A-Z]{3}$/.test(currency) ? `No exchange rate for ${currency} in Settings` : rate && rate !== 1 ? `1 ${mainCurrency} = ${rate} ${currency}` : undefined}>
              <Input id="currency" value={s.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} maxLength={3} list="fq-currencies" className="uppercase" />
              <datalist id="fq-currencies">
                {known.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="Received on" htmlFor="receivedOn" error={st.errors?.receivedOn}>
              <Input id="receivedOn" type="date" value={s.receivedOn} max={today} onChange={(e) => set("receivedOn", e.target.value)} />
            </Field>
            <Field label="Valid until" htmlFor="validUntil" optional error={st.errors?.validUntil}>
              <Input id="validUntil" type="date" value={s.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
            </Field>
            <Field label="Tax added on top" htmlFor="fq-vat" error={st.errors?.vatRate} hint="Prices are without tax" className="md:col-span-2">
              <PercentChoice id="fq-vat" label="Tax added on top" value={s.vatRate} onChange={(v) => set("vatRate", v)} choices={TAX_OPTIONS} invalid={!!st.errors?.vatRate} />
            </Field>
            <Field label="Price basis" htmlFor="priceBasis" optional error={st.errors?.priceBasis}>
              <Input id="priceBasis" value={s.priceBasis} onChange={(e) => set("priceBasis", e.target.value)} maxLength={60} list="fq-basis" placeholder="e.g. EXW factory" />
              <datalist id="fq-basis">
                {["EXW factory", "Delivered to our warehouse", "FOB Qingdao", "FOB Shanghai", "FOB Ningbo"].map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </Field>
            <Field label="Lead time" htmlFor="leadTime" optional error={st.errors?.leadTime}>
              <Input id="leadTime" value={s.leadTime} onChange={(e) => set("leadTime", e.target.value)} maxLength={120} placeholder="e.g. 25 days after deposit" />
            </Field>
            <Field label="Minimum order (MOQ)" htmlFor="moq" optional error={st.errors?.moq}>
              <Input id="moq" value={s.moq} onChange={(e) => set("moq", e.target.value)} maxLength={60} />
            </Field>
            <Field label="Payment terms" htmlFor="paymentTerms" optional error={st.errors?.paymentTerms} className="md:col-span-3">
              <Input id="paymentTerms" value={s.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} maxLength={2000} placeholder="e.g. 30% deposit, 70% before delivery" />
            </Field>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Prices</h3>
            <ol className="flex flex-col gap-3">
              {s.lines.map((l, i) => {
                const cost = costOf(l);
                const err = (f: string) => st.errors?.[`lines.${i}.${f}`];
                const remembered = l.hsKnown && cleanHs(l.hsCode) === l.hsChecked ? l.hsKnown : null;
                const rebateNow = numberText(l.rebateRate);
                return (
                  <li key={l.key} className="rounded-lg border border-line p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 flex-1 sm:max-w-md">
                        <label htmlFor={`fq-item-${l.key}`} className="sr-only">
                          For which requested item
                        </label>
                        <Select id={`fq-item-${l.key}`} compact value={l.requestedItemId} onChange={(e) => linkItem(i, e.target.value)}>
                          <option value="">Not linked to a requested item</option>
                          {items.map((it, n) => (
                            <option key={it.id} value={it.id}>
                              For item {n + 1}: {it.description.split("\n")[0].slice(0, 60)}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <RowButtons index={i} count={s.lines.length} label={`price ${i + 1}`} onMove={(to) => setS((x) => ({ ...x, lines: move(x.lines, i, to) }))} onRemove={() => setS((x) => ({ ...x, lines: x.lines.filter((_, n) => n !== i) }))} />
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-8">
                      <div className="col-span-2 sm:col-span-5">
                        <MiniLabel htmlFor={`fq-desc-${l.key}`}>Description (as the factory wrote it)</MiniLabel>
                        <Input id={`fq-desc-${l.key}`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} aria-invalid={!!err("description") || undefined} />
                        <ErrorText error={err("description")} />
                      </div>
                      <div className="col-span-2 sm:col-span-3">
                        <MiniLabel htmlFor={`fq-model-${l.key}`}>Model</MiniLabel>
                        <Input id={`fq-model-${l.key}`} value={l.model} onChange={(e) => setLine(i, { model: e.target.value })} maxLength={120} />
                      </div>
                      <div>
                        <MiniLabel htmlFor={`fq-qty-${l.key}`}>Quantity</MiniLabel>
                        <Input id={`fq-qty-${l.key}`} inputMode="decimal" className="tabular" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} aria-invalid={!!err("quantity") || undefined} />
                        <ErrorText error={err("quantity")} />
                      </div>
                      <div>
                        <MiniLabel htmlFor={`fq-unit-${l.key}`}>Unit</MiniLabel>
                        <Input id={`fq-unit-${l.key}`} value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} maxLength={20} />
                      </div>
                      <div className="col-span-2">
                        <MiniLabel htmlFor={`fq-price-${l.key}`}>Unit price without tax ({currency || "—"})</MiniLabel>
                        <Input id={`fq-price-${l.key}`} inputMode="decimal" className="tabular" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} aria-invalid={!!err("unitPrice") || undefined} />
                        <ErrorText error={err("unitPrice")} />
                      </div>
                      <div className="col-span-2 sm:col-span-2">
                        <MiniLabel htmlFor={`fq-hs-${l.key}`}>
                          HS code <span className="text-muted/80">optional</span>
                        </MiniLabel>
                        <Input
                          id={`fq-hs-${l.key}`}
                          inputMode="decimal"
                          className="tabular"
                          value={l.hsCode}
                          maxLength={20}
                          placeholder="e.g. 8437.80"
                          onChange={(e) => setLine(i, { hsCode: e.target.value })}
                          onBlur={(e) => void checkHs(l.key, e.target.value)}
                          aria-invalid={!!err("hsCode") || undefined}
                        />
                        <ErrorText error={err("hsCode")} />
                      </div>
                      <div className="col-span-2 flex flex-col justify-end sm:col-span-2">
                        <span className="mb-1 block text-xs text-muted">Your cost / unit ({mainCurrency})</span>
                        <span className="flex h-9 items-center text-sm font-medium tabular">{cost === null ? <span className="text-xs font-normal text-muted">Enter a price</span> : cost.landed === null ? <span className="text-xs font-normal text-warn">No exchange rate</span> : formatMinor(cost.landed, mainCurrency)}</span>
                      </div>
                      <div className="col-span-2 sm:col-span-8">
                        <MiniLabel htmlFor={`fq-rebate-${l.key}`}>Export rebate</MiniLabel>
                        <PercentChoice id={`fq-rebate-${l.key}`} label={`Export rebate for price ${i + 1}`} value={l.rebateRate} onChange={(v) => setLine(i, { rebateRate: v })} choices={REBATE_OPTIONS} invalid={!!err("rebateRate")} />
                        {err("rebateRate") ? (
                          <ErrorText error={err("rebateRate")} />
                        ) : l.hsNew && cleanHs(l.hsCode) === l.hsChecked ? (
                          <p className="mt-1 text-xs text-primary">New HS code: choose its rebate — it will be remembered</p>
                        ) : remembered ? (
                          <p className="mt-1 text-xs text-muted">
                            {rebateNow !== "" && Number(rebateNow) !== remembered.rebateRate
                              ? `HS ${l.hsChecked} was ${remembered.rebateRate}%: saving remembers ${rebateNow}% instead`
                              : `Remembered for HS ${l.hsChecked}${remembered.description ? ` (${remembered.description})` : ""}`}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    {cost && <p className="mt-2 rounded-md bg-surface-2/70 px-2.5 py-1.5 text-xs text-text-2 tabular">{cost.sentence}</p>}
                  </li>
                );
              })}
            </ol>
            {!Object.keys(st.errors ?? {}).some((k) => k.startsWith("lines.")) && <ErrorText error={st.errors?.lines} />}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setS((x) => ({ ...x, lines: [...x.lines, { key: rowKey(), id: null, requestedItemId: "", description: "", model: "", quantity: "1", unit: "pcs", unitPrice: "", hsCode: "", rebateRate: "", ...blankHs }] }))}>
                <Plus aria-hidden /> Add a price
              </Button>
            </div>
          </div>

          <Field label="Notes" htmlFor="fq-notes" optional error={st.errors?.notes}>
            <Textarea id="fq-notes" rows={2} className="min-h-0" value={s.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Packing, samples, anything to remember about this offer" />
          </Field>
          <div className="flex gap-2">
            <SubmitButton pendingText="Saving…">{quote ? "Save the prices" : "Add these prices"}</SubmitButton>
            <Button variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}
