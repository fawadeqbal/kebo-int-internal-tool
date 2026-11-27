"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronUp, ClipboardPaste, Lock, Plus, X } from "lucide-react";
import { createPortal } from "react-dom";
import { convertMinor, formatMinor, fromMinor, fxRate, landedUnitCosts, marginPercent, priceForMargin, toMinor } from "@kebo/money";
import { basisText, BASIS_STEP_LABEL, leadWords, optionLetter } from "@kebo/shared";
import { Badge, Button, Card, cn, Input, Select, Textarea, controlClass, controlSizes, subTitleClass } from "@kebo/ui";
import { EditButton } from "@/components/common/edit-button";
import { BottomSheet } from "@/components/common/bottom-sheet";
import { useIsPhone } from "@/components/common/floating";
import { useFooterSlot } from "@/components/common/panel";
import { UNITS } from "@/components/lines/line-table";
import { PhoneLineRow, PhonePriceBox } from "@/components/lines/phone-lines";
import type { QuoteOffers } from "@/lib/types-deals";
import type { Fx } from "@/lib/fx";
import { ErrorText, numberText, rowKey } from "./form-bits";
import { shortName } from "./offer-facts";
import { asLineOf, BasisCosts, Fig, gapOf, marginOf, optionTotals, pricedAll, startMargin, STEP_LINE, valid, type ChargeState, type EditorState, type OptionState } from "./revision-editor";


/** A price box: right-aligned figures, the whole value selected on focus. */
const PRICE_BOX = `${controlClass} ${controlSizes.sm} min-w-0 text-right tabular`;
/** A plain box in the charges table. */
const CELL_BOX = `${controlClass} ${controlSizes.sm} min-w-0`;
const TH = "h-9 border-b border-line bg-surface-2 px-3 text-xs font-medium whitespace-nowrap text-text-2";
const amount2 = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * "Edit lines" of a draft quotation, in the same window as an offer's lines editor: the options as tabs; the
 * open option's lines with a price box in each row (Enter goes to the next line, a column pasted from Excel
 * fills down); the costs to reach our basis as one internal line; charges of our own; the option's lead
 * time; and at the bottom Save changes and Cancel with the totals, cost, profit and margin.
 *
 * Only prices are changed here. Which offers are quoted, and the terms, are in the quotation's window (Edit).
 * The whole revision is saved, as before.
 */
/**
 * The price sheet of a draft quotation, shared by "Edit lines" and the steps window's Lines step: the options as
 * tabs; the open option's lines with a price box in each row (Enter goes to the next line, a column pasted from
 * Excel fills down); the costs to reach our basis as one internal line; charges of our own; the option's lead
 * time. Controlled: the draft's values are the caller's (`s`), so one Save sends everything.
 */
export function PriceSheet({
  s,
  setS,
  offers,
  showCosts,
  active,
  setActive,
  errors,
  steps = false,
}: {
  s: EditorState;
  setS: React.Dispatch<React.SetStateAction<EditorState>>;
  offers: QuoteOffers;
  showCosts: boolean;
  active: number;
  setActive: (i: number) => void;
  errors?: Record<string, string[] | string | undefined>;
  /** In the steps window (the lead time is changed under Delivery, in the same window). */
  steps?: boolean;
}) {
  // The box starts with the margin the options have now (not the usual one from Settings).
  const [margin, setMargin] = useState(() => startMargin(s, offers));
  const [costsOpen, setCostsOpen] = useState(false);
  const [paste, setPaste] = useState<string | null>(null);
  const [chargesOpen, setChargesOpen] = useState(false);
  const setOption = (i: number, patch: Partial<OptionState> | ((o: OptionState) => Partial<OptionState>)) =>
    setS((st) => ({ ...st, options: st.options.map((o, n) => (n === i ? { ...o, ...(typeof patch === "function" ? patch(o) : patch) } : o)) }));

  const currency = /^[A-Za-z]{3}$/.test(s.currency.trim()) ? s.currency.trim().toUpperCase() : "—";
  const fmt = (minor: number) => formatMinor(minor, currency);
  const amountOf = (v: string | undefined) => (valid(v ?? "") ? toMinor(numberText(v ?? "")) : 0);
  const marginNumber = Number(numberText(margin));
  const marginOk = marginOf(margin) !== null;
  // A little under the usual margin is fine; more than two points under it shows amber, below cost red.
  const tone = (m: number | null) => (m === null ? "text-muted" : m < 0 ? "text-bad" : m < offers.defaultMargin - 2 ? "text-warn" : "text-ok");

  const totalsOf = (o: OptionState) => optionTotals(o, offers, s.incoterm, currency);

  const opt = s.options[Math.min(active, s.options.length - 1)]!;
  const at = s.options.indexOf(opt);
  const letter = optionLetter(at);
  const { lines, totals, extra } = totalsOf(opt);
  const landed = landedUnitCosts(
    lines.map((l) => ({ unitCostMinor: l.unitCost === null ? null : toMinor(l.unitCost), quantity: numberText(l.quantity) || 0 })),
    extra.minor,
  );
  const offer = opt.supplierQuoteId ? offers.offers.find((o) => o.supplierQuoteId === opt.supplierQuoteId) : null;
  const itemName = (no: string) => offers.items.find((i) => i.no === no)?.description.split("\n")[0] ?? "";
  const topItems = offers.items.filter((i) => !i.parentId).length;
  const fx: Fx = { main: offers.mainCurrency, rates: offers.rates };
  const ours = basisText(s.incoterm, s.incotermPlace.trim() || null);

  const priceAll = () => marginOk && setS((st) => ({ ...st, options: pricedAll(st, offers, marginNumber) }));

  const nameOf = (o: OptionState) => (o.supplierQuoteId ? (offers.offers.find((x) => x.supplierQuoteId === o.supplierQuoteId)?.supplier.name ?? "a removed offer") : "the customer's items");

  /* ---------- the lines */
  const priceKeys = (i: number, attr: string) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Like a spreadsheet: Enter and the arrows go to the price below or above.
    const to = e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey) ? i + 1 : e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey) ? i - 1 : null;
    if (to === null) return;
    e.preventDefault();
    document.querySelector<HTMLInputElement>(`[${attr}="${at}:${to}"]`)?.focus();
  };
  const pricePaste = (i: number) => (e: React.ClipboardEvent<HTMLInputElement>) => {
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
  };
  const lineView = lines.map((l, i) => {
    const price = opt.prices[l.id] ?? "";
    // On the landed cost: the supplier's cost plus this line's share of the costs to reach our basis.
    const cost = landed[i] ?? null;
    const m = showCosts && cost !== null && valid(price) && Number(numberText(price)) > 0 ? marginPercent(toMinor(numberText(price)), cost) : null;
    const part = l.no.includes(".");
    // Under the line: its model (the offer's name and the item it answers are said once, above the table).
    const second = l.model ? `model ${l.model}` : "";
    return { l, i, price, cost, m, part, second };
  });
  const setPrice = (id: string, v: string) => setOption(at, (o) => ({ prices: { ...o.prices, [id]: v } }));

  /* ---------- the charges */
  const setCharge = (k: number, patch: Partial<ChargeState>) => setOption(at, (o) => ({ charges: o.charges.map((c, n) => (n === k ? { ...c, ...patch } : c)) }));
  const newCharge = (patch: Partial<ChargeState>): ChargeState => ({ key: rowKey(), parentKey: null, type: "charge", description: "", quantity: "1", unit: "lot", unitPrice: "", unitCost: "", ...patch });
  /** Typing in the entry row makes it a charge; a new entry row follows, and the typing goes on in the new charge. */
  const startCharge = (description: string) => {
    const c = newCharge({ description });
    setOption(at, (o) => ({ charges: [...o.charges, c] }));
    requestAnimationFrame(() => {
      const box = document.querySelector<HTMLInputElement>(`[data-charge="${c.key}"]`);
      box?.focus();
      box?.setSelectionRange(description.length, description.length);
    });
  };
  const pasted = (text: string) =>
    text
      .replace(/\r/g, "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        // Excel: Charge, Qty, Unit, Price (and our cost); a plain line: the charge, then its price at the end.
        const cells = line.includes("\t") ? line.split("\t").map((c) => c.trim()) : (/^(.*?)[\s:–-]+([\d.,]+)$/.exec(line)?.slice(1) ?? [line]);
        const isNum = (c: string) => /^-?[\d.,]+$/.test(c) && c !== "";
        const description = cells.find((c) => !isNum(c)) ?? "";
        const after = cells.slice(cells.indexOf(description) + 1);
        const nums = after.filter(isNum).map((c) => c.replace(/,/g, ""));
        const unit = after.find((c) => !isNum(c) && c) ?? "lot";
        const [quantity, unitPrice, unitCost] = nums.length >= 2 ? [nums[0]!, nums[1]!, nums[2] ?? ""] : ["1", nums[0] ?? "", ""];
        return newCharge({ description, quantity, unit, unitPrice, unitCost });
      })
      .filter((c) => c.description);

  /* ---------- the costs to reach our basis */
  const gap = opt.supplierQuoteId ? gapOf(opt, offers, s.incoterm) : null;
  const costLine = (gap?.needed ?? []).map((step) => {
    const c = opt.costs[step];
    const filled = c && valid(c.amount) && Number(numberText(c.amount)) > 0;
    return (
      <span key={step} className="whitespace-nowrap">
        {BASIS_STEP_LABEL[step]}{" "}
        {filled ? (
          <b className="font-semibold tabular">
            {c.currency} {amount2(Number(numberText(c.amount)))}
            {c.note ? <span className="font-normal text-text-2"> ({c.note})</span> : null}
          </b>
        ) : asLineOf(opt, step) ? (
          <span className="text-muted">as a charge below</span>
        ) : (
          <span className="font-medium text-warn">not entered</span>
        )}
      </span>
    );
  });

  const optionCard = (o: OptionState, i: number) => {
    const t = totalsOf(o);
    const off = o.supplierQuoteId ? offers.offers.find((x) => x.supplierQuoteId === o.supplierQuoteId) : null;
    const on = i === at;
    return (
      <button
        key={o.key}
        type="button"
        role="tab"
        aria-selected={on}
        onClick={() => setActive(i)}
        className={cn(
          "flex w-60 shrink-0 flex-col gap-1.5 rounded-xl border bg-surface px-3.5 py-3 text-left transition-colors sm:w-64",
          on ? "border-primary bg-primary-soft/40 ring-1 ring-primary" : "border-line hover:border-line-strong",
        )}
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-sm font-semibold" title={nameOf(o)}>
            {optionLetter(i)} · {off ? shortName(off.supplier.name) : o.supplierQuoteId ? "removed offer" : "by hand"}
          </span>
          <span className="shrink-0 text-sm font-semibold tabular">{fmt(t.totals.total)}</span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-text-2">
          {showCosts && t.costing.marginPercent !== null && <span className={cn("tabular", t.costing.marginPercent < 0 && "text-bad")}>margin {t.costing.marginPercent.toFixed(1)}%</span>}
          {off && <Badge tone={off.coverage.missing.length ? "warn" : "ok"}>{off.coverage.missing.length ? `Missing item ${off.coverage.missing.join(", ")}` : "Covers all"}</Badge>}
        </span>
      </button>
    );
  };

  return (
    <>
          {/* The options as tabs, and the margin for everything. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* One option (a quotation from one offer): nothing to choose between. */}
            {s.options.length > 1 && (
              <div role="tablist" aria-label="Options" className="-mx-1 flex min-w-0 gap-2 scroll-x px-1 py-0.5 scroll-none max-sm:w-full">
                {s.options.map(optionCard)}
              </div>
            )}
            {showCosts && (
              <div className="ml-auto flex items-center gap-2 max-sm:w-full">
                <label htmlFor="price-all" className="text-xs text-text-2">
                  Price all at
                </label>
                <Input size="sm" id="price-all" inputMode="decimal" unit="%" className="w-20 text-right tabular" value={margin} onChange={(e) => setMargin(e.target.value)} />
                <Button size="sm" variant="secondary" onClick={priceAll} disabled={!marginOk}>
                  Apply
                </Button>
              </div>
            )}
          </div>

          {/* The open option's lines. */}
          <Card aria-label={`Option ${letter} items`}>
            <div className="border-b border-line px-4 py-3">
              <h3 className={cn(subTitleClass, "max-sm:hidden")}>
                Option {letter} · {opt.supplierQuoteId ? (offer ? `items from ${offer.supplier.name}'s offer` : "an offer that was removed") : "the customer's items"}
              </h3>
              <h3 className={cn(subTitleClass, "sm:hidden")}>Items</h3>
              <p className="mt-0.5 text-xs text-muted max-sm:hidden">
                {offer?.coverage.missing.length ? (
                  <span className="inline-flex items-center gap-1 text-warn">
                    <AlertTriangle className="size-3.5" aria-hidden /> Does not cover {offer.coverage.missing.map((n) => `${n} (${itemName(n)})`).join(", ")}
                  </span>
                ) : (
                  `All ${topItems} customer item${topItems === 1 ? "" : "s"} covered`
                )}
                {offer ? ` · Incoterm ${offer.basis ? basisText(offer.basis, offer.basisPlace) : "not said"} → ${ours}` : ""}
              </p>
            </div>
            {lines.length === 0 && opt.supplierQuoteId && !offer && (
              <p className="m-4 rounded-md bg-warn-soft px-3 py-2 text-sm">This supplier offer was removed from the inquiry. Remove this option or add another offer.</p>
            )}
            {/* Wide: every column in view. */}
            <div className="p-4 max-sm:hidden">
              <table className="w-full table-fixed border-separate border-spacing-0 overflow-hidden rounded-lg border border-line text-sm" aria-label={`Option ${letter} prices`}>
                <colgroup>
                  <col className="w-14" />
                  <col />
                  <col className="w-24" />
                  {showCosts && <col className="w-32" />}
                  <col className="w-40" />
                  {showCosts && <col className="w-24" />}
                  <col className="w-32" />
                </colgroup>
                <thead>
                  <tr>
                    <th className={cn(TH, "text-left")}>No.</th>
                    <th className={cn(TH, "text-left")}>Description</th>
                    <th className={cn(TH, "text-right")}>Quantity</th>
                    {showCosts && <th className={cn(TH, "text-right")}>{extra.minor > 0 ? "Cost (landed)" : "Cost"}</th>}
                    <th className={cn(TH, "text-right")}>Unit price {currency}</th>
                    {showCosts && <th className={cn(TH, "text-right")}>Margin</th>}
                    <th className={cn(TH, "text-right")}>Amount {currency}</th>
                  </tr>
                </thead>
                <tbody>
                  {lineView.map(({ l, i, price, cost, m, part, second }) => (
                    <tr key={l.id} className="[&>td]:border-b [&>td]:border-line last:[&>td]:border-b-0">
                      <td className="px-3 py-2.5 align-middle text-xs text-muted tabular">{l.no}</td>
                      <td className={cn("px-3 py-2 align-middle", part && "pl-7")}>
                        <span className="block truncate" title={l.description}>
                          {l.description.split("\n")[0]}
                        </span>
                        {second && <span className="block truncate text-xs text-muted">{second}</span>}
                      </td>
                      <td className="px-3 py-2 text-right align-middle whitespace-nowrap tabular">
                        {Number(l.quantity).toLocaleString("en-US", { maximumFractionDigits: 2 })} {l.unit}
                      </td>
                      {showCosts && (
                        <td className="px-3 py-2 text-right align-middle whitespace-nowrap text-text-2 tabular" title={cost !== null && extra.minor > 0 && l.unitCost !== null ? `Supplier ${fmt(toMinor(l.unitCost))} + its share of the costs to reach ${s.incoterm}` : undefined}>
                          {cost === null ? "—" : amount2(Number(fromMinor(cost)))}
                        </td>
                      )}
                      <td className="px-3 py-1.5 align-middle">
                        <PriceInput
                          aria-label={`Unit price for ${l.no}`}
                          data-price={`${at}:${i}`}
                          value={price}
                          placeholder="0.00"
                          onChange={(v) => setPrice(l.id, v)}
                          onKeyDown={priceKeys(i, "data-price")}
                          onPaste={pricePaste(i)}
                        />
                      </td>
                      {showCosts && <td className={cn("px-3 py-2 text-right align-middle font-semibold tabular", tone(m))}>{m === null ? "—" : `${m.toFixed(1)}%`}</td>}
                      <td className="px-3 py-2 text-right align-middle font-semibold whitespace-nowrap tabular">{amount2(Number(fromMinor(totals.lines[i]?.lineTotal ?? 0)))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Phone (design "Items on a small phone"): the one item line (PhoneLineRow) with its price box in it
                (PhonePriceBox: pricing is the work here), the cost beside how many, the margin and the amount under it. */}
            <ul aria-label={`Option ${letter} prices`} className="flex flex-col sm:hidden">
              {lineView.map(({ l, i, price, cost, m, part }) => {
                const amount = totals.lines[i]?.lineTotal ?? 0;
                return (
                  <PhoneLineRow
                    key={l.id}
                    no={l.no}
                    kind={part ? "Part" : "Item"}
                    name={l.description.split("\n")[0]!}
                    under={l.model}
                    line={[
                      `${Number(l.quantity).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${l.unit}`,
                      ...(showCosts && cost !== null && cost > 0 ? [`cost ${amount2(Number(fromMinor(cost)))}`] : []),
                    ]}
                    amount={amount > 0 ? amount2(Number(fromMinor(amount))) : null}
                    needs={null}
                    part={part}
                    busy={false}
                    field={
                      <PhonePriceBox
                        value={price}
                        onChange={(v) => setPrice(l.id, v)}
                        label={`Unit price for ${l.no}`}
                        index={i}
                        group={`m${at}`}
                        needed={!part}
                        onPaste={pricePaste(i)}
                      />
                    }
                    note={showCosts && m !== null ? <span className={tone(m)}>margin {m.toFixed(1)}%</span> : null}
                  />
                );
              })}
            </ul>
          </Card>

          {/* The costs between the supplier's basis and ours: internal, one line. */}
          {showCosts && opt.supplierQuoteId && offer && (
            <Card aria-label={`Getting it to ${ours}`}>
              <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
                <div className="min-w-0">
                  <h3 className={subTitleClass}>Getting it to {ours}</h3>
                  <p className="mt-0.5 text-xs text-muted">
                    <Lock className="mr-1 inline size-3" aria-hidden />
                    Internal: added to the cost of the items above, never printed.
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-3 px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-sm">
                  {!gap ? (
                    <span className="flex items-center gap-1.5 text-warn">
                      <AlertTriangle className="size-4" aria-hidden /> The offer does not say its Incoterm: set it on Supplier offers, or add freight as a charge.
                    </span>
                  ) : gap.needed.length === 0 ? (
                    <span className="flex items-center gap-1.5 text-ok">
                      <CheckCircle2 className="size-4" aria-hidden /> Their {offer.basis} price already covers {s.incoterm}: nothing to add.
                    </span>
                  ) : (
                    costLine
                  )}
                  {gap && gap.needed.length > 0 && (
                    <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setCostsOpen((v) => !v)} aria-expanded={costsOpen}>
                      {costsOpen ? "Done" : "Change"}
                    </Button>
                  )}
                </div>
                {costsOpen && gap && (
                  <BasisCosts
                    bare
                    letter={letter}
                    supplierBasis={offer.basis}
                    supplierPlace={offer.basisPlace}
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
                          newCharge({
                            description: STEP_LINE[step](s.incotermPlace.trim()),
                            unitCost: fromMinor(costMinor),
                            unitPrice: fromMinor(priceForMargin(costMinor, marginOk ? marginNumber : offers.defaultMargin)),
                          }),
                        ],
                      }))
                    }
                  />
                )}
              </div>
            </Card>
          )}

          {/* Charges: our own price lines, printed. */}
          <Card aria-label="Charges">
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <h3 className={subTitleClass}>
                  Charges<span className="sm:hidden"> · {opt.charges.length}</span>
                </h3>
                <p className="mt-0.5 text-xs text-muted max-sm:hidden">Our own charges (freight, inspection…): printed on the quotation.{showCosts ? " Cost is internal." : ""}</p>
              </div>
              <Button size="xs" variant="ghost" className="max-sm:hidden" onClick={() => setPaste((v) => (v === null ? "" : null))} aria-expanded={paste !== null}>
                <ClipboardPaste aria-hidden /> Paste a list
              </Button>
              {chargesOpen ? (
                <Button size="xs" variant="secondary" className="sm:hidden" onClick={() => setChargesOpen(false)} aria-expanded>
                  Done
                </Button>
              ) : (
                <EditButton className="sm:hidden" onClick={() => setChargesOpen(true)} aria-expanded={false} />
              )}
            </div>
            {paste !== null && (
              <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
                <label htmlFor="charges-paste" className="text-xs text-text-2">
                  One charge a line: copied from Excel (charge, qty, unit, price{showCosts ? ", our cost" : ""}) or typed (&ldquo;Inspection 350&rdquo;).
                </label>
                <Textarea id="charges-paste" rows={3} className="min-h-0" value={paste} onChange={(e) => setPaste(e.target.value)} autoFocus />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!pasted(paste).length}
                    onClick={() => {
                      const add = pasted(paste);
                      setOption(at, (o) => ({ charges: [...o.charges, ...add] }));
                      setPaste(null);
                    }}
                  >
                    Add {pasted(paste).length || ""} charge{pasted(paste).length === 1 ? "" : "s"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPaste(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {/* Phone: summed up, Edit opens them. */}
            {!chargesOpen && (
              <p className="px-4 py-3 text-sm text-text-2 sm:hidden">
                {opt.charges.length ? opt.charges.map((c) => `${c.description.split("\n")[0]} ${currency} ${amount2(amountOf(c.unitPrice) * (Number(numberText(c.quantity)) || 0) / 100)}`).join(" · ") : "No charges."}
              </p>
            )}
            <div className={cn("p-4", !chargesOpen && "max-sm:hidden")}>
              <ChargesTable
                charges={opt.charges}
                currency={currency}
                showCosts={showCosts}
                amountOf={amountOf}
                onChange={setCharge}
                onRemove={(k) => setOption(at, (o) => ({ charges: o.charges.filter((_, n) => n !== k) }))}
                onStart={startCharge}
              />
            </div>
          </Card>

          {/* The option's lead time, as the quotation's form has it (one thing, one form: it is changed there, under Delivery). */}
          <p className="text-sm">
            <span className="font-medium">Lead time{s.options.length > 1 ? ` of Option ${letter}` : ""}:</span>{" "}
            {opt.leadDays.trim() ? leadWords(Number(opt.leadDays) || 0, opt.leadFrom, "customer") : opt.leadTime || <span className="text-muted">not said</span>}
            <span className="ml-1.5 text-xs text-muted">{steps ? "changed under Delivery" : "changed in the quotation's Edit, under Delivery"}</span>
          </p>

          <ErrorText error={errors?.options ?? errors?.currency} />

    </>
  );
}

/** The open option's money: subtotal, the discount box, total, and (people who see costs) cost, profit and margin. */
export function PriceTotals({
  s,
  setS,
  offers,
  showCosts,
  active,
  inline = false,
}: {
  s: EditorState;
  setS: React.Dispatch<React.SetStateAction<EditorState>>;
  offers: QuoteOffers;
  showCosts: boolean;
  active: number;
  /** Under the sheet (the steps window) rather than in a window's footer. */
  inline?: boolean;
}) {
  const currency = /^[A-Za-z]{3}$/.test(s.currency.trim()) ? s.currency.trim().toUpperCase() : "—";
  const fmt = (minor: number) => formatMinor(minor, currency);
  const tone = (m: number | null) => (m === null ? "text-muted" : m < 0 ? "text-bad" : m < offers.defaultMargin - 2 ? "text-warn" : "text-ok");
  const opt = s.options[Math.min(active, s.options.length - 1)]!;
  const at = s.options.indexOf(opt);
  const letter = optionLetter(at);
  const { totals, costing } = optionTotals(opt, offers, s.incoterm, currency);
  const setOption = (i: number, patch: Partial<OptionState>) => setS((st) => ({ ...st, options: st.options.map((o, n) => (n === i ? { ...o, ...patch } : o)) }));
  const phone = useIsPhone();
  const slot = useFooterSlot();
  const [sheetOpen, setSheetOpen] = useState(false);
  if (inline) {
    const block = (sheet: boolean) => (
      <dl className={cn("grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6", sheet ? "px-4 py-3" : "rounded-xl border border-line bg-surface-2/50 px-4 py-3")}>
        <Fig label="Subtotal">{fmt(totals.subtotal)}</Fig>
        <div className="flex flex-col">
          <dt>
            <label htmlFor={`disc-${opt.key}${sheet ? "-sheet" : ""}`} className="text-xs text-text-2">
              Discount
            </label>
          </dt>
          <dd>
            <PriceInput id={`disc-${opt.key}${sheet ? "-sheet" : ""}`} className="w-28" value={opt.discount} placeholder="0.00" onChange={(v) => setOption(at, { discount: v })} />
          </dd>
        </div>
        <Fig label={s.options.length > 1 ? `Option ${letter} total` : "Total"} strong>
          {fmt(totals.total)}
        </Fig>
        {showCosts && (
          <>
            <Fig label="Cost">{fmt(costing.costMinor)}</Fig>
            <Fig label="Profit" className={costing.profitMinor < 0 ? "text-bad" : undefined}>
              {fmt(costing.profitMinor)}
            </Fig>
            <Fig label="Margin" strong className={tone(costing.marginPercent)}>
              {costing.marginPercent === null ? "—" : `${costing.marginPercent.toFixed(1)}%`}
            </Fig>
          </>
        )}
      </dl>
    );
    // A phone in a window (design "Items on a small phone"): the total (and margin) in the footer beside Save; a tap
    // shows every figure, the discount box with them. Nothing floats over the items.
    const phoneTotal = (
      <button type="button" onClick={() => setSheetOpen(true)} aria-haspopup="dialog" className="flex min-w-0 flex-col items-start text-left">
        <span className="flex items-center gap-1 text-xs text-text-2">
          {showCosts ? "Total · margin" : "Total"} <ChevronUp className="size-3.5" aria-hidden />
        </span>
        <span className="max-w-full truncate text-lead font-bold tabular">
          {fmt(totals.total)}
          {showCosts && costing.marginPercent !== null && <span className={cn("font-semibold", tone(costing.marginPercent))}> · {costing.marginPercent.toFixed(1)}%</span>}
        </span>
      </button>
    );
    return (
      <>
        <div className={cn(phone && slot && "max-sm:hidden")}>{block(false)}</div>
        {phone && slot && createPortal(phoneTotal, slot)}
        {sheetOpen && (
          <BottomSheet title={s.options.length > 1 ? `Option ${letter} · totals` : "Totals"} sub="from the prices as they are now" onClose={() => setSheetOpen(false)}>
            {block(true)}
          </BottomSheet>
        )}
      </>
    );
  }
  return (
    <>
            <dl className="ml-auto flex flex-wrap items-end gap-x-5 gap-y-2 max-sm:hidden">
              <Fig label="Subtotal">{fmt(totals.subtotal)}</Fig>
              <div className="flex flex-col">
                <dt>
                  <label htmlFor={`disc-${opt.key}`} className="text-xs text-text-2">
                    Discount
                  </label>
                </dt>
                <dd>
                  <span className="flex items-center gap-1 text-sm font-semibold">
                    −
                    <PriceInput id={`disc-${opt.key}`} className="w-28" value={opt.discount} placeholder="0.00" onChange={(v) => setOption(at, { discount: v })} />
                  </span>
                </dd>
              </div>
              <Fig label={s.options.length > 1 ? `Option ${letter} total` : "Total"} strong>
                {fmt(totals.total)}
              </Fig>
              {showCosts && (
                <>
                  <Fig label="Cost">{fmt(costing.costMinor)}</Fig>
                  <Fig label="Profit" className={costing.profitMinor < 0 ? "text-bad" : undefined}>
                    {fmt(costing.profitMinor)}
                  </Fig>
                  <Fig label="Margin" strong className={tone(costing.marginPercent)}>
                    {costing.marginPercent === null ? "—" : `${costing.marginPercent.toFixed(1)}%`}
                  </Fig>
                </>
              )}
            </dl>
            {/* Phone: the total and the margin. */}
            <div className="ml-auto min-w-0 sm:hidden">
              <p className="text-xs text-text-2">{showCosts ? "Total · margin" : "Total"}</p>
              <p className="text-sm font-semibold tabular">
                {fmt(totals.total)}
                {showCosts && costing.marginPercent !== null ? ` · ${costing.marginPercent.toFixed(1)}%` : ""}
              </p>
            </div>
    </>
  );
}

/**
 * A price box: the figure with its thousands separators while it is not being
 * typed in ("42,560.00"), the bare number while it is; all selected on focus.
 */
function PriceInput({ value, onChange, className, ...props }: Omit<React.ComponentProps<"input">, "value" | "onChange"> & { value: string; onChange: (v: string) => void }) {
  const [typing, setTyping] = useState(false);
  const n = Number(numberText(value));
  const shown = !typing && value.trim() !== "" && Number.isFinite(n) ? amount2(n) : value;
  return (
    <input
      {...props}
      inputMode="decimal"
      className={cn(PRICE_BOX, className)}
      value={shown}
      onFocus={(e) => {
        setTyping(true);
        const el = e.currentTarget;
        requestAnimationFrame(() => el.select());
      }}
      onBlur={() => setTyping(false)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * The option's charges as a plain table: each one's boxes in place, a remove
 * button, and an entry row at the bottom ("Add a charge…") that becomes a
 * charge as soon as something is typed in it. On a phone each charge is a
 * small block of the same boxes.
 */
function ChargesTable({
  charges,
  currency,
  showCosts,
  amountOf,
  onChange,
  onRemove,
  onStart,
}: {
  charges: ChargeState[];
  currency: string;
  showCosts: boolean;
  amountOf: (v: string | undefined) => number;
  onChange: (k: number, patch: Partial<ChargeState>) => void;
  onRemove: (k: number) => void;
  onStart: (description: string) => void;
}) {
  const total = (c: ChargeState) => amount2((amountOf(c.unitPrice) * (Number(numberText(c.quantity)) || 0)) / 100);
  const unitSelect = (c: ChargeState, k: number, label: string) => (
    <Select size="sm" aria-label={label} value={c.unit} onChange={(e) => onChange(k, { unit: e.target.value })}>
      {[...new Set([c.unit, ...UNITS, "job", "trip", "container"])].filter(Boolean).map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
    </Select>
  );
  return (
    <>
      <table className="w-full table-fixed border-separate border-spacing-0 overflow-hidden rounded-lg border border-line text-sm max-sm:hidden" aria-label="Charges">
        <colgroup>
          <col className="w-14" />
          <col />
          <col className="w-20" />
          <col className="w-28" />
          {showCosts && <col className="w-32" />}
          <col className="w-36" />
          <col className="w-32" />
          <col className="w-10" />
        </colgroup>
        <thead>
          <tr>
            <th className={cn(TH, "text-left")}>No.</th>
            <th className={cn(TH, "text-left")}>Charge</th>
            <th className={cn(TH, "text-right")}>Quantity</th>
            <th className={cn(TH, "text-left")}>Unit</th>
            {showCosts && <th className={cn(TH, "text-right")}>Our cost {currency}</th>}
            <th className={cn(TH, "text-right")}>Unit price {currency}</th>
            <th className={cn(TH, "text-right")}>Amount {currency}</th>
            <th className={TH}>
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {charges.map((c, k) => (
            <tr key={c.key} className="[&>td]:border-b [&>td]:border-line">
              <td className="px-3 py-1.5 align-middle text-xs text-muted tabular">{k + 1}</td>
              <td className="px-3 py-1.5 align-middle">
                <input data-charge={c.key} aria-label={`Charge ${k + 1}`} className={CELL_BOX} value={c.description} maxLength={500} onChange={(e) => onChange(k, { description: e.target.value })} />
              </td>
              <td className="px-3 py-1.5 align-middle">
                <input aria-label={`Charge ${k + 1} quantity`} inputMode="decimal" className={cn(CELL_BOX, "text-right tabular")} value={c.quantity} onChange={(e) => onChange(k, { quantity: e.target.value })} />
              </td>
              <td className="px-3 py-1.5 align-middle">{unitSelect(c, k, `Charge ${k + 1} unit`)}</td>
              {showCosts && (
                <td className="px-3 py-1.5 align-middle">
                  <PriceInput aria-label={`Charge ${k + 1} our cost`} value={c.unitCost} onChange={(v) => onChange(k, { unitCost: v })} />
                </td>
              )}
              <td className="px-3 py-1.5 align-middle">
                <PriceInput aria-label={`Charge ${k + 1} price`} value={c.unitPrice} placeholder="0.00" onChange={(v) => onChange(k, { unitPrice: v })} />
              </td>
              <td className="px-3 py-1.5 text-right align-middle font-semibold whitespace-nowrap tabular">{total(c)}</td>
              <td className="px-1 py-1.5 align-middle">
                <Button size="icon-xs" variant="ghost" aria-label={`Remove charge ${k + 1}`} onClick={() => onRemove(k)}>
                  <X aria-hidden />
                </Button>
              </td>
            </tr>
          ))}
          {/* The entry row: typing a charge here adds it. */}
          <tr>
            <td className="px-3 py-2 align-middle text-xs text-muted tabular">{charges.length + 1}</td>
            <td className="px-3 py-2 align-middle" colSpan={showCosts ? 6 : 5}>
              <input aria-label="Add a charge" className={cn(CELL_BOX, "max-w-xl")} value="" onChange={(e) => e.target.value && onStart(e.target.value)} />
            </td>
            <td />
          </tr>
        </tbody>
      </table>
      {/* Phone: each charge a small block. */}
      <ul className="flex flex-col gap-3 sm:hidden">
        {charges.map((c, k) => (
          <li key={c.key} className="flex flex-col gap-2 rounded-lg border border-line p-3">
            <div className="flex items-center gap-2">
              <input data-charge={`${c.key}-m`} aria-label={`Charge ${k + 1}`} className={CELL_BOX} value={c.description} onChange={(e) => onChange(k, { description: e.target.value })} />
              <Button size="icon-xs" variant="ghost" aria-label={`Remove charge ${k + 1}`} onClick={() => onRemove(k)}>
                <X aria-hidden />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input aria-label={`Charge ${k + 1} quantity`} inputMode="decimal" className={cn(CELL_BOX, "text-right tabular")} value={c.quantity} onChange={(e) => onChange(k, { quantity: e.target.value })} />
              {unitSelect(c, k, `Charge ${k + 1} unit`)}
              <input aria-label={`Charge ${k + 1} price`} inputMode="decimal" className={PRICE_BOX} value={c.unitPrice} placeholder="Price" onChange={(e) => onChange(k, { unitPrice: e.target.value })} />
              {showCosts && (
                <input aria-label={`Charge ${k + 1} our cost`} inputMode="decimal" className={cn(CELL_BOX, "col-span-3 text-right tabular")} value={c.unitCost} onChange={(e) => onChange(k, { unitCost: e.target.value })} />
              )}
            </div>
          </li>
        ))}
        <li>
          <Button size="sm" variant="secondary" onClick={() => onStart("")}>
            <Plus aria-hidden /> Add a charge
          </Button>
        </li>
      </ul>
    </>
  );
}
