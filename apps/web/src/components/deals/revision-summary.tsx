import { CornerDownRight } from "lucide-react";
import { BALANCE_TERMS_LABEL, LINE_TYPE_LABEL } from "@kebo/shared";
import { Badge, cn, DetailList, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { date, money, qty } from "@/lib/format";
import type { OptionView, RevisionView } from "@/lib/types-deals";
import { CostingBox, CoverageBadge } from "./revision-editor";

const STATUS: Record<OptionView["status"], { label: string; tone: "ok" | "neutral" } | null> = {
  open: null,
  accepted: { label: "Accepted", tone: "ok" },
  not_chosen: { label: "Not chosen", tone: "neutral" },
};

/** A revision as the customer saw it (read only): its terms and each option, with the internal costing for people who may see costs. */
export function RevisionSummary({ r }: { r: RevisionView }) {
  return (
    <div className="flex flex-col gap-4">
      <DetailList
        columns={3}
        items={[
          { label: "Terms of delivery", value: `${r.incoterm}${r.incotermPlace ? ` ${r.incotermPlace}` : ""}` },
          { label: "Payment", value: `${r.depositPercent}% deposit · ${BALANCE_TERMS_LABEL[r.balanceTerms].toLowerCase()}` },
          { label: "Options", value: r.options.length === 1 ? "One" : r.options.map((o) => o.letter).join(", ") },
          { label: "Valid until", value: date(r.validUntil) },
        ]}
      />
      {r.options.map((o) => (
        <OptionSummary key={o.id} o={o} currency={r.currency} single={r.options.length === 1} />
      ))}
      {(r.terms || r.notes) && (
        <div className="text-sm">
          {r.terms && <p className="whitespace-pre-line text-text-2">{r.terms}</p>}
          {r.notes && <p className="mt-2 whitespace-pre-line text-muted">{r.notes}</p>}
        </div>
      )}
    </div>
  );
}

function OptionSummary({ o, currency, single }: { o: OptionView; currency: string; single: boolean }) {
  const showCosts = !!o.costing;
  const st = STATUS[o.status];
  return (
    <section aria-label={`Option ${o.letter}`} className={cn("rounded-xl border border-line", o.status === "accepted" && "border-ok/50", o.status === "not_chosen" && "opacity-75")}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{single ? "The offer" : `Option ${o.letter}`}</span>
          {st && <Badge tone={st.tone}>{st.label}</Badge>}
          {o.factory && <span className="text-xs text-muted">from {o.factory.name}</span>}
          {o.leadTime && <span className="text-xs text-muted">· {o.leadTime}</span>}
        </div>
        <div className="flex items-center gap-2">
          {o.factory && <CoverageBadge missing={o.coverage.missing} />}
          <span className="text-sm font-semibold tabular">{money(o.total, currency)}</span>
        </div>
      </header>
      <Table>
        <THead>
          <tr>
            <Th>No.</Th>
            <Th>Description</Th>
            <Th className="text-right">Qty</Th>
            <Th className="text-right">Unit price</Th>
            {showCosts && <Th className="text-right">Unit cost</Th>}
            <Th className="text-right">Total</Th>
          </tr>
        </THead>
        <tbody>
          {o.lines.map((l) => (
            <Tr key={l.id}>
              <Td className="text-muted tabular">{l.no}</Td>
              <Td className={cn("min-w-52", l.no.includes(".") && "pl-6")}>
                <span className="flex items-start gap-1">
                  {l.no.includes(".") && <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden />}
                  <span className="block max-w-[28rem] text-sm whitespace-pre-line">{l.description}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  {l.type !== "goods" && <Badge tone="outline">{LINE_TYPE_LABEL[l.type]}</Badge>}
                  {l.model}
                </span>
              </Td>
              <Td className="text-right whitespace-nowrap tabular">
                {qty(l.quantity)} {l.unit}
              </Td>
              <Td className="text-right whitespace-nowrap tabular">{money(l.unitPrice, currency)}</Td>
              {showCosts && <Td className="text-right whitespace-nowrap text-text-2 tabular">{l.unitCost ? money(l.unitCost, currency) : "—"}</Td>}
              <Td className="text-right font-medium whitespace-nowrap tabular">{money(l.lineTotal, currency)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div />
        <div className="flex flex-col gap-3">
          <dl className="rounded-lg border border-line p-3 text-sm">
            <div className="flex justify-between py-1">
              <dt className="text-muted">Subtotal</dt>
              <dd className="tabular">{money(o.subtotal, currency)}</dd>
            </div>
            {Number(o.discount) > 0 && (
              <div className="flex justify-between py-1">
                <dt className="text-muted">Discount</dt>
                <dd className="tabular">− {money(o.discount, currency)}</dd>
              </div>
            )}
            <div className="mt-1 flex justify-between border-t border-line pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular">{money(o.total, currency)}</dd>
            </div>
          </dl>
          {o.costing && (
            <CostingBox currency={currency} cost={o.costing.costMinor} sales={o.costing.salesMinor} profit={o.costing.profitMinor} margin={o.costing.marginPercent} uncosted={o.costing.uncostedLines} />
          )}
        </div>
      </div>
    </section>
  );
}
