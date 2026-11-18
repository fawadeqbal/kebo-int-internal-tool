"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, Factory, History, Loader2, Plus, Search, ShieldCheck, Tag, Truck } from "lucide-react";
import { fxRate } from "@kebo/money";
import {
  basisText,
  INCOTERMS,
  leadWords,
  offerPartsFrom,
  parseLead,
  parseWarranty,
  REASON_CHOICES,
  WARRANTY_FROM_LABEL,
  type Incoterm,
  type LeadFrom,
  type WarrantyFrom,
} from "@kebo/shared";
import { Button, Checkbox, cn, controlClass, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { FactoryOption, FactoryQuoteView } from "@/lib/types-deals";
import { convertText, rateOf, rateSentence } from "@/lib/fx";
import { CurrencySelect } from "@/components/common/currency-select";
import { FloatingList } from "@/components/common/floating";
import { PANEL_FORM, PanelSection, useReportDirty, useReportLost } from "@/components/common/panel";
import { StepsFrame } from "@/components/common/steps-frame";
import { ChoiceChips } from "@/components/common/choice-chips";
import { ReasonChips } from "@/components/edits/reason-chips";
import { date, money } from "@/lib/format";
import { Facts, ReviewBox } from "./deal-form";
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
      <Field label="Tax %" htmlFor={`${idPrefix}-tax-rate`} error={error}>
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
        <span className="font-medium">Tax included in their prices</span>
      </label>
      {note && <p className="text-xs text-text-2 sm:col-span-2">{note}</p>}
    </fieldset>
  );
}

/** What changing the offer's % does to its lines: those at the old % follow, the others keep theirs. */
export function taxRateNote(lines: { taxRate: number }[], oldRate: number, newRate: string): ReactNode {
  const next = Number(newRate || 0);
  if (!lines.length || !Number.isFinite(next) || next === oldRate) return null;
  const follow = lines.filter((l) => Number(l.taxRate) === oldRate).length;
  const own = lines.length - follow;
  if (!follow) return `No item is at ${oldRate}%, so no item changes: each keeps its own %.`;
  return `${follow === lines.length ? `All ${follow}` : follow} item${follow === 1 ? "" : "s"} at ${oldRate}% change to ${next}%${own ? `; ${own} with ${own === 1 ? "its" : "their"} own % stay${own === 1 ? "s" : ""} as ${own === 1 ? "it is" : "they are"}` : ""}.`;
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
      { name: "Deposit", share: 30, rule: "on_order" },
      { name: "Balance", share: 70, rule: "on_ready" },
    ],
  },
  {
    label: "50 / 50",
    parts: [
      { name: "Deposit", share: 50, rule: "on_order" },
      { name: "Balance", share: 50, rule: "on_ready" },
    ],
  },
  { label: "All when ready", parts: [{ name: "Payment", share: 100, rule: "on_ready" }] },
  { label: "All after shipping", parts: [{ name: "Payment after shipping", share: 100, rule: "after_shipping", days: 30 }] },
];

/** A factory asked for this inquiry (offered first in the picker): how it stands ("asked 15 Nov · no offer yet"). */
export type AskedFactory = FactoryOption & { note?: string };

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/**
 * Choose a known factory, or type a new one's name (it is added to the factory list on save). The factories asked
 * for this inquiry come first (design 18 Nov); typing searches them all.
 */
export function FactoryPicker({
  value,
  onChange,
  search,
  asked = [],
  error,
}: {
  value: QuoteState["factory"];
  onChange: (f: QuoteState["factory"], known?: FactoryOption) => void;
  search: (q: string) => Promise<FactoryOption[]>;
  asked?: AskedFactory[];
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

  if (value) {
    const known = asked.find((a) => a.id === value.id);
    return (
      <div className={cn("flex min-h-12 items-center gap-3 rounded-[10px] border border-line bg-surface-2/60 px-3 py-2", error && "border-bad")}>
        <Factory className="size-4 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{value.name}</p>
          <p className="truncate text-xs text-text-2">{!value.id ? "New supplier — added when you save" : (known?.note ?? known?.contactPerson ?? "")}</p>
        </div>
        <Button size="xs" variant="ghost" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    );
  }

  const typed = q.trim();
  const low = typed.toLowerCase();
  const askedShown = asked.filter((a) => !low || a.name.toLowerCase().includes(low));
  const others = rows.filter((r) => !asked.some((a) => a.id === r.id));
  const exact = [...asked, ...rows].some((r) => r.name.toLowerCase() === low);
  const pick = (f: FactoryOption) => onChange({ id: f.id, name: f.name }, f);
  const option = (f: AskedFactory, note?: string) => (
    <li
      key={f.id}
      role="option"
      aria-selected={false}
      onMouseDown={(e) => {
        e.preventDefault();
        pick(f);
      }}
      className="grid cursor-pointer grid-cols-[2rem_minmax(0,1fr)] items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-surface-2"
    >
      <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-surface-3 text-xs font-bold text-text-2">
        {initialsOf(f.name)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{f.name}</span>
        {(note ?? f.contactPerson) && <span className="block truncate text-xs text-text-2">{note ?? f.contactPerson}</span>}
      </span>
    </li>
  );
  const group = (title: string) => (
    <li role="presentation" className="px-2.5 pt-1.5 pb-1 text-[11.5px] font-semibold tracking-wide text-text-2 uppercase">
      {title}
    </li>
  );
  return (
    <div ref={box} className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        id="factory"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-invalid={!!error || undefined}
        autoComplete="off"
        value={q}
        placeholder="Search suppliers"
        className={cn(controlClass, "h-10 pr-9 pl-9 max-sm:h-11 max-sm:text-base")}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const hit = [...askedShown, ...others].find((r) => r.name.toLowerCase() === low);
            if (hit) pick(hit);
            else if (typed) onChange({ id: null, name: typed });
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {loading && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted" aria-hidden />}
      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label="Suppliers"
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-80 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-pop"
        >
          {askedShown.length > 0 && group("Asked for this inquiry")}
          {askedShown.map((f) => option(f, f.note))}
          {others.length > 0 && group(typed ? `Results for “${typed}”` : "Other suppliers")}
          {others.map((f) => option(f))}
          {typed && !exact && (
            <li
              role="option"
              aria-selected={false}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange({ id: null, name: typed });
              }}
              className="mt-1 grid cursor-pointer grid-cols-[2rem_minmax(0,1fr)] items-center gap-2.5 rounded-lg border-t border-line px-2.5 py-2 font-semibold text-primary hover:bg-surface-2"
            >
              <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-primary-soft">
                <Plus className="size-4" />
              </span>
              <span className="truncate text-sm">New supplier “{typed}”</span>
            </li>
          )}
          {!loading && !askedShown.length && !others.length && !typed && <li className="px-2.5 py-3 text-sm text-muted">No suppliers yet: type the name of the first one.</li>}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- the offer's window, in steps (design 18 Nov) */

/**
 * The offer's steps (design 18 Nov, the inquiry's rules): Factory (who sent it, when, and their paper) · Prices (the
 * currency and tax above the lines) · Delivery & payment · Warranty & conditions, then Review (a new offer) or Changes (an edit).
 */
export type OfferStep = "factory" | "prices" | "terms" | "conditions" | "review" | "changes";
/** The offer's parts: the steps that hold its fields, and its page's boxes. */
export type OfferPart = Exclude<OfferStep, "review" | "changes">;
export const OFFER_PART_LABEL: Record<OfferPart, string> = { factory: "Supplier", prices: "Prices", terms: "Delivery & payment", conditions: "Warranty & conditions" };
const STEP_ICON: Record<OfferStep, typeof Factory> = {
  factory: Factory,
  prices: Tag,
  terms: Truck,
  conditions: ShieldCheck,
  review: CircleCheck,
  changes: History,
};

/** One change in an edit: which field, its words, old → new, and the part it is in. */
export type OfferChange = { key: string; label: string; from: string; to: string; part: OfferPart };

/** What changed between how the window opened and now, in words, part by part. */
export function offerChanges(a: QuoteState, b: QuoteState): OfferChange[] {
  const short = (t: string) => (t.trim() ? (t.trim().length > 40 ? `${t.trim().slice(0, 40)}…` : t.trim()) : "none");
  const day = (d: string) => (d ? date(d) : "none");
  const tax = (x: QuoteState) => {
    const r = Number(x.taxRate || 0);
    return r > 0 ? `${r}% ${x.taxIncluded ? "included" : "added"}` : "no tax";
  };
  const lead = (x: QuoteState) => (x.leadDays.trim() ? leadWords(Number(x.leadDays) || 0, x.leadFrom, "factory") : x.leadTime.trim() || "none");
  const plan = (x: QuoteState) => (x.parts.length ? x.parts.map((p) => `${p.share}%`).join(" / ") : "none");
  const warranty = (x: QuoteState) => (x.warrantyMonths.trim() ? `${x.warrantyMonths.trim()} months from ${WARRANTY_FROM_LABEL[x.warrantyFrom]}` : "none");
  const all: (OfferChange & { same: boolean })[] = [
    { key: "factory", label: "Supplier", from: a.factory?.name ?? "none", to: b.factory?.name ?? "none", part: "factory", same: (a.factory?.id ?? a.factory?.name) === (b.factory?.id ?? b.factory?.name) },
    { key: "receivedOn", label: "Received on", from: day(a.receivedOn), to: day(b.receivedOn), part: "factory", same: a.receivedOn === b.receivedOn },
    { key: "validUntil", label: "Valid until", from: day(a.validUntil), to: day(b.validUntil), part: "factory", same: a.validUntil === b.validUntil },
    { key: "reference", label: "Their reference", from: short(a.reference), to: short(b.reference), part: "factory", same: a.reference.trim() === b.reference.trim() },
    { key: "currency", label: "Currency", from: a.currency.toUpperCase(), to: b.currency.toUpperCase(), part: "prices", same: a.currency.trim().toUpperCase() === b.currency.trim().toUpperCase() },
    { key: "tax", label: "Tax", from: tax(a), to: tax(b), part: "prices", same: tax(a) === tax(b) },
    { key: "basis", label: "Incoterm", from: a.basis || "none", to: b.basis || "none", part: "terms", same: a.basis === b.basis },
    { key: "basisPlace", label: b.basis === "EXW" ? "Town" : "Port", from: short(a.basisPlace), to: short(b.basisPlace), part: "terms", same: a.basisPlace.trim() === b.basisPlace.trim() },
    { key: "lead", label: "Lead time", from: lead(a), to: lead(b), part: "terms", same: lead(a) === lead(b) },
    { key: "parts", label: "Payment", from: plan(a), to: plan(b), part: "terms", same: JSON.stringify(partsPayload(a.parts, "factory")) === JSON.stringify(partsPayload(b.parts, "factory")) },
    { key: "paymentTerms", label: "Payment note", from: short(a.paymentTerms), to: short(b.paymentTerms), part: "terms", same: a.paymentTerms.trim() === b.paymentTerms.trim() },
    { key: "warrantyMonths", label: "Warranty", from: warranty(a), to: warranty(b), part: "conditions", same: warranty(a) === warranty(b) },
    { key: "warranty", label: "What it covers", from: short(a.warranty), to: short(b.warranty), part: "conditions", same: a.warranty.trim() === b.warranty.trim() },
    { key: "moq", label: "Minimum order", from: short(a.moq), to: short(b.moq), part: "conditions", same: a.moq.trim() === b.moq.trim() },
    { key: "notes", label: "Notes", from: short(a.notes), to: short(b.notes), part: "conditions", same: a.notes.trim() === b.notes.trim() },
  ];
  return all.filter((c) => !c.same).map(({ same: _, ...c }) => c);
}

/** The quick reasons for changing an offer (design rules 18 Nov: Why? is asked only when something changed). */
const OFFER_REASONS = [...REASON_CHOICES.factoryPrice.slice(0, 2), "Typed wrong", "Mistake fixed"];

/** A row of the Changes table: Part · What · Was · Now · Undo on fixed columns; on a phone, What and Undo. */
const CHANGE_ROW =
  "grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-t border-line px-4 py-2 sm:grid-cols-[8.5rem_minmax(0,1fr)_minmax(0,9rem)_minmax(0,9rem)_4rem]";

/** What the window saved, for its owner: the reason given and what changed (each box keeps its own history). */
export type OfferSaved = { reason?: string; changes: OfferChange[] };

/**
 * The offer's window, the same for a new offer and an edit (design 18 Nov, the inquiry's rules): the steps on the
 * left, two even columns of fields, one strong button. A new offer ends with Review and Confirm and save; an edit
 * marks each change, counts them on its parts and its Save, ends with Changes, and asks why once. `only`: one part
 * in a smaller window. The lines (`lines`) and the factory's files (`files`) are the owner's; their changes are
 * counted here (`linesChanges`, `filesAdded`) so the counts, Undo and the leave guard cover them too.
 */
export function OfferHeaderForm({
  action,
  quote,
  today,
  defaults,
  searchFactories,
  asked,
  onDone,
  files,
  filesAdded = [],
  onUndoFiles,
  lines,
  linesReview,
  linesCount,
  linesChanges = [],
  onUndoLines,
  extra,
  note,
  footerStart,
  onAnother,
  startStep,
  step: stepAsked,
  onStep,
  only = false,
  mainCurrency,
  rates,
}: {
  action: Action;
  /** The offer being edited; null: a new one. */
  quote: FactoryQuoteView | null;
  today: string;
  mainCurrency: string;
  rates: Record<string, number>;
  /** A new offer's tax and advance: the company's defaults (Settings). */
  defaults?: { taxIncluded: boolean; taxRate: number; advancePercent?: number };
  searchFactories: (q: string) => Promise<FactoryOption[]>;
  /** The factories asked for this inquiry, offered first (design 18 Nov). */
  asked?: AskedFactory[];
  /** Saved: the answer, the reason given and what changed. */
  onDone: (state: ActionState, saved: OfferSaved) => void;
  /** Their quotation: the files it has, and the place to add more (in the Factory step). */
  files: ReactNode;
  /** Files added but not sent yet (an edit counts them as changes). */
  filesAdded?: string[];
  onUndoFiles?: () => void;
  /** The Prices step's lines, told the currency and tax being typed. */
  lines: (h: { currency: string; taxRate: number; taxIncluded: boolean; errors: string[] }) => ReactNode;
  /** The lines in Review (a new offer). */
  linesReview?: (h: { currency: string; taxRate: number; taxIncluded: boolean }) => ReactNode;
  /** "4 lines, 2 parts". */
  linesCount?: string;
  /** What changed in the lines (an edit), and Undo for them. */
  linesChanges?: string[];
  onUndoLines?: () => void;
  /** More of the saved body (a new offer's lines go in the same save). */
  /** More to send with the offer (a new offer's lines); a function gets the currency and tax as they are now. */
  extra?: Record<string, unknown> | ((h: { currency: string; taxRate: number; taxIncluded: boolean }) => Record<string, unknown>);
  /** Said above the buttons (what did not go up). */
  note?: ReactNode;
  /** Left of the buttons on the first step (Remove this offer). */
  footerStart?: ReactNode;
  /** A new offer: "Save and add another" beside Confirm and save. */
  onAnother?: () => void;
  /** Where the window opens. */
  startStep?: OfferStep;
  /** The step, when the window keeps it (it opens Prices after a refused save of the lines). */
  step?: OfferStep;
  onStep?: (step: OfferStep) => void;
  /** One part in a smaller window (Edit on that box). */
  only?: boolean;
}) {
  const create = !quote;
  // How the window opens: a fresh start, with the company's usual tax and advance (Settings).
  const [start] = useState<QuoteState>(() => ({
    ...initialState(quote, today, defaults?.advancePercent ?? 30),
    ...(!quote && defaults ? { taxIncluded: defaults.taxIncluded, taxRate: String(defaults.taxRate) } : {}),
  }));
  const [s, setS] = useState<QuoteState>(start);
  const set = <K extends keyof QuoteState>(k: K, v: QuoteState[K]) => setS((st) => ({ ...st, [k]: v }));
  const STEPS = OFFER_STEPS.filter((x) => x.key !== (create ? "changes" : "review"));
  const [stepOwn, setStepOwn] = useState<OfferStep>(startStep ?? (create ? "factory" : "prices"));
  const step = stepAsked ?? stepOwn;
  const setStep = onStep ?? setStepOwn;
  const at = Math.max(0, STEPS.findIndex((x) => x.key === step));
  const last = at === STEPS.length - 1;
  const go = (k: number) => setStep(STEPS[Math.max(0, Math.min(STEPS.length - 1, k))]!.key);
  const currency = s.currency.trim().toUpperCase();
  const fx = { main: mainCurrency, rates };
  const rate = fxRate(currency, mainCurrency, mainCurrency, rates);
  const taxRate = Number(s.taxRate || 0);
  const taxIncluded = s.taxIncluded ?? false;

  // Changing the currency of an offer that has prices: convert them, or keep the numbers.
  const priced = (quote?.lines ?? []).filter((l) => Number(l.unitPrice) > 0);
  const recurrency = !!quote && currency !== quote.currency && priced.length > 0;
  const canConvert = recurrency && rateOf(fx, quote!.currency, currency) !== null;
  const sample = recurrency ? priced[0]! : null;
  const sampleTo = sample && canConvert ? convertText(String(sample.unitPrice), quote!.currency, currency, fx) : null;

  // An edit (design rules 18 Nov): each change, the save that counts them, and why — asked only when something changed.
  const fieldChanges = useMemo(() => (create ? [] : offerChanges(start, s)), [create, start, s]);
  const changedOf = (k: string) => fieldChanges.find((c) => c.key === k);
  const total = fieldChanges.length + linesChanges.length + filesAdded.length;
  const changesIn = (k: OfferStep) =>
    k === "changes"
      ? total
      : fieldChanges.filter((c) => c.part === k).length + (k === "prices" ? linesChanges.length : 0) + (k === "factory" ? filesAdded.length : 0);
  const [why, setWhy] = useState("");
  const needWhy = !create && total > 0;
  const canSave = create || (total > 0 && !!why.trim());
  const saveLabel = total ? `Save ${total} change${total === 1 ? "" : "s"}` : "No changes";
  const changedNote = (k: string) => {
    const c = changedOf(k);
    return c ? (
      <span className="flex items-center gap-1.5 text-xs font-semibold text-action">
        <span aria-hidden className="size-1.5 rounded-full bg-action-solid" />
        Changed · was {c.from}
      </span>
    ) : null;
  };
  const changedField = (k: string) =>
    changedOf(k) ? "[&_:is(input,select,textarea)]:border-action/70 [&_[aria-checked=true]]:border-action" : undefined;
  const reasonBox = needWhy ? (
    <ReasonChips choices={OFFER_REASONS} value={why} onChange={setWhy} title={total === 1 ? "Why the change?" : "Why these changes?"} />
  ) : null;
  const undo = (k: string) => {
    const back: Partial<QuoteState> =
      k === "tax"
        ? { taxIncluded: start.taxIncluded, taxRate: start.taxRate }
        : k === "lead"
          ? { leadDays: start.leadDays, leadFrom: start.leadFrom, leadTime: start.leadTime }
          : k === "warrantyMonths"
            ? { warrantyMonths: start.warrantyMonths, warrantyFrom: start.warrantyFrom }
            : { [k]: start[k as keyof QuoteState] };
    setS((x) => ({ ...x, ...back }));
  };

  // Leaving without saving (design rules 18 Nov): nothing changed → it just closes; else what would be lost.
  const reportDirty = useReportDirty();
  const reportLost = useReportLost();
  const lost = create
    ? [
        s.factory ? `Supplier: ${s.factory.name}` : null,
        linesCount && linesCount !== "no lines yet" ? `Items: ${linesCount}` : null,
        filesAdded.length ? `Files: ${filesAdded.join(", ")}` : null,
      ].filter((x): x is string => !!x)
    : [...fieldChanges.map((c) => `${c.label}: ${c.from} → ${c.to}`), ...linesChanges.slice(0, 4), ...filesAdded.map((f) => `File to add: ${f}`)];
  const lostKey = lost.join("\n");
  useEffect(() => {
    reportLost(
      lost.length ? (create ? { title: "Close without saving?", text: "This new offer isn’t saved yet. These will be lost:", lines: lost } : { lines: lost.slice(0, 6) }) : null,
    );
    reportDirty(lost.length ? true : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the words, not the list's identity
  }, [lostKey, create, reportLost, reportDirty]);

  // The payment's parts: what 100% is when the offer has lines, and what stops a save.
  const totalText = quote && Number(quote.factoryTotal) > 0 ? money(quote.factoryTotal, quote.currency) : null;
  const [partsTried, setPartsTried] = useState(false);
  const partsBad = partsProblem(s.parts);
  const daysTyped = s.leadDays.trim() !== "";
  // An older offer's words the form read its days or months from, said under the field.
  const leadWordsWere = quote && quote.leadDays === null && quote.leadTime && !s.leadTime ? quote.leadTime : null;
  const warrantyWordsWere = quote && quote.warrantyMonths === null && quote.warranty && parseWarranty(quote.warranty) ? quote.warranty : null;

  const bar = "sticky bottom-0 z-10 flex items-center gap-2 border-t border-line bg-surface px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] max-md:px-4";
  const back =
    !only && at > 0 ? (
      <Button type="button" variant="ghost" onClick={() => go(at - 1)} aria-label="Back" className="max-md:size-11 max-md:px-0">
        <ChevronLeft aria-hidden /> <span className="max-md:hidden">Back</span>
      </Button>
    ) : (
      footerStart
    );
  const footer = create ? (
    // One strong button (design rules 18 Nov): Next is soft, Back and Review are words; ✕ closes, there is no Cancel.
    <div className={bar}>
      {back}
      <span className="flex-1" />
      {step === "review" ? (
        <>
          {onAnother && (
            <SubmitButton variant="ghost" pendingText="Saving…" onClick={() => onAnother()} className="max-md:hidden">
              Save and add another
            </SubmitButton>
          )}
          <SubmitButton variant="strong" size="lg" pendingText="Saving…" className="max-md:flex-1">
            <Check aria-hidden /> Confirm and save
          </SubmitButton>
        </>
      ) : (
        <>
          {at < STEPS.length - 2 && (
            <Button type="button" variant="ghost" onClick={() => setStep("review")}>
              Review
            </Button>
          )}
          <Button type="button" variant="soft" onClick={() => go(at + 1)}>
            Next <ChevronRight aria-hidden />
          </Button>
        </>
      )}
    </div>
  ) : (
    <>
      {/* Under a long list, Why? is a strip right above Save (design 18 Nov). */}
      {only && step === "prices" && needWhy && (
        <ReasonChips strip choices={OFFER_REASONS} value={why} onChange={setWhy} title={total === 1 ? "Why the change?" : "Why these changes?"} />
      )}
      <div className={bar}>
        {back}
        <span className="flex-1" />
        {only || step === "changes" ? (
          <SubmitButton variant="strong" size="lg" disabled={!canSave} pendingText="Saving…" className="max-md:flex-1">
            <Check aria-hidden /> {saveLabel}
          </SubmitButton>
        ) : (
          <>
            {at < STEPS.length - 2 && (
              <Button type="button" variant="ghost" onClick={() => setStep("changes")}>
                Changes{total ? ` · ${total}` : ""}
              </Button>
            )}
            <Button type="button" variant="soft" onClick={() => go(at + 1)}>
              Next <ChevronRight aria-hidden />
            </Button>
          </>
        )}
      </div>
    </>
  );

  const h = { currency: currency || mainCurrency, taxRate, taxIncluded };
  const grid = "md:grid-cols-2 md:gap-x-5 md:gap-y-4";
  const day = (d: string) => (d ? date(d) : "—");

  return (
    <ActionForm
      action={action}
      onDone={(st) => onDone(st, { reason: why.trim() || undefined, changes: fieldChanges })}
      className={cn(PANEL_FORM, "min-h-0 gap-0")}
      keepFields
      showSuccess={false}
      beforeSend={() => {
        // Saved from Review (new) or Changes (all parts) only: Enter on a step goes on to the next one.
        if (!only && !last) {
          go(at + 1);
          return false;
        }
        if (partsBad) {
          setPartsTried(true);
          setStep("terms");
          document.getElementById("fq-parts")?.scrollIntoView?.({ block: "center" });
          return false;
        }
        // Nothing changed: nothing to save; something changed: why, first.
        return canSave;
      }}
    >
      {(st) => (
        <>
          <input type="hidden" name="payload" value={JSON.stringify({ ...payload(s, canConvert), ...(typeof extra === "function" ? extra(h) : extra) })} />
          {needWhy && why.trim() && <input type="hidden" name="reason" value={why.trim()} />}
          {/* The factory's name, for the note after saving ("Offer from Jinan Pharma Machinery added"). */}
          <input type="hidden" name="factoryLabel" value={s.factory?.name ?? ""} />
          <StepsFrame
            steps={STEPS.map((x, k) => ({
              key: x.key,
              label: x.label,
              icon: STEP_ICON[x.key],
              done: create && k < at,
              count: create ? undefined : changesIn(x.key) || undefined,
              apart: x.key === "review" || x.key === "changes",
            }))}
            at={step}
            onGo={setStep}
            single={only}
            fill={step === "prices"}
            footer={footer}
          >
            {/* A refused field on another part: every step, at that one. */}
            <JumpToError st={st} onJump={setStep} />

            {step === "factory" && (
              <PanelSection quiet title="Who sent it, and when" first className={grid}>
                <Field
                  label="Supplier"
                  htmlFor="factory"
                  required
                  error={st.errors?.factoryId ?? st.errors?.newFactoryName}
                  className={cn("md:col-span-2", changedField("factory"))}
                >
                  <FactoryPicker value={s.factory} search={searchFactories} asked={asked} error={st.errors?.factoryId} onChange={(f) => set("factory", f)} />
                  {changedNote("factory")}
                </Field>
                <Field label="Received on" htmlFor="receivedOn" required error={st.errors?.receivedOn} className={changedField("receivedOn")}>
                  <Input id="receivedOn" type="date" value={s.receivedOn} max={today} onChange={(e) => set("receivedOn", e.target.value)} />
                  {changedNote("receivedOn")}
                </Field>
                <Field label="Valid until" htmlFor="validUntil" optional error={st.errors?.validUntil} className={changedField("validUntil")}>
                  <Input id="validUntil" type="date" value={s.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
                  {changedNote("validUntil")}
                </Field>
                <Field label="Their reference" htmlFor="reference" optional error={st.errors?.reference} className={changedField("reference")}>
                  <Input id="reference" value={s.reference} onChange={(e) => set("reference", e.target.value)} maxLength={80} />
                  {changedNote("reference")}
                </Field>
                <div className="min-w-0 md:col-span-2">{files}</div>
              </PanelSection>
            )}

            {step === "prices" && (
              <>
                <PanelSection quiet title="Currency and tax" first className={grid}>
                  <Field
                    label="Currency"
                    htmlFor="currency"
                    error={st.errors?.currency}
                    hint={rate === null ? `No exchange rate for ${currency} in Settings` : (rateSentence(fx, mainCurrency, currency) ?? undefined)}
                    className={changedField("currency")}
                  >
                    <CurrencySelect id="currency" value={s.currency} onChange={(e) => set("currency", e.target.value)} />
                    {changedNote("currency")}
                  </Field>
                  <Field label="Tax" htmlFor="fq-tax" error={st.errors?.taxRate ?? st.errors?.taxIncluded} className={changedField("tax")}>
                    <TaxChoice
                      id="fq-tax"
                      included={taxIncluded}
                      rate={s.taxRate}
                      onChange={(inc, r) => setS((x) => ({ ...x, taxIncluded: inc, taxRate: r }))}
                    />
                    {quote && taxRateNote(quote.lines, quote.taxRate, s.taxRate) && <span className="text-xs text-text-2">{taxRateNote(quote.lines, quote.taxRate, s.taxRate)}</span>}
                    {changedNote("tax")}
                  </Field>
                  {recurrency && (
                    <fieldset className="flex flex-col gap-2 rounded-lg border border-warn/30 bg-warn-soft/40 p-3 md:col-span-2">
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
                        <input type="radio" name="fq-convert" className="mt-1" checked={!canConvert || !s.convertPrices} onChange={() => set("convertPrices", false)} />
                        <span>
                          Keep the numbers
                          <span className="block text-xs text-text-2">They were typed in {currency} already; only the currency was wrong.</span>
                        </span>
                      </label>
                      {st.errors?.convertPrices && <span className="text-xs text-bad">{st.errors.convertPrices[0]}</span>}
                    </fieldset>
                  )}
                </PanelSection>
                <PanelSection quiet title="Items" fill className="sm:grid-cols-1">
                  {lines({ ...h, errors: lineErrors(st.errors) })}
                </PanelSection>
              </>
            )}

            {step === "terms" && (
              <>
                <PanelSection title="Delivery" first className={grid}>
                  <Field label="Incoterm" htmlFor="basis" error={st.errors?.basis} className={changedField("basis")}>
                    <Select id="basis" value={s.basis} onChange={(e) => set("basis", e.target.value as Incoterm | "")}>
                      <option value="">Not said</option>
                      {INCOTERMS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                          {BASIS_WORDS[t] ? ` · ${BASIS_WORDS[t]}` : ""}
                        </option>
                      ))}
                    </Select>
                    {changedNote("basis")}
                  </Field>
                  <Field label={s.basis === "EXW" ? "Town" : "Port"} htmlFor="basisPlace" optional error={st.errors?.basisPlace} className={changedField("basisPlace")}>
                    <PortPicker id="basisPlace" value={s.basisPlace} onChange={(v) => set("basisPlace", v)} exw={s.basis === "EXW"} />
                    {changedNote("basisPlace")}
                  </Field>
                  <LeadField
                    id="leadDays"
                    label="Lead time"
                    className={cn("md:col-span-2", changedField("lead"))}
                    side="factory"
                    days={s.leadDays}
                    from={s.leadFrom}
                    onDays={(v) => set("leadDays", v)}
                    onFrom={(v) => set("leadFrom", v)}
                    error={st.errors?.leadDays ?? st.errors?.leadFrom ?? st.errors?.leadTime}
                    hint={
                      changedOf("lead") ? (
                        changedNote("lead")
                      ) : !daysTyped && s.leadTime ? (
                        <>
                          Their words: “{s.leadTime}”, kept until you type the days.{" "}
                          <button type="button" className="font-medium text-primary hover:underline" onClick={() => set("leadTime", "")}>
                            Clear
                          </button>
                        </>
                      ) : leadWordsWere && daysTyped ? (
                        `Worked out from their words “${leadWordsWere}”`
                      ) : undefined
                    }
                  />
                </PanelSection>
                <PanelSection title="Payment" className={grid}>
                  <div className={cn("min-w-0 md:col-span-2", changedField("parts"))}>
                    <PartsField
                      id="fq-parts"
                      idPrefix="fq-part"
                      side="factory"
                      rows={s.parts}
                      onChange={(rows) => set("parts", rows)}
                      presets={OFFER_PRESETS}
                      amounts={totalText}
                      error={(partsTried ? partsBad : null) ?? st.errors?.paymentParts}
                    />
                    {changedNote("parts")}
                  </div>
                  <Field label="Payment note" htmlFor="paymentTerms" optional error={st.errors?.paymentTerms} className={cn("md:col-span-2", changedField("paymentTerms"))}>
                    <Input id="paymentTerms" value={s.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} maxLength={2000} />
                    {changedNote("paymentTerms")}
                  </Field>
                </PanelSection>
              </>
            )}

            {step === "conditions" && (
              <PanelSection quiet first title="Warranty & conditions" className={grid}>
                <div className={cn("contents", changedField("warrantyMonths"))}>
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
                </div>
                {(changedOf("warrantyMonths") || changedOf("warranty")) && (
                  <div className="flex flex-col gap-1 md:col-span-2">
                    {changedNote("warrantyMonths")}
                    {changedNote("warranty")}
                  </div>
                )}
                <Field label="Minimum order (MOQ)" htmlFor="moq" optional error={st.errors?.moq} className={changedField("moq")}>
                  <Input id="moq" value={s.moq} onChange={(e) => set("moq", e.target.value)} maxLength={60} />
                  {changedNote("moq")}
                </Field>
                <Field label="Notes" htmlFor="fq-notes" optional error={st.errors?.notes} className={cn("md:col-span-2", changedField("notes"))}>
                  <Textarea id="fq-notes" rows={4} value={s.notes} onChange={(e) => set("notes", e.target.value)} />
                  {changedNote("notes")}
                </Field>
              </PanelSection>
            )}

            {only && step !== "prices" && reasonBox}

            {step === "review" && (
              <div className="flex flex-col gap-3.5">
                <div className="grid gap-3.5 md:grid-cols-2 md:items-start">
                  <ReviewBox title="Supplier" onEdit={() => setStep("factory")}>
                    <Facts
                      rows={[
                        ["Supplier", s.factory?.name ?? <span className="font-semibold text-bad">Not chosen yet</span>],
                        ["Received on", day(s.receivedOn)],
                        ["Valid until", day(s.validUntil)],
                        ["Their reference", s.reference.trim() || "—"],
                        ["Their quotation", filesAdded.length ? filesAdded.join(", ") : "—"],
                      ]}
                    />
                  </ReviewBox>
                  <ReviewBox title="Delivery & payment" onEdit={() => setStep("terms")}>
                    <Facts
                      rows={[
                        ["Delivery", s.basis ? basisText(s.basis, s.basisPlace) : "—"],
                        ["Lead time", daysTyped ? leadWords(Number(s.leadDays) || 0, s.leadFrom, "factory") : s.leadTime || "—"],
                        ["Payment", s.parts.length ? s.parts.map((p) => `${p.share}%`).join(" / ") : "—"],
                        ["Payment note", s.paymentTerms.trim() || "—"],
                      ]}
                    />
                  </ReviewBox>
                </div>
                <ReviewBox title="Prices" count={[linesCount, currency, taxRate > 0 ? `tax ${taxRate}% ${taxIncluded ? "included" : "added"}` : "no tax"].filter(Boolean).join(" · ")} onEdit={() => setStep("prices")}>
                  {linesReview?.(h)}
                </ReviewBox>
                <div className="grid gap-3.5 md:grid-cols-2 md:items-start">
                  <ReviewBox title="Warranty & conditions" onEdit={() => setStep("conditions")}>
                    <Facts
                      rows={[
                        ["Warranty", s.warrantyMonths.trim() ? `${s.warrantyMonths.trim()} months from ${WARRANTY_FROM_LABEL[s.warrantyFrom]}` : "—"],
                        ["Covers", s.warranty.trim() || "—"],
                        ["Minimum order", s.moq.trim() || "—"],
                        ["Notes", s.notes.trim() || "—"],
                      ]}
                    />
                  </ReviewBox>
                </div>
              </div>
            )}

            {step === "changes" && (
              <div className="flex flex-col gap-3.5">
                {total ? (
                  <div role="table" aria-label="What changed" className="overflow-hidden rounded-xl border border-line text-[13.5px] max-sm:[&>[role=row]:nth-child(2)]:border-t-0">
                    <div role="row" className={cn(CHANGE_ROW, "h-9 border-t-0 bg-surface-2 py-0 text-xs font-semibold text-text-2 max-sm:hidden")}>
                      <span role="columnheader">Part</span>
                      <span role="columnheader">What</span>
                      <span role="columnheader">Was</span>
                      <span role="columnheader">Now</span>
                      <span role="columnheader">
                        <span className="sr-only">Undo</span>
                      </span>
                    </div>
                    {fieldChanges.map((c) => (
                      <div role="row" key={c.key} className={CHANGE_ROW}>
                        <span role="cell" className="text-text-2 max-sm:hidden">
                          {OFFER_PART_LABEL[c.part]}
                        </span>
                        <span role="cell" className="min-w-0">
                          <span className="text-text-2 sm:text-text">
                            <span className="sm:hidden">{OFFER_PART_LABEL[c.part]} · </span>
                            {c.label}
                          </span>
                          <span className="block sm:hidden">
                            <s className="text-muted">{c.from}</s> → <b className="font-semibold">{c.to}</b>
                          </span>
                        </span>
                        <span role="cell" title={c.from} className="min-w-0 truncate max-sm:hidden">
                          <s className="text-muted">{c.from}</s>
                        </span>
                        <span role="cell" title={c.to} className="min-w-0 truncate font-semibold max-sm:hidden">
                          {c.to}
                        </span>
                        <span role="cell" className="text-right">
                          <Button type="button" size="xs" variant="ghost" onClick={() => undo(c.key)} className="text-primary hover:text-primary" aria-label={`Undo: ${c.label}`}>
                            Undo
                          </Button>
                        </span>
                      </div>
                    ))}
                    {linesChanges.length > 0 && (
                      <div role="row" className={CHANGE_ROW}>
                        <span role="cell" className="text-text-2 max-sm:hidden">
                          Prices
                        </span>
                        <span role="cell" className="flex min-w-0 flex-col gap-0.5 sm:col-span-3">
                          <span className="text-text-2 sm:hidden">Prices</span>
                          {linesChanges.slice(0, 8).map((x) => (
                            <span key={x}>{x}</span>
                          ))}
                          {linesChanges.length > 8 && <span className="text-text-2">and {linesChanges.length - 8} more</span>}
                        </span>
                        <span role="cell" className="text-right">
                          <Button type="button" size="xs" variant="ghost" onClick={() => onUndoLines?.()} className="text-primary hover:text-primary" aria-label="Undo the changes to the items">
                            Undo
                          </Button>
                        </span>
                      </div>
                    )}
                    {filesAdded.length > 0 && (
                      <div role="row" className={CHANGE_ROW}>
                        <span role="cell" className="text-text-2 max-sm:hidden">
                          Supplier
                        </span>
                        <span role="cell" className="min-w-0 sm:col-span-3">
                          <span className="text-text-2 sm:hidden">Supplier · </span>
                          {filesAdded.length} to add: {filesAdded.join(", ")}
                        </span>
                        <span role="cell" className="text-right">
                          <Button type="button" size="xs" variant="ghost" onClick={() => onUndoFiles?.()} className="text-primary hover:text-primary" aria-label="Undo the files to add">
                            Undo
                          </Button>
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-text-2">Nothing changed.</p>
                )}
                {reasonBox}
              </div>
            )}
            {note}
          </StepsFrame>
        </>
      )}
    </ActionForm>
  );
}

/** The offer's tax (design 18 Nov): included in their prices, added on top, or none — and its %. */
function TaxChoice({ id, included, rate, onChange }: { id: string; included: boolean; rate: string; onChange: (included: boolean, rate: string) => void }) {
  const none = Number(rate || 0) === 0;
  const kind = none ? "none" : included ? "included" : "added";
  const [lastRate, setLastRate] = useState(none ? "13" : rate);
  return (
    <span className="flex flex-wrap items-center gap-2.5">
      <ChoiceChips
        id={id}
        label="Tax"
        value={kind}
        options={["included", "added", "none"] as const}
        labels={{ included: "Included", added: "Added", none: "No tax" }}
        onChange={(k) => {
          if (k === "none") {
            if (!none) setLastRate(rate);
            onChange(included, "0");
          } else onChange(k === "included", none ? lastRate || "13" : rate);
        }}
      />
      {!none && (
        <span className="flex items-center gap-1.5">
          <Input
            aria-label="Tax %"
            inputMode="decimal"
            className="w-20 text-right tabular"
            value={rate}
            onChange={(e) => onChange(included, e.target.value.replace(/[^\d.]/g, ""))}
          />
          <span className="text-sm text-muted">%</span>
        </span>
      )}
    </span>
  );
}

const OFFER_STEPS: { key: OfferStep; label: string }[] = [
  { key: "factory", label: "Supplier" },
  { key: "prices", label: "Prices" },
  { key: "terms", label: "Delivery & payment" },
  { key: "conditions", label: "Warranty & conditions" },
  { key: "review", label: "Review" },
  { key: "changes", label: "Changes" },
];

/** Where each field the API can refuse is typed. */
const FIELD_STEP: Record<string, OfferStep> = {
  factoryId: "factory",
  newFactoryName: "factory",
  reference: "factory",
  receivedOn: "factory",
  validUntil: "factory",
  currency: "prices",
  convertPrices: "prices",
  taxRate: "prices",
  taxIncluded: "prices",
  basis: "terms",
  basisPlace: "terms",
  leadDays: "terms",
  leadFrom: "terms",
  leadTime: "terms",
  paymentParts: "terms",
  paymentTerms: "terms",
  advancePercent: "terms",
  warranty: "conditions",
  warrantyMonths: "conditions",
  warrantyFrom: "conditions",
  moq: "conditions",
  notes: "conditions",
};

/** What the API said about the lines of a new offer ("lines.2.unitPrice") as "Line 3: Enter the factory's price". */
function lineErrors(errors: ActionState["errors"]): string[] {
  const out: string[] = [];
  for (const [key, list] of Object.entries(errors ?? {})) {
    if (!list?.length || (key !== "lines" && !key.startsWith("lines."))) continue;
    const n = Number(key.split(".")[1]);
    const say = Number.isInteger(n) ? `Item ${n + 1}: ${list[0]}` : list[0]!;
    if (!out.includes(say)) out.push(say);
  }
  return out;
}

/** A save refused for a field on another step opens that step, so the field and its message are in view. */
function JumpToError({ st, onJump }: { st: ActionState; onJump: (step: OfferStep) => void }) {
  // Once per answer: a later step change by hand is not undone.
  const jump = useRef(onJump);
  useEffect(() => {
    jump.current = onJump;
  });
  useEffect(() => {
    const first = Object.keys(st.errors ?? {}).find((k) => st.errors?.[k]?.length);
    if (first) jump.current(FIELD_STEP[first] ?? "prices");
  }, [st]);
  return null;
}
