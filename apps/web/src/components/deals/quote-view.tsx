import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { toMinor } from "@kebo/money";
import { isWarrantyFrom, LINE_TYPE_LABEL, partsWords, partWhen, percentText, termsChecks, warrantyLine, type PaymentRoute, type TermsCheck, type WarrantyFrom } from "@kebo/shared";
import { Badge, cn } from "@kebo/ui";
import { money, qty } from "@/lib/format";
import type { OptionView, RevisionView } from "@/lib/types-deals";
import { shortName } from "./offer-facts";

/*
 * One quotation as the Quotations tab shows it, read only (design "one way, any number"): its lines in the app's
 * clean table and its terms in three groups (Delivery · Payment · Warranty & conditions), each with its pencil
 * on a draft. Server-safe: no state of its own.
 */

const ROUTE: Record<PaymentRoute, string> = { informal: "Informal", bank_contract: "Bank contract", letter_of_credit: "Letter of credit" };
const two = (v: string | number) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The option that speaks for the revision: the accepted one, else the first. */
export const optionOf = (r: RevisionView): OptionView | undefined => r.options.find((o) => o.status === "accepted") ?? r.options[0];

/** What we promise against what the option's factory gives (people who see costs): lead time, payment, warranty. */
export function checksOf(r: RevisionView, o: OptionView | undefined): TermsCheck[] {
  if (!o?.factory || !o.factoryTerms) return [];
  const factoryMinor = o.costing ? o.costing.costMinor - o.costing.extraCostMinor : 0;
  return termsChecks(
    { leadDays: o.leadDays, leadFrom: o.leadFrom, parts: r.paymentParts, warrantyMonths: r.warrantyMonths, warrantyFrom: r.warrantyFrom, totalMinor: toMinor(o.total), currency: r.currency },
    { factory: shortName(o.factory.name), ...o.factoryTerms, costMinor: factoryMinor > 0 ? factoryMinor : null },
  );
}

/** A check as a short chip: its words, the whole sentence on hover and for screen readers. */
export function CheckChip({ check }: { check: TermsCheck }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", check.ok ? "text-ok" : "text-warn")} title={check.text}>
      {check.ok ? <CheckCircle2 className="size-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="size-3.5 shrink-0" aria-hidden />}
      {check.word}
      <span className="sr-only">: {check.text}</span>
    </span>
  );
}

const FROM_SHORT: Record<WarrantyFrom, string> = { shipment: "shipment", delivery: "delivery", sat: "SAT" };

/** The revision's facts in a line each, for the list row: "FOB Ningbo", "45 days after the deposit", the parts, "12 months from SAT". */
export function termsFacts(r: RevisionView) {
  const o = optionOf(r);
  const from = isWarrantyFrom(r.warrantyFrom) ? r.warrantyFrom : "shipment";
  return {
    delivery: `${r.incoterm}${r.incotermPlace ? ` ${r.incotermPlace}` : ""}`,
    lead: o?.leadTime ?? r.leadTime ?? null,
    payment: partsWords(r.paymentParts, "customer"),
    warranty: r.warrantyMonths !== null ? `${r.warrantyMonths} months from ${FROM_SHORT[from]}` : (warrantyLine(r)?.replace(/\.$/, "") ?? null),
  };
}

/** A pencil-headed group of facts (Delivery, Payment, Warranty & conditions). */
function Group({ title, edit, children }: { title: string; edit?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-1 px-4 py-3 text-[13px] leading-relaxed text-text-2 max-md:border-b max-md:border-line max-md:last:border-b-0 md:border-l md:border-line md:first:border-l-0">
      <h4 className="flex min-h-7 items-center justify-between gap-2 text-xs font-bold tracking-wide text-text uppercase">
        {title}
        {edit}
      </h4>
      {children}
    </section>
  );
}

/** The three groups of terms; `edit(group)` gives a group's pencil on a draft that can change. */
export function QuoteTerms({ r, showChecks, edit }: { r: RevisionView; showChecks: boolean; edit?: (group: "delivery" | "payment" | "warranty") => ReactNode }) {
  const o = optionOf(r);
  const checks = showChecks ? checksOf(r, o) : [];
  const check = (key: TermsCheck["key"]) => checks.find((c) => c.key === key);
  const total = Number(o?.total ?? r.total);
  const lead = o?.leadTime ?? r.leadTime;
  const c = { lead: check("lead"), payment: check("payment"), warranty: check("warranty") };
  return (
    <div className="grid overflow-hidden rounded-xl border border-line bg-surface md:grid-cols-3">
      <Group title="Delivery" edit={edit?.("delivery")}>
        <span className="font-medium text-text">
          {r.incoterm}
          {r.incotermPlace ? ` ${r.incotermPlace}` : ""}
        </span>
        {r.portOfDischarge && <span>Port of discharge: {r.portOfDischarge}</span>}
        {lead && <span>{lead}</span>}
        {c.lead && <CheckChip check={c.lead} />}
        {r.deliveryTerms && <span className="line-clamp-3 whitespace-pre-line">{r.deliveryTerms}</span>}
      </Group>
      <Group title="Payment" edit={edit?.("payment")}>
        <span className="font-medium text-text">{r.paymentRoute ? ROUTE[r.paymentRoute] : "How they pay: not decided"}</span>
        {r.paymentParts.map((p, i) => (
          <span key={i} className="tabular">
            {percentText(p.percent)}% {partWhen(p, "customer")}
            {total > 0 && <> · {money((total * p.percent) / 100, r.currency)}</>}
          </span>
        ))}
        {c.payment && <CheckChip check={c.payment} />}
        {r.paymentTerms && <span className="line-clamp-3 whitespace-pre-line">{r.paymentTerms}</span>}
      </Group>
      <Group title="Warranty & conditions" edit={edit?.("warranty")}>
        <span className="font-medium text-text">{warrantyLine(r)?.replace(/\.$/, "") ?? "No warranty said"}</span>
        {c.warranty && <CheckChip check={c.warranty} />}
        {r.notes && <span className="line-clamp-4 whitespace-pre-line">{r.notes}</span>}
      </Group>
    </div>
  );
}

/** One option's lines in the app's clean table, with its totals (cost, profit and margin for people who see costs). */
function OptionTable({ o, currency, title }: { o: OptionView; currency: string; title?: string }) {
  const costs = !!o.costing;
  const marginOf = (price: string, cost: string | null | undefined) => {
    const p = Number(price);
    const k = cost === null || cost === undefined ? NaN : Number(cost);
    return p > 0 && Number.isFinite(k) ? ((p - k) / p) * 100 : null;
  };
  const cell = "border-b border-line px-3 py-2 align-top";
  const num = cn(cell, "text-right whitespace-nowrap tabular");
  return (
    <div className="flex flex-col gap-2">
      {title && <p className="text-[13px] font-semibold">{title}</p>}
      {/* It can scroll sideways, so Tab stops on it. */}
      <div tabIndex={0} role="region" aria-label={title ?? "Lines"} className="overflow-x-auto rounded-xl border border-line bg-surface focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-surface-2 text-left text-xs text-text-2">
              <th scope="col" className="w-12 border-b border-line px-3 py-2 font-medium">
                No.
              </th>
              <th scope="col" className="border-b border-line px-3 py-2 font-medium">
                Item
              </th>
              <th scope="col" className="border-b border-line px-3 py-2 text-right font-medium">
                Qty
              </th>
              {costs && (
                <th scope="col" className="border-b border-line px-3 py-2 text-right font-medium max-md:hidden">
                  Cost
                </th>
              )}
              <th scope="col" className="border-b border-line px-3 py-2 text-right font-medium">
                Unit price
              </th>
              {costs && (
                <th scope="col" className="border-b border-line px-3 py-2 text-right font-medium max-md:hidden">
                  Margin
                </th>
              )}
              <th scope="col" className="border-b border-line px-3 py-2 text-right font-medium">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {o.lines.map((l) => {
              const part = l.no.includes(".");
              const m = costs ? marginOf(l.unitPrice, l.unitCost) : null;
              return (
                <tr key={l.id} className="last:[&>td]:border-b-0">
                  <td className={cn(cell, "text-text-2 tabular", part && "pl-5")}>{l.no}</td>
                  <td className={cn(cell, "min-w-48", part && "pl-7")}>
                    <span className={cn("block whitespace-pre-line text-text", !part && "font-semibold")}>{l.description}</span>
                    {(l.model || l.type !== "goods") && (
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-text-2">
                        {l.type !== "goods" && <Badge tone="outline">{LINE_TYPE_LABEL[l.type]}</Badge>}
                        {l.model}
                      </span>
                    )}
                  </td>
                  <td className={num}>
                    {qty(l.quantity)} {l.unit}
                  </td>
                  {costs && (
                    <td className={cn(num, "text-text-2 max-md:hidden")}>
                      {l.unitCost ? two(l.unitCost) : "—"}
                    </td>
                  )}
                  <td className={num}>{two(l.unitPrice)}</td>
                  {costs && <td className={cn(num, "max-md:hidden", m === null ? "text-text-2" : m < 0 ? "text-bad" : m < 5 ? "text-warn" : "text-text-2")}>{m === null ? "—" : `${m.toFixed(1)}%`}</td>}
                  <td className={cn(num, "font-semibold")}>{two(l.lineTotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-line bg-surface-2/50 px-4 py-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <dt className="text-text-2">Subtotal</dt>
          <dd className="text-sm font-semibold tabular">{two(o.subtotal)}</dd>
        </div>
        <div>
          <dt className="text-text-2">Discount</dt>
          <dd className="text-sm font-semibold tabular">{two(o.discount)}</dd>
        </div>
        <div>
          <dt className="text-text-2">Total</dt>
          <dd className="text-sm font-semibold tabular">{money(o.total, currency)}</dd>
        </div>
        {o.costing && (
          <>
            <div>
              <dt className="text-text-2">Cost</dt>
              <dd className="text-sm font-semibold tabular">{two(o.costing.cost)}</dd>
            </div>
            <div>
              <dt className="text-text-2">Profit</dt>
              <dd className={cn("text-sm font-semibold tabular", Number(o.costing.profit) < 0 && "text-bad")}>{two(o.costing.profit)}</dd>
            </div>
            <div>
              <dt className="text-text-2">Margin</dt>
              <dd className={cn("text-sm font-semibold tabular", o.costing.marginPercent !== null && o.costing.marginPercent < 0 && "text-bad")}>
                {o.costing.marginPercent === null ? "—" : `${o.costing.marginPercent.toFixed(1)}%`}
              </dd>
            </div>
          </>
        )}
      </dl>
    </div>
  );
}

/** The revision's lines: one table (an older quotation offering several options: one per option). */
export function QuoteLines({ r }: { r: RevisionView }) {
  if (r.options.length === 1) return <OptionTable o={r.options[0]!} currency={r.currency} />;
  return (
    <div className="flex flex-col gap-4">
      {r.options.map((o) => (
        <OptionTable
          key={o.id}
          o={o}
          currency={r.currency}
          title={`Option ${o.letter}${o.factory ? ` · ${shortName(o.factory.name)}` : ""}${o.status === "accepted" ? " · accepted" : o.status === "not_chosen" ? " · not chosen" : ""}`}
        />
      ))}
    </div>
  );
}
