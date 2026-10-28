import Link from "next/link";
import { ArrowRight, Building2, CalendarClock, Inbox, Receipt } from "lucide-react";
import { COMPANY_KIND_LABEL } from "@kebo/shared";
import { Card, CardBody, CardHeader, EmptyState, PageHeader, buttonClass } from "@kebo/ui";
import { platformApi } from "@/lib/api";
import { date, dateTime, timeAgo } from "@/lib/format";
import type { Overview } from "@/lib/types-platform";
import { CompanyStatusBadge, KindBadge, LeadStatusBadge } from "@/components/platform/badges";

export const metadata = { title: "Overview" };

/** What needs the platform admin today: new client inquiries, follow-ups, demos ending, renewals. */
export default async function PlatformOverviewPage() {
  const o = await platformApi.get<Overview>("/overview");
  const count = (kind: string, status?: string) =>
    o.counts.filter((c) => c.kind === kind && (!status || c.status === status)).reduce((t, c) => t + c.count, 0);
  const tiles = [
    { label: "New client inquiries", value: o.newLeads, href: "/platform/leads?status=new", icon: Inbox },
    {
      label: "Clients",
      value: count("client"),
      sub: `${count("client", "active")} active`,
      href: "/platform/companies?kind=client",
      icon: Building2,
    },
    {
      label: "Demos",
      value: count("demo"),
      sub: `${count("demo", "active")} running`,
      href: "/platform/companies?kind=demo",
      icon: CalendarClock,
    },
    {
      label: "Trials",
      value: count("trial"),
      sub: `${count("trial", "active")} running`,
      href: "/platform/companies?kind=trial",
      icon: Receipt,
    },
  ];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Overview"
        description="New client inquiries, follow-ups, demos ending and payments due."
        actions={
          <Link href="/platform/companies/new" className={buttonClass("primary", "sm")}>
            New company or demo
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className="group rounded-xl border border-line bg-surface p-4 shadow-card transition-colors hover:border-line-strong"
          >
            <p className="flex items-center gap-2 text-sm text-muted">
              <t.icon className="size-4" aria-hidden /> {t.label}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular">{t.value}</p>
            {t.sub && <p className="text-xs text-muted">{t.sub}</p>}
          </Link>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Follow up today" description="Client inquiries with a follow-up date today or earlier" />
          {o.followUps.length ? (
            <ul className="divide-y divide-line">
              {o.followUps.map((l) => (
                <li key={l.id}>
                  <Link href={`/platform/leads/${l.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/60">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{l.companyName}</span>
                      <span className="block truncate text-xs text-muted">
                        {l.name} · follow up {date(l.followUpOn)}
                      </span>
                    </span>
                    <LeadStatusBadge status={l.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <CardBody>
              <EmptyState
                title="Nothing to follow up"
                description="Follow-up dates you set on client inquiries show here."
                className="py-6"
              />
            </CardBody>
          )}
        </Card>
        <Card>
          <CardHeader title="Demos and trials ending" description="Ending in the next two days, or ended this week" />
          {o.ending.length ? (
            <ul className="divide-y divide-line">
              {o.ending.map((c) => (
                <li key={c.id}>
                  <Link href={`/platform/companies/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/60">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {COMPANY_KIND_LABEL[c.kind]} · ends {dateTime(c.endsAt)}
                      </span>
                    </span>
                    <CompanyStatusBadge status={c.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <CardBody>
              <EmptyState title="No demo ends soon" className="py-6" />
            </CardBody>
          )}
        </Card>
        <Card>
          <CardHeader title="Payments due" description="Clients whose paid-until date is within a week, or past" />
          {o.renewals.length ? (
            <ul className="divide-y divide-line">
              {o.renewals.map((c) => (
                <li key={c.id}>
                  <Link href={`/platform/companies/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/60">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="block truncate text-xs text-muted">paid until {date(c.renewsOn)}</span>
                    </span>
                    <CompanyStatusBadge status={c.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <CardBody>
              <EmptyState title="No payments due" className="py-6" />
            </CardBody>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Lately"
            actions={
              <Link href="/platform/log" className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Platform log <ArrowRight className="size-4" aria-hidden />
              </Link>
            }
          />
          <ul className="divide-y divide-line">
            {o.recent.map((e) => (
              <li key={e.id} className="px-4 py-2 text-sm">
                <p>{e.summary}</p>
                <p className="text-xs text-muted">
                  {e.adminName ?? "Automatic"} · {timeAgo(e.at)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <p className="text-xs text-muted">
        Kinds: <KindBadge kind="client" /> pays · <KindBadge kind="demo" /> made by you, a few days · <KindBadge kind="trial" /> self
        sign-up.
      </p>
    </div>
  );
}
