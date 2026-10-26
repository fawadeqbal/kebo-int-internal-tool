import { Download } from "lucide-react";
import { CHANNEL_LABEL, LOST_REASON_LABEL } from "@kebo/shared";
import { buildHref, buttonClass, Card, CardBody, CardHeader, Input, PageHeader, Segmented, Select, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { addDays, formatDuration, todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { requirePermission } from "@/lib/session";
import { date, money } from "@/lib/format";
import type { PersonWithRole, ProfitRow, ReportView } from "@/lib/types-deals";
import { Stat } from "@/components/common/stat";
import { ReportTrendChart } from "@/components/deals/report-trend-chart";

export const metadata = { title: "Reports" };

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";
const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isId = (v?: string) => !!v && /^[0-9a-f-]{36}$/i.test(v);

function ranges(today: string) {
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = addDays(monthStart, -1);
  const lastMonthStart = `${lastMonthEnd.slice(0, 7)}-01`;
  const quarterStart = (() => {
    const d = new Date(`${monthStart}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 2);
    return d.toISOString().slice(0, 10);
  })();
  return [
    { key: "month", label: "This month", from: monthStart, to: today },
    { key: "last", label: "Last month", from: lastMonthStart, to: lastMonthEnd },
    { key: "3m", label: "Last 3 months", from: quarterStart, to: today },
    { key: "year", label: "This year", from: `${today.slice(0, 4)}-01-01`, to: today },
  ];
}

const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

function CountTable({ title, rows, empty }: { title: string; rows: { label: string; count: number }[]; empty: string }) {
  const total = rows.reduce((t, r) => t + r.count, 0);
  return (
    <Card>
      <CardHeader title={title} />
      {rows.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">{empty}</p>
        </CardBody>
      ) : (
        <ul className="flex flex-col gap-2.5 p-4">
          {rows.map((r) => (
            <li key={r.label} className="text-sm">
              <div className="mb-1 flex justify-between gap-3">
                <span className="truncate">{r.label}</span>
                <span className="text-text-2 tabular">
                  {r.count} <span className="text-xs text-muted">({total ? Math.round((r.count / total) * 100) : 0}%)</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-3" aria-hidden>
                <div className="h-1.5 rounded-full bg-[var(--chart-1)]" style={{ width: `${total ? (r.count / total) * 100 : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ProfitTable({ title, column, rows, currency }: { title: string; column: string; rows: (ProfitRow & { key: string })[]; currency: string }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No orders in this period.</p>
      ) : (
        <div className="rounded-lg border border-line">
          <Table>
            <THead>
              <tr>
                <Th>{column}</Th>
                <Th className="text-right">Sales</Th>
                <Th className="text-right">Profit</Th>
                <Th className="text-right">Margin</Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.key}>
                  <Td className="max-w-48 truncate">{r.key}</Td>
                  <Td className="text-right whitespace-nowrap tabular">{money(r.revenue, currency)}</Td>
                  <Td className="text-right font-medium whitespace-nowrap tabular">{money(r.profit, currency)}</Td>
                  <Td className="text-right whitespace-nowrap tabular">
                    {pct(r.marginPercent)}
                    {r.coveragePercent !== null && r.coveragePercent < 100 && <span className="block text-xs text-muted">{r.coveragePercent}% costed</span>}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}

/** Managers' view of the deal funnel, win rates and estimated profit over a period. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("reports.view");
  const sp = await searchParams;
  const today = todayIn(TZ);
  const from = isDay(sp.from) ? sp.from : undefined;
  const to = isDay(sp.to) ? sp.to : undefined;
  const staff = isId(sp.staff) ? sp.staff : undefined;
  const [r, people] = await Promise.all([api.get<ReportView>("/reports", { from, to, staff }), api.get<PersonWithRole[]>("/users/people")]);
  const quick = ranges(today);
  const keep = { from: r.range.from, to: r.range.to, staff };
  const csvHref = buildHref("/reports/csv", keep, {});
  const f = r.funnel;
  const person = people.find((p) => p.id === staff);
  const t = r.profit.total;

  return (
    <div>
      <PageHeader
        title="Reports"
        description={`${date(r.range.from)} – ${date(r.range.to)}${person ? ` · deals handled by ${person.name}` : " · everyone"}. Amounts in ${r.currency} at today's exchange rates.`}
        actions={
          <a href={csvHref} className={buttonClass("secondary")} download>
            <Download aria-hidden /> Download CSV
          </a>
        }
      />

      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 lg:flex-row lg:items-end lg:justify-between">
        <Segmented label="Period" options={quick.map((q) => ({ href: buildHref("/reports", { staff }, { from: q.from, to: q.to }), label: q.label, active: q.from === r.range.from && q.to === r.range.to }))} />
        <form className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">
            From
            <Input name="from" type="date" defaultValue={r.range.from} max={today} className="mt-1 h-8 w-38" />
          </label>
          <label className="text-xs text-muted">
            To
            <Input name="to" type="date" defaultValue={r.range.to} max={today} className="mt-1 h-8 w-38" />
          </label>
          <label className="text-xs text-muted">
            Handled by
            <Select name="staff" compact defaultValue={staff ?? ""} className="mt-1 w-40">
              <option value="">Everyone</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
          <button className={buttonClass("secondary", "sm")}>Show</button>
        </form>
      </div>

      <section aria-label="Funnel" className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Received" value={f.received} hint="New inquiries in the period" />
        <Stat label="Quoted" value={f.quoted} hint={f.received ? `${Math.round((f.quoted / f.received) * 100)}% of those received` : "Of those received"} />
        <Stat label="Won" value={f.won} hint={r.turnaroundMs.won ? `Took ${formatDuration(r.turnaroundMs.won)} on average` : "Closed in the period"} tone={f.won ? "ok" : undefined} />
        <Stat label="Lost" value={f.lost} hint={r.turnaroundMs.lost ? `Took ${formatDuration(r.turnaroundMs.lost)} on average` : "Closed in the period"} />
        <Stat label="Win rate" value={pct(f.winRatePercent)} hint="Won ÷ (won + lost)" />
        <Stat label="Won value" value={money(r.wonValue, r.currency)} hint="Orders made in the period" />
      </section>

      <Card className="mb-5">
        <CardHeader title="Last 12 months" description={`Inquiries received and won per month, up to ${date(r.range.to)}`} />
        <CardBody>
          <ReportTrendChart data={r.trend} />
        </CardBody>
      </Card>

      <div className="mb-5 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <CountTable title="Why deals were lost" rows={r.lostReasons.map((x) => ({ label: LOST_REASON_LABEL[x.reason], count: x.count }))} empty="No deals lost in this period." />
        <CountTable title="By channel" rows={r.byChannel.map((x) => ({ label: CHANNEL_LABEL[x.key] ?? x.key, count: x.count }))} empty="No inquiries in this period." />
        <CountTable title="By category" rows={r.byCategory.map((x) => ({ label: x.key, count: x.count }))} empty="No inquiries in this period." />
        <Card>
          <CardHeader title="Win rate by person" description="Deals closed in the period" />
          {r.people.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">No deals closed in this period.</p>
            </CardBody>
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Person</Th>
                  <Th className="text-right">Won</Th>
                  <Th className="text-right">Lost</Th>
                  <Th className="text-right">Rate</Th>
                </tr>
              </THead>
              <tbody>
                {r.people.map((p) => (
                  <Tr key={p.person}>
                    <Td>{p.person}</Td>
                    <Td className="text-right tabular">{p.won}</Td>
                    <Td className="text-right tabular">{p.lost}</Td>
                    <Td className="text-right font-medium tabular">{p.winRatePercent}%</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Estimated profit"
          description={`On ${t.orders} order${t.orders === 1 ? "" : "s"} made in the period, from the costs recorded on their lines (sales after discount, without VAT).`}
        />
        <CardBody className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Sales" value={money(t.revenue, r.currency)} />
            <Stat label="Cost" value={money(t.cost, r.currency)} />
            <Stat label="Profit" value={money(t.profit, r.currency)} tone={Number(t.profit) < 0 ? "bad" : Number(t.profit) > 0 ? "ok" : undefined} />
            <Stat label="Margin" value={pct(t.marginPercent)} hint={t.coveragePercent === null ? undefined : `${t.coveragePercent}% of sales have a cost`} />
          </div>
          {t.coveragePercent !== null && t.coveragePercent < 100 && (
            <p className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-sm">
              Coverage {t.coveragePercent}%: lines without a cost (freight, hand-priced items) are left out of profit and margin, so they are never counted as pure profit.
            </p>
          )}
          <div className="grid gap-5 2xl:grid-cols-3">
            <ProfitTable title="By customer" column="Customer" rows={r.profit.byCustomer} currency={r.currency} />
            <ProfitTable title="By category" column="Category" rows={r.profit.byCategory} currency={r.currency} />
            <ProfitTable title="By person" column="Person" rows={r.profit.byPerson} currency={r.currency} />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
