"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Factory, Loader2, Plus } from "lucide-react";
import { fxRate } from "@kebo/money";
import {
  INCOTERMS,
  leadWords,
  offerPartsFrom,
  parseLead,
  parseWarranty,
  type Incoterm,
  type LeadFrom,
  type WarrantyFrom,
} from "@kebo/shared";
import { Button, Checkbox, cn, controlClass, Field, Input, Select, Textarea } from "@kebo/ui";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { FactoryOption, FactoryQuoteView } from "@/lib/types-deals";
import { convertText, rateOf, rateSentence } from "@/lib/fx";
import { CurrencySelect } from "@/components/common/currency-select";
import { FloatingList } from "@/components/common/floating";
import { PANEL_FORM, PanelSection } from "@/components/common/panel";
import { StepsFrame, type StepInfo } from "@/components/common/steps-frame";
import { money } from "@/lib/format";
import {
  LeadField,
  PartsField,
  partRows,
  partsPayload,
  partsProblem,
  WarrantyFields,
  wholeOrNull,
  type PartRow,
  type PartsPreset,
} from "./terms-fields";

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
          className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded text-muted hover:text-text pointer-coarse:size-10"
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
  // One tick (Fawad, 17 Nov): ticked, their prices already have the tax in them; not ticked, it is added on top.
  return (
    <fieldset className={cn("grid gap-x-3 gap-y-2 sm:grid-cols-2", className)}>
      <legend className="sr-only">Tax</legend>
      <Field label="Tax %" htmlFor={`${idPrefix}-tax-rate`} error={error} hint="0 unless the factory charges tax, e.g. 13% VAT in China">
        <span className="flex items-center gap-2">
          <Input
            id={`${idPrefix}-tax-rate`}
            inputMode="decimal"
            className="w-24 text-right tabular"
            value={rate}
            onChange={(e) => onRate(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="0"
          />
          <span className="text-sm text-muted">%</span>
        </span>
      </Field>
      <label htmlFor={`${idPrefix}-tax-included`} className="flex min-h-11 cursor-pointer items-start gap-2.5 text-sm sm:mt-[26px]">
        <Checkbox id={`${idPrefix}-tax-included`} checked={included} onChange={(e) => onIncluded(e.target.checked)} className="mt-0.5 size-[18px]" />
        <span>
          <span className="block font-medium">Tax included in their prices</span>
          <span className="block text-xs text-text-2">{included ? "The price already has the tax in it" : "Not ticked: the tax is added on top"}</span>
        </span>
      </label>
      <p className="text-xs text-text-2 sm:col-span-2">{note ?? "Applies to every line; a line can still have its own %."}</p>
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
  /** The lead time's words: an older offer's, kept until days are typed (with days they are worked out). */
  leadTime: string;
  /** The lead time as days from a moment. */
  leadDays: string;
  leadFrom: LeadFrom;
  moq: string;
  /** A note on how they are paid (by T/T to their account…). */
  paymentTerms: string;
  /** What they ask, as parts (like their plan on an order); its "when we order" parts are the advance. */
  parts: PartRow[];
  /** The warranty's words: what it covers (an older offer: its whole warranty). */
  warranty: string;
  warrantyMonths: string;
  warrantyFrom: WarrantyFrom;
  notes: string;
  /** Their prices have the tax in them (null: a new offer, the company's default). */
  taxIncluded: boolean | null;
  /** The offer's tax % as typed ("": a new offer, the company's default). */
  taxRate: string;
}

/**
 * How the form opens. An older offer kept its lead time and warranty as words: where they say the days or
 * months plainly the form starts from them (and says so), else the words stay as they are.
 */
function initialState(quote: FactoryQuoteView | null, today: string, usualAdvance: number): QuoteState {
  const lead =
    quote?.leadDays !== null && quote?.leadDays !== undefined
      ? { days: quote.leadDays, from: quote.leadFrom ?? "after_payment" }
      : parseLead(quote?.leadTime);
  const warranty =
    quote?.warrantyMonths !== null && quote?.warrantyMonths !== undefined
      ? { months: quote.warrantyMonths, from: quote.warrantyFrom ?? "shipment", rest: quote.warranty }
      : parseWarranty(quote?.warranty);
  return {
    factory: quote ? { id: quote.factory.id, name: quote.factory.name } : null,
    reference: quote?.reference ?? "",
    currency: quote?.currency ?? "CNY",
    convertPrices: true,
    receivedOn: quote?.receivedOn ?? today,
    validUntil: quote?.validUntil ?? "",
    basis: quote?.basis ?? "",
    basisPlace: quote?.basisPlace ?? "",
    leadTime: lead ? "" : (quote?.leadTime ?? ""),
    leadDays: lead ? String(lead.days) : "",
    leadFrom: lead?.from ?? "after_payment",
    moq: quote?.moq ?? "",
    paymentTerms: quote?.paymentTerms ?? "",
    parts: partRows(quote ? quote.paymentParts : offerPartsFrom(usualAdvance)),
    warranty: warranty ? (warranty.rest ?? "") : (quote?.warranty ?? ""),
    warrantyMonths: warranty ? String(warranty.months) : "",
    warrantyFrom: warranty?.from ?? "shipment",
    notes: quote?.notes ?? "",
    taxIncluded: quote ? quote.taxIncluded : null,
    taxRate: quote ? String(quote.taxRate) : "",
  };
}

/** The offer's details; its lines are added and changed in the line table, one at a time. */
function payload(s: QuoteState, convertible?: boolean) {
  const days = wholeOrNull(s.leadDays);
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
    // With days the words are worked out from them; without, an older offer's words are kept.
    leadDays: days,
    leadFrom: s.leadFrom,
    leadTime: days === null ? s.leadTime : null,
    moq: s.moq,
    paymentTerms: s.paymentTerms,
    paymentParts: partsPayload(s.parts, "factory"),
    warranty: s.warranty,
    warrantyMonths: wholeOrNull(s.warrantyMonths),
    warrantyFrom: s.warrantyFrom,
    notes: s.notes,
    // Not set (a new offer): the company's default.
    ...(s.taxIncluded === null ? {} : { taxIncluded: s.taxIncluded }),
    ...(s.taxRate.trim() === "" ? {} : { taxRate: s.taxRate.trim() }),
  };
}

/** The usual payments to start from (the same as a supplier's plan on an order). */
const OFFER_PRESETS: PartsPreset[] = [
  {
    label: "30% when we order · 70% when ready",
    parts: [
      { name: "Advance", share: 30, rule: "on_order" },
      { name: "Balance", share: 70, rule: "on_ready" },
    ],
  },
  {
    label: "50 / 50",
    parts: [
      { name: "Advance", share: 50, rule: "on_order" },
      { name: "Balance", share: 50, rule: "on_ready" },
    ],
  },
  { label: "All when ready", parts: [{ name: "Payment", share: 100, rule: "on_ready" }] },
  { label: "All after shipping", parts: [{ name: "Payment after shipping", share: 100, rule: "after_shipping", days: 30 }] },
];

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
 * The offer's window, the same for "Enter factory offer" and "Edit the offer", in the groups every offer,
 * quotation, order and purchase order uses (design "terms that travel"): Who and when · Price · Delivery ·
 * Payment · Warranty · Conditions and their quotation. The price basis is under Delivery (where they hand the
 * goods over); the lead time is days from a moment; the payment is parts, like their plan on an order. Its
 * lines are not here: they have their own editor. `files` sits in the last section; `footer` is the window's
 * buttons (inside the form).
 */
export function OfferHeaderForm({
  action,
  quote,
  today,
  mainCurrency,
  rates,
  searchFactories,
  onDone,
  defaults,
  files,
  note,
  footer,
  footerStart,
  startStep = "lines",
  step: stepAsked,
  onStep,
  lines,
  linesSummary,
  extra,
}: {
  /** Where the window opens (design 17 Nov: the offer in steps). */
  startStep?: OfferStep;
  /** The step, when the window keeps it (it opens the Lines step after a refused save of the lines). */
  step?: OfferStep;
  onStep?: (step: OfferStep) => void;
  /** The Lines step's sheet, under the offer's own fields; it is told the currency and tax being typed. */
  lines?: (h: { currency: string; taxRate: number; taxIncluded: boolean; errors: string[] }) => ReactNode;
  /** More of the saved body (a new offer's lines go in the same save). */
  extra?: Record<string, unknown>;
  /** "7 lines", for the rail. */
  linesSummary?: string;
  /** Left of the buttons on the first step (Remove this offer). */
  footerStart?: ReactNode;
  action: Action;
  quote: FactoryQuoteView | null;
  today: string;
  mainCurrency: string;
  rates: Record<string, number>;
  searchFactories: (q: string) => Promise<FactoryOption[]>;
  onDone: (state: ActionState) => void;
  /** A new offer's tax and advance: the company's defaults (Settings). */
  defaults?: { taxIncluded: boolean; taxRate: number; advancePercent?: number };
  /** The factory's own quotation files: the ones it has, and the place to add more. */
  files: ReactNode;
  /** Said above the buttons (a new offer: its lines come next). */
  note?: ReactNode;
  /** Cancel and the save buttons; `last`: the last step, where saving is the main button. */
  footer: (last: boolean) => ReactNode;
}) {
  // How the window opens: a fresh start, with the company's usual tax and advance (Settings).
  const [start] = useState<QuoteState>(() => ({
    ...initialState(quote, today, defaults?.advancePercent ?? 30),
    ...(!quote && defaults ? { taxIncluded: defaults.taxIncluded, taxRate: String(defaults.taxRate) } : {}),
  }));
  const [s, setS] = useState<QuoteState>(start);
  const set = <K extends keyof QuoteState>(k: K, v: QuoteState[K]) => setS((st) => ({ ...st, [k]: v }));
  const [stepOwn, setStepOwn] = useState<OfferStep>(startStep);
  const step = stepAsked ?? stepOwn;
  const setStep = onStep ?? setStepOwn;
  const at = OFFER_STEPS.findIndex((x) => x.key === step);
  // Every new offer starts fresh (nothing is filled from the factory's last offer: decided 16 Nov 2026).
  const pickFactory = (f: QuoteState["factory"]) => set("factory", f);
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
          Its {priced.length} price{priced.length === 1 ? " is" : "s are"} in {quote!.currency}. What should happen to{" "}
          {priced.length === 1 ? "it" : "them"}?
        </p>
        <label className={cn("flex items-start gap-2 text-sm", !canConvert && "text-muted")}>
          <input
            type="radio"
            name="fq-convert"
            className="mt-1"
            checked={canConvert && s.convertPrices}
            disabled={!canConvert}
            onChange={() => set("convertPrices", true)}
          />
          <span>
            Convert them to {currency}
            {canConvert ? (
              <span className="block text-xs text-text-2">
                At {rateSentence(fx, quote!.currency, currency)}: {sample!.description.split("\n")[0]} {quote!.currency}{" "}
                {Number(sample!.unitPrice).toLocaleString("en-US", { minimumFractionDigits: 2 })} → {currency}{" "}
                {Number(sampleTo).toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
            ) : (
              <span className="block text-xs">Add the exchange rate in Settings first.</span>
            )}
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="fq-convert"
            className="mt-1"
            checked={!canConvert || !s.convertPrices}
            onChange={() => set("convertPrices", false)}
          />
          <span>
            Keep the numbers
            <span className="block text-xs text-text-2">They were typed in {currency} already; only the currency was wrong.</span>
          </span>
        </label>
        {st.errors?.convertPrices && <span className="text-xs text-bad">{st.errors.convertPrices[0]}</span>}
      </fieldset>
    );

  // The payment's parts: what 100% is when the offer has lines, and what stops a save.
  const total = quote && Number(quote.factoryTotal) > 0 ? money(quote.factoryTotal, quote.currency) : null;
  const [partsTried, setPartsTried] = useState(false);
  const partsBad = partsProblem(s.parts);
  const daysTyped = s.leadDays.trim() !== "";
  // An older offer's words the form read its days or months from, said under the field.
  const leadWordsWere = quote && quote.leadDays === null && quote.leadTime && !s.leadTime ? quote.leadTime : null;
  const warrantyWordsWere =
    quote && quote.warrantyMonths === null && quote.warranty && parseWarranty(quote.warranty) ? quote.warranty : null;

  return (
    <ActionForm
      action={action}
      onDone={onDone}
      className={cn(PANEL_FORM, "min-h-0 gap-0")}
      keepFields
      showSuccess={false}
      beforeSend={() => {
        if (!partsBad) return true;
        setPartsTried(true);
        setStep("payment");
        document.getElementById("fq-parts")?.scrollIntoView?.({ block: "center" });
        return false;
      }}
    >
      {(st) => (
        <>
          <input type="hidden" name="payload" value={JSON.stringify({ ...payload(s, canConvert), ...extra })} />
          {/* The factory's name, for the note after saving ("Offer from Jinan Pharma Machinery added"). */}
          <input type="hidden" name="factoryLabel" value={s.factory?.name ?? ""} />
          <StepsFrame
            steps={offerStepsInfo(s, at, !!quote, linesSummary)}
            at={step}
            onGo={setStep}
            footer={
              <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-line bg-surface px-6 py-3 max-md:px-4">
                {at > 0 ? (
                  <Button type="button" variant="secondary" onClick={() => setStep(OFFER_STEPS[at - 1]!.key)}>
                    <ChevronLeft aria-hidden /> Back
                  </Button>
                ) : (
                  footerStart
                )}
                <span className="flex-1" />
                {footer(at === OFFER_STEPS.length - 1)}
                {at < OFFER_STEPS.length - 1 && (
                  <Button type="button" variant="primary" onClick={() => setStep(OFFER_STEPS[at + 1]!.key)}>
                    Next <ChevronRight aria-hidden />
                  </Button>
                )}
              </div>
            }
          >
          <JumpToError st={st} onJump={setStep} />
          {step === "lines" && (
          <>
          <PanelSection title="Who and when" first className="md:grid-cols-3">
            <Field
              label="Factory"
              htmlFor="factory"
              required
              error={st.errors?.factoryId ?? st.errors?.newFactoryName}
              className="md:col-span-2"
            >
              <FactoryPicker
                value={s.factory}
                search={searchFactories}
                error={st.errors?.factoryId}
                onChange={(f) => void pickFactory(f)}
              />
            </Field>
            <Field label="Their reference" htmlFor="reference" optional error={st.errors?.reference}>
              <Input
                id="reference"
                value={s.reference}
                onChange={(e) => set("reference", e.target.value)}
                maxLength={80}
                placeholder="Their quote no."
              />
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
              hint={rate === null ? `No exchange rate for ${currency} in Settings` : (rateSentence(fx, mainCurrency, currency) ?? undefined)}
            >
              <CurrencySelect id="currency" value={s.currency} onChange={(e) => set("currency", e.target.value)} />
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
              note={quote ? taxRateNote(quote.lines, quote.taxRate, s.taxRate) : undefined}
            />
          </PanelSection>
          {lines && (
            <PanelSection title="Lines" className="sm:grid-cols-1">
              {lines({ currency, taxRate: Number(s.taxRate || 0), taxIncluded: s.taxIncluded ?? false, errors: lineErrors(st.errors) })}
            </PanelSection>
          )}
          </>
          )}
          {step === "delivery" && (
          <PanelSection quiet first title="Delivery" className="md:grid-cols-4">
            <Field
              label="Delivery basis (Incoterm)"
              htmlFor="basis"
              error={st.errors?.basis}
              hint={s.basis ? BASIS_HINT[s.basis] : "What their prices already pay for: needed to work out freight and the like"}
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
            <Field
              label={s.basis === "EXW" ? "Town" : "Port"}
              htmlFor="basisPlace"
              optional
              error={st.errors?.basisPlace}
            >
              <PortPicker id="basisPlace" value={s.basisPlace} onChange={(v) => set("basisPlace", v)} exw={s.basis === "EXW"} />
            </Field>
            <LeadField
              id="leadDays"
              className="sm:col-span-2"
              side="factory"
              days={s.leadDays}
              from={s.leadFrom}
              onDays={(v) => set("leadDays", v)}
              onFrom={(v) => set("leadFrom", v)}
              error={st.errors?.leadDays ?? st.errors?.leadFrom ?? st.errors?.leadTime}
              hint={
                daysTyped ? (
                  <>
                    Printed as “{leadWords(Number(s.leadDays) || 0, s.leadFrom, "factory")}”
                    {leadWordsWere ? `, worked out from their words “${leadWordsWere}”` : ""}
                  </>
                ) : s.leadTime ? (
                  <>
                    Their words: “{s.leadTime}”, kept until you type the days.{" "}
                    <button type="button" className="font-medium text-primary hover:underline" onClick={() => set("leadTime", "")}>
                      Clear
                    </button>
                  </>
                ) : (
                  "So a ready date can be worked out"
                )
              }
            />
          </PanelSection>
          )}
          {step === "payment" && (
          <PanelSection quiet first title="Payment" className="md:grid-cols-3">
            <PartsField
              id="fq-parts"
              idPrefix="fq-part"
              side="factory"
              rows={s.parts}
              onChange={(rows) => set("parts", rows)}
              presets={OFFER_PRESETS}
              amounts={total}
              error={(partsTried ? partsBad : null) ?? st.errors?.paymentParts}
            />
            <Field
              label="Payment note"
              htmlFor="paymentTerms"
              optional
              error={st.errors?.paymentTerms}
              className="sm:col-span-2 md:col-span-3"
            >
              <Input
                id="paymentTerms"
                value={s.paymentTerms}
                onChange={(e) => set("paymentTerms", e.target.value)}
                maxLength={2000}
                placeholder="e.g. By T/T, bank charges outside China for us"
              />
            </Field>
          </PanelSection>
          )}
          {step === "warranty" && (
          <>
          <PanelSection quiet first title="Warranty" className="md:grid-cols-3">
            <WarrantyFields
              idPrefix="fq"
              months={s.warrantyMonths}
              from={s.warrantyFrom}
              covers={s.warranty}
              onMonths={(v) => set("warrantyMonths", v)}
              onFrom={(v) => set("warrantyFrom", v)}
              onCovers={(v) => set("warranty", v)}
              errors={{ months: st.errors?.warrantyMonths, from: st.errors?.warrantyFrom, covers: st.errors?.warranty }}
              coversHint={warrantyWordsWere ? `Worked out from their words “${warrantyWordsWere}”` : undefined}
            />
          </PanelSection>
          <PanelSection title="Conditions and their quotation">
            <div className="flex flex-col gap-3.5">
              <Field label="Minimum order (MOQ)" htmlFor="moq" optional error={st.errors?.moq}>
                <Input id="moq" value={s.moq} onChange={(e) => set("moq", e.target.value)} maxLength={60} placeholder="e.g. 1 set" />
              </Field>
              <Field label="Notes" htmlFor="fq-notes" optional error={st.errors?.notes}>
                <Textarea
                  id="fq-notes"
                  rows={3}
                  className="min-h-0"
                  value={s.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder="Packing, samples, anything to remember about this offer"
                />
              </Field>
            </div>
            <div className="min-w-0">{files}</div>
          </PanelSection>
          </>
          )}
          {note}
          </StepsFrame>
        </>
      )}
    </ActionForm>
  );
}

/** The offer's steps (design 17 Nov): its lines (with who, when, the currency and the tax above them), then its terms. */
export type OfferStep = "lines" | "delivery" | "payment" | "warranty";
const OFFER_STEPS: { key: OfferStep; label: string }[] = [
  { key: "lines", label: "Lines" },
  { key: "delivery", label: "Delivery" },
  { key: "payment", label: "Payment" },
  { key: "warranty", label: "Warranty & conditions" },
];

/** Each step with what it holds now ("Shenjing · CNY · tax 13% incl."). */
function offerStepsInfo(s: QuoteState, at: number, saved: boolean, lines?: string): StepInfo<OfferStep>[] {
  const rate = Number(s.taxRate || 0);
  const summary: Record<OfferStep, string> = {
    lines: [s.factory?.name, lines, s.currency.trim().toUpperCase(), rate > 0 ? `tax ${rate}%${s.taxIncluded ? " incl." : ""}` : "no tax"].filter(Boolean).join(" · "),
    delivery: [s.basis ? `${s.basis}${s.basisPlace ? ` ${s.basisPlace}` : ""}` : null, s.leadDays.trim() ? `${s.leadDays.trim()} days` : s.leadTime || null].filter(Boolean).join(" · "),
    payment: s.parts.map((p) => `${p.share}%`).join(" · "),
    warranty: [s.warrantyMonths.trim() ? `${s.warrantyMonths.trim()} months` : null, s.moq.trim() ? `MOQ ${s.moq.trim()}` : null].filter(Boolean).join(" · "),
  };
  return OFFER_STEPS.map((x, k) => ({ key: x.key, label: x.label, summary: summary[x.key] || undefined, done: saved || k < at }));
}

/** Where each field the API can refuse is typed. */
const FIELD_STEP: Record<string, OfferStep> = {
  basis: "delivery",
  basisPlace: "delivery",
  leadDays: "delivery",
  leadFrom: "delivery",
  leadTime: "delivery",
  paymentParts: "payment",
  paymentTerms: "payment",
  advancePercent: "payment",
  warranty: "warranty",
  warrantyMonths: "warranty",
  warrantyFrom: "warranty",
  moq: "warranty",
  notes: "warranty",
};

/** A save refused for a field on another step opens that step, so the field and its message are in view. */
/** What the API said about the lines of a new offer ("lines.2.unitPrice") as "Line 3: Enter the factory's price". */
function lineErrors(errors: ActionState["errors"]): string[] {
  const out: string[] = [];
  for (const [key, list] of Object.entries(errors ?? {})) {
    if (!list?.length || (key !== "lines" && !key.startsWith("lines."))) continue;
    const n = Number(key.split(".")[1]);
    const say = Number.isInteger(n) ? `Line ${n + 1}: ${list[0]}` : list[0]!;
    if (!out.includes(say)) out.push(say);
  }
  return out;
}

function JumpToError({ st, onJump }: { st: ActionState; onJump: (step: OfferStep) => void }) {
  useEffect(() => {
    const first = Object.keys(st.errors ?? {}).find((k) => st.errors?.[k]?.length);
    if (first) onJump(FIELD_STEP[first] ?? "lines");
  }, [st, onJump]);
  return null;
}
