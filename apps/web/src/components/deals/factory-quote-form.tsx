"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Factory, Loader2, Plus } from "lucide-react";
import { fxRate } from "@kebo/money";
import { INCOTERMS, type Incoterm } from "@kebo/shared";
import { Button, cn, controlClass, Field, Input, Select, Textarea } from "@kebo/ui";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { FactoryOption, FactoryQuoteView, LastOffer } from "@/lib/types-deals";
import { date } from "@/lib/format";
import { convertText, rateOf, rateSentence } from "@/lib/fx";
import { CurrencySelect } from "@/components/common/currency-select";
import { FloatingList } from "@/components/common/floating";
import { PANEL_FORM, PanelSection } from "@/components/common/panel";

/** The usual Chinese ports, offered under the Port field (any other can be typed). */
const PORTS = ["Qingdao", "Shanghai", "Ningbo", "Tianjin", "Shenzhen", "Guangzhou", "Xiamen", "Dalian"];

/**
 * The port (or the factory's town for EXW) as its own field: type it, or pick
 * one of the usual ports from the list that opens under this field (drawn
 * above the page, so it never covers or hides under another field).
 */
export function PortPicker({ id, value, onChange, exw }: { id: string; value: string; onChange: (v: string) => void; exw: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const typed = value.trim().toLowerCase();
  const shown = exw ? [] : PORTS.filter((p) => !typed || p.toLowerCase().includes(typed) || PORTS.some((x) => x.toLowerCase() === typed));
  return (
    <div ref={box} className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open && shown.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        maxLength={60}
        placeholder={exw ? "The factory's town" : "e.g. Qingdao"}
        className={cn(controlClass, "h-9 pr-9")}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            document.querySelector<HTMLElement>(`#${CSS.escape(id)}-list [role=option]`)?.focus();
          }
        }}
      />
      {!exw && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Show the usual ports"
          className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted hover:text-text"
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown className="size-4" aria-hidden />
        </button>
      )}
      {open && shown.length > 0 && (
        <FloatingList anchor={() => box.current} onClose={() => setOpen(false)} className="p-1">
          <ul id={`${id}-list`} role="listbox" aria-label="Ports" className="max-h-60 overflow-y-auto">
            {shown.map((p) => (
              <li
                key={p}
                role="option"
                tabIndex={-1}
                aria-selected={p.toLowerCase() === typed}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(p);
                  setOpen(false);
                }}
                onKeyDown={(e) => {
                  const items = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[role=option]") ?? [])];
                  const at = items.indexOf(e.currentTarget);
                  const input = () => document.getElementById(id)?.focus();
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    items[at + 1]?.focus();
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    if (at === 0) input();
                    else items[at - 1]?.focus();
                  } else if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onChange(p);
                    setOpen(false);
                    input();
                  } else if (e.key === "Escape") {
                    setOpen(false);
                    input();
                  }
                }}
                className={cn(
                  "cursor-pointer rounded-md px-2.5 py-2 text-sm outline-none hover:bg-surface-2 focus:bg-surface-2",
                  p.toLowerCase() === typed && "bg-primary-soft font-medium text-primary",
                )}
              >
                {p}
              </li>
            ))}
          </ul>
        </FloatingList>
      )}
    </div>
  );
}

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * The offer's tax (board Fix27Tax): "Their prices are" without tax (added on
 * top) or tax included, and the tax % its lines take. `note` says what a
 * change does to the lines already there.
 */
export function TaxBox({
  idPrefix,
  included,
  rate,
  onIncluded,
  onRate,
  error,
  note,
  className,
}: {
  idPrefix: string;
  included: boolean;
  rate: string;
  onIncluded: (v: boolean) => void;
  onRate: (v: string) => void;
  error?: string[];
  note?: ReactNode;
  className?: string;
}) {
  const choice = (value: boolean, title: string, sub: string) => (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-lg border bg-surface px-3 py-2.5 text-sm transition-colors",
        included === value ? "border-primary bg-primary-soft/50 ring-1 ring-primary/30" : "border-line hover:border-line-strong",
      )}
    >
      <input
        type="radio"
        name={`${idPrefix}-tax-included`}
        className="mt-0.5 accent-[var(--color-primary)]"
        checked={included === value}
        onChange={() => onIncluded(value)}
      />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-text-2">{sub}</span>
      </span>
    </label>
  );
  return (
    <fieldset className={cn("flex flex-col gap-3 rounded-xl border border-line bg-surface-2/60 p-3 sm:p-4", className)}>
      <legend className="sr-only">Tax</legend>
      <p className="text-sm font-semibold" aria-hidden>
        Tax
      </p>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-text-2">Their prices are</span>
        <div className="grid gap-2 sm:grid-cols-2">
          {choice(false, "Without tax", "tax is added on top")}
          {choice(true, "Tax included", "the price already has the tax in it")}
        </div>
      </div>
      <Field
        label="Tax %"
        htmlFor={`${idPrefix}-tax-rate`}
        error={error}
        hint="0 unless the factory charges tax, e.g. 13% VAT in China"
      >
        <span className="flex items-center gap-2">
          <Input
            id={`${idPrefix}-tax-rate`}
            inputMode="decimal"
            className="h-9 w-24 text-right tabular"
            value={rate}
            onChange={(e) => onRate(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="0"
          />
          <span className="text-sm text-muted">%</span>
        </span>
      </Field>
      <p className="text-xs text-text-2">{note ?? "Applies to every line; a line can still have its own %."}</p>
    </fieldset>
  );
}

/** What changing the offer's % does to its lines: those at the old % follow, the others keep theirs. */
export function taxRateNote(lines: { taxRate: number }[], oldRate: number, newRate: string): ReactNode {
  const next = Number(newRate || 0);
  if (!lines.length || !Number.isFinite(next) || next === oldRate) return null;
  const follow = lines.filter((l) => Number(l.taxRate) === oldRate).length;
  const own = lines.length - follow;
  if (!follow) return `No line is at ${oldRate}%, so no line changes: each keeps its own %.`;
  return `${follow === lines.length ? `All ${follow}` : follow} line${follow === 1 ? "" : "s"} at ${oldRate}% change to ${next}%${own ? `; ${own} with ${own === 1 ? "its" : "their"} own % stay${own === 1 ? "s" : ""} as ${own === 1 ? "it is" : "they are"}` : ""}.`;
}

/** What each basis means for us, in a few words. */
export const BASIS_HINT: Partial<Record<Incoterm, string>> = {
  EXW: "At their factory: we pay transport to the port and everything after",
  FCA: "Handed to our carrier, export cleared: we pay the freight and after",
  FOB: "On board at the port: we pay the sea freight and after",
  CFR: "Freight paid to the destination port: we pay insurance and after",
  CIF: "Freight and insurance paid to the destination port",
  DAP: "Delivered to the named place, not import cleared",
  DDP: "Delivered, duties paid",
};

/** The basis in the list, with what it means in two or three words. */
const BASIS_WORDS: Partial<Record<Incoterm, string>> = {
  EXW: "at their factory",
  FCA: "to our carrier",
  FOB: "on board at the port",
  CFR: "freight paid",
  CIF: "freight and insurance paid",
  DAP: "delivered",
  DDP: "delivered, duties paid",
};

export interface QuoteState {
  factory: { id: string | null; name: string } | null;
  reference: string;
  currency: string;
  /** When the currency changes on an offer with prices: turn them into the new currency, or keep the numbers. */
  convertPrices: boolean;
  receivedOn: string;
  validUntil: string;
  basis: Incoterm | "";
  basisPlace: string;
  leadTime: string;
  moq: string;
  paymentTerms: string;
  /** The advance they ask when we order, % ("": the company's default). */
  advancePercent: string;
  /** The warranty the factory gives. */
  warranty: string;
  notes: string;
  /** Their prices have the tax in them (null: a new offer, the company's default). */
  taxIncluded: boolean | null;
  /** The offer's tax % as typed ("": a new offer, the company's default). */
  taxRate: string;
}

function initialState(quote: FactoryQuoteView | null, today: string): QuoteState {
  return {
    factory: quote ? { id: quote.factory.id, name: quote.factory.name } : null,
    reference: quote?.reference ?? "",
    currency: quote?.currency ?? "CNY",
    convertPrices: true,
    receivedOn: quote?.receivedOn ?? today,
    validUntil: quote?.validUntil ?? "",
    basis: quote?.basis ?? "",
    basisPlace: quote?.basisPlace ?? "",
    leadTime: quote?.leadTime ?? "",
    moq: quote?.moq ?? "",
    paymentTerms: quote?.paymentTerms ?? "",
    advancePercent: quote?.advancePercent === null || quote?.advancePercent === undefined ? "" : String(quote.advancePercent),
    warranty: quote?.warranty ?? "",
    notes: quote?.notes ?? "",
    taxIncluded: quote ? quote.taxIncluded : null,
    taxRate: quote ? String(quote.taxRate) : "",
  };
}

/** The offer's details; its lines are added and changed in the line table, one at a time. */
function payload(s: QuoteState, convertible?: boolean) {
  return {
    factoryId: s.factory?.id ?? null,
    newFactoryName: s.factory && !s.factory.id ? s.factory.name : null,
    reference: s.reference,
    receivedOn: s.receivedOn,
    validUntil: s.validUntil || null,
    currency: s.currency.trim().toUpperCase(),
    convertPrices: s.convertPrices && !!convertible,
    basis: s.basis || null,
    basisPlace: s.basisPlace,
    leadTime: s.leadTime,
    moq: s.moq,
    paymentTerms: s.paymentTerms,
    // Not set: a new offer takes the company's default; an edited one keeps its own.
    ...(s.advancePercent.trim() === "" ? {} : { advancePercent: s.advancePercent.trim() }),
    warranty: s.warranty,
    notes: s.notes,
    // Not set (a new offer): the company's default.
    ...(s.taxIncluded === null ? {} : { taxIncluded: s.taxIncluded }),
    ...(s.taxRate.trim() === "" ? {} : { taxRate: s.taxRate.trim() }),
  };
}

/** What a factory's last offer can fill in a new one (its lines, dates, reference and notes are always the new offer's own). */
const FROM_LAST = ["currency", "basis", "basisPlace", "taxIncluded", "taxRate", "leadTime", "paymentTerms", "advancePercent", "warranty"] as const;
export type FromLast = Partial<Pick<QuoteState, (typeof FROM_LAST)[number]>>;

/** The last offer as the form's values; what it did not say is left out. */
export function lastOfferValues(last: LastOffer): FromLast {
  const v: FromLast = {
    currency: last.currency,
    taxIncluded: last.taxIncluded,
    taxRate: String(last.taxRate),
    ...(last.basis ? { basis: last.basis } : {}),
    ...(last.basisPlace ? { basisPlace: last.basisPlace } : {}),
    ...(last.leadTime ? { leadTime: last.leadTime } : {}),
    ...(last.paymentTerms ? { paymentTerms: last.paymentTerms } : {}),
    ...(last.advancePercent === null ? {} : { advancePercent: String(last.advancePercent) }),
    ...(last.warranty ? { warranty: last.warranty } : {}),
  };
  return v;
}

/** Fill a new offer from the factory's last one: only the fields nobody has typed in yet (still as the window opened). */
export function fillFromLast(s: QuoteState, start: QuoteState, values: FromLast): QuoteState {
  const next = { ...s };
  for (const k of FROM_LAST) if (values[k] !== undefined && s[k] === start[k]) Object.assign(next, { [k]: values[k] });
  return next;
}

/** "Start empty", or another factory chosen: what was filled and not typed over goes back to how the window opened. */
export function unfill(s: QuoteState, start: QuoteState, values: FromLast | null | undefined): QuoteState {
  if (!values) return s;
  const next = { ...s };
  for (const k of FROM_LAST) if (values[k] !== undefined && s[k] === values[k]) Object.assign(next, { [k]: start[k] });
  return next;
}

/** Choose a known factory, or type a new one's name (it is added to the factory list on save). */
export function FactoryPicker({
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
 * The offer's window, the same for "Enter factory offer" and "Edit the offer": four sections in the same
 * order (Who, Price, Terms, Notes and their quotation). Its lines are not here: they have their own editor.
 * `files` is the right half of the last section; `footer` the window's buttons (inside the form).
 */
export function OfferHeaderForm({
  action,
  quote,
  today,
  mainCurrency,
  rates,
  searchFactories,
  lastOffer,
  onDone,
  defaults,
  files,
  note,
  footer,
}: {
  action: Action;
  quote: FactoryQuoteView | null;
  today: string;
  mainCurrency: string;
  rates: Record<string, number>;
  searchFactories: (q: string) => Promise<FactoryOption[]>;
  /** A new offer: what the chosen factory said on its last offer (the window starts from it). */
  lastOffer?: (factoryId: string) => Promise<LastOffer | null>;
  onDone: (state: ActionState) => void;
  /** A new offer's tax: the company's default (Settings). */
  defaults?: { taxIncluded: boolean; taxRate: number };
  /** The factory's own quotation files: the ones it has, and the place to add more. */
  files: ReactNode;
  /** Said above the buttons (a new offer: its lines come next). */
  note?: ReactNode;
  footer: ReactNode;
}) {
  // How the window opens; a field still like this has not been typed in.
  const [start] = useState<QuoteState>(() => ({
    ...initialState(quote, today),
    ...(!quote && defaults ? { taxIncluded: defaults.taxIncluded, taxRate: String(defaults.taxRate) } : {}),
  }));
  const [s, setS] = useState<QuoteState>(start);
  const set = <K extends keyof QuoteState>(k: K, v: QuoteState[K]) => setS((st) => ({ ...st, [k]: v }));
  // A new offer starts from the chosen factory's last one; what was filled, so each field can say so.
  const [filled, setFilled] = useState<{ last: LastOffer; values: FromLast } | null>(null);
  const asked = useRef(0);
  const pickFactory = async (f: QuoteState["factory"]) => {
    const n = ++asked.current;
    const before = filled?.values;
    setS((st) => ({ ...unfill(st, start, before), factory: f }));
    setFilled(null);
    if (quote || !f?.id || !lastOffer) return;
    const last = await lastOffer(f.id);
    if (n !== asked.current || !last) return;
    const values = lastOfferValues(last);
    setS((st) => fillFromLast(st, start, values));
    setFilled({ last, values });
  };
  const startEmpty = () => {
    const before = filled?.values;
    setS((st) => unfill(st, start, before));
    setFilled(null);
  };
  /** This field still shows what the last offer said. */
  const from = (...keys: (keyof FromLast)[]) => !!filled && keys.every((k) => filled.values[k] !== undefined && s[k] === filled.values[k]);
  const FROM = "from their last offer";
  const hintOf = (k: keyof FromLast, rest?: string) => (from(k) ? [FROM, rest].filter(Boolean).join(" · ") : rest);
  const currency = s.currency.trim().toUpperCase();
  const fx = { main: mainCurrency, rates };
  const rate = fxRate(currency, mainCurrency, mainCurrency, rates);
  // Changing the currency of an offer that has prices: convert them, or keep the numbers.
  const priced = (quote?.lines ?? []).filter((l) => Number(l.unitPrice) > 0);
  const recurrency = !!quote && currency !== quote.currency && priced.length > 0;
  const canConvert = recurrency && rateOf(fx, quote!.currency, currency) !== null;
  const sample = recurrency ? priced[0]! : null;
  const sampleTo = sample && canConvert ? convertText(String(sample.unitPrice), quote!.currency, currency, fx) : null;

  const recurrencyBox = (st: ActionState) =>
    recurrency && (
      <fieldset className="flex flex-col gap-2 rounded-lg border border-warn/30 bg-warn-soft/40 p-3 sm:col-span-2 md:col-span-3">
        <legend className="sr-only">What to do with the prices</legend>
        <p className="text-sm font-medium">
          Its {priced.length} price{priced.length === 1 ? " is" : "s are"} in {quote!.currency}. What should happen to {priced.length === 1 ? "it" : "them"}?
        </p>
        <label className={cn("flex items-start gap-2 text-sm", !canConvert && "text-muted")}>
          <input type="radio" name="fq-convert" className="mt-1" checked={canConvert && s.convertPrices} disabled={!canConvert} onChange={() => set("convertPrices", true)} />
          <span>
            Convert them to {currency}
            {canConvert ? (
              <span className="block text-xs text-text-2">
                At {rateSentence(fx, quote!.currency, currency)}: {sample!.description.split("\n")[0]} {quote!.currency} {Number(sample!.unitPrice).toLocaleString("en-US", { minimumFractionDigits: 2 })} → {currency}{" "}
                {Number(sampleTo).toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
            ) : (
              <span className="block text-xs">Add the exchange rate in Settings first.</span>
            )}
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="fq-convert" className="mt-1" checked={!canConvert || !s.convertPrices} onChange={() => set("convertPrices", false)} />
          <span>
            Keep the numbers
            <span className="block text-xs text-text-2">They were typed in {currency} already; only the currency was wrong.</span>
          </span>
        </label>
        {st.errors?.convertPrices && <span className="text-xs text-bad">{st.errors.convertPrices[0]}</span>}
      </fieldset>
    );

  return (
      <ActionForm action={action} onDone={onDone} className={PANEL_FORM} keepFields showSuccess={false}>
        {(st) => (
          <>
            <input type="hidden" name="payload" value={JSON.stringify(payload(s, canConvert))} />
            {filled && s.factory && (
              <p role="status" className="rounded-xl border border-info/25 bg-info-soft px-3 py-2.5 text-sm">
                Filled from {s.factory.name}’s last offer:{" "}
                <strong>
                  {filled.last.inquiryRef} · {date(filled.last.receivedOn)}
                </strong>
                .{" "}
                <button type="button" onClick={startEmpty} className="font-semibold text-info underline underline-offset-2 hover:no-underline">
                  Start empty
                </button>
              </p>
            )}
            <PanelSection title="Who" first className="md:grid-cols-3">
              <Field label="Factory" htmlFor="factory" required error={st.errors?.factoryId ?? st.errors?.newFactoryName} className="md:col-span-2">
                <FactoryPicker value={s.factory} search={searchFactories} error={st.errors?.factoryId} onChange={(f) => void pickFactory(f)} />
              </Field>
              <Field label="Their reference" htmlFor="reference" optional error={st.errors?.reference}>
                <Input id="reference" value={s.reference} onChange={(e) => set("reference", e.target.value)} maxLength={80} placeholder="Their quote no." />
              </Field>
              <Field label="Received on" htmlFor="receivedOn" required error={st.errors?.receivedOn}>
                <Input id="receivedOn" type="date" value={s.receivedOn} max={today} onChange={(e) => set("receivedOn", e.target.value)} />
              </Field>
              <Field label="Valid until" htmlFor="validUntil" optional error={st.errors?.validUntil}>
                <Input id="validUntil" type="date" value={s.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
              </Field>
            </PanelSection>
            <PanelSection title="Price" className="md:grid-cols-3">
              <Field
                label="Currency"
                htmlFor="currency"
                error={st.errors?.currency}
                hint={hintOf("currency", rate === null ? `No exchange rate for ${currency} in Settings` : (rateSentence(fx, mainCurrency, currency) ?? undefined))}
              >
                <CurrencySelect id="currency" value={s.currency} onChange={(e) => set("currency", e.target.value)} />
              </Field>
              <Field
                label="Price basis"
                htmlFor="basis"
                error={st.errors?.basis}
                hint={hintOf("basis", s.basis ? BASIS_HINT[s.basis] : "What their prices already pay for: needed to work out freight and the like")}
              >
                <Select id="basis" value={s.basis} onChange={(e) => set("basis", e.target.value as Incoterm | "")}>
                  <option value="">Not said</option>
                  {INCOTERMS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                      {BASIS_WORDS[t] ? ` · ${BASIS_WORDS[t]}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={s.basis === "EXW" ? "Town" : "Port"} htmlFor="basisPlace" optional error={st.errors?.basisPlace} hint={hintOf("basisPlace")}>
                <PortPicker id="basisPlace" value={s.basisPlace} onChange={(v) => set("basisPlace", v)} exw={s.basis === "EXW"} />
              </Field>
              {recurrencyBox(st)}
              <TaxBox
                idPrefix="fq"
                className="sm:col-span-2"
                included={s.taxIncluded ?? false}
                rate={s.taxRate}
                onIncluded={(v) => set("taxIncluded", v)}
                onRate={(v) => set("taxRate", v)}
                error={st.errors?.taxRate ?? st.errors?.taxIncluded}
                note={quote ? taxRateNote(quote.lines, quote.taxRate, s.taxRate) : from("taxIncluded", "taxRate") ? `As on their last offer. Applies to every line; a line can still have its own %.` : undefined}
              />
              <Field label="Minimum order (MOQ)" htmlFor="moq" optional error={st.errors?.moq}>
                <Input id="moq" value={s.moq} onChange={(e) => set("moq", e.target.value)} maxLength={60} placeholder="e.g. 1 set" />
              </Field>
            </PanelSection>
            <PanelSection title="Terms" className="md:grid-cols-3">
              <Field label="Lead time" htmlFor="leadTime" optional error={st.errors?.leadTime} hint={hintOf("leadTime")}>
                <Input id="leadTime" value={s.leadTime} onChange={(e) => set("leadTime", e.target.value)} maxLength={120} placeholder="e.g. 25 days after deposit" />
              </Field>
              <Field label="Advance when we order" htmlFor="advancePercent" optional hint={hintOf("advancePercent", "Starts the factory's payment plan; printed on the PO")} error={st.errors?.advancePercent}>
                <div className="flex items-center gap-1.5">
                  <Input
                    id="advancePercent"
                    inputMode="decimal"
                    className="w-24 tabular"
                    value={s.advancePercent}
                    onChange={(e) => set("advancePercent", e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="default"
                  />
                  <span className="text-sm text-text-2">%</span>
                </div>
              </Field>
              <Field label="Warranty" htmlFor="fq-warranty" optional error={st.errors?.warranty} hint={hintOf("warranty")}>
                <Input id="fq-warranty" value={s.warranty} onChange={(e) => set("warranty", e.target.value)} maxLength={300} placeholder="e.g. 12 months from commissioning" />
              </Field>
              <Field label="Payment terms (note)" htmlFor="paymentTerms" optional error={st.errors?.paymentTerms} hint={hintOf("paymentTerms")} className="md:col-span-3">
                <Input id="paymentTerms" value={s.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} maxLength={2000} placeholder="e.g. 30% advance, 70% before shipping, by T/T" />
              </Field>
            </PanelSection>
            <PanelSection title="Notes and their quotation">
              <Field label="Notes" htmlFor="fq-notes" optional error={st.errors?.notes}>
                <Textarea id="fq-notes" rows={4} className="min-h-0" value={s.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Packing, samples, anything to remember about this offer" />
              </Field>
              <div className="min-w-0">{files}</div>
            </PanelSection>
            {note}
            {footer}
          </>
        )}
      </ActionForm>
    );
}
