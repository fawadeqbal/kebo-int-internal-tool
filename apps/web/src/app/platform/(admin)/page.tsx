import Link from "next/link";
import { Plus } from "lucide-react";
import { Card, cn, DataRow, EmptyState, PageHeader, ButtonLink, PhoneList, PhoneRow, StatusBadge, Td, Th, THead, buttonClass, StatTile } from "@kebo/ui";
import { platformApi } from "@/lib/api";
import { date, dateTime } from "@/lib/format";
import type { Dashboard, Overview } from "@/lib/types-platform";
import { DataTable } from "@/components/common/data-table";
import { MoreMenu } from "@/components/common/more-menu";
import { moneyText, n, overviewAttention, versus, type Meaning } from "./overview";

export const metadata = { title: "Overview" };

const DOT: Record<Meaning, string> = { neutral: "bg-text-2", info: "bg-info", ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" };

const WATCH: Record<Dashboard["watch"][number]["reason"], { label: string; meaning: Meaning }> = {
  overdue: { label: "Overdue", meaning: "bad" },
  ending: { label: "Ends soon", meaning: "warn" },
  renews: { label: "Renews", meaning: "info" },
};
const lastMonthName = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
};

/**
 * The platform at a glance (design system: Dashboard frame, approved page
 * 30): five tiles (paying companies, income this month, renewals in 30 days,
 * demos and trials, new client inquiries), what needs attention, and the
 * companies to look at (overdue, demos ending, renewals). "New company" is
 * the one primary.
 */
export default async function PlatformOverviewPage() {
  const o = await platformApi.get<Overview>("/overview");
  const d = o.dashboard;
  const companies = o.counts.reduce((t, c) => t + c.count, 0);
  const items = overviewAttention(d, o.followUps);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Platform"
        summary={`${n(companies, "company", "companies")} · ${n(d.newLeads, "new client inquiry", "new client inquiries")}`}
        primary={
          <ButtonLink href="/platform/companies/new" variant="primary">
            <Plus aria-hidden /> New company
          </ButtonLink>
        }
        more={
          <MoreMenu
            label="More on the platform"
            items={[
              { label: "New client inquiry", href: "/platform/leads/new" },
              { label: "Give a demo", href: "/platform/companies/new?kind=demo" },
              { label: "Platform log", href: "/platform/log" },
              { label: "Visitors and leads", href: "/platform/settings?section=website" },
            ]}
          />
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile
          size="sm"
          label="Paying companies"
          value={d.paying}
          sub={d.payingNewThisMonth ? `${d.payingNewThisMonth} new this month` : "none new this month"}
          href="/platform/companies?kind=client"
        />
        <StatTile
          size="sm"
          label="Income this month"
          value={moneyText(d.incomeThisMonth)}
          sub={versus(d.incomeThisMonth, d.incomeLastMonth, lastMonthName()) ?? "payments recorded this month"}
          href="/platform/log?kind=companies"
        />
        <StatTile
          size="sm"
          label="Renewals in 30 days"
          value={d.renewals}
          sub={d.renewalsDue.length ? `${moneyText(d.renewalsDue)} due` : "nothing due"}
          href="/platform/companies?kind=client"
        />
        <StatTile
          size="sm"
          label="Demos and trials"
          value={d.trials}
          sub={d.trialsEndingThisWeek ? `${d.trialsEndingThisWeek} end this week` : "none end this week"}
          href="/platform/companies?kind=demo"
        />
        <StatTile
          size="sm"
          label="New client inquiries"
          value={d.newLeads}
          sub={`${d.leadsThisWeek} came in since Monday`}
          href="/platform/leads?status=new"
        />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_1.3fr]">
        <Card className="overflow-clip">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Needs attention</h2>
            <p className="mt-0.5 text-xs text-muted">{items.length ? "what to deal with, and where" : "nothing waits for you"}</p>
          </div>
          {items.length ? (
            <ul className="divide-y divide-line px-4">
              {items.map((i) => (
                <li key={i.key} className="flex items-start gap-3 py-2.5">
                  <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[i.meaning])} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{i.title}</span>
                    {i.sub && <span className="block text-xs break-words text-text-2">{i.sub}</span>}
                  </span>
                  <Link
                    href={i.href}
                    className="inline-flex min-h-6 shrink-0 items-center text-xs font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {i.link} <span aria-hidden>&nbsp;→</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-4 text-sm text-text-2">
              No overdue payments, no demo ends this week, backups are fine and every client inquiry has been seen.
            </p>
          )}
        </Card>
        <Card className="overflow-clip">
          <div className="flex min-h-14 items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Renewals and demos ending</h2>
              <p className="mt-0.5 text-xs text-muted">overdue, ending within a week, renewing within 30 days</p>
            </div>
            <Link href="/platform/companies" className={buttonClass("ghost", "sm", "h-8 px-2.5 text-[13px] text-text-2")}>
              All companies
            </Link>
          </div>
          {d.watch.length ? (
            <>
              <PhoneList label="Renewals and demos ending">
                {d.watch.map((c) => (
                  <PhoneRow
                    key={`${c.reason}-${c.id}`}
                    href={`/platform/companies/${c.id}`}
                    title={c.name}
                    line={`${c.plan ?? "no plan"} · ${c.date ? (c.reason === "ending" ? dateTime(c.date) : date(c.date)) : "—"}`}
                    status={<StatusBadge meaning={WATCH[c.reason].meaning}>{WATCH[c.reason].label}</StatusBadge>}
                  />
                ))}
              </PhoneList>
              <DataTable label="Renewals and demos ending" className="max-sm:hidden">
                <THead>
                  <tr>
                    <Th>Company</Th>
                    <Th>Status</Th>
                    <Th>Plan</Th>
                    <Th>Date</Th>
                    <Th className="text-right">People</Th>
                  </tr>
                </THead>
                <tbody>
                  {d.watch.map((c) => (
                    <DataRow key={`${c.reason}-${c.id}`} href={`/platform/companies/${c.id}`}>
                      <Td>
                        <Link href={`/platform/companies/${c.id}`} className="font-semibold hover:text-primary">
                          {c.name}
                        </Link>
                      </Td>
                      <Td>
                        <StatusBadge meaning={WATCH[c.reason].meaning}>{WATCH[c.reason].label}</StatusBadge>
                      </Td>
                      <Td className="text-sm">{c.plan ?? (c.kind === "client" ? "No plan" : "—")}</Td>
                      <Td className="text-sm whitespace-nowrap">
                        {c.date ? (c.reason === "ending" ? dateTime(c.date) : date(c.date)) : "—"}
                      </Td>
                      <Td className="text-right tabular">{c.people}</Td>
                    </DataRow>
                  ))}
                </tbody>
              </DataTable>
            </>
          ) : (
            <EmptyState
              framed
              title="Nothing ends or renews soon"
              description="Overdue clients, demos ending this week and renewals in the next 30 days show here."
            />
          )}
        </Card>
      </div>
    </div>
  );
}
