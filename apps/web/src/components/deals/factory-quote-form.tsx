"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Factory, Loader2, Plus } from "lucide-react";
import { convertMinor, formatMinor, fxRate, toMinor, unitCostMinor } from "@kebo/money";
import { Button, Checkbox, cn, controlClass, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { FactoryOption, FactoryQuoteView, SourcingView } from "@/lib/types-deals";
import { ErrorText, MiniLabel, move, numberText, RowButtons, rowKey } from "./form-bits";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

interface LineState {
  key: string;
  id: string | null;
  requestedItemId: string;
  description: string;
  model: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  vatRate: string;
  rebateRate: string;
}

interface QuoteState {
  factory: { id: string | null; name: string } | null;
  reference: string;
  currency: string;
  pricesIncludeVat: boolean;
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
const lineFromItem = (it: Item, vatRate = "13"): LineState => ({
  key: `item-${it.id}`,
  id: null,
  requestedItemId: it.id,
  description: it.description,
  model: it.model ?? "",
  quantity: it.quantity,
  unit: it.unit,
  unitPrice: "",
  vatRate,
  rebateRate: "0",
});

function initialState(quote: FactoryQuoteView | null, items: Item[], today: string): QuoteState {
  if (quote)
    return {
      factory: { id: quote.factory.id, name: quote.factory.name },
      reference: quote.reference ?? "",
      currency: quote.currency,
      pricesIncludeVat: quote.pricesIncludeVat,
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
        vatRate: String(l.vatRate),
        rebateRate: String(l.rebateRate),
      })),
    };
  return {
    factory: null,
    reference: "",
    currency: "CNY",
    pricesIncludeVat: true,
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
    pricesIncludeVat: s.pricesIncludeVat,
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
      vatRate: numberText(l.vatRate),
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
              <p className="truncate text-xs text-muted">
                {f.contactPerson ? `${f.contactPerson} · ` : ""}VAT {Number(f.defaultVatRate)}% {f.pricesIncludeVat ? "included" : "on top"}
              </p>
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
 * One factory's prices for this deal: who, in what currency, with or without
 * VAT, and a price per requested item. Shows the landed unit cost in the
 * selling currency as you type (the same maths as the API).
 */
export function FactoryQuoteForm({
  action,
  quote,
  items,
  today,
  mainCurrency,
  rates,
  searchFactories,
  onDone,
}: {
  action: Action;
  quote: FactoryQuoteView | null;
  items: Item[];
  today: string;
  mainCurrency: string;
  rates: Record<string, number>;
  searchFactories: (q: string) => Promise<FactoryOption[]>;
  onDone: () => void;
}) {
  const [s, setS] = useState<QuoteState>(() => initialState(quote, items, today));
  const set = <K extends keyof QuoteState>(k: K, v: QuoteState[K]) => setS((st) => ({ ...st, [k]: v }));
  const setLine = (i: number, patch: Partial<LineState>) => setS((st) => ({ ...st, lines: st.lines.map((l, n) => (n === i ? { ...l, ...patch } : l)) }));
  const currency = s.currency.trim().toUpperCase();
  const rate = /^[A-Z]{3}$/.test(currency) ? fxRate(currency, mainCurrency, mainCurrency, rates) : null;
  const known = [mainCurrency, ...Object.keys(rates)];

  const landed = (l: LineState) => {
    const price = numberText(l.unitPrice);
    if (!price || !Number.isFinite(Number(price)) || rate === null) return null;
    const cost = unitCostMinor({ unitPriceMinor: toMinor(price), vatRate: Number(numberText(l.vatRate)) || 0, pricesIncludeVat: s.pricesIncludeVat, rebateRate: Number(numberText(l.rebateRate)) || 0 });
    return convertMinor(cost, rate);
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
                onChange={(f, k) => {
                  set("factory", f);
                  if (k && !quote) setS((x) => ({ ...x, factory: f, pricesIncludeVat: k.pricesIncludeVat, lines: x.lines.map((l) => ({ ...l, vatRate: String(Number(k.defaultVatRate)) })) }));
                }}
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
            <div className="flex items-center gap-2 md:col-span-3">
              <Checkbox id="pricesIncludeVat" checked={s.pricesIncludeVat} onChange={(e) => set("pricesIncludeVat", e.target.checked)} />
              <label htmlFor="pricesIncludeVat" className="text-sm">
                Prices include VAT <span className="text-muted">(Chinese factories usually quote with 13% VAT included)</span>
              </label>
            </div>
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
                const cost = landed(l);
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
                        <Input id={`fq-desc-${l.key}`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                      </div>
                      <div className="col-span-2 sm:col-span-3">
                        <MiniLabel htmlFor={`fq-model-${l.key}`}>Model</MiniLabel>
                        <Input id={`fq-model-${l.key}`} value={l.model} onChange={(e) => setLine(i, { model: e.target.value })} maxLength={120} />
                      </div>
                      <div>
                        <MiniLabel htmlFor={`fq-qty-${l.key}`}>Quantity</MiniLabel>
                        <Input id={`fq-qty-${l.key}`} inputMode="decimal" className="tabular" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                      </div>
                      <div>
                        <MiniLabel htmlFor={`fq-unit-${l.key}`}>Unit</MiniLabel>
                        <Input id={`fq-unit-${l.key}`} value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} maxLength={20} />
                      </div>
                      <div className="col-span-2">
                        <MiniLabel htmlFor={`fq-price-${l.key}`}>Unit price ({currency || "—"})</MiniLabel>
                        <Input id={`fq-price-${l.key}`} inputMode="decimal" className="tabular" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} />
                      </div>
                      <div>
                        <MiniLabel htmlFor={`fq-vat-${l.key}`}>VAT %</MiniLabel>
                        <Input id={`fq-vat-${l.key}`} inputMode="decimal" className="tabular" value={l.vatRate} onChange={(e) => setLine(i, { vatRate: e.target.value })} />
                      </div>
                      <div>
                        <MiniLabel htmlFor={`fq-rebate-${l.key}`}>Rebate %</MiniLabel>
                        <Input id={`fq-rebate-${l.key}`} inputMode="decimal" className="tabular" value={l.rebateRate} onChange={(e) => setLine(i, { rebateRate: e.target.value })} title="Export VAT rebate rate for this product's HS code (0 when not claimed)" />
                      </div>
                      <div className="col-span-2 flex flex-col justify-end">
                        <span className="mb-1 block text-xs text-muted">Landed cost / unit</span>
                        <span className="flex h-9 items-center text-sm font-medium tabular">{cost === null ? <span className="text-xs font-normal text-muted">{rate === null ? "No exchange rate" : "Enter a price"}</span> : formatMinor(cost, mainCurrency)}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            <ErrorText error={st.errors?.lines} />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setS((x) => ({ ...x, lines: [...x.lines, { key: rowKey(), id: null, requestedItemId: "", description: "", model: "", quantity: "1", unit: "pcs", unitPrice: "", vatRate: x.lines[0]?.vatRate ?? "13", rebateRate: "0" }] }))}>
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
