"use client";

import { useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, CheckCircle2, Lock } from "lucide-react";
import {
  convertMinor,
  costSummary,
  documentTotals,
  formatMinor,
  fromMinor,
  fxRate,
  landedUnitCosts,
  priceForMargin,
  toMinor,
} from "@kebo/money";
import {
  balanceTermsOfParts,
  BASIS_STEP_HINT,
  BASIS_STEP_LABEL,
  basisGap,
  basisText,
  depositOfParts,
  INCOTERMS,
  leadCheck,
  leadWords,
  optionLetter,
  parseLead,
  parseWarranty,
  paymentCheck,
  quotePartsFrom,
  warrantyCheck,
  type BasisStep,
  type Incoterm,
  type LeadFrom,
  type OurTerms,
  type PaymentRoute,
  type TheirTerms,
  type WarrantyFrom,
} from "@kebo/shared";
import { Badge, Button, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { OfferLine, QuoteOffers, RevisionDraft } from "@/lib/types-deals";
import { ErrorText, numberText, rowKey } from "./form-bits";
import { convertText, rateSentence, type Fx } from "@/lib/fx";
import { CurrencySelect } from "@/components/common/currency-select";
import { PANEL_FORM, PanelFooter, PanelSection } from "@/components/common/panel";
import { shortName } from "./offer-facts";
import {
  CheckNote,
  LeadInputs,
  PartsField,
  partRows,
  partsPayload,
  partsProblem,
  RouteChoice,
  rowsAsParts,
  WarrantyFields,
  wholeOf,
  wholeOrNull,
  type PartRow,
  type PartsPreset,
} from "./terms-fields";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export interface ChargeState {
  key: string;
  /** Charges have no parts (the line table's rows always say so). */
  parentKey: null;
  type: "service" | "charge";
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  unitCost: string;
}

export interface OptionState {
  key: string;
  /** null: the customer's items, priced by hand. */
  factoryQuoteId: string | null;
  /** The lead time's words: an older option's, kept until days are typed (with days they are worked out). */
  leadTime: string;
  /** The lead time we promise as days from a moment. */
  leadDays: string;
  leadFrom: LeadFrom;
  discount: string;
  /** Our price per line, by factory line id (or customer item id). */
  prices: Record<string, string>;
  charges: ChargeState[];
  /** Costs between the factory's basis and ours, by step (to the port, sea freight…). */
  costs: Partial<Record<BasisStep, CostState>>;
}

export interface CostState {
  amount: string;
  currency: string;
  note: string;
}

export interface EditorState {
  currency: string;
  incoterm: Incoterm;
  incotermPlace: string;
  /** Where the goods go, printed as the port of discharge. */
  portOfDischarge: string;
  /** How the customer pays ("": not decided yet). */
  paymentRoute: PaymentRoute | "";
  /** The payment as parts: the plan the order starts with (the deposit and balance are worked out from them). */
  parts: PartRow[];
  validUntil: string;
  /** Payment conditions, printed under the parts. */
  paymentTerms: string;
  /** Delivery conditions, printed under the delivery time. */
  deliveryTerms: string;
  /** The warranty's words: what it covers (an older quotation: its whole warranty). */
  warranty: string;
  warrantyMonths: string;
  warrantyFrom: WarrantyFrom;
  notes: string;
  options: OptionState[];
}

const str = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(v));
const money2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "");
export const valid = (v: string) => v.trim() !== "" && Number.isFinite(Number(numberText(v)));

/**
 * The editor's values from the API's, as they are (the price editor saves them back unchanged): the payment's
 * parts (an older client's draft: its deposit and balance as parts), the lead times and the warranty as kept.
 */
export function fromDraft(d: RevisionDraft): EditorState {
  return {
    currency: d.currency,
    incoterm: d.incoterm,
    incotermPlace: str(d.incotermPlace),
    portOfDischarge: str(d.portOfDischarge),
    paymentRoute: d.paymentRoute ?? "",
    parts: partRows(d.paymentParts?.length ? d.paymentParts : quotePartsFrom(Number(d.depositPercent), d.balanceTerms)),
    validUntil: d.validUntil,
    paymentTerms: str(d.paymentTerms),
    deliveryTerms: str(d.deliveryTerms),
    warranty: str(d.warranty),
    warrantyMonths: str(d.warrantyMonths),
    warrantyFrom: d.warrantyFrom ?? "shipment",
    notes: str(d.notes),
    options: d.options.map((o, i) => ({
      key: `option-${i}`,
      factoryQuoteId: o.factoryQuoteId,
      leadTime: str(o.leadTime),
      leadDays: str(o.leadDays),
      leadFrom: o.leadFrom ?? "after_payment",
      discount: Number(o.discount) ? Number(o.discount).toFixed(2) : "",
      prices: Object.fromEntries(o.prices.map((p) => [p.lineId, money2(Number(p.unitPrice))])),
      charges: o.charges.map((c, k) => ({
        key: `charge-${i}-${k}`,
        parentKey: null,
        type: c.type,
        description: c.description,
        quantity: str(c.quantity),
        unit: c.unit,
        unitPrice: money2(Number(c.unitPrice)),
        unitCost: c.unitCost === null ? "" : money2(Number(c.unitCost)),
      })),
      costs: Object.fromEntries(
        (o.costs ?? []).map((c) => [c.step, { amount: money2(Number(c.amount)), currency: c.currency, note: c.note ?? "" }]),
      ),
    })),
  };
}

/** What the option's factory offer pays for vs the basis we sell on (null: no factory offer, or its basis is not said). */
export function gapOf(o: OptionState, offers: QuoteOffers, selling: Incoterm) {
  if (!o.factoryQuoteId) return null;
  return basisGap(offers.offers.find((x) => x.factoryQuoteId === o.factoryQuoteId)?.basis ?? null, selling);
}

/** The words a step gets when it is shown to the customer as its own line. */
export const STEP_LINE: Record<BasisStep, (place: string) => string> = {
  to_port: () => "Transport to the port",
  freight: (place) => `Sea freight${place ? ` to ${place}` : ""}`,
  insurance: () => "Cargo insurance",
  delivery: (place) => `Delivery${place ? ` to ${place}` : ""}`,
  duties: () => "Import duties and taxes",
};
export const asLineOf = (o: OptionState, step: BasisStep) => o.charges.some((c) => c.description.startsWith(STEP_LINE[step]("")));

/** The costs to reach our basis in the quotation's currency; which are still empty; a currency without a rate. */
export function extraOf(o: OptionState, offers: QuoteOffers, selling: Incoterm, currency: string) {
  const gap = gapOf(o, offers, selling);
  const out = { minor: 0, empty: [] as BasisStep[], noRate: null as string | null, needed: gap?.needed ?? [] };
  for (const step of out.needed) {
    const c = o.costs[step];
    const amount = c && valid(c.amount) ? Number(numberText(c.amount)) : 0;
    if (!(amount > 0)) {
      if (!asLineOf(o, step)) out.empty.push(step);
      continue;
    }
    const rate = /^[A-Z]{3}$/.test(currency) ? fxRate(c!.currency, currency, offers.mainCurrency, offers.rates) : null;
    if (rate === null) out.noRate = c!.currency;
    else out.minor += convertMinor(toMinor(numberText(c!.amount)), rate);
  }
  return out;
}

/** The lines an option offers: the factory's (locked), or the customer's items when there are no factory prices. */
export function linesOf(o: OptionState, offers: QuoteOffers): OfferLine[] | null {
  if (!o.factoryQuoteId) return offers.items.map((i) => ({ ...i, requestedItemId: i.id, answersNo: i.no, unitCost: null }));
  return offers.offers.find((x) => x.factoryQuoteId === o.factoryQuoteId)?.lines ?? null;
}

export function payload(s: EditorState, offers: QuoteOffers) {
  const costsOf = (o: OptionState) =>
    (gapOf(o, offers, s.incoterm)?.needed ?? [])
      .filter((step) => valid(o.costs[step]?.amount ?? "") && Number(numberText(o.costs[step]!.amount)) > 0)
      .map((step) => ({
        step,
        amount: numberText(o.costs[step]!.amount),
        currency: o.costs[step]!.currency.trim().toUpperCase(),
        note: o.costs[step]!.note,
      }));
  const parts = rowsAsParts(s.parts);
  return {
    currency: s.currency.trim().toUpperCase(),
    incoterm: s.incoterm,
    incotermPlace: s.incotermPlace,
    portOfDischarge: s.portOfDischarge,
    // Worked out from the parts by the API too; sent for what still reads them.
    depositPercent: depositOfParts(parts),
    balanceTerms: balanceTermsOfParts(parts),
    paymentRoute: s.paymentRoute || null,
    paymentParts: partsPayload(s.parts, "customer"),
    validUntil: s.validUntil,
    paymentTerms: s.paymentTerms,
    deliveryTerms: s.deliveryTerms,
    warranty: s.warranty,
    warrantyMonths: wholeOrNull(s.warrantyMonths),
    warrantyFrom: s.warrantyFrom,
    notes: s.notes,
    options: s.options.map((o) => ({
      factoryQuoteId: o.factoryQuoteId,
      // With days the words are worked out from them; without, an older option's words are kept.
      leadDays: wholeOrNull(o.leadDays),
      leadFrom: o.leadFrom,
      leadTime: o.leadDays.trim() ? null : o.leadTime,
      discount: numberText(o.discount),
      prices: (linesOf(o, offers) ?? [])
        .filter((l) => valid(o.prices[l.id] ?? ""))
        .map((l) => ({ lineId: l.id, unitPrice: numberText(o.prices[l.id]!) })),
      charges: o.charges.map((c) => ({
        type: c.type,
        description: c.description,
        quantity: numberText(c.quantity),
        unit: c.unit.trim() || "lot",
        unitPrice: numberText(c.unitPrice),
        unitCost: numberText(c.unitCost) || null,
      })),
      costs: costsOf(o),
    })),
  };
}

/**
 * Prices for every line that has a cost, at a margin, on the landed cost: the
 * line's cost plus its share of the costs to reach our basis (freight…), so the
 * prices cover them. Lines without a cost keep what they have.
 */
export function priced(lines: OfferLine[], prices: Record<string, string>, margin: number, extraMinor = 0) {
  const next = { ...prices };
  const landed = landedUnitCosts(
    lines.map((l) => ({ unitCostMinor: l.unitCost === null ? null : toMinor(l.unitCost), quantity: numberText(l.quantity) || 0 })),
    extraMinor,
  );
  lines.forEach((l, i) => {
    if (landed[i] !== null) next[l.id] = fromMinor(priceForMargin(landed[i]!, margin));
  });
  return next;
}

/** An option's lines, totals and costing (what it costs us to reach our terms, and the margin that leaves). */
export function optionTotals(o: OptionState, offers: QuoteOffers, incoterm: Incoterm, currency: string) {
  const lines = linesOf(o, offers) ?? [];
  const rows = [
    ...lines.map((l) => ({ quantity: numberText(l.quantity) || 0, unitPrice: numberText(o.prices[l.id] ?? "") || 0, cost: l.unitCost })),
    ...o.charges.map((c) => ({
      quantity: numberText(c.quantity) || 0,
      unitPrice: numberText(c.unitPrice) || 0,
      cost: valid(c.unitCost) ? numberText(c.unitCost) : null,
    })),
  ];
  const totals = documentTotals(rows, numberText(o.discount) || 0);
  const extra = extraOf(o, offers, incoterm, currency);
  const costing = costSummary(
    rows.map((r) => ({
      quantity: r.quantity,
      unitPriceMinor: toMinor(r.unitPrice),
      unitCostMinor: r.cost === null || r.cost === undefined ? null : toMinor(r.cost),
    })),
    totals.discount,
    extra.minor,
  );
  return { lines, totals, costing, extra };
}

const currencyOf = (s: EditorState) => (/^[A-Za-z]{3}$/.test(s.currency.trim()) ? s.currency.trim().toUpperCase() : "—");

/**
 * What the margin box starts with: the margin the quotation's options have now, when they share one (to one
 * decimal), so the box says what is there. Options at different margins, or none with a cost: the usual
 * margin from Settings, which only prices what is added.
 */
export function startMargin(s: EditorState, offers: QuoteOffers): string {
  const margins = s.options
    .map((o) => optionTotals(o, offers, s.incoterm, currencyOf(s)).costing.marginPercent)
    .filter((m): m is number => m !== null)
    .map((m) => Math.round(m * 10) / 10);
  const one = margins.length > 0 && margins.every((m) => m === margins[0]) ? margins[0]! : null;
  return String(one !== null && one >= 0 && one < 100 ? one : offers.defaultMargin);
}

/**
 * Every option priced at one margin on its landed cost (its lines' costs plus the costs to reach our terms).
 * A line without a cost, and an option priced by hand (the customer's items), keep their prices.
 */
export function pricedAll(s: EditorState, offers: QuoteOffers, margin: number): OptionState[] {
  const currency = currencyOf(s);
  return s.options.map((o) => ({
    ...o,
    prices: priced(linesOf(o, offers) ?? [], o.prices, margin, extraOf(o, offers, s.incoterm, currency).minor),
  }));
}

/** A margin typed in the box: a number from 0 up to (not) 100. */
export function marginOf(text: string): number | null {
  const n = Number(numberText(text));
  return text.trim() !== "" && Number.isFinite(n) && n >= 0 && n < 100 ? n : null;
}

/** The usual payments to start from (as on the order's plan). */
const CUSTOMER_PRESETS: PartsPreset[] = [
  {
    label: "30% now · 70% before shipment",
    parts: [
      { name: "Deposit", share: 30, rule: "on_order" },
      { name: "Balance", share: 70, rule: "before_shipment" },
    ],
  },
  {
    label: "50 / 50",
    parts: [
      { name: "Deposit", share: 50, rule: "on_order" },
      { name: "Balance", share: 50, rule: "before_shipment" },
    ],
  },
  {
    label: "30 · 60 · 10 after the site test",
    parts: [
      { name: "Deposit", share: 30, rule: "on_order" },
      { name: "Before shipment", share: 60, rule: "before_shipment" },
      { name: "After the site test", share: 10, rule: "after_sat", days: 0 },
    ],
  },
  { label: "All against the B/L copy", parts: [{ name: "Payment against the B/L copy", share: 100, rule: "against_bl_copy" }] },
];
/** With a letter of credit: the usual LC payment too. */
const LC_PRESET: PartsPreset = {
  label: "30% now · 70% by LC at sight",
  parts: [
    { name: "Deposit", share: 30, rule: "on_order" },
    { name: "Balance by LC", share: 70, rule: "lc", days: 0 },
  ],
};

/**
 * A draft opened in the form: an older option's lead time words, and an older warranty's, read for their days
 * and months where they say them plainly (the form says so, and nothing is saved until Save).
 */
export function withFacts(s: EditorState): { state: EditorState; leadWords: Record<string, string>; warrantyWords: string | null } {
  const leadWordsOf: Record<string, string> = {};
  const options = s.options.map((o) => {
    if (o.leadDays.trim() || !o.leadTime.trim()) return o;
    const lead = parseLead(o.leadTime);
    if (!lead) return o;
    leadWordsOf[o.key] = o.leadTime;
    return { ...o, leadDays: String(lead.days), leadFrom: lead.from, leadTime: "" };
  });
  const w = !s.warrantyMonths.trim() ? parseWarranty(s.warranty) : null;
  return {
    state: { ...s, options, ...(w ? { warrantyMonths: String(w.months), warrantyFrom: w.from, warranty: w.rest ?? "" } : {}) },
    leadWords: leadWordsOf,
    warrantyWords: w ? s.warranty : null,
  };
}

/**
 * The quotation's form, the same for "New quotation R1" and "Edit quotation R1", in the groups every offer,
 * quotation, order and purchase order uses (design "terms that travel"): which offers to quote (each ticked one
 * an option) · The quotation · Delivery · Payment · Warranty · Conditions. Delivery has each option's lead time
 * beside what its factory gives; Payment is the order's plan (how they pay, the parts, a usual one in one tap);
 * where we promise more than the factory gives, it says so before the quotation is sent. The prices are not
 * here: they have their own editor (Edit lines). The whole draft is saved.
 */
export function RevisionEditor({
  action,
  number,
  initial,
  offers: initialOffers,
  loadOffers,
  showCosts,
  submitLabel,
  onDone,
  requireChanges,
  onCancel,
  tickAll = false,
  footNote,
}: {
  /** The window of a first revision: every factory offer that has lines starts ticked. */
  tickAll?: boolean;
  /** The window's footer, on the left ("Once sent, a change needs a new revision."). */
  footNote?: ReactNode;
  action: Action;
  number: number;
  initial: RevisionDraft;
  offers: QuoteOffers;
  /** The offers with costs in another currency (when the quotation currency changes). */
  loadOffers?: (currency: string) => Promise<QuoteOffers | null>;
  showCosts: boolean;
  submitLabel: string;
  /** Saved: given the answer, so a window can close without asking "Throw away your changes?". */
  onDone?: (state: ActionState) => void;
  /** Saving needs a change (editing an existing draft). */
  requireChanges?: boolean;
  onCancel?: () => void;
}) {
  // The window of a first revision quotes every offer that has lines; the person unticks what they do not want.
  const [opened] = useState(() => {
    const st = fromDraft(initial);
    if (!tickAll) return withFacts(st);
    const has = new Set(st.options.map((o) => o.factoryQuoteId));
    const more = initialOffers.offers
      .filter((o) => !has.has(o.factoryQuoteId) && o.lines.length > 0)
      .map((o) => newOption(o, priced(o.lines, {}, initialOffers.defaultMargin)));
    return withFacts({ ...st, options: [...st.options, ...more] });
  });
  const [s, setS] = useState<EditorState>(opened.state);
  const [saved, setSaved] = useState(() => JSON.stringify(opened.state));
  const [offers, setOffers] = useState(initialOffers);
  // The box starts with the margin the options have (the last revision's, or the usual one on a first quotation).
  const [margin, setMargin] = useState(() => startMargin(opened.state, initialOffers));
  /** The margin every ticked offer was last priced at from the box in this window (said under it). */
  const [pricedAt, setPricedAt] = useState<number | null>(null);
  const [partsTried, setPartsTried] = useState(false);
  const dirty = JSON.stringify(s) !== saved;
  const set = <K extends keyof EditorState>(k: K, v: EditorState[K]) => setS((st) => ({ ...st, [k]: v }));
  const setOption = (key: string, patch: Partial<OptionState>) =>
    setS((st) => ({ ...st, options: st.options.map((o) => (o.key === key ? { ...o, ...patch } : o)) }));
  // A first revision says where a value came from, for as long as it still shows that value.
  const fromCustomer = initial.from?.currency === "customer" && s.currency.trim().toUpperCase() === initial.currency;
  const fromLast = initial.from?.delivery === "last_quotation";
  const lastWords = `from the last quotation to ${initial.from?.customer ?? "this customer"}${initial.from?.lastQuotation ? ` (${initial.from.lastQuotation})` : ""}`;

  const currency = /^[A-Za-z]{3}$/.test(s.currency.trim()) ? s.currency.trim().toUpperCase() : "—";
  const fmt = (minor: number) => formatMinor(minor, currency);
  const marginNumber = Number(numberText(margin));
  const marginOk = marginOf(margin) !== null;
  /**
   * The margin box: a margin typed there prices every ticked offer at once, so the totals beside each offer
   * are the ones that will be saved.
   */
  const priceEveryOffer = (text: string) => {
    setMargin(text);
    const m = marginOf(text);
    if (m === null) return;
    setS((st) => ({ ...st, options: pricedAll(st, offers, m) }));
    setPricedAt(m);
  };
  const totalsOf = (o: OptionState) => optionTotals(o, offers, s.incoterm, currency);

  // The list keeps the order it opened with (options A, B… first, then the other offers), so a tick never moves a row.
  const [firstOrder] = useState(() => s.options.map((o) => o.factoryQuoteId));
  const place = (id: string) => {
    const i = firstOrder.indexOf(id);
    return i < 0 ? firstOrder.length : i;
  };
  const listed = [...offers.offers].sort((a, b) => place(a.factoryQuoteId) - place(b.factoryQuoteId));
  const addOption = (factoryQuoteId: string | null) => {
    const offer = offers.offers.find((o) => o.factoryQuoteId === factoryQuoteId);
    const lines = offer?.lines ?? offers.items.map((i) => ({ ...i, requestedItemId: i.id, answersNo: i.no, unitCost: null }));
    const prices = priced(lines, {}, marginOk ? marginNumber : offers.defaultMargin);
    setS((st) => ({ ...st, options: [...st.options, offer ? newOption(offer, prices) : { ...newOption(null, prices) }] }));
  };

  const fx: Fx = { main: offers.mainCurrency, rates: offers.rates };
  /** The note under the currency after a change: what was converted, or why the numbers were kept. */
  const [converted, setConverted] = useState<{ text: string; ok: boolean } | null>(null);
  const typedIn = useRef<{ currency: string; options: OptionState[]; shown: string } | null>(null);
  /**
   * Another currency: every price, discount and charge is converted at the
   * Settings rates (USD 1,000 → PKR 280,000), and the factory costs are
   * fetched again in the new currency. Without a rate the numbers are kept.
   */
  const changeCurrency = async (to: string) => {
    const now = s.currency.trim().toUpperCase();
    if (to === now) return;
    // Convert from the numbers as they were typed (unless edited since), so USD → PKR → USD gives back the same cents.
    const origin =
      typedIn.current && JSON.stringify(s.options) === typedIn.current.shown
        ? typedIn.current
        : { currency: now, options: s.options, shown: "" };
    const from = origin.currency;
    const ok = from === to || convertText("1", from, to, fx) !== null;
    const c = (t: string) => (from === to ? t : ok && t.trim() !== "" ? (convertText(t, from, to, fx) ?? t) : t);
    const options = (ok ? origin.options : s.options).map((o) => ({
      ...o,
      discount: c(o.discount),
      prices: Object.fromEntries(Object.entries(o.prices).map(([k, v]) => [k, c(v)])),
      charges: o.charges.map((ch) => ({ ...ch, unitPrice: c(ch.unitPrice), unitCost: c(ch.unitCost) })),
    }));
    typedIn.current = ok && from !== to ? { currency: from, options: origin.options, shown: JSON.stringify(options) } : null;
    setS((st) => ({ ...st, currency: to, options }));
    setConverted(
      ok
        ? {
            ok: true,
            text:
              from === to
                ? `Back in ${to}: the prices as they were typed.`
                : `Prices, discounts and charges converted from ${now} at ${rateSentence(fx, now, to)}.`,
          }
        : { ok: false, text: `No exchange rate between ${now} and ${to} in Settings: the numbers were kept as they are.` },
    );
    if (loadOffers && to !== offers.currency) {
      const next = await loadOffers(to);
      if (next) setOffers(next);
    }
  };

  /* ---- each option against its factory: what we promise beside what it gives */
  const parts = rowsAsParts(s.parts);
  const partsBad = partsProblem(s.parts);
  const many = s.options.length > 1;
  const offerOf = (o: OptionState) =>
    o.factoryQuoteId ? (offers.offers.find((x) => x.factoryQuoteId === o.factoryQuoteId) ?? null) : null;
  const nameOf = (o: OptionState) => {
    const off = offerOf(o);
    return o.factoryQuoteId ? (off ? shortName(off.factory.name) : "A removed offer") : "The customer's items";
  };
  const oursOf = (o: OptionState): OurTerms => ({
    leadDays: wholeOf(o.leadDays),
    leadFrom: o.leadFrom,
    parts,
    warrantyMonths: wholeOf(s.warrantyMonths),
    warrantyFrom: s.warrantyFrom,
    totalMinor: totalsOf(o).totals.total,
    currency,
  });
  const theirsOf = (o: OptionState): TheirTerms | null => {
    const off = offerOf(o);
    if (!off?.terms) return null;
    const c = totalsOf(o).costing;
    // What the factory is paid: the option's cost without the costs to reach our basis (freight and the like).
    const factoryMinor = c.costMinor - c.extraCostMinor;
    return { factory: shortName(off.factory.name), ...off.terms, costMinor: factoryMinor > 0 ? factoryMinor : null };
  };
  const checksOf = (key: "payment" | "warranty") =>
    s.options.flatMap((o, i) => {
      const theirs = theirsOf(o);
      const c = theirs ? (key === "payment" ? paymentCheck(oursOf(o), theirs) : warrantyCheck(oursOf(o), theirs)) : null;
      return c ? [{ key: `${o.key}-${key}`, ok: c.ok, text: many ? `${optionLetter(i)} · ${c.text}` : c.text }] : [];
    });
  // The ticked offers all hand over at the same place on our basis: said under the place ("Both offers are FOB Qingdao").
  const bases = s.options.map((o) => offerOf(o)).filter((x) => x !== null);
  const sharedPlace =
    bases.length === s.options.length && bases.length > 0 && bases.every((b) => b.basis === s.incoterm && b.basisPlace && b.basisPlace === bases[0]!.basisPlace)
      ? `${bases.length === 1 ? "The offer is" : bases.length === 2 ? "Both offers are" : `All ${bases.length} offers are`} ${s.incoterm} ${bases[0]!.basisPlace}`
      : null;
  const totalsText = s.options.map((o, i) => `${many ? `${optionLetter(i)} ` : ""}${fmt(totalsOf(o).totals.total)}`).join(" · ");
  const presets = s.paymentRoute === "letter_of_credit" ? [...CUSTOMER_PRESETS, LC_PRESET] : CUSTOMER_PRESETS;

  return (
    <ActionForm
      action={action}
      onDone={(state) => {
        setSaved(JSON.stringify(s));
        onDone?.(state);
      }}
      beforeSend={() => {
        if (!partsBad) return true;
        setPartsTried(true);
        document.getElementById(`parts-${number}`)?.scrollIntoView?.({ block: "center" });
        return false;
      }}
      className={PANEL_FORM}
    >
      {(st) => (
        <>
          <input type="hidden" name="payload" value={JSON.stringify(payload(s, offers))} />

          <PanelSection title="Options: which offers to quote" first className="sm:grid-cols-1">
            <ul className="flex flex-col divide-y divide-line rounded-xl border border-line" aria-label="Factory offers">
              {listed.map((off) => {
                const i = s.options.findIndex((o) => o.factoryQuoteId === off.factoryQuoteId);
                const on = i >= 0;
                const t = on ? totalsOf(s.options[i]!) : null;
                const none = off.lines.length === 0;
                const last = on && s.options.length === 1;
                const facts = [
                  none
                    ? "No lines yet: add its lines on Factory offers to quote it"
                    : off.coverage.missing.length
                      ? `Does not include item ${off.coverage.missing.join(", ")}`
                      : "Covers every item",
                  off.leadTime,
                  showCosts && off.totalCost ? `cost ${formatMinor(toMinor(off.totalCost), currency)}` : null,
                  showCosts && t && t.costing.marginPercent !== null ? `margin ${t.costing.marginPercent.toFixed(1)}%` : null,
                ].filter(Boolean);
                return (
                  <li key={off.factoryQuoteId}>
                    <label
                      className={cn("flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm", none && "cursor-default opacity-60")}
                      title={last ? "A quotation keeps at least one option" : undefined}
                    >
                      <input
                        type="checkbox"
                        className="size-[18px] shrink-0 accent-primary"
                        checked={on}
                        disabled={none || last}
                        onChange={() =>
                          on
                            ? setS((x) => ({ ...x, options: x.options.filter((o) => o.factoryQuoteId !== off.factoryQuoteId) }))
                            : addOption(off.factoryQuoteId)
                        }
                      />
                      <span className="w-4 shrink-0 font-bold">{on ? optionLetter(i) : ""}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{off.factory.name}</span>
                        <span className="block text-xs text-text-2">{facts.join(" · ")}</span>
                      </span>
                      <span className="shrink-0 font-semibold tabular">{t ? fmt(t.totals.total) : "—"}</span>
                    </label>
                  </li>
                );
              })}
              {(s.options.some((o) => o.factoryQuoteId === null) || offers.offers.length === 0) && (
                <li>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm">
                    <input
                      type="checkbox"
                      className="size-[18px] shrink-0 accent-primary"
                      checked={s.options.some((o) => o.factoryQuoteId === null)}
                      disabled={s.options.length === 1 && s.options[0]!.factoryQuoteId === null}
                      onChange={() =>
                        s.options.some((o) => o.factoryQuoteId === null)
                          ? setS((x) => ({ ...x, options: x.options.filter((o) => o.factoryQuoteId !== null) }))
                          : addOption(null)
                      }
                    />
                    <span className="w-4 shrink-0 font-bold">
                      {s.options.some((o) => o.factoryQuoteId === null)
                        ? optionLetter(s.options.findIndex((o) => o.factoryQuoteId === null))
                        : ""}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">The customer&rsquo;s items, priced by hand</span>
                      <span className="block text-xs text-text-2">No factory prices: the items as the customer asked for them</span>
                    </span>
                  </label>
                </li>
              )}
            </ul>
            {showCosts && (
              <div className="flex flex-col gap-1 text-[13px] text-text-2">
                <p className="flex flex-wrap items-center gap-2">
                  <label htmlFor={`margin-${number}`}>Price every ticked offer at</label>
                  <Input
                    id={`margin-${number}`}
                    inputMode="decimal"
                    className="h-9 w-16 text-right tabular"
                    value={margin}
                    onChange={(e) => priceEveryOffer(e.target.value)}
                  />
                  <span>% on our cost. Each price can be changed after, in Edit lines.</span>
                </p>
                {pricedAt !== null && marginOk && (
                  <p role="status" className="text-text">
                    {s.options.length === 1 ? "The offer is" : `All ${s.options.length} offers are`} priced at {pricedAt}% now: the totals
                    above are the new ones. Prices typed by hand before are replaced when you save.
                  </p>
                )}
                {!marginOk && margin.trim() !== "" && <p className="text-bad">Type a margin from 0 to 99.</p>}
              </div>
            )}
            {initial.options
              .map((o, i) => ({ o, i }))
              .filter(({ o }) => requireChanges && !s.options.some((x) => x.factoryQuoteId === o.factoryQuoteId))
              .map(({ o, i }) => (
                <p key={o.factoryQuoteId ?? "items"} className="rounded-lg bg-warn-soft/60 px-3 py-2 text-[13px]">
                  Option {optionLetter(i)}
                  {o.factoryQuoteId
                    ? ` (${offers.offers.find((x) => x.factoryQuoteId === o.factoryQuoteId)?.factory.name ?? "its offer"})`
                    : ""}{" "}
                  and the prices you set for it will be removed when you save.
                </p>
              ))}
            <ErrorText error={st.errors?.options} />
          </PanelSection>

          <PanelSection title="The quotation">
            <Field
              label="Currency"
              htmlFor={`cur-${number}`}
              error={st.errors?.currency}
              hint={
                converted ? (
                  <span className={converted.ok ? undefined : "text-warn"}>{converted.text}</span>
                ) : fromCustomer ? (
                  `${initial.from?.customer ?? "The customer"} is quoted in ${initial.currency} (from the customer)`
                ) : (
                  "Changing it converts the prices"
                )
              }
            >
              <CurrencySelect id={`cur-${number}`} value={s.currency} onChange={(e) => void changeCurrency(e.target.value)} />
            </Field>
            <Field label="Valid until" htmlFor={`valid-${number}`} error={st.errors?.validUntil}>
              <Input id={`valid-${number}`} type="date" value={s.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
            </Field>
          </PanelSection>

          <PanelSection title="Delivery" sub="where we hand the goods over, and when" className="md:grid-cols-3">
            <Field
              label="Delivery basis (Incoterm)"
              htmlFor={`inco-${number}`}
              error={st.errors?.incoterm}
              hint={fromLast && s.incoterm === initial.incoterm ? lastWords : undefined}
            >
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
              hint={
                fromLast && initial.incotermPlace && s.incotermPlace === initial.incotermPlace
                  ? lastWords
                  : (sharedPlace ?? "The port or place for the Incoterm")
              }
            >
              <Input
                id={`place-${number}`}
                value={s.incotermPlace}
                maxLength={80}
                placeholder="e.g. Qingdao"
                onChange={(e) => set("incotermPlace", e.target.value)}
              />
            </Field>
            <Field
              label="Port of discharge"
              htmlFor={`pod-${number}`}
              optional
              error={st.errors?.portOfDischarge}
              hint="Where the goods go; printed on the quotation"
            >
              <Input
                id={`pod-${number}`}
                value={s.portOfDischarge}
                maxLength={80}
                placeholder="e.g. Karachi"
                onChange={(e) => set("portOfDischarge", e.target.value)}
              />
            </Field>
            <div className="sm:col-span-2 md:col-span-3">
              <table className="w-full border-collapse text-sm" aria-label="Lead time of each option">
                <thead>
                  <tr className="text-left text-xs text-text-2">
                    <th className="pb-1.5 font-medium max-md:hidden">Option</th>
                    <th className="pb-1.5 font-medium">Lead time we promise</th>
                    <th className="pb-1.5 font-medium max-md:hidden">{showCosts ? "The factory gives" : ""}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.options.map((o, i) => {
                    const theirs = theirsOf(o);
                    const check = theirs ? leadCheck(oursOf(o), theirs) : null;
                    const off = offerOf(o);
                    const was = opened.leadWords[o.key];
                    const days = o.leadDays.trim() !== "";
                    return (
                      <tr key={o.key} className="border-t border-line align-top">
                        <th scope="row" className="py-2 pr-3 text-left font-semibold max-md:hidden md:whitespace-nowrap">
                          {optionLetter(i)} · {nameOf(o)}
                        </th>
                        <td className="py-2 md:pr-3">
                          <p className="mb-1 text-sm font-semibold md:hidden">
                            {optionLetter(i)} · {nameOf(o)}
                          </p>
                          <LeadInputs
                            id={`lead-${o.key}`}
                            daysLabel={`Option ${optionLetter(i)} lead time`}
                            side="customer"
                            days={o.leadDays}
                            from={o.leadFrom}
                            onDays={(v) => setOption(o.key, { leadDays: v })}
                            onFrom={(v) => setOption(o.key, { leadFrom: v })}
                          />
                          <p className="mt-1 text-xs text-muted">
                            {days
                              ? `Printed as “${leadWords(Number(o.leadDays) || 0, o.leadFrom, "customer")}”${was ? `, worked out from “${was}”` : ""}`
                              : o.leadTime
                                ? `Its words: “${o.leadTime}”, kept until you type the days.`
                                : "So the ship-by date can be worked out"}
                          </p>
                          {check && (
                            <CheckNote ok={check.ok} className="mt-1.5 md:hidden">
                              {check.text}
                            </CheckNote>
                          )}
                        </td>
                        <td className="py-2 max-md:hidden">
                          {check ? (
                            <CheckNote ok={check.ok}>{check.text}</CheckNote>
                          ) : off && showCosts ? (
                            <span className="text-xs text-muted">
                              {off.leadTime ? `Their words: “${off.leadTime}”` : "Their lead time is not said"}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <ErrorText error={st.errors?.leadDays ?? st.errors?.leadFrom} />
            </div>
            <Field
              label="Delivery conditions"
              htmlFor={`del-terms-${number}`}
              optional
              error={st.errors?.deliveryTerms}
              hint="Printed under the delivery time"
              className="sm:col-span-2 md:col-span-3"
            >
              <Textarea
                id={`del-terms-${number}`}
                rows={2}
                className="min-h-0"
                placeholder="e.g. Export wooden cases; inspection before shipment"
                value={s.deliveryTerms}
                onChange={(e) => set("deliveryTerms", e.target.value)}
              />
            </Field>
          </PanelSection>

          <PanelSection title="Payment" sub="the plan the order starts with" className="md:grid-cols-3">
            <RouteChoice idPrefix={`route-${number}`} value={s.paymentRoute} onChange={(v) => set("paymentRoute", v)} />
            <PartsField
              id={`parts-${number}`}
              idPrefix={`part-${number}`}
              side="customer"
              rows={s.parts}
              onChange={(rows) => set("parts", rows)}
              presets={presets}
              amounts={totalsText}
              error={(partsTried ? partsBad : null) ?? st.errors?.paymentParts ?? st.errors?.depositPercent}
            />
            {checksOf("payment").map((c) => (
              <CheckNote key={c.key} ok={c.ok} className="sm:col-span-2 md:col-span-3">
                {c.text}
              </CheckNote>
            ))}
            <Field
              label="Payment conditions"
              htmlFor={`pay-terms-${number}`}
              optional
              error={st.errors?.paymentTerms}
              hint="The parts print by themselves; this is printed after them"
              className="sm:col-span-2 md:col-span-3"
            >
              <Textarea
                id={`pay-terms-${number}`}
                rows={2}
                className="min-h-0"
                placeholder="e.g. Bank charges outside China are for the buyer"
                value={s.paymentTerms}
                onChange={(e) => set("paymentTerms", e.target.value)}
              />
            </Field>
          </PanelSection>

          <PanelSection title="Warranty" className="md:grid-cols-3">
            <WarrantyFields
              idPrefix={`q${number}`}
              months={s.warrantyMonths}
              from={s.warrantyFrom}
              covers={s.warranty}
              onMonths={(v) => set("warrantyMonths", v)}
              onFrom={(v) => set("warrantyFrom", v)}
              onCovers={(v) => set("warranty", v)}
              errors={{ months: st.errors?.warrantyMonths, from: st.errors?.warrantyFrom, covers: st.errors?.warranty }}
              coversHint={opened.warrantyWords ? `Worked out from “${opened.warrantyWords}”` : undefined}
            />
            {checksOf("warranty").map((c) => (
              <CheckNote key={c.key} ok={c.ok} className="sm:col-span-2 md:col-span-3">
                {c.text}
              </CheckNote>
            ))}
          </PanelSection>

          <PanelSection title="Conditions" className="sm:grid-cols-1">
            <Field label="Notes" htmlFor={`notes-${number}`} optional error={st.errors?.notes} hint="Printed last">
              <Textarea
                id={`notes-${number}`}
                rows={3}
                className="min-h-0"
                placeholder="Prices include export wooden cases and loading at the port…"
                value={s.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </Field>
          </PanelSection>

          <PanelFooter start={footNote}>
            {onCancel && (
              <Button type="button" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
            <SubmitButton pendingText="Saving…" disabled={requireChanges && !dirty}>
              <Check aria-hidden /> {submitLabel}
            </SubmitButton>
          </PanelFooter>
        </>
      )}
    </ActionForm>
  );
}

/** A new option for an offer (or the customer's items): its prices, and the factory's lead time promised from the same moment. */
function newOption(offer: QuoteOffers["offers"][number] | null, prices: Record<string, string>): OptionState {
  const days = offer?.leadDays ?? null;
  return {
    key: rowKey(),
    factoryQuoteId: offer?.factoryQuoteId ?? null,
    leadTime: days === null ? (offer?.leadTime ?? "") : "",
    leadDays: days === null ? "" : String(days),
    leadFrom: offer?.leadFrom ?? "after_payment",
    discount: "",
    prices,
    charges: [],
    costs: {},
  };
}

/** A figure in a totals bar: small label over the amount. */
export function Fig({ label, children, strong, className }: { label: string; children: ReactNode; strong?: boolean; className?: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-text-2">{label}</dt>
      <dd className={cn("text-sm font-semibold whitespace-nowrap tabular", strong && "text-base", className)}>{children}</dd>
    </div>
  );
}

/** "Covers everything" or what it misses, by item number. */
export function CoverageBadge({ missing }: { missing: string[] }) {
  return missing.length ? (
    <Badge tone="warn">
      <AlertTriangle aria-hidden /> Misses {missing.join(", ")}
    </Badge>
  ) : (
    <Badge tone="ok">
      <CheckCircle2 aria-hidden /> Covers all
    </Badge>
  );
}

/** Cost, sales, profit and margin of an option. Internal: never printed. */
export function CostingBox({
  currency,
  cost,
  sales,
  profit,
  margin,
  uncosted,
  extra = 0,
  extraLabel,
}: {
  currency: string;
  cost: number;
  sales: number;
  profit: number;
  margin: number | null;
  uncosted: number;
  /** Part of the cost: freight and the like to reach the basis we sell on. */
  extra?: number;
  extraLabel?: string;
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
        {extra > 0 && (
          <div className="flex justify-between pb-0.5 pl-3 text-xs text-muted">
            <dt>{extraLabel ?? "incl. costs to reach our basis"}</dt>
            <dd className="tabular">{fmt(extra)}</dd>
          </div>
        )}
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

/**
 * Between the factory's price basis and the one we sell on: the costs to add
 * (to the port, sea freight…), each in its own currency, or as a line the
 * customer sees. Warns when the basis is not said, when a cost is still empty,
 * and when the factory's price pays for something we do not sell.
 */
export function BasisCosts({
  letter,
  factoryBasis,
  factoryPlace,
  selling,
  sellingPlace,
  currency,
  fx,
  costs,
  extra,
  asLine,
  convert,
  fmt,
  onChange,
  onAsLine,
  bare = false,
}: {
  /** Without its own frame and title (inside the price editor's card). */
  bare?: boolean;
  letter: string;
  factoryBasis: Incoterm | null;
  factoryPlace: string | null;
  selling: Incoterm;
  sellingPlace: string;
  currency: string;
  fx: Fx;
  costs: Partial<Record<BasisStep, CostState>>;
  extra: ReturnType<typeof extraOf>;
  asLine: (step: BasisStep) => boolean;
  convert: (c: CostState) => number | null;
  fmt: (minor: number) => string;
  onChange: (step: BasisStep, patch: Partial<CostState>) => void;
  onAsLine: (step: BasisStep, costMinor: number) => void;
}) {
  const ours = basisText(selling, sellingPlace.trim() || null);
  const gap = basisGap(factoryBasis, selling);
  return (
    <section aria-label={`Getting it to ${ours}`} className={cn("flex flex-col gap-2", !bare && "rounded-lg border border-line p-3")}>
      {!bare && (
        <h4 className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
          Getting it to {ours}
          <span className="text-xs font-normal text-muted">
            the factory&apos;s price is {factoryBasis ? basisText(factoryBasis, factoryPlace) : "on a basis not said"} · internal
          </span>
        </h4>
      )}
      {!gap ? (
        <p className="flex items-start gap-1.5 rounded-md bg-warn-soft px-3 py-2 text-xs text-text">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
          The offer does not say its price basis (EXW, FOB…), so the costs to reach {selling} cannot be worked out. Set it on Factory offers
          (the offer's Edit), or add freight and the like as charges.
        </p>
      ) : (
        <>
          {gap.extra.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-md bg-warn-soft px-3 py-2 text-xs text-text">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
              Their {factoryBasis} price already pays for {gap.extra.map((x) => BASIS_STEP_LABEL[x].toLowerCase()).join(" and ")}, which you
              do not sell on {selling}: ask them for a {selling} price, or you pay for it.
            </p>
          )}
          {gap.needed.length === 0 ? (
            <p className="flex items-center gap-1.5 text-xs text-ok">
              <CheckCircle2 className="size-3.5" aria-hidden /> Their price already covers {selling}: nothing to add.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {gap.needed.map((step) => {
                const c = costs[step] ?? { amount: "", currency: currency === "—" ? "USD" : currency, note: "" };
                const minor = convert(c);
                const filled = valid(c.amount) && Number(numberText(c.amount)) > 0;
                return (
                  <li key={step} className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_7rem_5.5rem_minmax(0,1fr)_auto] sm:items-center">
                    <span className="min-w-0">
                      <span className="block text-sm">{BASIS_STEP_LABEL[step]}</span>
                      <span className="block text-xs text-muted">{BASIS_STEP_HINT[step]}</span>
                    </span>
                    <Input
                      aria-label={`Option ${letter}: ${BASIS_STEP_LABEL[step]} cost`}
                      inputMode="decimal"
                      className="h-8 text-right tabular"
                      placeholder={asLine(step) ? "as a line" : "0.00"}
                      value={c.amount}
                      onChange={(e) => onChange(step, { amount: e.target.value })}
                    />
                    <CurrencySelect
                      aria-label={`Option ${letter}: ${BASIS_STEP_LABEL[step]} currency`}
                      compact
                      short
                      className="h-8"
                      value={c.currency}
                      onChange={(e) => {
                        // The amount follows the currency: CNY 3,550 → USD 500.00.
                        const to = e.target.value;
                        const amount = c.amount.trim() ? convertText(c.amount, c.currency, to, fx) : null;
                        onChange(step, { currency: to, ...(amount !== null ? { amount } : {}) });
                      }}
                    />
                    <Input
                      aria-label={`Option ${letter}: ${BASIS_STEP_LABEL[step]} note`}
                      className="h-8"
                      maxLength={200}
                      placeholder="Note, e.g. forwarder's quote"
                      value={c.note}
                      onChange={(e) => onChange(step, { note: e.target.value })}
                    />
                    <span className="flex items-center justify-end gap-2 text-xs whitespace-nowrap">
                      {filled ? (
                        minor === null ? (
                          <span className="text-warn">No rate for {c.currency}</span>
                        ) : (
                          <>
                            {c.currency !== currency && <span className="text-muted tabular">≈ {fmt(minor)}</span>}
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => onAsLine(step, minor)}
                              title="Show it to the customer as its own line (a charge) instead of inside the prices"
                            >
                              As a line
                            </Button>
                          </>
                        )
                      ) : asLine(step) ? (
                        <span className="text-muted">Shown as a line below</span>
                      ) : (
                        <span className="text-warn">Not entered yet</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {gap.needed.length > 0 && (
            <p className="text-xs text-muted">
              {extra.minor > 0 ? (
                <>
                  <span className="font-medium text-text">{fmt(extra.minor)}</span> added to Option {letter}&apos;s cost. &ldquo;Price all
                  at … %&rdquo; spreads it over the lines, so the prices cover it.
                </>
              ) : (
                "Enter what each step costs (a forwarder's quote is fine): it is added to the cost and spread over the prices."
              )}
              {extra.noRate && <span className="ml-1 text-warn">There is no exchange rate for {extra.noRate} in Settings.</span>}
              {gap.needed.some((x) => asLine(x)) && (
                <span className="mt-1 block text-warn">
                  A cost shown as its own line is no longer spread into the prices: price Option {letter} again (&ldquo;Price all at …
                  %&rdquo;) if you priced before moving it.
                </span>
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}
