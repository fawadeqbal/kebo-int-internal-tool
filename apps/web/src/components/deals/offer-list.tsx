import Link from "next/link";
import type { ReactNode } from "react";
import { basisText } from "@kebo/shared";
import { Badge, cn, Notice } from "@kebo/ui";
import { date, dayMonth, money, qty } from "@/lib/format";
import type { FactoryQuoteView, SourcingView } from "@/lib/types-deals";

/*
 * An inquiry's supplier offers (design "RFQ Desk — list pages", 18 Nov 2026): each offer's figures as the list and
 * Compare say them — the Amount with tax and how the tax was given, the lead time's days and from when, the
 * Incoterm and its place, the deposit — and Compare: the offers side by side, the lowest, fastest and longest
 * marked in green.
 */

/** What an offer comes to, with tax, before tax, and how its tax was given. */
export function offerFigures(x: FactoryQuoteView) {
  const lines = Number(x.factoryTotal) || 0;
  const tax = Number(x.taxTotal) || 0;
  const rate = Number(x.taxRate) || 0;
  const withTax = x.taxIncluded ? lines : lines + tax;
  const beforeTax = x.taxIncluded ? lines - tax : lines;
  const taxWord = rate <= 0 ? "no tax" : x.taxIncluded ? `${rate}% tax included` : `with ${rate}% tax added`;
  // "35 days after deposit": the days, then from when (two short lines in a narrow column).
  const lead = x.leadTime ? x.leadTime.match(/^(.*?)\s+(after .*)$/) : null;
  const basis = basisText(x.basis, x.basisPlace);
  // The deposit: the part paid when we order, else the offer's old advance.
  const first = x.paymentParts.find((p) => p.rule === "on_order");
  const deposit = first ? first.percent : x.advancePercent;
  return {
    withTax,
    beforeTax,
    taxWord,
    shortTax: rate <= 0 ? "no tax" : x.taxIncluded ? `${rate}% included` : `${rate}% added`,
    lead: x.leadTime ? (lead ? { main: lead[1]!, sub: lead[2]! } : { main: x.leadTime, sub: null }) : null,
    basis: x.basis ? { main: x.basis, sub: x.basisPlace } : basis ? { main: basis, sub: null } : null,
    deposit: deposit === null || deposit === undefined ? null : `${deposit}%`,
  };
}

const Best = ({ children }: { children: ReactNode }) => (
  <Badge tone="ok" className="ml-1.5 h-5 px-2 align-[1px] text-2xs max-sm:mt-1 max-sm:ml-0 max-sm:flex max-sm:w-fit">
    {children}
  </Badge>
);

/**
 * Compare: the offers that have items side by side, down the side the price (Total with tax, Before tax, Tax, ≈ the
 * main currency), then item by item, then the terms. Lowest goes by the total with tax (in the main currency, so
 * offers in different currencies compare); an item's lowest by our cost per unit.
 */
export function OfferCompare({ view, status, dealId, waiting }: { view: SourcingView; status: (q: FactoryQuoteView) => ReactNode; dealId: string; waiting: string[] }) {
  const offers = view.quotes.filter((q) => q.lines.length);
  if (offers.length < 2)
    return <p className="px-5 py-8 text-center text-sm text-text-2">Compare needs two offers with their items{offers.length === 1 ? `; so far only ${offers[0]!.factory.name}'s` : ""}.</p>;
  const fig = new Map(offers.map((q) => [q.id, offerFigures(q)]));
  const one = new Set(offers.map((q) => q.currency)).size === 1;
  const foreign = offers.some((q) => q.currency !== view.currency);
  const complete = offers.filter((q) => q.totalCost !== null && !q.coverage.missing.length && !q.unpriced);
  const lowest = complete.length > 1 ? complete.reduce((a, b) => (Number(b.totalCost) < Number(a.totalCost) ? b : a)).id : null;
  const days = offers.map((q) => q.leadDays);
  const sameFrom = new Set(offers.map((q) => q.leadFrom)).size === 1;
  const fastest = sameFrom && days.every((d) => d !== null) && new Set(days).size > 1 ? offers.reduce((a, b) => (b.leadDays! < a.leadDays! ? b : a)).id : null;
  const months = offers.map((q) => q.warrantyMonths);
  const longest = months.every((m) => m !== null) && new Set(months).size > 1 ? offers.reduce((a, b) => (b.warrantyMonths! > a.warrantyMonths! ? b : a)).id : null;
  const bases = new Set(offers.map((q) => q.basis ?? "?"));
  // Two offers fit a 360 px phone side by side (labels narrow, values wrap); more scroll sideways in the card.
  const cols = { gridTemplateColumns: `minmax(6.5rem,13rem) repeat(${offers.length}, minmax(8rem, 1fr))`, minWidth: `${6.5 + 8 * offers.length}rem` };
  const cell = "border-b border-line/70 px-3 py-2 text-md leading-[19px] max-sm:px-2 max-sm:text-md max-sm:leading-[18px]";
  const label = cn(cell, "pl-5 text-md text-text-2 max-sm:pl-4 max-sm:text-xs");
  const group = (name: string) => (
    <div className="col-span-full border-b border-line/70 bg-surface-2/70 px-5 py-1.5 text-xs font-bold tracking-[.03em] text-text-2 uppercase max-sm:px-4">{name}</div>
  );
  const row = (name: ReactNode, value: (q: FactoryQuoteView) => ReactNode, best?: { id: string | null; word: string }, num = false) => (
    <>
      <div className={label}>{name}</div>
      {offers.map((q) => (
        <div key={q.id} className={cn(cell, num && "tabular")}>
          {value(q)}
          {best?.id === q.id && <Best>{best.word}</Best>}
        </div>
      ))}
    </>
  );
  const lines = view.items.length ? view.items : [];
  return (
    <div>
      {(view.missingRates.length > 0 || bases.size > 1) && (
        <div className="flex flex-col gap-2 border-b border-line px-5 py-3">
          {view.missingRates.length > 0 && (
            <Notice tone="todo">
              No exchange rate for {view.missingRates.join(", ")} in Settings: those offers cannot be set against the others in {view.currency}.
            </Notice>
          )}
          {bases.size > 1 && <Notice tone="todo">Not like for like: the offers have different Incoterms ({[...bases].map((b) => (b === "?" ? "not said" : b)).join(", ")}).</Notice>}
        </div>
      )}
      <div className="overflow-x-auto">
        <div role="group" aria-label="Offers side by side" className="grid w-full" style={cols}>
          <div className={cn(cell, "bg-surface-2/40")} />
          {offers.map((q) => (
            <div key={q.id} className={cn(cell, "bg-surface-2/40")}>
              <Link href={`/inquiries/${dealId}/offers/${q.id}`} className="block font-bold text-text hover:text-primary">
                {q.factory.name}
              </Link>
              <span className="mt-1 block">{status(q)}</span>
            </div>
          ))}
          {group("Price")}
          {row("Total with tax", (q) => <b className="font-bold">{money(fig.get(q.id)!.withTax, q.currency)}</b>, { id: lowest, word: "Lowest" }, true)}
          {row("Before tax", (q) => money(fig.get(q.id)!.beforeTax, q.currency), undefined, true)}
          {row("Tax", (q) => fig.get(q.id)!.shortTax)}
          {foreign && row(`≈ ${view.currency}`, (q) => (q.totalCost === null ? <span className="text-warn">No exchange rate</span> : money(q.totalCost, view.currency)), undefined, true)}
          {lines.length > 0 && group(one ? "Item by item · unit price with tax" : `Item by item · our cost per unit in ${view.currency}, with tax`)}
          {lines.map((it) => (
            <Row
              key={it.id}
              label={
                <span className={cn(it.parentId && "pl-3")}>
                  {it.no}. {it.description.split("\n")[0]} · {qty(it.quantity)} {it.unit}
                </span>
              }
              labelClass={label}
              cellClass={cn(cell, "tabular")}
              offers={offers}
              value={(q) => {
                const mine = it.options.filter((o) => o.quoteId === q.id);
                const o = mine.find((x) => x.id === it.cheapestLineId) ?? mine[0];
                if (!o) return <span className={it.hasParts ? "text-muted" : "text-warn"}>{it.hasParts ? "In its parts" : "Not offered"}</span>;
                if (Number(o.unitPrice) === 0) return <span className="text-warn">No price yet</span>;
                // With tax, as the totals and the Lowest mark go (an offer's prices may have it in, or not).
                const withTax = q.taxIncluded ? Number(o.unitPrice) : Number(o.unitPrice) * (1 + (Number(o.taxRate) || 0) / 100);
                const shown = one ? money(withTax, q.currency) : o.unitCost === null ? null : money(o.unitCost, view.currency);
                return (
                  <>
                    {shown ?? <span className="text-warn">No exchange rate</span>}
                    {o.id === it.cheapestLineId && it.options.length > 1 && <Best>Lowest</Best>}
                  </>
                );
              }}
            />
          ))}
          {group("Terms")}
          {row("Lead time", (q) => q.leadTime ?? <span className="text-muted">—</span>, { id: fastest, word: "Fastest" })}
          {row("Incoterm", (q) => basisText(q.basis, q.basisPlace) ?? <span className="text-muted">—</span>)}
          {row("Deposit", (q) => fig.get(q.id)!.deposit ?? <span className="text-muted">—</span>)}
          {row("Warranty", (q) => warrantyWords(q) ?? <span className="text-muted">—</span>, { id: longest, word: "Longest" })}
          {row("Valid until", (q) => (q.validUntil ? date(q.validUntil) : <span className="text-muted">—</span>))}
          {offers.some((q) => q.unpriced) && row("Items without a price", (q) => (q.unpriced ? <span className="text-warn">{q.unpriced}</span> : "None"))}
          {row("Their quotation file", (q) => (q.files.length ? "Attached" : <span className="text-warn">Missing</span>))}
        </div>
      </div>
      {waiting.length > 0 && <p className="px-5 py-2.5 text-md text-text-2">{waiting.join(" ")}</p>}
    </div>
  );
}

function Row({ label, labelClass, cellClass, offers, value }: { label: ReactNode; labelClass: string; cellClass: string; offers: FactoryQuoteView[]; value: (q: FactoryQuoteView) => ReactNode }) {
  return (
    <>
      <div className={labelClass}>{label}</div>
      {offers.map((q) => (
        <div key={q.id} className={cellClass}>
          {value(q)}
        </div>
      ))}
    </>
  );
}

const FROM = { shipment: "shipment", delivery: "delivery", sat: "the site test" } as const;
/** The warranty as the offer says it, else its months and from when ("18 months from shipment"). */
const warrantyWords = (q: FactoryQuoteView) =>
  q.warranty ?? (q.warrantyMonths !== null ? `${q.warrantyMonths} months${q.warrantyFrom ? ` from ${FROM[q.warrantyFrom]}` : ""}` : null);

/** "asked 15 Nov · answer due 20 Nov", "in 16 Nov · valid until 8 Dec". */
export const offerLine = (x: FactoryQuoteView) => [`in ${dayMonth(x.receivedOn)}`, x.validUntil ? `valid until ${dayMonth(x.validUntil)}` : null].filter(Boolean).join(" · ");
