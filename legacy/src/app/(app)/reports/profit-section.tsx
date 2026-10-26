import Link from "next/link";
import { BadgeDollarSign, CircleDollarSign, FileCheck2, Hourglass } from "lucide-react";
import { Alert, Card, CardBody, CardHeader, Table, THead, Td, Th, Tr } from "@/components/ui";
import { StatCard } from "@/components/stats";
import { ProfitChart } from "@/components/charts";
import { formatCents } from "@/lib/utils/money";
import { cn } from "@/lib/utils/cn";
import type { ProfitReport } from "@/modules/reports/profit";
import type { ProfitGroup } from "@/modules/reports/profit-math";

/** Margin with a colour: red when we lose money, amber when under the target margin. */
function Margin({ value, target }: { value: number | null; target: number }) {
  if (value === null) return <span className="text-muted">—</span>;
  return <span className={cn("tabular", value < 0 ? "font-semibold text-bad" : value < target ? "text-warn" : "text-ok")}>{value}%</span>;
}

function GroupTable({ title, description, rows, currency, target, nameLabel }: { title: string; description?: string; rows: ProfitGroup[]; currency: string; target: number; nameLabel: string }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} description={description} />
      {rows.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">Nothing invoiced in this period.</p>
        </CardBody>
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>{nameLabel}</Th>
              <Th className="hidden text-right sm:table-cell">Invoiced</Th>
              <Th className="text-right">Profit</Th>
              <Th className="text-right">Margin</Th>
            </tr>
          </THead>
          <tbody>
            {rows.map((g) => (
              <Tr key={g.key}>
                <Td className="max-w-48 truncate font-medium">{g.key}</Td>
                <Td className="hidden text-right whitespace-nowrap text-text-2 tabular sm:table-cell">{formatCents(g.revenueCents, currency)}</Td>
                <Td className={cn("text-right whitespace-nowrap tabular", g.profitCents < 0 && "text-bad")}>{g.costedRevenueCents > 0 ? formatCents(g.profitCents, currency) : <span className="text-muted">No cost</span>}</Td>
                <Td className="text-right">
                  <Margin value={g.marginPercent} target={target} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

type Deal = ProfitReport["best"][number];

function DealList({ title, description, deals, currency, target }: { title: string; description: string; deals: Deal[]; currency: string; target: number }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody className="py-1">
        {deals.length === 0 ? (
          <p className="py-3 text-sm text-muted">No costed invoices in this period.</p>
        ) : (
          <ul className="divide-y divide-line">
            {deals.map((d) => (
              <li key={d.id}>
                <Link href={`/invoices/${d.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text">{d.customer}</span>
                    <span className="block font-mono text-xs text-muted">{d.no}</span>
                  </span>
                  <span className="text-right">
                    <span className={cn("block text-sm font-semibold tabular", d.profitCents < 0 ? "text-bad" : "text-text")}>{formatCents(d.profitCents, currency)}</span>
                    <span className="block text-xs">
                      <Margin value={d.marginPercent} target={target} /> <span className="text-muted">of {formatCents(d.costedRevenueCents, currency)}</span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * For the people running the business: what we made, what is coming, and where
 * it comes from. Revenue is after discounts and before tax; our costs include
 * the factory's VAT. Lines without a cost (freight, items priced by hand) are
 * kept out of the profit and shown apart.
 */
export function ProfitSection({ p, target, staffName }: { p: ProfitReport; target: number; staffName?: string }) {
  const c = p.currency;
  const inv = p.invoiced;
  const marginHint = (m: number | null, n: number, what: string) => `${m === null ? "No costs yet" : `${m}% margin`} · ${n} ${what}`;
  return (
    <section aria-labelledby="profit-heading" className="space-y-5">
      <div>
        <h2 id="profit-heading" className="text-base font-semibold text-text">
          Profit{staffName && ` · ${staffName}`}
        </h2>
        <p className="text-sm text-muted">After discounts, before tax. Our costs include the factory&apos;s VAT. Target margin {target}%.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label="Gross profit (invoiced)"
          icon={CircleDollarSign}
          tone={inv.profitCents < 0 ? "bad" : "ok"}
          value={formatCents(inv.profitCents, c)}
          hint={marginHint(inv.marginPercent, inv.documents, inv.documents === 1 ? "invoice" : "invoices")}
        />
        <StatCard label="Invoiced" icon={BadgeDollarSign} tone="primary" value={formatCents(inv.revenueCents, c)} hint={`Our cost ${formatCents(inv.costCents, c)}`} />
        <StatCard
          label="Booked profit"
          icon={FileCheck2}
          tone="info"
          value={formatCents(p.booked.profitCents, c)}
          hint={marginHint(p.booked.marginPercent, p.booked.documents, p.booked.documents === 1 ? "accepted quotation" : "accepted quotations")}
        />
        <StatCard
          label="Waiting on customers"
          icon={Hourglass}
          value={formatCents(p.waiting.profitCents, c)}
          hint={`${p.waiting.documents} ${p.waiting.documents === 1 ? "quotation" : "quotations"} sent${p.waiting.documents > 0 && p.waiting.costedRevenueCents === 0 ? " · no costs recorded" : ", not answered yet"}`}
        />
      </div>

      {(inv.uncostedRevenueCents !== 0 || p.otherCurrencyInvoices > 0) && (
        <Alert tone="info">
          {inv.uncostedRevenueCents !== 0 && (
            <>
              {formatCents(inv.uncostedRevenueCents, c)} of what was invoiced has no recorded cost (freight, inspection, items priced by hand) and is not counted in the profit
              {inv.coveragePercent !== null && <> ({inv.coveragePercent}% of revenue is costed)</>}.{" "}
            </>
          )}
          {p.otherCurrencyInvoices > 0 && `${p.otherCurrencyInvoices} invoice(s) in other currencies are left out of these figures.`}
        </Alert>
      )}

      <Card>
        <CardHeader title="Profit per month" description={`Invoiced vs gross profit, last 12 months, ${c}`} />
        <CardBody>
          <ProfitChart data={p.trend} currency={c} />
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <GroupTable title="By customer" description="Who we make the most on" rows={p.byCustomer} currency={c} target={target} nameLabel="Customer" />
        <GroupTable title="By factory" description="Profit on the goods bought from each factory" rows={p.byFactory} currency={c} target={target} nameLabel="Factory" />
        <GroupTable title="By category" rows={p.byCategory} currency={c} target={target} nameLabel="Category" />
        {!staffName && <GroupTable title="By person" description="Who handled the inquiry" rows={p.byPerson} currency={c} target={target} nameLabel="Person" />}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <DealList title="Thinnest margins" description="Invoices to look at" deals={p.thinnest} currency={c} target={target} />
        <DealList title="Most profitable" description="Invoices that made the most" deals={p.best} currency={c} target={target} />
      </div>
    </section>
  );
}
