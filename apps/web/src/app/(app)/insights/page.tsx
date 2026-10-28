import { Suspense } from "react";
import Link from "next/link";
import { Banknote, ChartLine, Coins, HandCoins, Percent, Target, TrendingUp, Trophy, Users } from "lucide-react";
import { CHANNEL_LABEL } from "@kebo/shared";
import { Alert, Badge, buildHref, Card, CardBody, CardHeader, cn, LinkTabs, PageHeader, Segmented, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { hasFeature, requirePermission } from "@/lib/session";
import { PlanOff } from "@/components/common/plan-off";
import { money } from "@/lib/format";
import { countryName } from "@/lib/countries";
import type { Insights } from "@/lib/types-insights";
import type { LeaksReport } from "@/lib/types-money";
import { CashFlowChart, Donut, RevenueChart } from "@/components/insights/charts";
import { Change, flag, Funnel, Headline, KpiCard, ShareBars, TargetRing } from "@/components/insights/kpi";
import { PeriodPicker } from "@/components/insights/period";
import { TargetEditor } from "@/components/insights/targets";
import { FileActions } from "@/components/common/file-actions";
import { LEAK_VIEWS, LeaksBody, type LeakView } from "@/components/insights/leaks";
import { ProfitTable } from "@/components/insights/pnl";
import { ReportTrendChart } from "@/components/deals/report-trend-chart";

export const metadata = { title: "Insights" };

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";
const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const TABS = ["overview", "sales", "customers", "factories", "profit"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { overview: "Overview", sales: "Sales", customers: "Customers", factories: "Factories", profit: "Profit" };
const n = (v: number | null | undefined, suffix = "") => (v === null || v === undefined ? "—" : `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}${suffix}`);
const nums = (xs: (string | number | null)[]) => xs.map((x) => Number(x ?? 0));

type Search = { tab?: string; from?: string; to?: string; sub?: string; year?: string; pl?: string };

/**
 * How the business is doing, for any period against the one before: the
 * executive overview, then sales, customers, factories and profit. One period
 * for every number on the page.
 */
export default async function InsightsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePermission("reports.view");
  if (!(await hasFeature("insights"))) return <PlanOff title="Insights" what="Insights (sales, profit and team reports)" />;
  const sp = await searchParams;
  const today = todayIn(TZ);
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "overview";
  const from = isDay(sp.from) ? sp.from : undefined;
  const to = isDay(sp.to) ? sp.to : undefined;
  const i = await api.get<Insights>("/insights", { from, to });
  const c = i.currency;
  const k = i.kpis;
  const keep = { tab: tab === "overview" ? undefined : tab, from, to };
  const href = (change: Record<string, string | undefined>) => buildHref("/insights", { ...keep, sub: sp.sub, year: sp.year, pl: sp.pl }, change);
  const spark = (key: keyof Insights["series"][number]) => nums(i.series.slice(-12).map((s) => s[key] as string | number | null));

  return (
    <div>
      <PageHeader
        title="Insights"
        description={`How the business is doing. Amounts in ${c}: orders and payments at today's rates, costs at the rates used when paid.`}
        actions={
          <FileActions
            excelHref={buildHref("/sheets/export/report", {}, { from: i.range.from, to: i.range.to })}
            viewHref={buildHref("/print/report", {}, { from: i.range.from, to: i.range.to })}
            pdfHref={buildHref("/pdf/report/summary", {}, { from: i.range.from, to: i.range.to })}
          />
        }
      />
      <LinkTabs
        label="Insights sections"
        className="no-print mb-4"
        tabs={TABS.map((t) => ({ href: buildHref("/insights", { from, to }, { tab: t === "overview" ? undefined : t }), label: TAB_LABEL[t], active: tab === t }))}
      />
      <div className="mb-5">
        <PeriodPicker path="/insights" keep={{ tab: keep.tab }} range={i.range} previous={i.previous} today={today} />
      </div>
      {i.missingRates.length > 0 && (
        <Alert tone="warning" className="mb-5">
          There is no exchange rate for {i.missingRates.join(", ")} in Settings, so amounts in {i.missingRates.length === 1 ? "it are" : "them are"} left out.
        </Alert>
      )}

      {tab === "overview" && (
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiCard label="Sales" icon={<TrendingUp className="size-3.5" />} value={<Headline amount={k.revenue.value ?? 0} currency={c} />} kpi={k.revenue} note={`${k.orders.value} order${k.orders.value === 1 ? "" : "s"}`} spark={spark("revenue")} href={href({ tab: "sales" })} />
              <KpiCard
                label="Gross profit"
                icon={<Coins className="size-3.5" />}
                value={<Headline amount={k.grossProfit.value ?? 0} currency={c} />}
                kpi={k.grossProfit}
                note={k.margin.value !== null ? `${n(k.margin.value, "%")} margin` : undefined}
                spark={spark("grossProfit")}
                href={href({ tab: "profit" })}
              />
              {k.netProfit ? (
                <KpiCard
                  label="Profit after expenses"
                  icon={<Banknote className="size-3.5" />}
                  value={<Headline amount={k.netProfit.value ?? 0} currency={c} />}
                  kpi={k.netProfit}
                  tone={Number(k.netProfit.value) < 0 ? "bad" : undefined}
                  spark={spark("netProfit")}
                  href={href({ tab: "profit" })}
                />
              ) : (
                <KpiCard label="Average order" icon={<Banknote className="size-3.5" />} value={<Headline amount={k.avgOrder.value ?? 0} currency={c} />} kpi={k.avgOrder} />
              )}
              <KpiCard
                label="Win rate"
                icon={<Trophy className="size-3.5" />}
                value={n(k.winRate.value, "%")}
                kpi={k.winRate}
                points
                note={`${k.won.value} won`}
                spark={nums(i.series.slice(-12).map((s) => s.won))}
                href={href({ tab: "sales" })}
              />
            </div>
            <Card className="rounded-2xl">
              <CardHeader title="This month's target" description={new Date(`${i.target.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })} actions={i.target.canSet ? <TargetEditor month={i.target.month} current={i.target.amount} currency={c} /> : undefined} />
              <CardBody>
                {i.target.amount && i.target.percent !== null ? (
                  <TargetRing percent={i.target.percent} reached={i.target.reached} amount={i.target.amount} currency={c} />
                ) : (
                  <p className="flex items-start gap-2 text-sm text-muted">
                    <Target className="mt-0.5 size-4 shrink-0" aria-hidden />
                    No target for this month yet. A target shows how sales are going at a glance{i.target.canSet ? ": set one above." : "."}
                  </p>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Money in" icon={<HandCoins className="size-3.5" />} value={<Headline amount={k.cashIn.value ?? 0} currency={c} />} kpi={k.cashIn} note="From customers" spark={spark("cashIn")} />
            <KpiCard
              label="Customers owe us"
              icon={<Users className="size-3.5" />}
              value={<Headline amount={i.now.toReceive} currency={c} />}
              note={Number(i.now.overdue) > 0 ? <span className="font-medium text-bad">{money(i.now.overdue, c)} overdue</span> : "Nothing overdue"}
              tone={Number(i.now.overdue) > 0 ? "warn" : undefined}
              href="/money?tab=receive"
            />
            {i.now.cashInHand !== null ? (
              <KpiCard label="In our accounts" icon={<Banknote className="size-3.5" />} value={<Headline amount={i.now.cashInHand} currency={c} />} note={i.now.toPay !== null ? `We owe factories ${money(i.now.toPay, c)}` : undefined} href="/money?tab=cash" />
            ) : (
              <KpiCard label="Quotations sent" value={String(k.quotesSent.value ?? 0)} kpi={k.quotesSent} note={money(k.quotesValue.value ?? 0, c)} />
            )}
            <KpiCard
              label="Pipeline"
              icon={<ChartLine className="size-3.5" />}
              value={<Headline amount={i.now.pipeline} currency={c} />}
              note={`${i.now.pipelineDeals} quoted ${i.now.pipelineDeals === 1 ? "inquiry" : "inquiries"}${i.now.weightedPipeline ? ` · likely ${money(i.now.weightedPipeline, c)}` : ""}`}
              href="/inquiries?stage=quoted"
            />
          </div>

          <Card className="rounded-2xl">
            <CardHeader title="Sales and profit, month by month" description="Bars: sales (orders won). Lines: profit. Grey: the same month a year before. Dashed: the target." />
            <CardBody>
              <RevenueChart data={i.series} currency={c} showNet={i.seeMoney} />
            </CardBody>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            {i.seeMoney && (
              <Card className="rounded-2xl">
                <CardHeader title="Cash flow" description="Money in from customers, and out to factories and expenses, each month" />
                <CardBody>
                  <CashFlowChart data={i.series.slice(-12)} currency={c} />
                </CardBody>
              </Card>
            )}
            <Card className="rounded-2xl">
              <CardHeader title="From inquiry to order" description="Inquiries received in the period, how many got a quotation, how many were won" />
              <CardBody className="flex flex-col gap-5">
                <Funnel
                  steps={[
                    { label: "Inquiries received", value: i.funnel.received },
                    { label: "Quotation sent", value: i.funnel.quoted },
                    { label: "Won", value: i.funnel.won },
                  ]}
                />
                <div className="grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
                  <div>
                    <p className="text-xs text-muted">Days to send a quotation</p>
                    <p className="flex items-center gap-2 text-lg font-semibold tabular">
                      {n(k.quoteDays.value)} <Change value={k.quoteDays.change} goodWhenUp={false} />
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Days from inquiry to order</p>
                    <p className="flex items-center gap-2 text-lg font-semibold tabular">
                      {n(k.closeDays.value)} <Change value={k.closeDays.change} goodWhenUp={false} />
                    </p>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="rounded-2xl">
              <CardHeader title="Best customers" description="Sales in the period" actions={<Link href={href({ tab: "customers" })} className="text-sm text-primary hover:underline">All customers</Link>} />
              <CardBody>
                {i.topCustomers.length ? (
                  <ShareBars
                    currency={c}
                    rows={i.topCustomers.slice(0, 6).map((x) => ({
                      key: x.customer.id,
                      label: (
                        <>
                          {flag(x.customer.country)} {x.customer.name} {x.isNew && <Badge tone="ok">New</Badge>}
                        </>
                      ),
                      sub: `${x.orders} order${x.orders === 1 ? "" : "s"}`,
                      value: Number(x.revenue),
                      href: `/customers/${x.customer.id}?tab=money&view=profit`,
                    }))}
                  />
                ) : (
                  <p className="text-sm text-muted">No order in this period.</p>
                )}
              </CardBody>
            </Card>
            <Card className="rounded-2xl">
              <CardHeader title="What customers owe, by age" description="Right now, by how long it is overdue" actions={<Link href="/money?tab=receive" className="text-sm text-primary hover:underline">To receive</Link>} />
              <CardBody>
                <ShareBars
                  currency={c}
                  rows={[
                    { key: "notDue", label: "Not due yet", value: Number(i.aging.notDue) },
                    { key: "d30", label: "1–30 days late", value: Number(i.aging.d30) },
                    { key: "d60", label: "31–60 days late", value: Number(i.aging.d60) },
                    { key: "d90", label: "61–90 days late", value: Number(i.aging.d90) },
                    { key: "older", label: "Over 90 days late", value: Number(i.aging.older) },
                  ]}
                  tone="warn"
                />
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="rounded-2xl">
              <CardHeader title="Why we lose inquiries" description="Inquiries lost in the period" />
              <CardBody>
                {i.lostReasons.length ? (
                  <Donut data={i.lostReasons.map((r) => ({ label: r.label, value: r.count }))} centre={String(i.lostReasons.reduce((t, r) => t + r.count, 0))} centreLabel="lost" />
                ) : (
                  <p className="text-sm text-muted">No inquiry lost in this period.</p>
                )}
              </CardBody>
            </Card>
            <Card className="rounded-2xl">
              <CardHeader title="Where the goods go" description="Sales by the customer's country" />
              <CardBody>
                {i.countries.length ? (
                  <ShareBars
                    currency={c}
                    rows={i.countries.slice(0, 8).map((x) => ({
                      key: x.country,
                      label: `${flag(x.country)} ${countryName(x.country)}`,
                      sub: `${x.customers} customer${x.customers === 1 ? "" : "s"}`,
                      value: Number(x.revenue),
                    }))}
                  />
                ) : (
                  <p className="text-sm text-muted">No order in this period.</p>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {tab === "sales" && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Inquiries received" value={String(k.received.value)} kpi={k.received} spark={nums(i.series.slice(-12).map((s) => s.received))} />
            <KpiCard label="Quotations sent" value={String(k.quotesSent.value)} kpi={k.quotesSent} note={money(k.quotesValue.value ?? 0, c)} />
            <KpiCard label="Orders won" value={String(k.won.value)} kpi={k.won} note={money(k.revenue.value ?? 0, c)} spark={nums(i.series.slice(-12).map((s) => s.won))} />
            <KpiCard label="Average order" value={<Headline amount={k.avgOrder.value ?? 0} currency={c} />} kpi={k.avgOrder} />
            <KpiCard label="Win rate" icon={<Percent className="size-3.5" />} value={n(k.winRate.value, "%")} kpi={k.winRate} points note="Won ÷ (won + lost)" />
            <KpiCard label="Days to send a quotation" value={n(k.quoteDays.value)} kpi={k.quoteDays} goodWhenUp={false} note="From the inquiry" />
            <KpiCard label="Days to win" value={n(k.closeDays.value)} kpi={k.closeDays} goodWhenUp={false} note="Inquiry to order" />
            <KpiCard label="Shipped on time" value={n(k.onTime.value, "%")} kpi={k.onTime} points note="By the date promised" />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="rounded-2xl">
              <CardHeader title="Inquiries received and won" description="Month by month" />
              <CardBody>
                <ReportTrendChart data={i.series.slice(-12).map((s) => ({ month: s.month, received: s.received, won: s.won }))} />
              </CardBody>
            </Card>
            <Card className="rounded-2xl">
              <CardHeader title="From inquiry to order" description="Inquiries received in the period" />
              <CardBody>
                <Funnel
                  steps={[
                    { label: "Inquiries received", value: i.funnel.received },
                    { label: "Quotation sent", value: i.funnel.quoted },
                    { label: "Won", value: i.funnel.won },
                  ]}
                />
              </CardBody>
            </Card>
          </div>
          <Card className="overflow-hidden rounded-2xl">
            <CardHeader title="The team" description="Inquiries each person received in the period, won and lost, their sales and how fast they quote" />
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <tr>
                    <Th>Person</Th>
                    <Th className="text-right">Received</Th>
                    <Th className="text-right">Won</Th>
                    <Th className="text-right">Lost</Th>
                    <Th className="text-right">Win rate</Th>
                    <Th className="text-right">Days to quote</Th>
                    <Th className="text-right">Sales</Th>
                  </tr>
                </THead>
                <tbody>
                  {i.people.map((p) => (
                    <Tr key={p.id ?? "nobody"}>
                      <Td className="font-medium">{p.id ? <Link href={`/inquiries?assignee=${p.id}`} className="hover:text-primary">{p.name}</Link> : <span className="text-muted">{p.name}</span>}</Td>
                      <Td className="text-right tabular">{p.received}</Td>
                      <Td className="text-right tabular">{p.won}</Td>
                      <Td className="text-right tabular">{p.lost}</Td>
                      <Td className={cn("text-right tabular", p.winRate !== null && p.winRate < 30 && "text-bad")}>{n(p.winRate, "%")}</Td>
                      <Td className="text-right tabular">{n(p.quoteDays)}</Td>
                      <Td className="text-right font-semibold whitespace-nowrap tabular">{money(p.revenue, c)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="rounded-2xl">
              <CardHeader title="Where inquiries come from" description="And how many of them we win" />
              <CardBody>
                <ShareBars rows={i.channels.map((ch) => ({ key: ch.channel, label: CHANNEL_LABEL[ch.channel], sub: `${ch.won} won · ${n(ch.winRate, "%")}`, value: ch.received }))} />
              </CardBody>
            </Card>
            <Card className="rounded-2xl">
              <CardHeader title="What sells" description="Sales by product category" />
              <CardBody>
                <ShareBars currency={c} rows={i.categories.map((x) => ({ key: x.category, label: x.category, sub: `${x.orders} order${x.orders === 1 ? "" : "s"}`, value: Number(x.revenue) }))} />
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {tab === "customers" && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="New customers" value={String(k.newCustomers.value)} kpi={k.newCustomers} note="First order in the period" />
            <KpiCard label="Orders from returning customers" value={n(k.repeatShare.value, "%")} kpi={k.repeatShare} points note="They came back" />
            <KpiCard label="Orders" value={String(k.orders.value)} kpi={k.orders} />
            <KpiCard label="Average order" value={<Headline amount={k.avgOrder.value ?? 0} currency={c} />} kpi={k.avgOrder} />
          </div>
          <Card className="overflow-hidden rounded-2xl">
            <CardHeader title="Customers by sales" description="Click one for their account: what they earned us and what was spent on them" />
            {i.topCustomers.length === 0 ? (
              <CardBody>
                <p className="text-sm text-muted">No order in this period.</p>
              </CardBody>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <tr>
                      <Th>Customer</Th>
                      <Th className="text-right">Orders</Th>
                      <Th className="text-right">Sales</Th>
                      <Th className="text-right">Gross profit</Th>
                      <Th className="text-right">Margin</Th>
                    </tr>
                  </THead>
                  <tbody>
                    {i.topCustomers.map((x) => (
                      <Tr key={x.customer.id} className="hover:bg-surface-2/50">
                        <Td>
                          <Link href={`/customers/${x.customer.id}?tab=money&view=profit`} className="font-medium hover:text-primary">
                            {flag(x.customer.country)} {x.customer.name}
                          </Link>{" "}
                          {x.isNew && <Badge tone="ok">New</Badge>}
                        </Td>
                        <Td className="text-right tabular">{x.orders}</Td>
                        <Td className="text-right whitespace-nowrap tabular">{money(x.revenue, c)}</Td>
                        <Td className="text-right whitespace-nowrap tabular">{money(x.grossProfit, c)}</Td>
                        <Td className="text-right tabular">{Number(x.revenue) ? n(Math.round((Number(x.grossProfit) / Number(x.revenue)) * 1000) / 10, "%") : "—"}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </Card>
          <Card className="rounded-2xl">
            <CardHeader title="Where the goods go" description="Sales by the customer's country" />
            <CardBody>
              <ShareBars currency={c} rows={i.countries.map((x) => ({ key: x.country, label: `${flag(x.country)} ${countryName(x.country)}`, sub: `${x.orders} order${x.orders === 1 ? "" : "s"} · ${x.customers} customer${x.customers === 1 ? "" : "s"}`, value: Number(x.revenue) }))} />
            </CardBody>
          </Card>
        </div>
      )}

      {tab === "factories" && <FactoriesTab i={i} from={i.range.from} to={i.range.to} />}

      {tab === "profit" && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Gross profit" value={<Headline amount={k.grossProfit.value ?? 0} currency={c} />} kpi={k.grossProfit} spark={spark("grossProfit")} />
            <KpiCard label="Margin" value={n(k.margin.value, "%")} kpi={k.margin} points note="Gross profit ÷ sales" />
            {k.expenses && <KpiCard label="Expenses" value={<Headline amount={k.expenses.value ?? 0} currency={c} />} kpi={k.expenses} goodWhenUp={false} spark={spark("expenses")} href="/money?tab=expenses" />}
            {k.netProfit && <KpiCard label="Profit after expenses" value={<Headline amount={k.netProfit.value ?? 0} currency={c} />} kpi={k.netProfit} tone={Number(k.netProfit.value) < 0 ? "bad" : undefined} spark={spark("netProfit")} />}
          </div>
          <p className="-mt-2 px-1 text-xs text-muted">The cards count each order in the month it was won. The table below counts it in the month it shipped, so the two can differ.</p>
          {i.seeMoney ? (
            <>
              <Segmented
                label="Profit views"
                className="no-print w-fit"
                options={[
                  { href: href({ sub: undefined }), label: "Month by month", active: !sp.sub || sp.sub === "pnl" },
                  { href: href({ sub: "attention" }), label: "Where we lose money", active: !!sp.sub && sp.sub !== "pnl" },
                ]}
              />
              {!sp.sub || sp.sub === "pnl" ? (
                <Suspense fallback={<SectionSkeleton />}>
                  <ProfitTable year={sp.year} cash={sp.pl === "cash"} href={(change) => href(change)} />
                </Suspense>
              ) : (
                <Suspense fallback={<SectionSkeleton />}>
                  <LeaksTab from={i.range.from} to={i.range.to} view={(LEAK_VIEWS as readonly string[]).includes(sp.sub) ? (sp.sub as LeakView) : "attention"} href={(v) => href({ sub: v })} />
                </Suspense>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">Profit after expenses is for managers.</p>
          )}
        </div>
      )}
    </div>
  );
}

async function LeaksTab({ from, to, view, href }: { from: string; to: string; view: LeakView; href: (v: LeakView) => string }) {
  const r = await api.get<LeaksReport>("/reports/leaks", { from, to });
  return <LeaksBody r={r} view={view} href={href} />;
}

/** Who we buy from, money stuck with factories, and what visiting them cost. */
async function FactoriesTab({ i, from, to }: { i: Insights; from: string; to: string }) {
  const c = i.currency;
  const leaks = i.seeMoney ? await api.get<LeaksReport>("/reports/leaks", { from, to }) : null;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader title="Who we buy from" description="The factory cost of the goods on orders won in the period" />
          <CardBody>
            {i.factories.length ? (
              <ShareBars currency={c} rows={i.factories.map((f) => ({ key: f.factory.id, label: f.factory.name, sub: `${f.orders} order${f.orders === 1 ? "" : "s"}`, value: Number(f.spend), href: `/factories/${f.factory.id}` }))} />
            ) : (
              <p className="text-sm text-muted">No order with factory costs in this period.</p>
            )}
          </CardBody>
        </Card>
        {leaks && (
          <Card className="rounded-2xl">
            <CardHeader title="Visits and costs at factories" description="Trips to check products, inspections there" />
            <CardBody>
              {leaks.factories.length ? (
                <ShareBars currency={c} tone="warn" rows={leaks.factories.map((f) => ({ key: f.factory.id, label: f.factory.name, sub: `${f.count} expense${f.count === 1 ? "" : "s"}`, value: Number(f.spent), href: `/factories/${f.factory.id}?tab=costs` }))} />
              ) : (
                <p className="text-sm text-muted">No expense names a factory in this period.</p>
              )}
            </CardBody>
          </Card>
        )}
      </div>
      {leaks && (
        <Card className="rounded-2xl">
          <CardHeader title="Money stuck with factories" description="Open orders where we paid the factory more than the customer has paid us" />
          <CardBody>
            {leaks.stuck.length ? (
              <ShareBars
                tone="warn"
                rows={leaks.stuck.map((x) => ({ key: x.id, label: `${x.refNo} · ${x.customer.name}`, sub: `paid ${x.days} days ago`, value: Number(x.amount), display: money(x.amount, x.currency), href: `/orders/${x.id}/money` }))}
              />
            ) : (
              <p className="text-sm text-muted">None: customers have paid ahead of the factories.</p>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

/** While a section's figures are on their way. */
function SectionSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
      <div className="h-24 animate-pulse rounded-2xl bg-surface-2" />
      <div className="h-64 animate-pulse rounded-2xl bg-surface-2" />
    </div>
  );
}
