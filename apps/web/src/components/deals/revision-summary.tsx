import { BALANCE_TERMS_LABEL, BASIS_STEP_LABEL, basisText, LINE_TYPE_LABEL } from "@kebo/shared";
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
      {r.options.map((o) =>
        o.status === "not_chosen" ? (
          // Once the customer has chosen, the other options are kept for reference, folded away.
          <details key={o.id} className="group rounded-xl border border-line">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
              <span className="flex items-center gap-2">
                <span className="font-semibold">Option {o.letter}</span>
                <Badge tone="neutral">Not chosen</Badge>
                {o.factory && (
            <span className="text-xs text-muted">
              from {o.factory.name}
              {o.factoryBasis ? ` · ${basisText(o.factoryBasis, o.factoryBasisPlace ?? null)}` : ""}
            </span>
          )}
              </span>
              <span className="flex items-center gap-2 text-muted">
                <span className="tabular">{money(o.total, r.currency)}</span>
                <span className="text-xs group-open:hidden">Show</span>
                <span className="hidden text-xs group-open:inline">Hide</span>
              </span>
            </summary>
            <div className="border-t border-line p-2">
              <OptionSummary o={o} currency={r.currency} incoterm={r.incoterm} single={false} />
            </div>
          </details>
        ) : (
          <OptionSummary key={o.id} o={o} currency={r.currency} incoterm={r.incoterm} single={r.options.length === 1} />
        ),
      )}
      {(r.paymentTerms || r.deliveryTerms || r.notes) && (
        <DetailList
          columns={3}
          items={[
            { label: "Payment terms", value: <span className="whitespace-pre-line">{r.paymentTerms}</span>, hidden: !r.paymentTerms },
            { label: "Delivery terms", value: <span className="whitespace-pre-line">{r.deliveryTerms}</span>, hidden: !r.deliveryTerms },
            { label: "Notes", value: <span className="whitespace-pre-line">{r.notes}</span>, hidden: !r.notes },
          ]}
        />
      )}
    </div>
  );
}

function OptionSummary({ o, currency, incoterm, single }: { o: OptionView; currency: string; incoterm: string; single: boolean }) {
  const showCosts = !!o.costing;
  const st = STATUS[o.status];
  return (
    <section
      aria-label={`Option ${o.letter}`}
      className={cn("rounded-xl border border-line", o.status === "accepted" && "border-ok/50", o.status === "not_chosen" && "opacity-75")}
    >
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
              <Td className="min-w-52">
                <span className="block max-w-[28rem] text-sm whitespace-pre-line">{l.description}</span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  {l.type !== "goods" && <Badge tone="outline">{LINE_TYPE_LABEL[l.type]}</Badge>}
                  {l.model}
                </span>
              </Td>
              <Td className="text-right whitespace-nowrap tabular">
                {qty(l.quantity)} {l.unit}
              </Td>
              <Td className="text-right whitespace-nowrap tabular">{money(l.unitPrice, currency)}</Td>
              {showCosts && (
                <Td className="text-right whitespace-nowrap text-text-2 tabular">{l.unitCost ? money(l.unitCost, currency) : "—"}</Td>
              )}
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
            <CostingBox
              currency={currency}
              cost={o.costing.costMinor}
              sales={o.costing.salesMinor}
              profit={o.costing.profitMinor}
              margin={o.costing.marginPercent}
              uncosted={o.costing.uncostedLines}
              extra={o.costing.extraCostMinor}
              extraLabel={`incl. costs to reach ${incoterm}`}
            />
          )}
          {o.costs && o.costs.length > 0 && (
            <ul className="text-xs text-muted">
              {o.costs.map((c) => (
                <li key={c.step} className="flex justify-between gap-2">
                  <span>
                    {BASIS_STEP_LABEL[c.step]}
                    {c.note ? ` · ${c.note}` : ""}
                  </span>
                  <span className="tabular">
                    {money(c.amount, c.currency)}
                    {c.currency !== currency ? ` ≈ ${money(c.cost, currency)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
