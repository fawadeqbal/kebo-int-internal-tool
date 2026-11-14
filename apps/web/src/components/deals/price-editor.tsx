"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ClipboardPaste, Lock, Plus, X } from "lucide-react";
import { convertMinor, formatMinor, fromMinor, fxRate, landedUnitCosts, marginPercent, priceForMargin, toMinor } from "@kebo/money";
import { basisText, BASIS_STEP_LABEL, optionLetter } from "@kebo/shared";
import { Badge, Button, Card, cn, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { EditButton } from "@/components/common/edit-button";
import { ActionForm } from "@/components/common/action-form";
import { PANEL_FORM, PanelActions, PanelBody, useClosePanel, useReportDirty } from "@/components/common/panel";
import { UNITS } from "@/components/lines/line-table";
import type { ActionState } from "@/lib/actions";
import type { QuoteOffers, RevisionDraft } from "@/lib/types-deals";
import type { Fx } from "@/lib/fx";
import { ErrorText, numberText, rowKey } from "./form-bits";
import { shortName } from "./offer-facts";
import { againstTarget, asLineOf, BasisCosts, Fig, fromDraft, gapOf, marginOf, optionTotals, payload, pricedAll, startMargin, STEP_LINE, targetOf, valid, type ChargeState, type EditorState, type OptionState } from "./revision-editor";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** A price box: right-aligned figures, the whole value selected on focus. */
const PRICE_BOX =
  "h-9 w-full min-w-0 rounded-lg border border-line bg-surface px-3 text-right text-sm tabular outline-none placeholder:text-muted/70 focus:border-primary focus:ring-2 focus:ring-primary/30";
/** A plain box in the charges table. */
const CELL_BOX = "h-9 w-full min-w-0 rounded-lg border border-line bg-surface px-3 text-sm outline-none placeholder:text-muted/80 focus:border-primary focus:ring-2 focus:ring-primary/30";
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
/** The option the lines window opens on (0 = A): the one shown on the card it was opened from. */
export const OptionAt = createContext(0);

export function PriceEditor({
  action,
  initial,
  offers,
  showCosts,
}: {
  action: Action;
  initial: RevisionDraft;
  offers: QuoteOffers;
  showCosts: boolean;
}) {
  const initialOption = useContext(OptionAt);
  const close = useClosePanel();
  const reportDirty = useReportDirty();
  const [s, setS] = useState<EditorState>(() => fromDraft(initial));
  const [saved] = useState(() => JSON.stringify(fromDraft(initial)));
  const [active, setActive] = useState(Math.min(Math.max(0, initialOption), initial.options.length - 1));
  // The box starts with the margin the options have now (not the usual one from Settings).
  const [margin, setMargin] = useState(() => startMargin(fromDraft(initial), offers));
  const [costsOpen, setCostsOpen] = useState(false);
  const [paste, setPaste] = useState<string | null>(null);
  const [chargesOpen, setChargesOpen] = useState(false);
  const dirty = JSON.stringify(s) !== saved;
  // The window asks "Discard changes?" only when a price really changed.
  useEffect(() => {
    reportDirty(dirty);
    return () => reportDirty(null);
  }, [dirty, reportDirty]);
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
  const { lines, totals, costing, extra } = totalsOf(opt);
  const landed = landedUnitCosts(
    lines.map((l) => ({ unitCostMinor: l.unitCost === null ? null : toMinor(l.unitCost), quantity: numberText(l.quantity) || 0 })),
    extra.minor,
  );
  const offer = opt.factoryQuoteId ? offers.offers.find((o) => o.factoryQuoteId === opt.factoryQuoteId) : null;
  const itemName = (no: string) => offers.items.find((i) => i.no === no)?.description.split("\n")[0] ?? "";
  const topItems = offers.items.filter((i) => !i.parentId).length;
  const fx: Fx = { main: offers.mainCurrency, rates: offers.rates };
  const ours = basisText(s.incoterm, s.incotermPlace.trim() || null);

  const priceAll = () => marginOk && setS((st) => ({ ...st, options: pricedAll(st, offers, marginNumber) }));

  const nameOf = (o: OptionState) => (o.factoryQuoteId ? (offers.offers.find((x) => x.factoryQuoteId === o.factoryQuoteId)?.factory.name ?? "a removed offer") : "the customer's items");

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
    // On the landed cost: the factory's cost plus this line's share of the costs to reach our basis.
    const cost = landed[i] ?? null;
    const m = showCosts && cost !== null && valid(price) && Number(numberText(price)) > 0 ? marginPercent(toMinor(numberText(price)), cost) : null;
    const part = l.no.includes(".");
    const second = [l.model ? `model ${l.model}` : null, opt.factoryQuoteId && l.answersNo ? `for item ${l.answersNo}` : null, offer && !part ? shortName(offer.factory.name) : null].filter(Boolean).join(" · ");
    // The price the customer hopes for (the item this line answers), and ours against it.
    const target = targetOf(l, offers);
    return { l, i, price, cost, m, part, second, target, against: againstTarget(price, target) };
  });
  // The target column only shows when the customer gave a target for a line of this option.
  const hasTargets = lineView.some((v) => v.target !== null && Number(v.target) > 0);
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
  const gap = opt.factoryQuoteId ? gapOf(opt, offers, s.incoterm) : null;
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
    const off = o.factoryQuoteId ? offers.offers.find((x) => x.factoryQuoteId === o.factoryQuoteId) : null;
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
            {optionLetter(i)} · {off ? shortName(off.factory.name) : o.factoryQuoteId ? "removed offer" : "by hand"}
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
    <PanelBody>
    <ActionForm action={action} onDone={(state) => close(state)} className={PANEL_FORM}>
      {(st) => (
        <>
          <input type="hidden" name="payload" value={JSON.stringify(payload(s, offers))} />

          {/* The options as tabs, and the margin for everything. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div role="tablist" aria-label="Options" className="-mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] max-sm:w-full">
              {s.options.map(optionCard)}
            </div>
            {showCosts && (
              <div className="ml-auto flex items-center gap-2 max-sm:w-full">
                <label htmlFor="price-all" className="text-xs text-text-2">
                  Price all at
                </label>
                <Input id="price-all" inputMode="decimal" className="h-9 w-16 text-right tabular" value={margin} onChange={(e) => setMargin(e.target.value)} />
                <span className="text-sm text-muted">%</span>
                <Button size="sm" variant="secondary" onClick={priceAll} disabled={!marginOk}>
                  Apply
                </Button>
              </div>
            )}
          </div>

          {/* The open option's lines. */}
          <Card aria-label={`Option ${letter} lines`}>
            <div className="border-b border-line px-4 py-3">
              <h3 className="text-sm font-semibold max-sm:hidden">
                Option {letter} · {opt.factoryQuoteId ? (offer ? `lines from ${offer.factory.name}'s offer` : "an offer that was removed") : "the customer's items"}
              </h3>
              <h3 className="text-sm font-semibold sm:hidden">Lines</h3>
              <p className="mt-0.5 text-xs text-muted max-sm:hidden">
                {offer?.coverage.missing.length ? (
                  <span className="inline-flex items-center gap-1 text-warn">
                    <AlertTriangle className="size-3.5" aria-hidden /> Does not cover {offer.coverage.missing.map((n) => `${n} (${itemName(n)})`).join(", ")}
                  </span>
                ) : (
                  `All ${topItems} customer item${topItems === 1 ? "" : "s"} covered`
                )}
                {offer ? ` · price basis ${offer.basis ? basisText(offer.basis, offer.basisPlace) : "not said"} → ${ours}` : ""}
              </p>
            </div>
            {lines.length === 0 && opt.factoryQuoteId && !offer && (
              <p className="m-4 rounded-md bg-warn-soft px-3 py-2 text-sm">This factory offer was removed from the inquiry. Remove this option or add another offer.</p>
            )}
            {/* Wide: every column in view. */}
            <div className="p-4 max-sm:hidden">
              <table className="w-full table-fixed border-separate border-spacing-0 overflow-hidden rounded-lg border border-line text-sm" aria-label={`Option ${letter} prices`}>
                <colgroup>
                  <col className="w-14" />
                  <col />
                  <col className="w-24" />
                  {showCosts && <col className="w-32" />}
                  {hasTargets && <col className="w-32" />}
                  <col className="w-40" />
                  {showCosts && <col className="w-24" />}
                  <col className="w-32" />
                </colgroup>
                <thead>
                  <tr>
                    <th className={cn(TH, "text-left")}>No.</th>
                    <th className={cn(TH, "text-left")}>Description</th>
                    <th className={cn(TH, "text-right")}>Qty</th>
                    {showCosts && <th className={cn(TH, "text-right")}>{extra.minor > 0 ? "Cost (landed)" : "Cost"}</th>}
                    {hasTargets && <th className={cn(TH, "text-right")}>Customer&rsquo;s target</th>}
                    <th className={cn(TH, "text-right")}>Unit price {currency}</th>
                    {showCosts && <th className={cn(TH, "text-right")}>Margin</th>}
                    <th className={cn(TH, "text-right")}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lineView.map(({ l, i, price, cost, m, part, second, target, against }) => (
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
                        <td className="px-3 py-2 text-right align-middle whitespace-nowrap text-text-2 tabular" title={cost !== null && extra.minor > 0 && l.unitCost !== null ? `Factory ${fmt(toMinor(l.unitCost))} + its share of the costs to reach ${s.incoterm}` : undefined}>
                          {cost === null ? "—" : amount2(Number(fromMinor(cost)))}
                        </td>
                      )}
                      {hasTargets && (
                        <td className="px-3 py-1.5 text-right align-middle whitespace-nowrap tabular">
                          {target !== null && Number(target) > 0 ? (
                            <>
                              <span className="block text-text-2">{amount2(Number(target))}</span>
                              {against && <span className={cn("block text-xs font-medium", against.over ? "text-warn" : "text-ok")}>{against.text}</span>}
                            </>
                          ) : (
                            <span className="text-xs text-muted">not said</span>
                          )}
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
            {/* Phone: one row per line, its price box on the right. */}
            <ul className="flex flex-col divide-y divide-line px-4 sm:hidden">
              {lineView.map(({ l, i, price, cost, m, part, target, against }) => (
                <li key={l.id} className={cn("flex items-center gap-3 py-2.5", part && "pl-3")}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      <span className="text-xs text-muted tabular">{l.no}</span> {l.description.split("\n")[0]}
                    </span>
                    <span className="block text-xs text-text-2 tabular">
                      {Number(l.quantity).toLocaleString("en-US", { maximumFractionDigits: 2 })} {l.unit}
                      {showCosts && cost !== null ? ` · cost ${Math.round(Number(fromMinor(cost))).toLocaleString("en-US")}` : ""}
                      {showCosts && m !== null && <span className={tone(m)}> · {m.toFixed(1)}%</span>}
                    </span>
                    {target !== null && Number(target) > 0 && (
                      <span className="block text-xs text-text-2 tabular">
                        target {amount2(Number(target))}
                        {against && <span className={against.over ? "text-warn" : "text-ok"}> · {against.text}</span>}
                      </span>
                    )}
                  </span>
                  <PriceInput
                    aria-label={`Unit price for ${l.no}`}
                    data-price-m={`${at}:${i}`}
                    className="w-28 shrink-0"
                    value={price}
                    placeholder="0.00"
                    onChange={(v) => setPrice(l.id, v)}
                    onKeyDown={priceKeys(i, "data-price-m")}
                    onPaste={pricePaste(i)}
                  />
                </li>
              ))}
            </ul>
          </Card>

          {/* The costs between the factory's basis and ours: internal, one line. */}
          {showCosts && opt.factoryQuoteId && offer && (
            <Card aria-label={`Getting it to ${ours}`}>
              <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">Getting it to {ours}</h3>
                  <p className="mt-0.5 text-xs text-muted">
                    <Lock className="mr-1 inline size-3" aria-hidden />
                    Internal: added to the cost of the lines above, never printed.
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-3 px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-sm">
                  {!gap ? (
                    <span className="flex items-center gap-1.5 text-warn">
                      <AlertTriangle className="size-4" aria-hidden /> The offer does not say its price basis: set it on Factory offers, or add freight as a charge.
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
                    factoryBasis={offer.basis}
                    factoryPlace={offer.basisPlace}
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
                <h3 className="text-sm font-semibold">
                  Charges<span className="sm:hidden"> · {opt.charges.length}</span>
                </h3>
                <p className="mt-0.5 text-xs text-muted max-sm:hidden">Our own price lines (freight, inspection…): printed on the quotation.{showCosts ? " Cost is internal." : ""}</p>
              </div>
              <Button size="xs" variant="ghost" className="max-sm:hidden" onClick={() => setPaste((v) => (v === null ? "" : null))} aria-expanded={paste !== null}>
                <ClipboardPaste aria-hidden /> Paste a list
              </Button>
              {chargesOpen ? (
                <Button size="xs" variant="secondary" className="sm:hidden" onClick={() => setChargesOpen(false)} aria-expanded>
                  Done
                </Button>
              ) : (
                <EditButton size="xs" className="sm:hidden" onClick={() => setChargesOpen(true)} aria-expanded={false} />
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

          {/* The option's own term. */}
          <div className="max-w-sm">
            <TermBox label="Lead time" id={`lead-${opt.key}`} hint={s.options.length > 1 ? `Option ${letter}` : "Printed on the quotation"}>
              <Input id={`lead-${opt.key}`} value={opt.leadTime} maxLength={120} placeholder="e.g. 60 days after the deposit" onChange={(e) => setOption(at, { leadTime: e.target.value })} />
            </TermBox>
          </div>

          <ErrorText error={st.errors?.options ?? st.errors?.currency} />

          {/* Always in view: Save changes and Cancel as in every lines editor, then the option's money. */}
          <PanelActions>
            <SubmitButton size="sm" pendingText="Saving…" disabled={!dirty}>
              Save changes
            </SubmitButton>
            <Button size="sm" variant="ghost" onClick={() => close()}>
              Cancel
            </Button>
            <span className="text-xs text-muted max-lg:hidden">{dirty ? "Changes not saved yet" : "Nothing changed yet"}</span>
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
                    <PriceInput id={`disc-${opt.key}`} className="h-8 w-28" value={opt.discount} placeholder="0.00" onChange={(v) => setOption(at, { discount: v })} />
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
          </PanelActions>
        </>
      )}
    </ActionForm>
    </PanelBody>
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

function TermBox({ label, id, hint, error, children }: { label: string; id: string; hint?: string; error?: string[]; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {hint && <span className="ml-1.5 text-xs font-normal text-muted">{hint}</span>}
      </label>
      {children}
      <ErrorText error={error} />
    </div>
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
    <Select aria-label={label} className="h-9" value={c.unit} onChange={(e) => onChange(k, { unit: e.target.value })}>
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
            <th className={cn(TH, "text-right")}>Qty</th>
            <th className={cn(TH, "text-left")}>Unit</th>
            {showCosts && <th className={cn(TH, "text-right")}>Our cost {currency}</th>}
            <th className={cn(TH, "text-right")}>Price {currency}</th>
            <th className={cn(TH, "text-right")}>Total</th>
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
                  <PriceInput aria-label={`Charge ${k + 1} our cost`} value={c.unitCost} placeholder="Cost" onChange={(v) => onChange(k, { unitCost: v })} />
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
              <input aria-label="Add a charge" className={cn(CELL_BOX, "max-w-xl")} value="" placeholder="Add a charge: freight, inspection, insurance…" onChange={(e) => e.target.value && onStart(e.target.value)} />
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
                <input aria-label={`Charge ${k + 1} our cost`} inputMode="decimal" className={cn(CELL_BOX, "col-span-3 text-right tabular")} value={c.unitCost} placeholder="Our cost (internal)" onChange={(e) => onChange(k, { unitCost: e.target.value })} />
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
