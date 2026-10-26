import { BALANCE_TERMS_LABEL, LINE_TYPE_LABEL } from "@kebo/shared";
import { Badge, DetailList, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { date, money, qty } from "@/lib/format";
import type { RevisionView } from "@/lib/types-deals";
import { CostingBox } from "./revision-editor";

/** A revision as the customer saw it (read only), with the internal costing for people who may see costs. */
export function RevisionSummary({ r }: { r: RevisionView }) {
  const showCosts = !!r.costing;
  return (
    <div className="flex flex-col gap-4">
      <DetailList
        columns={3}
        items={[
          { label: "Terms of delivery", value: `${r.incoterm}${r.incotermPlace ? ` ${r.incotermPlace}` : ""}` },
          { label: "Payment", value: `${r.depositPercent}% deposit · ${BALANCE_TERMS_LABEL[r.balanceTerms].toLowerCase()}` },
          { label: "Lead time", value: r.leadTime },
          { label: "Valid until", value: date(r.validUntil) },
        ]}
      />
      <div className="rounded-lg border border-line">
        <Table>
          <THead>
            <tr>
              <Th>#</Th>
              <Th>Description</Th>
              <Th className="text-right">Qty</Th>
              <Th className="text-right">Unit price</Th>
              {showCosts && <Th className="text-right">Unit cost</Th>}
              <Th className="text-right">Total</Th>
            </tr>
          </THead>
          <tbody>
            {r.lines.map((l, i) => (
              <Tr key={l.id}>
                <Td className="text-muted tabular">{i + 1}</Td>
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
                <Td className="text-right whitespace-nowrap tabular">{money(l.unitPrice, r.currency)}</Td>
                {showCosts && <Td className="text-right whitespace-nowrap text-text-2 tabular">{l.unitCost ? money(l.unitCost, r.currency) : "—"}</Td>}
                <Td className="text-right font-medium whitespace-nowrap tabular">{money(l.lineTotal, r.currency)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="text-sm">
          {r.terms && <p className="whitespace-pre-line text-text-2">{r.terms}</p>}
          {r.notes && <p className="mt-2 whitespace-pre-line text-muted">{r.notes}</p>}
        </div>
        <div className="flex flex-col gap-3">
          <dl className="rounded-lg border border-line p-3 text-sm">
            <div className="flex justify-between py-1">
              <dt className="text-muted">Subtotal</dt>
              <dd className="tabular">{money(r.subtotal, r.currency)}</dd>
            </div>
            {Number(r.discount) > 0 && (
              <div className="flex justify-between py-1">
                <dt className="text-muted">Discount</dt>
                <dd className="tabular">− {money(r.discount, r.currency)}</dd>
              </div>
            )}
            <div className="mt-1 flex justify-between border-t border-line pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular">{money(r.total, r.currency)}</dd>
            </div>
          </dl>
          {r.costing && <CostingBox currency={r.currency} cost={r.costing.costMinor} sales={r.costing.salesMinor} profit={r.costing.profitMinor} margin={r.costing.marginPercent} uncosted={r.costing.uncostedLines} />}
        </div>
      </div>
    </div>
  );
}
