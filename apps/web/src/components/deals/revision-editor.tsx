"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, Lock } from "lucide-react";
import { convertMinor, costSummary, documentTotals, formatMinor, fromMinor, fxRate, landedUnitCosts, marginPercent, priceForMargin, toMinor } from "@kebo/money";
import {
  BALANCE_TERMS,
  BALANCE_TERMS_LABEL,
  BASIS_STEP_HINT,
  BASIS_STEP_LABEL,
  basisGap,
  basisText,
  INCOTERMS,
  optionLetter,
  readyAgainst,
  type BalanceTerms,
  type BasisStep,
  type Incoterm,
} from "@kebo/shared";
import { AddCard, Badge, Button, ChecksBox, cn, Field, Input, Select, SelectCard, SelectCardList, StickyBar, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { OfferLine, QuoteOffers, RevisionDraft } from "@/lib/types-deals";
import { LineTable, type LineColumn } from "@/components/lines/line-table";
import { localLineHandlers } from "@/components/lines/local-lines";
import { ErrorText, numberText, rowKey } from "./form-bits";
import { convertText, rateSentence, type Fx } from "@/lib/fx";
import { date } from "@/lib/format";
import { CurrencySelect } from "@/components/common/currency-select";
import { PANEL_FORM, PanelFooter, PanelSection } from "@/components/common/panel";

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
  leadTime: string;
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
  depositPercent: string;
  balanceTerms: BalanceTerms;
  validUntil: string;
  paymentTerms: string;
  deliveryTerms: string;
  warranty: string;
  notes: string;
  options: OptionState[];
}

const str = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(v));
const money2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "");
export const valid = (v: string) => v.trim() !== "" && Number.isFinite(Number(numberText(v)));

export function fromDraft(d: RevisionDraft): EditorState {
  return {
    currency: d.currency,
    incoterm: d.incoterm,
    incotermPlace: str(d.incotermPlace),
    depositPercent: str(d.depositPercent),
    balanceTerms: d.balanceTerms,
    validUntil: d.validUntil,
    paymentTerms: str(d.paymentTerms),
    deliveryTerms: str(d.deliveryTerms),
    warranty: str(d.warranty),
    notes: str(d.notes),
    options: d.options.map((o, i) => ({
      key: `option-${i}`,
      factoryQuoteId: o.factoryQuoteId,
      leadTime: str(o.leadTime),
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
      costs: Object.fromEntries((o.costs ?? []).map((c) => [c.step, { amount: money2(Number(c.amount)), currency: c.currency, note: c.note ?? "" }])),
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

/**
 * An offer's lead time against the day the customer wants the goods, if we ordered today:
 * "45 days: ready about 29 Dec 2026, 9 days after the customer wants it". Null when either is not known.
 */
export function readyLine(leadTime: string | null | undefined, today: string | undefined, wantedBy: string | null | undefined): { text: string; late: boolean } | null {
  const r = today ? readyAgainst(leadTime, today, wantedBy) : null;
  if (!r) return null;
  const start = `${leadTime!.trim()}: ready about ${date(r.readyOn)}`;
  return r.late > 0 ? { text: `${start}, ${r.late} day${r.late === 1 ? "" : "s"} after the customer wants it`, late: true } : { text: `${start}, in time`, late: false };
}

/** What the factories of the ticked offers give as warranty ("Jiangsu gives 12 months · Henan Pack gives 18 months"), beside ours. */
export function factoryWarranties(s: EditorState, offers: QuoteOffers): string | null {
  const said = s.options
    .map((o) => offers.offers.find((x) => x.factoryQuoteId === o.factoryQuoteId))
    .filter((o): o is QuoteOffers["offers"][number] => !!o?.warranty?.trim())
    .map((o) => `${o.factory.name} gives ${o.warranty!.trim()}`);
  return said.length ? [...new Set(said)].join(" · ") : null;
}

/** Our unit price against the price the customer hopes for: "4.0% over" or "2.8% under" (null: no target, or no price yet). */
export function againstTarget(price: string, target: string | null | undefined): { text: string; over: boolean } | null {
  const t = Number(target);
  if (!target || !(t > 0) || !valid(price)) return null;
  const p = Number(numberText(price));
  if (!(p > 0)) return null;
  const diff = ((p - t) / t) * 100;
  if (Math.abs(diff) < 0.05) return { text: "on target", over: false };
  return { text: `${Math.abs(diff).toFixed(1)}% ${diff > 0 ? "over" : "under"}`, over: diff > 0 };
}

/** The customer's target for a line: the item it answers (or the item itself, when priced by hand). */
export const targetOf = (l: OfferLine, offers: QuoteOffers) => offers.items.find((i) => i.id === (l.requestedItemId ?? l.id))?.targetPrice ?? null;

export function payload(s: EditorState, offers: QuoteOffers) {
  const costsOf = (o: OptionState) =>
    (gapOf(o, offers, s.incoterm)?.needed ?? [])
      .filter((step) => valid(o.costs[step]?.amount ?? "") && Number(numberText(o.costs[step]!.amount)) > 0)
      .map((step) => ({ step, amount: numberText(o.costs[step]!.amount), currency: o.costs[step]!.currency.trim().toUpperCase(), note: o.costs[step]!.note }));
  return {
    currency: s.currency.trim().toUpperCase(),
    incoterm: s.incoterm,
    incotermPlace: s.incotermPlace,
    depositPercent: numberText(s.depositPercent),
    balanceTerms: s.balanceTerms,
    validUntil: s.validUntil,
    paymentTerms: s.paymentTerms,
    deliveryTerms: s.deliveryTerms,
    warranty: s.warranty,
    notes: s.notes,
    options: s.options.map((o) => ({
      factoryQuoteId: o.factoryQuoteId,
      leadTime: o.leadTime,
      discount: numberText(o.discount),
      prices: (linesOf(o, offers) ?? []).filter((l) => valid(o.prices[l.id] ?? "")).map((l) => ({ lineId: l.id, unitPrice: numberText(o.prices[l.id]!) })),
      charges: o.charges.map((c) => ({ type: c.type, description: c.description, quantity: numberText(c.quantity), unit: c.unit.trim() || "lot", unitPrice: numberText(c.unitPrice), unitCost: numberText(c.unitCost) || null })),
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
    ...o.charges.map((c) => ({ quantity: numberText(c.quantity) || 0, unitPrice: numberText(c.unitPrice) || 0, cost: valid(c.unitCost) ? numberText(c.unitCost) : null })),
  ];
  const totals = documentTotals(rows, numberText(o.discount) || 0);
  const extra = extraOf(o, offers, incoterm, currency);
  const costing = costSummary(
    rows.map((r) => ({ quantity: r.quantity, unitPriceMinor: toMinor(r.unitPrice), unitCostMinor: r.cost === null || r.cost === undefined ? null : toMinor(r.cost) })),
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
  return s.options.map((o) => ({ ...o, prices: priced(linesOf(o, offers) ?? [], o.prices, margin, extraOf(o, offers, s.incoterm, currency).minor) }));
}

/** A margin typed in the box: a number from 0 up to (not) 100. */
export function marginOf(text: string): number | null {
  const n = Number(numberText(text));
  return text.trim() !== "" && Number.isFinite(n) && n >= 0 && n < 100 ? n : null;
}

/**
 * The editor for a draft revision: terms, then the options (A, B…) the
 * customer chooses from. Each option is one factory's offer — its lines exactly
 * as the factory gave them, locked — and we set our prices, the discount, the
 * lead time and charges such as freight. Totals use the API's own maths
 * (@kebo/money); people who may see costs get costs and margins per line and
 * per option.
 */
/** The sheet look shared with the line tables: bordered cells, a grey header and row numbers. */
const SHEET = "w-full border-collapse text-sm [&_tr>*:first-child]:border-l-0 [&_tr>*:last-child]:border-r-0";
const HEAD = "h-8 border border-t-0 border-line bg-surface-2 px-2 text-left text-xs font-medium whitespace-nowrap text-text-2";
const CELL = "h-9 border border-line px-2 align-middle";

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
  footer,
  onCancel,
  part,
  initialOption = 0,
  startAdding = false,
  title,
  note,
  submitShort,
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
  /** Saved: given the answer, so a window can close without asking "Discard changes?". */
  onDone?: (state: ActionState) => void;
  /** Saving needs a change (editing an existing draft). */
  requireChanges?: boolean;
  /** Shown under the form, e.g. the draft's own actions; told whether there are unsaved changes. */
  footer?: (dirty: boolean) => ReactNode;
  onCancel?: () => void;
  /**
   * Only part of the form: "terms" (currency, delivery, validity, payment and
   * the printed terms — the Quotation step's terms panel) or "options" (the
   * options and their prices — Edit prices). The whole revision is saved
   * either way. Default: everything.
   */
  part?: "terms" | "options";
  /** The option open first (0 = A), and the "Add an option" list open at once. */
  initialOption?: number;
  startAdding?: boolean;
  /** The title over the whole form ("New revision R2"; default "R2"), and what it starts with under it. */
  title?: ReactNode;
  note?: ReactNode;
  /** The save button's words on a phone, when submitLabel is long ("Save draft"). */
  submitShort?: string;
}) {
  // The window of a first revision quotes every offer that has lines; the person unticks what they do not want.
  const startState = (): EditorState => {
    const st = fromDraft(initial);
    if (!tickAll) return st;
    const has = new Set(st.options.map((o) => o.factoryQuoteId));
    const more = initialOffers.offers
      .filter((o) => !has.has(o.factoryQuoteId) && o.lines.length > 0)
      .map((o) => ({ key: rowKey(), factoryQuoteId: o.factoryQuoteId, leadTime: o.leadTime ?? "", discount: "", prices: priced(o.lines, {}, initialOffers.defaultMargin), charges: [], costs: {} }));
    return { ...st, options: [...st.options, ...more] };
  };
  const [s, setS] = useState<EditorState>(startState);
  const [saved, setSaved] = useState(() => JSON.stringify(startState()));
  const [offers, setOffers] = useState(initialOffers);
  const [active, setActive] = useState(initialOption);
  const [adding, setAdding] = useState(startAdding);
  const row = useRef<HTMLDivElement>(null);
  const shown = useRef(active);
  useEffect(() => {
    if (shown.current === active) return;
    shown.current = active;
    row.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  const terms = part !== "options";
  /** The terms alone, in the Quotation step's side panel: sections and the panel's footer. */
  const inPanel = part === "terms";
  const options = part !== "terms";
  // The box starts with the margin the options have (the last revision's, or the usual one on a first quotation).
  const [margin, setMargin] = useState(() => startMargin(startState(), initialOffers));
  /** The margin every ticked offer was last priced at from the box in this window (said under it). */
  const [pricedAt, setPricedAt] = useState<number | null>(null);
  const dirty = JSON.stringify(s) !== saved;
  const set = <K extends keyof EditorState>(k: K, v: EditorState[K]) => setS((st) => ({ ...st, [k]: v }));
  const setOption = (i: number, patch: Partial<OptionState> | ((o: OptionState) => Partial<OptionState>)) =>
    setS((st) => ({ ...st, options: st.options.map((o, n) => (n === i ? { ...o, ...(typeof patch === "function" ? patch(o) : patch) } : o)) }));
  // A first revision says where a value came from, for as long as it still shows that value.
  const fromCustomer = initial.from?.currency === "customer" && s.currency.trim().toUpperCase() === initial.currency;
  const fromLast = initial.from?.delivery === "last_quotation";
  const lastWords = `from the last quotation to ${initial.from?.customer ?? "this customer"}${initial.from?.lastQuotation ? ` (${initial.from.lastQuotation})` : ""}`;

  const currency = /^[A-Za-z]{3}$/.test(s.currency.trim()) ? s.currency.trim().toUpperCase() : "—";
  const fmt = (minor: number) => formatMinor(minor, currency);
  const amountOf = (v: string | undefined) => (valid(v ?? "") ? toMinor(numberText(v ?? "")) : 0);
  const chargeColumns: LineColumn[] = [
    { key: "description", label: "Charge", width: "minmax(0,1fr)", input: "textarea", required: "Each charge needs a description", placeholder: "e.g. Sea freight to Mombasa" },
    { key: "quantity", label: "Qty", width: "4.5rem", input: "number", align: "right", initial: "1", required: "Enter a quantity" },
    { key: "unit", label: "Unit", width: "5.5rem", input: "unit", initial: "lot", maxLength: 20 },
    ...(showCosts
      ? [
          {
            key: "unitCost",
            label: "Our cost",
            width: "6.5rem",
            input: "number" as const,
            align: "right" as const,
            placeholder: "Cost",
            format: (v: Record<string, string>) => (v.unitCost ? fmt(amountOf(v.unitCost)) : <span className="text-muted">—</span>),
          },
        ]
      : []),
    { key: "unitPrice", label: "Price", width: "7rem", input: "number", align: "right", placeholder: "0.00", required: "Enter a price", format: (v) => fmt(amountOf(v.unitPrice)) },
    { key: "total", label: "Total", width: "7.5rem", align: "right", format: (v) => fmt(Math.round(amountOf(v.unitPrice) * (Number(numberText(v.quantity ?? "")) || 0))) },
  ];
  const marginNumber = Number(numberText(margin));
  const marginOk = marginOf(margin) !== null;
  /**
   * The margin box of the window that starts a revision: a margin typed there prices every ticked offer at
   * once, so the totals beside each offer are the ones that will be saved. (It used to price only an offer
   * ticked afterwards: typing a margin and saving changed nothing.)
   */
  const priceEveryOffer = (text: string) => {
    setMargin(text);
    const m = marginOf(text);
    if (m === null) return;
    setS((st) => ({ ...st, options: pricedAll(st, offers, m) }));
    setPricedAt(m);
  };
  const opt = s.options[Math.min(active, s.options.length - 1)]!;
  const at = s.options.indexOf(opt);

  const totalsOf = (o: OptionState) => optionTotals(o, offers, s.incoterm, currency);

  // The list keeps the order it opened with (options A, B… first, then the other offers), so a tick never moves a row.
  const [firstOrder] = useState(() => s.options.map((o) => o.factoryQuoteId));
  const place = (id: string) => { const i = firstOrder.indexOf(id); return i < 0 ? firstOrder.length : i; };
  const listed = [...offers.offers].sort((a, b) => place(a.factoryQuoteId) - place(b.factoryQuoteId));

  // What can still be added: offers not used yet, and the customer's items when no option uses them.
  const used = new Set(s.options.map((o) => o.factoryQuoteId ?? "items"));
  const addable = [
    ...offers.offers.filter((o) => !used.has(o.factoryQuoteId)),
    ...(!used.has("items") ? [null] : []),
  ];
  const addOption = (factoryQuoteId: string | null) => {
    const offer = offers.offers.find((o) => o.factoryQuoteId === factoryQuoteId);
    const lines = offer?.lines ?? offers.items.map((i) => ({ ...i, requestedItemId: i.id, answersNo: i.no, unitCost: null }));
    setS((st) => ({
      ...st,
      options: [...st.options, { key: rowKey(), factoryQuoteId, leadTime: offer?.leadTime ?? "", discount: "", prices: priced(lines, {}, marginOk ? marginNumber : offers.defaultMargin), charges: [], costs: {} }],
    }));
    setActive(s.options.length);
    setAdding(false);
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
    const origin = typedIn.current && JSON.stringify(s.options) === typedIn.current.shown ? typedIn.current : { currency: now, options: s.options, shown: "" };
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
        ? { ok: true, text: from === to ? `Back in ${to}: the prices as they were typed.` : `Prices, discounts and charges converted from ${now} at ${rateSentence(fx, now, to)}.` }
        : { ok: false, text: `No exchange rate between ${now} and ${to} in Settings: the numbers were kept as they are.` },
    );
    if (loadOffers && to !== offers.currency) {
      const next = await loadOffers(to);
      if (next) setOffers(next);
    }
  };

  const { lines, totals, costing, extra } = totalsOf(opt);
  const landed = landedUnitCosts(
    lines.map((l) => ({ unitCostMinor: l.unitCost === null ? null : toMinor(l.unitCost), quantity: numberText(l.quantity) || 0 })),
    extra.minor,
  );
  const offer = opt.factoryQuoteId ? offers.offers.find((o) => o.factoryQuoteId === opt.factoryQuoteId) : null;
  const coverage = opt.factoryQuoteId ? offer?.coverage : { covered: offers.items.filter((i) => !i.parentId).map((i) => i.no), missing: [] };
  const costed = lines.filter((l) => l.unitCost !== null).length;
  const itemName = (no: string) => offers.items.find((i) => i.no === no)?.description.split("\n")[0] ?? "";

  /** What to look at before the revision goes to the customer, per option. */
  const checksOf = (o: OptionState, i: number): { key: string; text: ReactNode }[] => {
    const L = optionLetter(i);
    const t = totalsOf(o);
    const out: { key: string; text: ReactNode }[] = [];
    const off = o.factoryQuoteId ? offers.offers.find((x) => x.factoryQuoteId === o.factoryQuoteId) : null;
    if (o.factoryQuoteId && !off) out.push({ key: "gone", text: <>its factory offer was removed: remove this option or choose another offer.</> });
    const unpriced = t.lines.filter((l) => !(valid(o.prices[l.id] ?? "") && Number(numberText(o.prices[l.id]!)) > 0)).length;
    if (unpriced) out.push({ key: "price", text: <>{unpriced} line{unpriced === 1 ? "" : "s"} without a price.</> });
    if (off?.coverage.missing.length)
      out.push({
        key: "cover",
        text: (
          <>
            does not include {off.coverage.missing.map((n) => `${n}${itemName(n) ? ` ${itemName(n)}` : ""}`).join(", ")}; the customer will see {off.coverage.missing.length === 1 ? "it" : "them"} missing.
          </>
        ),
      });
    if (showCosts && off) {
      if (!gapOf(o, offers, s.incoterm)) out.push({ key: "basis", text: <>the factory&apos;s price basis is not said, so the costs to reach {s.incoterm} cannot be worked out.</> });
      else if (t.extra.empty.length)
        out.push({
          key: "costs",
          text: (
            <>
              {t.extra.empty.map((x) => BASIS_STEP_LABEL[x].toLowerCase()).join(" and ")} to reach {s.incoterm} {t.extra.empty.length === 1 ? "is" : "are"} not entered, so its cost and margin are too
              low.
            </>
          ),
        });
    }
    if (showCosts && t.costing.marginPercent !== null && t.costing.marginPercent < 0) out.push({ key: "loss", text: <>it sells below cost.</> });
    return out.map((c) => ({ key: `${o.key}-${c.key}`, text: <><b>Option {L}</b>{c.key === "price" || c.key === "gone" ? ": " : " "}{c.text}</> }));
  };
  const optChecks = checksOf(opt, at);
  const cancel = () => (!dirty || window.confirm("Leave without saving? Your changes will be lost.")) && onCancel?.();
  const letter = optionLetter(at);
  /** Section numbers when the form has both parts ("1 · Terms", "2 · Options for the customer"). */
  const both = terms && options;
  const nOffers = addable.filter(Boolean).length;
  const margined = (m: number | null) => (m === null ? "text-muted" : m < 0 ? "text-bad" : m < 5 ? "text-warn" : "text-ok");

  /** The price box of a line: Enter and the arrows move like a spreadsheet; a column pasted from Excel fills down. */
  const priceBox = (l: OfferLine, i: number, attr: "data-price" | "data-price-m", className: string) => (
    <input
      aria-label={`Unit price for ${l.no}`}
      {...{ [attr]: `${at}:${i}` }}
      inputMode="decimal"
      className={className}
      value={opt.prices[l.id] ?? ""}
      placeholder="0.00"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setOption(at, (o) => ({ prices: { ...o.prices, [l.id]: e.target.value } }))}
      onKeyDown={(e) => {
        // Like a spreadsheet: Enter and the arrows go to the price above or below.
        const to = e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey) ? i + 1 : e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey) ? i - 1 : null;
        if (to === null) return;
        const next = document.querySelector<HTMLInputElement>(`[${attr}="${at}:${to}"]`);
        e.preventDefault();
        next?.focus();
      }}
      onPaste={(e) => {
        // A column of prices copied from Excel fills this line and the ones below.
        const values = e.clipboardData.getData("text/plain").replace(/\r?\n$/, "").split(/\r?\n/).map((v) => v.split("\t")[0]!.trim());
        if (values.length < 2) return;
        e.preventDefault();
        setOption(at, (o) => {
          const prices = { ...o.prices };
          values.forEach((v, n) => {
            const target = lines[i + n];
            if (target) prices[target.id] = v.replace(/[^\d.,-]/g, "");
          });
          return { prices };
        });
      }}
    />
  );

  return (
    <>
      <ActionForm
        action={action}
        onDone={(state) => {
          setSaved(JSON.stringify(s));
          onDone?.(state);
        }}
        className={inPanel ? PANEL_FORM : "flex flex-col gap-4"}
      >
        {(st) => (
          <>
            <input type="hidden" name="payload" value={JSON.stringify(payload(s, offers))} />

            {terms && inPanel && (
              <>
                <PanelSection title="Options: which offers to quote" first className="sm:grid-cols-1">
                  <ul className="flex flex-col divide-y divide-line rounded-xl border border-line" aria-label="Factory offers">
                    {listed.map((off) => {
                      const i = s.options.findIndex((o) => o.factoryQuoteId === off.factoryQuoteId);
                      const on = i >= 0;
                      const t = on ? totalsOf(s.options[i]!) : null;
                      const none = off.lines.length === 0;
                      const last = on && s.options.length === 1;
                      // Its lead time against the day the customer wants the goods (when both are known).
                      const ready = none ? null : readyLine(off.leadTime, offers.today, offers.wantedBy);
                      const facts = [
                        none ? "No lines yet: add its lines on Factory offers to quote it" : off.coverage.missing.length ? `Does not include item ${off.coverage.missing.join(", ")}` : "Covers every item",
                        ready ? null : off.leadTime,
                        showCosts && off.totalCost ? `cost ${formatMinor(toMinor(off.totalCost), currency)}` : null,
                        showCosts && t && t.costing.marginPercent !== null ? `margin ${t.costing.marginPercent.toFixed(1)}%` : null,
                      ].filter(Boolean);
                      return (
                        <li key={off.factoryQuoteId}>
                          <label className={cn("flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm", none && "cursor-default opacity-60")} title={last ? "A quotation keeps at least one option" : undefined}>
                            <input
                              type="checkbox"
                              className="size-[18px] shrink-0 accent-primary"
                              checked={on}
                              disabled={none || last}
                              onChange={() => (on ? setS((x) => ({ ...x, options: x.options.filter((o) => o.factoryQuoteId !== off.factoryQuoteId) })) : addOption(off.factoryQuoteId))}
                            />
                            <span className="w-4 shrink-0 font-bold">{on ? optionLetter(i) : ""}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold">{off.factory.name}</span>
                              <span className="block text-xs text-text-2">{facts.join(" · ")}</span>
                              {ready && <span className={cn("block text-xs font-medium", ready.late ? "text-bad" : "text-ok")}>{ready.text}</span>}
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
                            onChange={() => (s.options.some((o) => o.factoryQuoteId === null) ? setS((x) => ({ ...x, options: x.options.filter((o) => o.factoryQuoteId !== null) })) : addOption(null))}
                          />
                          <span className="w-4 shrink-0 font-bold">{s.options.some((o) => o.factoryQuoteId === null) ? optionLetter(s.options.findIndex((o) => o.factoryQuoteId === null)) : ""}</span>
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
                        <Input id={`margin-${number}`} inputMode="decimal" className="h-9 w-16 text-right tabular" value={margin} onChange={(e) => priceEveryOffer(e.target.value)} />
                        <span>% on our cost. Each price can be changed after, in Edit lines.</span>
                      </p>
                      {pricedAt !== null && marginOk && (
                        <p role="status" className="text-text">
                          {s.options.length === 1 ? "The offer is" : `All ${s.options.length} offers are`} priced at {pricedAt}% now: the totals above are the new ones. Prices typed by hand before are replaced when you save.
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
                        {o.factoryQuoteId ? ` (${offers.offers.find((x) => x.factoryQuoteId === o.factoryQuoteId)?.factory.name ?? "its offer"})` : ""} and the prices you set for it will be removed when
                        you save.
                      </p>
                    ))}
                  <ErrorText error={st.errors?.options} />
                </PanelSection>
                <PanelSection title="The deal">
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
                  <Field label="Delivery (incoterm)" htmlFor={`inco-${number}`} error={st.errors?.incoterm} hint={fromLast && s.incoterm === initial.incoterm ? lastWords : undefined}>
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
                    hint={fromLast && initial.incotermPlace && s.incotermPlace === initial.incotermPlace ? lastWords : "The port or place for the incoterm"}
                  >
                    <Input id={`place-${number}`} value={s.incotermPlace} maxLength={80} placeholder="e.g. Karachi" onChange={(e) => set("incotermPlace", e.target.value)} />
                  </Field>
                </PanelSection>
                <PanelSection title="Payment">
                  <Field label="Deposit" htmlFor={`dep-${number}`} error={st.errors?.depositPercent} hint="% of the total, before production">
                    <div className="relative">
                      <Input id={`dep-${number}`} inputMode="decimal" className="pr-8 tabular" value={s.depositPercent} onChange={(e) => set("depositPercent", e.target.value)} />
                      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted">%</span>
                    </div>
                  </Field>
                  <Field label="Balance" htmlFor={`bal-${number}`} error={st.errors?.balanceTerms} hint="or against the B/L copy, or by LC">
                    <Select id={`bal-${number}`} value={s.balanceTerms} onChange={(e) => set("balanceTerms", e.target.value as BalanceTerms)}>
                      {BALANCE_TERMS.map((b) => (
                        <option key={b} value={b}>
                          {BALANCE_TERMS_LABEL[b]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </PanelSection>
                <PanelSection title="Printed on the quotation">
                  <Field label="Payment terms" htmlFor={`pay-terms-${number}`} optional error={st.errors?.paymentTerms} hint="Printed after the deposit and balance">
                    <Textarea id={`pay-terms-${number}`} rows={2} className="min-h-0" placeholder="e.g. By T/T; L/C at sight accepted" value={s.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} />
                  </Field>
                  <Field label="Delivery terms" htmlFor={`del-terms-${number}`} optional error={st.errors?.deliveryTerms} hint="Printed under the delivery time">
                    <Textarea id={`del-terms-${number}`} rows={2} className="min-h-0" placeholder="e.g. packing, inspection" value={s.deliveryTerms} onChange={(e) => set("deliveryTerms", e.target.value)} />
                  </Field>
                  <Field
                    label="Warranty"
                    htmlFor={`warranty-${number}`}
                    optional
                    error={st.errors?.warranty}
                    hint={showCosts && factoryWarranties(s, offers) ? factoryWarranties(s, offers) : "Starts from the company's usual warranty; change it for this quotation"}
                  >
                    <Input id={`warranty-${number}`} maxLength={300} placeholder="e.g. 12 months from commissioning" value={s.warranty} onChange={(e) => set("warranty", e.target.value)} />
                  </Field>
                  <Field label="Notes" htmlFor={`notes-${number}`} optional error={st.errors?.notes} hint="Printed last">
                    <Textarea id={`notes-${number}`} rows={3} className="min-h-0" placeholder="Prices include export wooden cases…" value={s.notes} onChange={(e) => set("notes", e.target.value)} />
                  </Field>
                </PanelSection>
              </>
            )}

            {!inPanel && (
              <div className={cn(both && "rounded-xl border border-line bg-surface shadow-card")}>
                {/* The title, what it starts with, and the date the whole quotation is valid until. */}
                {terms && (
                  <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-line px-4 py-3.5 sm:px-5">
                    <div className="min-w-0 flex-1 basis-80">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-lg font-semibold">{title ?? `R${number}`}</h3>
                        {onCancel && (
                          <Button size="sm" variant="ghost" className="-mr-2 sm:hidden" onClick={cancel}>
                            Cancel
                          </Button>
                        )}
                      </div>
                      {note && <p className="mt-0.5 text-xs text-text-2">{note}</p>}
                    </div>
                    <Field label="Valid until" htmlFor={`valid-${number}`} error={st.errors?.validUntil} hint="the whole quotation" className="w-44 max-sm:w-full">
                      <Input id={`valid-${number}`} type="date" value={s.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
                    </Field>
                  </div>
                )}

                <div className={cn("flex flex-col gap-6", both && "p-4 sm:p-5")}>
                  {terms && (
                    <section aria-labelledby={`terms-${number}`} className="flex flex-col gap-3">
                      <SectionTitle id={`terms-${number}`} n={1} sub="for every option in this revision">
                        Terms
                      </SectionTitle>
                      {/* Two kinds of terms: side by side on a wide screen, one under the other on a phone. */}
                      <div className="grid gap-4 lg:grid-cols-2">
                        <TermsGroup id={`pay-${number}`} title="Payment terms">
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                            <Field
                              label="Currency"
                              htmlFor={`cur-${number}`}
                              error={st.errors?.currency}
                              hint={converted ? <span className={converted.ok ? undefined : "text-warn"}>{converted.text}</span> : "Changing it converts the prices at the Settings rates"}
                              className="col-span-2 sm:col-span-1 lg:col-span-2 xl:col-span-1"
                            >
                              <CurrencySelect id={`cur-${number}`} value={s.currency} onChange={(e) => void changeCurrency(e.target.value)} />
                            </Field>
                            <Field label="Deposit %" htmlFor={`dep-${number}`} error={st.errors?.depositPercent}>
                              <Input id={`dep-${number}`} inputMode="decimal" className="tabular" value={s.depositPercent} onChange={(e) => set("depositPercent", e.target.value)} />
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
                          </div>
                          <Field label="Printed payment terms" htmlFor={`pay-terms-${number}`} optional error={st.errors?.paymentTerms} hint="Printed after the deposit and balance">
                            <Textarea id={`pay-terms-${number}`} rows={2} className="min-h-0" placeholder="e.g. By T/T; L/C at sight accepted" value={s.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} />
                          </Field>
                        </TermsGroup>
                        <TermsGroup id={`del-${number}`} title="Delivery terms">
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Incoterm" htmlFor={`inco-${number}`} error={st.errors?.incoterm}>
                              <Select id={`inco-${number}`} value={s.incoterm} onChange={(e) => set("incoterm", e.target.value as Incoterm)}>
                                {INCOTERMS.map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                            <Field label="Place" htmlFor={`place-${number}`} optional error={st.errors?.incotermPlace} hint="Port or place for the Incoterm">
                              <Input id={`place-${number}`} value={s.incotermPlace} maxLength={80} placeholder="e.g. Qingdao" onChange={(e) => set("incotermPlace", e.target.value)} />
                            </Field>
                          </div>
                          <Field label="Printed delivery terms" htmlFor={`del-terms-${number}`} optional error={st.errors?.deliveryTerms} hint="Printed under the delivery time">
                            <Textarea id={`del-terms-${number}`} rows={2} className="min-h-0" placeholder="e.g. packing, inspection" value={s.deliveryTerms} onChange={(e) => set("deliveryTerms", e.target.value)} />
                          </Field>
                          <Field label="Warranty" htmlFor={`warranty-${number}`} optional error={st.errors?.warranty} hint="Printed on the quotation">
                            <Input id={`warranty-${number}`} maxLength={300} placeholder="e.g. 12 months from commissioning" value={s.warranty} onChange={(e) => set("warranty", e.target.value)} />
                          </Field>
                        </TermsGroup>
                      </div>
                      <Field label="Notes" htmlFor={`notes-${number}`} optional error={st.errors?.notes} hint="Printed last, on the whole quotation">
                        <Textarea id={`notes-${number}`} rows={2} className="min-h-0" placeholder="e.g. Warranty 12 months from SAT; prices include export wooden cases" value={s.notes} onChange={(e) => set("notes", e.target.value)} />
                      </Field>
                    </section>
                  )}

                  {both && <hr className="border-line" />}

                  {options && (
                    <section aria-labelledby={`options-${number}`} className="flex flex-col gap-3">
                      <SectionTitle id={`options-${number}`} n={both ? 2 : null} sub="each option is one factory's offer · the customer accepts one · click an option to work on it">
                        Options for the customer
                      </SectionTitle>

                      {/* The options as a row of cards on top; on a phone the row scrolls sideways. */}
                      <div ref={row}>
                        <SelectCardList label="Options" className="sm:mx-0 sm:scroll-px-0 sm:flex-wrap sm:overflow-visible sm:px-0.5">
                          {s.options.map((o, i) => {
                            const t = totalsOf(o);
                            const off = o.factoryQuoteId ? offers.offers.find((x) => x.factoryQuoteId === o.factoryQuoteId) : null;
                            const n = checksOf(o, i).length;
                            return (
                              <SelectCard
                                key={o.key}
                                title={`Option ${optionLetter(i)}`}
                                figure={fmt(t.totals.total)}
                                meta={`${o.factoryQuoteId ? (off?.factory.name ?? "A removed offer") : "The customer's items"}${o.leadTime ? ` · ${o.leadTime}` : ""}`}
                                badges={
                                  <>
                                    {showCosts && t.costing.marginPercent !== null && <Badge tone={t.costing.marginPercent < 0 ? "bad" : "neutral"}>margin {t.costing.marginPercent.toFixed(1)}%</Badge>}
                                    {n ? <Badge tone="warn">{n} to check</Badge> : <Badge tone="ok">Ready</Badge>}
                                  </>
                                }
                                selected={i === at}
                                onSelect={() => setActive(i)}
                              />
                            );
                          })}
                          {addable.length > 0 && (
                            <AddCard
                              expanded={adding}
                              onClick={() => setAdding((v) => !v)}
                              hint={nOffers ? `${nOffers} more offer${nOffers === 1 ? "" : "s"} to add` : "the customer's items, by hand"}
                            >
                              Add an option
                            </AddCard>
                          )}
                        </SelectCardList>
                      </div>

                      {adding && (
                        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line" aria-label="Offers to add">
                          {addable.map((o) => (
                            <li key={o?.factoryQuoteId ?? "items"} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                              <span className="min-w-0">
                                <span className="font-medium">{o ? o.factory.name : "The customer's items, priced by hand"}</span>
                                <span className="block text-xs text-muted">
                                  {o
                                    ? `${o.lines.length} line${o.lines.length === 1 ? "" : "s"}${o.leadTime ? ` · ${o.leadTime}` : ""}${o.totalCost ? ` · cost ${formatMinor(toMinor(o.totalCost), currency)}` : ""}`
                                    : "No factory prices: the items as the customer asked for them"}
                                </span>
                              </span>
                              <span className="flex items-center gap-2">
                                {o && <CoverageBadge missing={o.coverage.missing} />}
                                <Button size="xs" variant="secondary" onClick={() => addOption(o?.factoryQuoteId ?? null)}>
                                  Add as Option {optionLetter(s.options.length)}
                                </Button>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {/* The chosen option, full width. */}
                      <div role="tabpanel" aria-label={`Option ${letter}`} className="flex min-w-0 flex-col rounded-xl border border-primary/60 bg-surface">
                        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-3 py-3 sm:px-4">
                          <div className="min-w-0">
                            <p className="text-base font-semibold">
                              Option {letter} · {opt.factoryQuoteId ? (offer?.factory.name ?? "an offer that was removed") : "the customer's items"}
                            </p>
                            {coverage && (
                              <p className="mt-0.5 text-xs">
                                {coverage.missing.length ? (
                                  <span className="flex items-start gap-1 text-warn">
                                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                                    Does not cover {coverage.missing.map((n) => `${n} (${itemName(n)})`).join(", ")}
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1 text-ok">
                                    <CheckCircle2 className="size-3.5" aria-hidden /> Covers everything the customer asked for
                                  </span>
                                )}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                            {showCosts && (
                              <span className="flex items-center gap-2">
                                <label htmlFor={`margin-${number}`} className="text-xs text-text-2">
                                  Price all at
                                </label>
                                <Input id={`margin-${number}`} inputMode="decimal" className="h-8 w-16 text-right tabular" value={margin} onChange={(e) => setMargin(e.target.value)} />
                                <span className="text-sm text-muted">%</span>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  aria-label={`Price every line of Option ${letter} at ${marginOk ? marginNumber : "…"}%`}
                                  onClick={() => marginOk && setOption(at, (o) => ({ prices: priced(lines, o.prices, marginNumber, extraOf(o, offers, s.incoterm, currency).minor) }))}
                                  disabled={!marginOk || costed === 0}
                                >
                                  Apply
                                </Button>
                                <span className="mx-1 h-6 w-px bg-line max-sm:hidden" aria-hidden />
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                disabled={at === 0}
                                aria-label={`Move option ${letter} left`}
                                onClick={() => {
                                  setS((x) => ({ ...x, options: swap(x.options, at, at - 1) }));
                                  setActive(at - 1);
                                }}
                              >
                                <ArrowLeft aria-hidden />
                              </Button>
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                disabled={at === s.options.length - 1}
                                aria-label={`Move option ${letter} right`}
                                onClick={() => {
                                  setS((x) => ({ ...x, options: swap(x.options, at, at + 1) }));
                                  setActive(at + 1);
                                }}
                              >
                                <ArrowRight aria-hidden />
                              </Button>
                              <Button
                                size="xs"
                                variant="danger-ghost"
                                disabled={s.options.length === 1}
                                title={s.options.length === 1 ? "A quotation keeps at least one option" : undefined}
                                aria-label={`Remove option ${letter}`}
                                onClick={() => {
                                  setS((x) => ({ ...x, options: x.options.filter((_, n) => n !== at) }));
                                  setActive(Math.max(0, at - 1));
                                }}
                              >
                                Remove
                              </Button>
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-col gap-4 p-3 sm:p-4">
                          <ChecksBox
                            title={`Before you send R${number}`}
                            items={optChecks}
                            ready={
                              <>
                                <b className="text-ok">Ready to send.</b> Every line has a price{showCosts && opt.factoryQuoteId ? ` and the costs to reach ${s.incoterm} are in` : ""}.
                              </>
                            }
                          />

                          {lines.length === 0 && opt.factoryQuoteId && !offer && (
                            <p className="rounded-md bg-warn-soft px-3 py-2 text-sm">This factory offer was removed from the inquiry. Remove this option or choose another offer.</p>
                          )}

                          {/* Wide: every column in view (no sideways scroll from 1024px). */}
                          <div className="relative overflow-x-auto rounded-lg border border-line bg-surface max-sm:hidden">
                            <table className={cn(SHEET, "min-w-[640px] lg:min-w-0")} aria-label={`Option ${letter} prices`}>
                              <thead>
                                <tr>
                                  <th className={cn(HEAD, "w-12 text-center")}>No.</th>
                                  <th className={HEAD}>Description</th>
                                  <th className={cn(HEAD, "w-24 text-right")}>Qty</th>
                                  {showCosts && <th className={cn(HEAD, "w-28 text-right")}>{extra.minor > 0 ? "Landed cost" : "Cost"}</th>}
                                  <th className={cn(HEAD, "w-36 text-right")}>Unit price ({currency})</th>
                                  {showCosts && <th className={cn(HEAD, "w-20 text-right")}>Margin</th>}
                                  <th className={cn(HEAD, "w-32 text-right")}>Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lines.map((l, i) => {
                                  const price = opt.prices[l.id] ?? "";
                                  // On the landed cost: the factory's cost plus this line's share of the costs to reach our basis.
                                  const cost = landed[i] ?? null;
                                  const m = showCosts && cost !== null && valid(price) && Number(numberText(price)) > 0 ? marginPercent(toMinor(numberText(price)), cost) : null;
                                  return (
                                    <tr key={l.id}>
                                      <th scope="row" className={cn(CELL, "bg-surface-2 text-center text-xs font-normal text-muted tabular")}>
                                        {l.no}
                                      </th>
                                      <td className={cn(CELL, "py-1.5")}>
                                        <span className="block whitespace-pre-line">{l.description}</span>
                                        <span className="block text-xs text-muted">
                                          {[l.model, opt.factoryQuoteId && l.answersNo ? `for item ${l.answersNo}` : null].filter(Boolean).join(" · ")}
                                        </span>
                                      </td>
                                      <td className={cn(CELL, "bg-surface-2/40 text-right whitespace-nowrap text-text-2 tabular")}>
                                        {Number(l.quantity).toLocaleString("en-US", { maximumFractionDigits: 2 })} {l.unit}
                                      </td>
                                      {showCosts && (
                                        <td className={cn(CELL, "bg-surface-2/40 text-right whitespace-nowrap text-text-2 tabular")}>
                                          {cost === null ? "—" : fmt(cost)}
                                          {cost !== null && extra.minor > 0 && l.unitCost !== null && (
                                            <span className="block text-xs text-muted" title={`Factory ${fmt(toMinor(l.unitCost))} + its share of the costs to reach ${s.incoterm}`}>
                                              factory {fmt(toMinor(l.unitCost))}
                                            </span>
                                          )}
                                        </td>
                                      )}
                                      <td className={cn(CELL, "p-0")}>
                                        {priceBox(
                                          l,
                                          i,
                                          "data-price",
                                          "block h-9 w-full min-w-0 border-0 bg-transparent px-2 text-right text-sm tabular outline-none placeholder:text-muted/70 focus:bg-surface focus:ring-2 focus:ring-primary focus:ring-inset",
                                        )}
                                      </td>
                                      {showCosts && <td className={cn(CELL, "text-right font-medium tabular", margined(m))}>{m === null ? "—" : `${m.toFixed(1)}%`}</td>}
                                      <td className={cn(CELL, "bg-surface-2/40 text-right font-semibold whitespace-nowrap tabular")}>{fmt(totals.lines[i]?.lineTotal ?? 0)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          {/* Phone: one row per line, its price box on the right (as on Edit prices). */}
                          <ul className="flex flex-col divide-y divide-line sm:hidden" aria-label={`Option ${letter} prices`}>
                            {lines.map((l, i) => {
                              const price = opt.prices[l.id] ?? "";
                              const cost = landed[i] ?? null;
                              const m = showCosts && cost !== null && valid(price) && Number(numberText(price)) > 0 ? marginPercent(toMinor(numberText(price)), cost) : null;
                              return (
                                <li key={l.id} className={cn("flex items-center gap-3 py-2.5", l.no.includes(".") && "pl-3")}>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm">
                                      <span className="text-xs text-muted tabular">{l.no}</span> {l.description.split("\n")[0]}
                                    </span>
                                    <span className="block text-xs text-text-2 tabular">
                                      {Number(l.quantity).toLocaleString("en-US", { maximumFractionDigits: 2 })} {l.unit}
                                      {showCosts && cost !== null ? ` · cost ${fmt(cost)}` : ""}
                                      {showCosts && m !== null && <span className={margined(m)}> · {m.toFixed(1)}%</span>}
                                    </span>
                                  </span>
                                  {priceBox(
                                    l,
                                    i,
                                    "data-price-m",
                                    "h-9 w-28 shrink-0 rounded-lg border border-line bg-surface px-3 text-right text-sm tabular outline-none placeholder:text-muted/70 focus:border-primary focus:ring-2 focus:ring-primary/30",
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                          <p className="text-xs text-muted">
                            Type a price and press Enter for the next line; a column of prices copied from Excel fills the lines below. The factory&apos;s lines
                            themselves change on Factory offers.
                          </p>
                          {showCosts && opt.factoryQuoteId && (
                            <BasisCosts
                              letter={letter}
                              factoryBasis={offer?.basis ?? null}
                              factoryPlace={offer?.basisPlace ?? null}
                              selling={s.incoterm}
                              sellingPlace={s.incotermPlace}
                              currency={currency}
                              fx={fx}
                              costs={opt.costs}
                              extra={extra}
                              asLine={(step) => asLineOf(opt, step)}
                              convert={(c) => {
                                const rate = /^[A-Z]{3}$/.test(currency) && valid(c.amount) ? fxRate(c.currency.trim().toUpperCase(), currency, offers.mainCurrency, offers.rates) : null;
                                return rate === null ? null : convertMinor(toMinor(numberText(c.amount)), rate);
                              }}
                              fmt={fmt}
                              onChange={(step, patch) =>
                                setOption(at, (o) => ({
                                  costs: { ...o.costs, [step]: { ...(o.costs[step] ?? { amount: "", currency: currency === "—" ? "USD" : currency, note: "" }), ...patch } },
                                }))
                              }
                              onAsLine={(step, costMinor) =>
                                setOption(at, (o) => ({
                                  costs: { ...o.costs, [step]: { amount: "", currency: o.costs[step]?.currency ?? currency, note: "" } },
                                  charges: [
                                    ...o.charges,
                                    {
                                      key: rowKey(),
                                      parentKey: null,
                                      type: "charge",
                                      description: STEP_LINE[step](s.incotermPlace.trim()),
                                      quantity: "1",
                                      unit: "lot",
                                      unitCost: fromMinor(costMinor),
                                      unitPrice: fromMinor(priceForMargin(costMinor, marginOk ? marginNumber : offers.defaultMargin)),
                                    },
                                  ],
                                }))
                              }
                            />
                          )}
                          <section aria-label="Charges" className="flex flex-col gap-1.5">
                            <h4 className="text-sm font-medium">
                              Charges <span className="text-xs font-normal text-muted">freight, inspection, insurance… our own price{showCosts ? ", and cost if known" : ""}</span>
                            </h4>
                            <LineTable
                              flat
                              noun="charge"
                              rows={opt.charges.map((c) => ({
                                key: c.key,
                                parentKey: null,
                                values: { description: c.description, quantity: c.quantity, unit: c.unit, unitCost: c.unitCost, unitPrice: c.unitPrice },
                              }))}
                              columns={chargeColumns}
                              {...localLineHandlers(
                                opt.charges,
                                (fn) => setOption(at, (o) => ({ charges: fn(o.charges) })),
                                (values) => ({
                                  key: rowKey(),
                                  parentKey: null,
                                  type: "charge" as const,
                                  description: values.description ?? "",
                                  quantity: values.quantity || "1",
                                  unit: values.unit || "lot",
                                  unitPrice: values.unitPrice ?? "",
                                  unitCost: values.unitCost ?? "",
                                }),
                                (row, values) => ({ ...row, ...values }),
                              )}
                            />
                          </section>
                          <ErrorText error={st.errors?.options} />

                          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                            <Field label="Lead time" htmlFor={`lead-${opt.key}`} optional hint="For this option, e.g. 45 days after deposit">
                              <Input id={`lead-${opt.key}`} value={opt.leadTime} maxLength={120} onChange={(e) => setOption(at, { leadTime: e.target.value })} />
                            </Field>
                            <div className="flex flex-col gap-3">
                              <dl className="rounded-lg border border-line p-3 text-sm">
                                <div className="flex justify-between py-1">
                                  <dt className="text-muted">Subtotal</dt>
                                  <dd className="tabular">{fmt(totals.subtotal)}</dd>
                                </div>
                                <div className="flex items-center justify-between gap-3 py-1">
                                  <dt>
                                    <label htmlFor={`disc-${opt.key}`} className="text-muted">
                                      Discount
                                    </label>
                                  </dt>
                                  <dd>
                                    <Input id={`disc-${opt.key}`} inputMode="decimal" className="h-8 w-32 text-right tabular" value={opt.discount} placeholder="0.00" onChange={(e) => setOption(at, { discount: e.target.value })} />
                                  </dd>
                                </div>
                                <div className="mt-1 flex justify-between border-t border-line pt-2 text-base font-semibold">
                                  <dt>Option {letter} total</dt>
                                  <dd className="tabular">{fmt(totals.total)}</dd>
                                </div>
                              </dl>
                              {showCosts && (
                                <CostingBox
                                  currency={currency}
                                  cost={costing.costMinor}
                                  sales={costing.salesMinor}
                                  profit={costing.profitMinor}
                                  margin={costing.marginPercent}
                                  uncosted={costing.uncostedLines}
                                  extra={costing.extraCostMinor}
                                  extraLabel={`incl. costs to reach ${s.incoterm}`}
                                />
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </section>
                  )}
                </div>
              </div>
            )}
            {part === "options" && <ErrorText error={st.errors?.currency ?? st.errors?.validUntil} />}

            {inPanel ? (
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
            ) : (
              <StickyBar className="gap-x-6 px-4 py-2.5 sm:px-5">
                {options && (
                  <>
                    {/* The chosen option's money: wide, every figure; phone, the total and the margin. */}
                    <dl className="flex flex-wrap items-end gap-x-6 gap-y-1 max-sm:hidden">
                      <Fig label={s.options.length > 1 ? `Option ${letter} total` : "Total"} strong>
                        {fmt(totals.total)}
                      </Fig>
                      {showCosts && (
                        <>
                          <Fig label="Cost">{fmt(costing.costMinor)}</Fig>
                          <Fig label="Profit" className={costing.profitMinor < 0 ? "text-bad" : undefined}>
                            {fmt(costing.profitMinor)}
                          </Fig>
                          <Fig label="Margin" strong className={costing.marginPercent !== null && costing.marginPercent < 0 ? "text-bad" : undefined}>
                            {costing.marginPercent === null ? "—" : `${costing.marginPercent.toFixed(1)}%`}
                          </Fig>
                        </>
                      )}
                    </dl>
                    <div className="min-w-0 sm:hidden">
                      <p className="text-xs text-text-2">
                        {s.options.length > 1 ? `Option ${letter}` : "Total"}
                        {showCosts ? " · margin" : ""}
                      </p>
                      <p className="text-sm font-semibold tabular">
                        {fmt(totals.total)}
                        {showCosts && costing.marginPercent !== null ? ` · ${costing.marginPercent.toFixed(1)}%` : ""}
                      </p>
                    </div>
                  </>
                )}
                <div className="ml-auto flex items-center gap-2">
                  {dirty && requireChanges && <span className="text-xs text-warn max-lg:hidden">Unsaved changes</span>}
                  {onCancel && (
                    <Button variant="ghost" className={cn(terms && "max-sm:hidden")} onClick={cancel}>
                      Cancel
                    </Button>
                  )}
                  <SubmitButton pendingText="Saving…" disabled={requireChanges && !dirty}>
                    {submitShort ? (
                      <>
                        <span className="max-sm:hidden">{submitLabel}</span>
                        <span className="sm:hidden">{submitShort}</span>
                      </>
                    ) : (
                      submitLabel
                    )}
                  </SubmitButton>
                </div>
              </StickyBar>
            )}
          </>
        )}
      </ActionForm>
      {footer?.(dirty)}
    </>
  );
}

/** "1 · Terms" with its short line under it. */
function SectionTitle({ id, n, sub, children }: { id: string; n: number | null; sub: ReactNode; children: ReactNode }) {
  return (
    <div>
      <h4 id={id} className="text-[0.9375rem] font-semibold">
        {n !== null && <span className="font-medium text-muted">{n} · </span>}
        {children}
      </h4>
      <p className="text-xs text-text-2">{sub}</p>
    </div>
  );
}

/** One kind of terms (payment, delivery): titled, its fields under the title. */
function TermsGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div role="group" aria-labelledby={id} className="flex min-w-0 flex-col gap-3 rounded-lg border border-line p-3 sm:p-4">
      <h5 id={id} className="text-sm font-semibold">
        {title}
      </h5>
      {children}
    </div>
  );
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

export function swap<T>(list: T[], a: number, b: number): T[] {
  if (b < 0 || b >= list.length) return list;
  const next = [...list];
  [next[a], next[b]] = [next[b]!, next[a]!];
  return next;
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
          <dd className={cn("font-semibold tabular", margin !== null && margin < 0 && "text-bad")}>{margin === null ? "—" : `${margin.toFixed(1)}%`}</dd>
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
          The offer does not say its price basis (EXW, FOB…), so the costs to reach {selling} cannot be worked out. Set it on Factory offers (the offer's Edit), or add
          freight and the like as charges.
        </p>
      ) : (
        <>
          {gap.extra.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-md bg-warn-soft px-3 py-2 text-xs text-text">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
              Their {factoryBasis} price already pays for {gap.extra.map((x) => BASIS_STEP_LABEL[x].toLowerCase()).join(" and ")}, which you do not sell on {selling}: ask
              them for a {selling} price, or you pay for it.
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
                            <Button size="xs" variant="ghost" onClick={() => onAsLine(step, minor)} title="Show it to the customer as its own line (a charge) instead of inside the prices">
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
                  <span className="font-medium text-text">{fmt(extra.minor)}</span> added to Option {letter}&apos;s cost. &ldquo;Price all at … %&rdquo; spreads it
                  over the lines, so the prices cover it.
                </>
              ) : (
                "Enter what each step costs (a forwarder's quote is fine): it is added to the cost and spread over the prices."
              )}
              {extra.noRate && <span className="ml-1 text-warn">There is no exchange rate for {extra.noRate} in Settings.</span>}
              {gap.needed.some((x) => asLine(x)) && (
                <span className="mt-1 block text-warn">
                  A cost shown as its own line is no longer spread into the prices: price Option {letter} again (&ldquo;Price all at … %&rdquo;) if you priced before moving it.
                </span>
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}
