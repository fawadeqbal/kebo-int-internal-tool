"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Factory, Loader2, Plus } from "lucide-react";
import { fxRate } from "@kebo/money";
import { INCOTERMS, type Incoterm } from "@kebo/shared";
import { Button, cn, controlClass, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { FactoryOption, FactoryQuoteView } from "@/lib/types-deals";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** What each basis means for us, in a few words. */
const BASIS_HINT: Partial<Record<Incoterm, string>> = {
  EXW: "At their factory: we pay transport to the port and everything after",
  FCA: "Handed to our carrier, export cleared: we pay the freight and after",
  FOB: "On board at the port: we pay the sea freight and after",
  CFR: "Freight paid to the destination port: we pay insurance and after",
  CIF: "Freight and insurance paid to the destination port",
  DAP: "Delivered to the named place, not import cleared",
  DDP: "Delivered, duties paid",
};

interface QuoteState {
  factory: { id: string | null; name: string } | null;
  reference: string;
  currency: string;
  receivedOn: string;
  validUntil: string;
  basis: Incoterm | "";
  basisPlace: string;
  leadTime: string;
  moq: string;
  paymentTerms: string;
  notes: string;
}

function initialState(quote: FactoryQuoteView | null, today: string): QuoteState {
  return {
    factory: quote ? { id: quote.factory.id, name: quote.factory.name } : null,
    reference: quote?.reference ?? "",
    currency: quote?.currency ?? "CNY",
    receivedOn: quote?.receivedOn ?? today,
    validUntil: quote?.validUntil ?? "",
    basis: quote?.basis ?? "",
    basisPlace: quote?.basisPlace ?? "",
    leadTime: quote?.leadTime ?? "",
    moq: quote?.moq ?? "",
    paymentTerms: quote?.paymentTerms ?? "",
    notes: quote?.notes ?? "",
  };
}

/** The offer's details; its lines are added and changed in the line table, one at a time. */
function payload(s: QuoteState) {
  return {
    factoryId: s.factory?.id ?? null,
    newFactoryName: s.factory && !s.factory.id ? s.factory.name : null,
    reference: s.reference,
    receivedOn: s.receivedOn,
    validUntil: s.validUntil || null,
    currency: s.currency.trim().toUpperCase(),
    basis: s.basis || null,
    basisPlace: s.basisPlace,
    leadTime: s.leadTime,
    moq: s.moq,
    paymentTerms: s.paymentTerms,
    notes: s.notes,
  };
}

/** Choose a known factory, or type a new one's name (it is added to the factory list on save). */
function FactoryPicker({
  value,
  onChange,
  search,
  error,
}: {
  value: QuoteState["factory"];
  onChange: (f: QuoteState["factory"], known?: FactoryOption) => void;
  search: (q: string) => Promise<FactoryOption[]>;
  error?: string[];
}) {
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
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label="Factories"
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-pop"
        >
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
          {!loading && !rows.length && !typed && (
            <li className="px-2.5 py-3 text-sm text-muted">No factories yet: type the name of the first one.</li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * One factory's offer: who, their reference, currency, dates, price basis,
 * lead time and terms. Saving a new one opens its line table, where the lines
 * are typed, pasted or copied from another factory's offer.
 */
export function OfferHeaderForm({
  action,
  quote,
  today,
  mainCurrency,
  rates,
  searchFactories,
  onDone,
  onCancel,
}: {
  action: Action;
  quote: FactoryQuoteView | null;
  today: string;
  mainCurrency: string;
  rates: Record<string, number>;
  searchFactories: (q: string) => Promise<FactoryOption[]>;
  onDone: (state: ActionState) => void;
  onCancel?: () => void;
}) {
  const [s, setS] = useState<QuoteState>(() => initialState(quote, today));
  const set = <K extends keyof QuoteState>(k: K, v: QuoteState[K]) => setS((st) => ({ ...st, [k]: v }));
  const currency = s.currency.trim().toUpperCase();
  const rate = /^[A-Z]{3}$/.test(currency) ? fxRate(currency, mainCurrency, mainCurrency, rates) : null;
  const known = [mainCurrency, ...Object.keys(rates)];

  return (
    <ActionForm action={action} onDone={onDone} className="flex flex-col gap-4" keepFields>
      {(st) => (
        <>
          <input type="hidden" name="payload" value={JSON.stringify(payload(s))} />
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Factory" htmlFor="factory" error={st.errors?.factoryId ?? st.errors?.newFactoryName} className="md:col-span-2">
              <FactoryPicker value={s.factory} search={searchFactories} error={st.errors?.factoryId} onChange={(f) => set("factory", f)} />
            </Field>
            <Field label="Their reference" htmlFor="reference" optional error={st.errors?.reference}>
              <Input
                id="reference"
                value={s.reference}
                onChange={(e) => set("reference", e.target.value)}
                maxLength={80}
                placeholder="Quote no."
              />
            </Field>
            <Field
              label="Currency"
              htmlFor="currency"
              error={st.errors?.currency}
              hint={
                rate === null && /^[A-Z]{3}$/.test(currency)
                  ? `No exchange rate for ${currency} in Settings`
                  : rate && rate !== 1
                    ? `1 ${mainCurrency} = ${rate} ${currency}`
                    : undefined
              }
            >
              <Input
                id="currency"
                value={s.currency}
                onChange={(e) => set("currency", e.target.value.toUpperCase())}
                maxLength={3}
                list="fq-currencies"
                className="uppercase"
              />
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
            <Field
              label="Price basis"
              htmlFor="basis"
              error={st.errors?.basis ?? st.errors?.basisPlace}
              hint={s.basis ? BASIS_HINT[s.basis] : "What their prices already pay for: needed to work out freight and the like"}
            >
              <div className="flex gap-2">
                <Select id="basis" value={s.basis} onChange={(e) => set("basis", e.target.value as Incoterm | "")} className="w-28 shrink-0">
                  <option value="">Not said</option>
                  {INCOTERMS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
                <Input
                  id="basisPlace"
                  aria-label="Basis place"
                  value={s.basisPlace}
                  onChange={(e) => set("basisPlace", e.target.value)}
                  maxLength={60}
                  list="fq-basis-place"
                  placeholder={s.basis === "EXW" ? "Factory town" : "Port, e.g. Qingdao"}
                />
                <datalist id="fq-basis-place">
                  {["Qingdao", "Shanghai", "Ningbo", "Tianjin", "Shenzhen", "Guangzhou", "Xiamen"].map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </div>
            </Field>
            <Field label="Lead time" htmlFor="leadTime" optional error={st.errors?.leadTime}>
              <Input
                id="leadTime"
                value={s.leadTime}
                onChange={(e) => set("leadTime", e.target.value)}
                maxLength={120}
                placeholder="e.g. 25 days after deposit"
              />
            </Field>
            <Field label="Minimum order (MOQ)" htmlFor="moq" optional error={st.errors?.moq}>
              <Input id="moq" value={s.moq} onChange={(e) => set("moq", e.target.value)} maxLength={60} />
            </Field>
            <Field label="Payment terms" htmlFor="paymentTerms" optional error={st.errors?.paymentTerms} className="md:col-span-3">
              <Input
                id="paymentTerms"
                value={s.paymentTerms}
                onChange={(e) => set("paymentTerms", e.target.value)}
                maxLength={2000}
                placeholder="e.g. 30% deposit, 70% before delivery"
              />
            </Field>
          </div>

          <Field label="Notes" htmlFor="fq-notes" optional error={st.errors?.notes}>
            <Textarea
              id="fq-notes"
              rows={2}
              className="min-h-0"
              value={s.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Packing, samples, anything to remember about this offer"
            />
          </Field>
          <div className="flex gap-2">
            <SubmitButton pendingText="Saving…">{quote ? "Save the details" : "Start this offer"}</SubmitButton>
            {onCancel && (
              <Button variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </>
      )}
    </ActionForm>
  );
}
