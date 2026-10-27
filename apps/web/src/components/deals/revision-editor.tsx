"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, CornerDownRight, Lock, Plus, Trash2 } from "lucide-react";
import { costSummary, documentTotals, formatMinor, fromMinor, marginPercent, priceForMargin, toMinor } from "@kebo/money";
import { BALANCE_TERMS, BALANCE_TERMS_LABEL, INCOTERMS, optionLetter, type BalanceTerms, type Incoterm } from "@kebo/shared";
import { Badge, Button, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { OfferLine, QuoteOffers, RevisionDraft } from "@/lib/types-deals";
import { LineTable, type LineColumn } from "@/components/lines/line-table";
import { localLineHandlers } from "@/components/lines/local-lines";
import { ErrorText, numberText, rowKey } from "./form-bits";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

interface ChargeState {
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

interface OptionState {
  key: string;
  /** null: the customer's items, priced by hand. */
  factoryQuoteId: string | null;
  leadTime: string;
  discount: string;
  /** Our price per line, by factory line id (or customer item id). */
  prices: Record<string, string>;
  charges: ChargeState[];
}

interface EditorState {
  currency: string;
  incoterm: Incoterm;
  incotermPlace: string;
  depositPercent: string;
  balanceTerms: BalanceTerms;
  validUntil: string;
  paymentTerms: string;
  deliveryTerms: string;
  notes: string;
  options: OptionState[];
}

const str = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(v));
const money2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "");
const valid = (v: string) => v.trim() !== "" && Number.isFinite(Number(numberText(v)));

function fromDraft(d: RevisionDraft): EditorState {
  return {
    currency: d.currency,
    incoterm: d.incoterm,
    incotermPlace: str(d.incotermPlace),
    depositPercent: str(d.depositPercent),
    balanceTerms: d.balanceTerms,
    validUntil: d.validUntil,
    paymentTerms: str(d.paymentTerms),
    deliveryTerms: str(d.deliveryTerms),
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
    })),
  };
}

/** The lines an option offers: the factory's (locked), or the customer's items when there are no factory prices. */
function linesOf(o: OptionState, offers: QuoteOffers): OfferLine[] | null {
  if (!o.factoryQuoteId) return offers.items.map((i) => ({ ...i, requestedItemId: i.id, answersNo: i.no, unitCost: null }));
  return offers.offers.find((x) => x.factoryQuoteId === o.factoryQuoteId)?.lines ?? null;
}

function payload(s: EditorState, offers: QuoteOffers) {
  return {
    currency: s.currency.trim().toUpperCase(),
    incoterm: s.incoterm,
    incotermPlace: s.incotermPlace,
    depositPercent: numberText(s.depositPercent),
    balanceTerms: s.balanceTerms,
    validUntil: s.validUntil,
    paymentTerms: s.paymentTerms,
    deliveryTerms: s.deliveryTerms,
    notes: s.notes,
    options: s.options.map((o) => ({
      factoryQuoteId: o.factoryQuoteId,
      leadTime: o.leadTime,
      discount: numberText(o.discount),
      prices: (linesOf(o, offers) ?? []).filter((l) => valid(o.prices[l.id] ?? "")).map((l) => ({ lineId: l.id, unitPrice: numberText(o.prices[l.id]!) })),
      charges: o.charges.map((c) => ({ type: c.type, description: c.description, quantity: numberText(c.quantity), unit: c.unit.trim() || "lot", unitPrice: numberText(c.unitPrice), unitCost: numberText(c.unitCost) || null })),
    })),
  };
}

/** Prices for every line that has a cost, at a margin (lines without a cost keep what they have). */
function priced(lines: OfferLine[], prices: Record<string, string>, margin: number) {
  const next = { ...prices };
  for (const l of lines) if (l.unitCost !== null) next[l.id] = fromMinor(priceForMargin(toMinor(l.unitCost), margin));
  return next;
}

/**
 * The editor for a draft revision: terms, then the options (A, B…) the
 * customer chooses from. Each option is one factory's offer — its lines exactly
 * as the factory gave them, locked — and we set our prices, the discount, the
 * lead time and charges such as freight. Totals use the API's own maths
 * (@kebo/money); people who may see costs get costs and margins per line and
 * per option.
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
  footer,
  onCancel,
}: {
  action: Action;
  number: number;
  initial: RevisionDraft;
  offers: QuoteOffers;
  /** The offers with costs in another currency (when the quotation currency changes). */
  loadOffers?: (currency: string) => Promise<QuoteOffers | null>;
  showCosts: boolean;
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
  const [offers, setOffers] = useState(initialOffers);
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState(false);
  const [margin, setMargin] = useState(String(initialOffers.defaultMargin));
  const dirty = JSON.stringify(s) !== saved;
  const set = <K extends keyof EditorState>(k: K, v: EditorState[K]) => setS((st) => ({ ...st, [k]: v }));
  const setOption = (i: number, patch: Partial<OptionState> | ((o: OptionState) => Partial<OptionState>)) =>
    setS((st) => ({ ...st, options: st.options.map((o, n) => (n === i ? { ...o, ...(typeof patch === "function" ? patch(o) : patch) } : o)) }));

  const currency = /^[A-Za-z]{3}$/.test(s.currency.trim()) ? s.currency.trim().toUpperCase() : "—";
  const fmt = (minor: number) => formatMinor(minor, currency);
  const amountOf = (v: string | undefined) => (valid(v ?? "") ? toMinor(numberText(v ?? "")) : 0);
  const chargeColumns: LineColumn[] = [
    { key: "description", label: "Charge", width: "minmax(0,1fr)", input: "textarea", required: "Each charge needs a description", placeholder: "e.g. Sea freight to Mombasa" },
    { key: "quantity", label: "Qty", width: "4.5rem", input: "number", align: "right", initial: "1", required: "Enter a quantity" },
    { key: "unit", label: "Unit", width: "4.5rem", input: "text", initial: "lot", maxLength: 20 },
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
  const marginOk = margin.trim() !== "" && Number.isFinite(marginNumber) && marginNumber >= 0 && marginNumber < 100;
  const opt = s.options[Math.min(active, s.options.length - 1)]!;
  const at = s.options.indexOf(opt);

  const totalsOf = (o: OptionState) => {
    const lines = linesOf(o, offers) ?? [];
    const rows = [
      ...lines.map((l) => ({ quantity: numberText(l.quantity) || 0, unitPrice: numberText(o.prices[l.id] ?? "") || 0, cost: l.unitCost })),
      ...o.charges.map((c) => ({ quantity: numberText(c.quantity) || 0, unitPrice: numberText(c.unitPrice) || 0, cost: valid(c.unitCost) ? numberText(c.unitCost) : null })),
    ];
    const totals = documentTotals(rows, numberText(o.discount) || 0);
    const costing = costSummary(
      rows.map((r) => ({ quantity: r.quantity, unitPriceMinor: toMinor(r.unitPrice), unitCostMinor: r.cost === null || r.cost === undefined ? null : toMinor(r.cost) })),
      totals.discount,
    );
    return { lines, totals, costing };
  };

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
      options: [...st.options, { key: rowKey(), factoryQuoteId, leadTime: offer?.leadTime ?? "", discount: "", prices: priced(lines, {}, marginOk ? marginNumber : offers.defaultMargin), charges: [] }],
    }));
    setActive(s.options.length);
    setAdding(false);
  };

  const refreshCosts = async (code: string) => {
    if (!loadOffers || !/^[A-Z]{3}$/.test(code) || code === offers.currency) return;
    const next = await loadOffers(code);
    if (next) setOffers(next);
  };

  const { lines, totals, costing } = totalsOf(opt);
  const offer = opt.factoryQuoteId ? offers.offers.find((o) => o.factoryQuoteId === opt.factoryQuoteId) : null;
  const coverage = opt.factoryQuoteId ? offer?.coverage : { covered: offers.items.filter((i) => !i.parentId).map((i) => i.no), missing: [] };
  const costed = lines.filter((l) => l.unitCost !== null).length;
  const itemName = (no: string) => offers.items.find((i) => i.no === no)?.description.split("\n")[0] ?? "";

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
            <input type="hidden" name="payload" value={JSON.stringify(payload(s, offers))} />

            <section aria-label="Terms" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Currency" htmlFor={`cur-${number}`} error={st.errors?.currency} hint={showCosts && offers.currency !== currency && currency !== "—" ? "Costs update when you leave this box" : undefined}>
                <Input
                  id={`cur-${number}`}
                  value={s.currency}
                  maxLength={3}
                  className="uppercase"
                  onChange={(e) => set("currency", e.target.value.toUpperCase())}
                  onBlur={(e) => void refreshCosts(e.target.value.trim().toUpperCase())}
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
              <Field label="Place" htmlFor={`place-${number}`} optional error={st.errors?.incotermPlace} hint="Port or place for the Incoterm">
                <Input id={`place-${number}`} value={s.incotermPlace} maxLength={80} placeholder="e.g. Qingdao" onChange={(e) => set("incotermPlace", e.target.value)} />
              </Field>
              <Field label="Valid until" htmlFor={`valid-${number}`} error={st.errors?.validUntil}>
                <Input id={`valid-${number}`} type="date" value={s.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
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
            </section>

            <section aria-label="Options" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Options for the customer</h3>
                  <p className="text-xs text-muted">Each option is one factory&apos;s offer, lines as the factory gave them. The customer accepts one.</p>
                </div>
                {showCosts && (
                  <div className="flex items-end gap-2">
                    <div>
                      <label htmlFor={`margin-${number}`} className="mb-1 block text-xs text-muted">
                        Margin
                      </label>
                      <div className="flex items-center gap-1.5">
                        <Input id={`margin-${number}`} inputMode="decimal" className="h-8 w-20 tabular" value={margin} onChange={(e) => setMargin(e.target.value)} />
                        <span className="text-sm text-muted">%</span>
                      </div>
                    </div>
                    <Button size="sm" onClick={() => marginOk && setOption(at, (o) => ({ prices: priced(lines, o.prices, marginNumber) }))} disabled={!marginOk || costed === 0}>
                      Price Option {optionLetter(at)} at {marginOk ? marginNumber : "…"}%
                    </Button>
                  </div>
                )}
              </div>

              <div role="tablist" aria-label="Options" className="flex flex-wrap items-center gap-1.5">
                {s.options.map((o, i) => {
                  const t = totalsOf(o);
                  return (
                    <button
                      key={o.key}
                      type="button"
                      role="tab"
                      aria-selected={i === at}
                      onClick={() => setActive(i)}
                      className={cn(
                        "flex flex-col items-start rounded-lg border px-3 py-1.5 text-left text-sm",
                        i === at ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface hover:border-line-strong",
                      )}
                    >
                      <span className="font-semibold">Option {optionLetter(i)}</span>
                      <span className="text-xs tabular">{fmt(t.totals.total)}</span>
                    </button>
                  );
                })}
                {addable.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
                    <Plus aria-hidden /> Add an option
                  </Button>
                )}
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

              <div role="tabpanel" aria-label={`Option ${optionLetter(at)}`} className="flex flex-col gap-4 rounded-xl border border-line p-3 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      Option {optionLetter(at)} — {opt.factoryQuoteId ? (offer?.factory.name ?? "an offer that was removed") : "the customer's items"}
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
                  <div className="flex items-center gap-1">
                    <Button size="icon-xs" variant="ghost" disabled={at === 0} aria-label="Move this option left" onClick={() => {
                        setS((x) => ({ ...x, options: swap(x.options, at, at - 1) }));
                        setActive(at - 1);
                      }}>
                      <ArrowLeft aria-hidden />
                    </Button>
                    <Button size="icon-xs" variant="ghost" disabled={at === s.options.length - 1} aria-label="Move this option right" onClick={() => {
                        setS((x) => ({ ...x, options: swap(x.options, at, at + 1) }));
                        setActive(at + 1);
                      }}>
                      <ArrowRight aria-hidden />
                    </Button>
                    <Button
                      size="xs"
                      variant="danger-ghost"
                      disabled={s.options.length === 1}
                      onClick={() => {
                        setS((x) => ({ ...x, options: x.options.filter((_, n) => n !== at) }));
                        setActive(Math.max(0, at - 1));
                      }}
                    >
                      <Trash2 aria-hidden /> Remove option
                    </Button>
                  </div>
                </div>

                {lines.length === 0 && opt.factoryQuoteId && !offer && (
                  <p className="rounded-md bg-warn-soft px-3 py-2 text-sm">This factory offer was removed from the deal. Remove this option or choose another offer.</p>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs text-muted">
                        <th className="w-10 py-2 font-medium">No.</th>
                        <th className="py-2 font-medium">Description</th>
                        <th className="py-2 text-right font-medium">Qty</th>
                        {showCosts && <th className="py-2 text-right font-medium">Cost</th>}
                        <th className="w-32 py-2 text-right font-medium">Unit price</th>
                        {showCosts && <th className="py-2 text-right font-medium">Margin</th>}
                        <th className="py-2 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => {
                        const price = opt.prices[l.id] ?? "";
                        const m = showCosts && l.unitCost !== null && valid(price) && Number(numberText(price)) > 0 ? marginPercent(toMinor(numberText(price)), toMinor(l.unitCost)) : null;
                        return (
                          <tr key={l.id} className="border-b border-line/70 align-top">
                            <td className="py-2 text-muted tabular">{l.no}</td>
                            <td className={cn("py-2 pr-3", l.parentId && "pl-4")}>
                              <span className="flex items-start gap-1">
                                {l.parentId && <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden />}
                                <span className="whitespace-pre-line">{l.description}</span>
                              </span>
                              <span className="block text-xs text-muted">
                                {[l.model, opt.factoryQuoteId && l.answersNo ? `for item ${l.answersNo}` : null].filter(Boolean).join(" · ")}
                              </span>
                            </td>
                            <td className="py-2 text-right whitespace-nowrap tabular">
                              {Number(l.quantity).toLocaleString("en-US", { maximumFractionDigits: 2 })} {l.unit}
                            </td>
                            {showCosts && <td className="py-2 text-right whitespace-nowrap text-text-2 tabular">{l.unitCost === null ? "—" : fmt(toMinor(l.unitCost))}</td>}
                            <td className="py-1.5 pl-2">
                              <Input
                                aria-label={`Unit price for ${l.no}`}
                                inputMode="decimal"
                                className="h-8 text-right tabular"
                                value={price}
                                placeholder="0.00"
                                onChange={(e) => setOption(at, (o) => ({ prices: { ...o.prices, [l.id]: e.target.value } }))}
                              />
                            </td>
                            {showCosts && (
                              <td className={cn("py-2 text-right font-medium tabular", m === null ? "text-muted" : m < 0 ? "text-bad" : m < 5 ? "text-warn" : "text-ok")}>
                                {m === null ? "—" : `${m.toFixed(1)}%`}
                              </td>
                            )}
                            <td className="py-2 text-right font-semibold whitespace-nowrap tabular">{fmt(totals.lines[i]?.lineTotal ?? 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted">The factory&apos;s lines cannot change here: change the offer on Factory prices.</p>
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
                        <dt>Option {optionLetter(at)} total</dt>
                        <dd className="tabular">{fmt(totals.total)}</dd>
                      </div>
                    </dl>
                    {showCosts && <CostingBox currency={currency} cost={costing.costMinor} sales={costing.salesMinor} profit={costing.profitMinor} margin={costing.marginPercent} uncosted={costing.uncostedLines} />}
                  </div>
                </div>
              </div>
            </section>

            <section aria-label="Terms and notes" className="grid gap-4 lg:grid-cols-2">
              <Field
                label="Payment terms"
                htmlFor={`pay-terms-${number}`}
                optional
                error={st.errors?.paymentTerms}
                hint="Printed after the deposit and balance, e.g. By T/T; L/C at sight accepted"
              >
                <Textarea id={`pay-terms-${number}`} rows={3} value={s.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} />
              </Field>
              <Field
                label="Delivery terms"
                htmlFor={`del-terms-${number}`}
                optional
                error={st.errors?.deliveryTerms}
                hint="Printed under the delivery time, e.g. packing, inspection, warranty"
              >
                <Textarea id={`del-terms-${number}`} rows={3} value={s.deliveryTerms} onChange={(e) => set("deliveryTerms", e.target.value)} />
              </Field>
              <Field label="Notes" htmlFor={`notes-${number}`} optional error={st.errors?.notes} hint="Printed last" className="lg:col-span-2">
                <Textarea id={`notes-${number}`} rows={3} value={s.notes} onChange={(e) => set("notes", e.target.value)} />
              </Field>
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

function swap<T>(list: T[], a: number, b: number): T[] {
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
export function CostingBox({ currency, cost, sales, profit, margin, uncosted }: { currency: string; cost: number; sales: number; profit: number; margin: number | null; uncosted: number }) {
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
