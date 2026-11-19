import Link from "next/link";
import { Check } from "lucide-react";
import { Badge, buildHref, ButtonLink, Card, cn, DataRow, EmptyState, LinkTabs, PAGE_SIZE, PageHeader, Pager, PhoneList, PhoneRow, Td, Th, THead, toPage, FactsLine } from "@kebo/ui";
import { DataTable } from "@/components/common/data-table";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { dateTime, timeAgo, countOf } from "@/lib/format";
import { ALERT_GROUPS, alertKind, type AlertGroup } from "@/lib/alerts";
import type { NotificationItem } from "@/lib/types-people";
import { ConfirmAction } from "@/components/people/confirm-action";
import { FilterCard } from "@/components/common/filter-card";
import { markAllReadAction } from "./actions";
import { readableDates } from "@/components/insights/readable-dates";

export const metadata = { title: "Alerts" };


/** Where a row goes: through /notifications/open (marks it read) when new, else straight to its link. */
const openHref = (n: NotificationItem) =>
  n.readAt ? (n.link ?? "/notifications") : buildHref("/notifications/open", {}, { id: n.id, to: n.link ?? undefined });

/**
 * Alerts (board "Alerts"): "N new" and Mark all read; chips All / Unread N /
 * Payments / Inquiries / Orders / Follow-ups; each alert a row with a dot when
 * new, its kind as a label, what happened and when, in the one list table (a click opens it); phone rows on a phone.
 * 25 a page.
 */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ show?: string; page?: string; q?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const onlyUnread = sp.show === "unread";
  const group = ALERT_GROUPS.find((g) => g.key === sp.show)?.key as AlertGroup | undefined;
  const page = toPage(sp.page);
  type Mine = { unread: number; total: number; items: NotificationItem[]; counts?: Record<string, number> };
  const { unread, total, items, counts } = await api.get<Mine>("/notifications", {
    unread: onlyUnread ? "true" : undefined,
    group,
    counts: "true",
    q: sp.q?.trim() || undefined,
    take: PAGE_SIZE,
    page,
  });
  const keep = { show: sp.show, q: sp.q };
  // A tab keeps the search: its count is for the same search.
  const tab = (show: string | undefined) => buildHref("/notifications", { q: sp.q }, { show });
  const show = onlyUnread ? "unread" : (group ?? "all");

  return (
    <>
      <PageHeader
        kind="list"
        crumbs={[{ label: "Alerts" }]}
        title="Alerts"
        primary={
          unread > 0 && (
            <ConfirmAction
              action={markAllReadAction}
              label="Mark all read"
              pendingText="Marking…"
              variant="secondary"
              size="md"
              showSuccess={false}
              icon={<Check aria-hidden />}
            />
          )
        }
      />
      <FactsLine facts={unread ? [{ label: "New", value: unread }] : []} />
      <LinkTabs
        label="Which alerts"
        className="mb-4"
        tabs={[
          { href: tab(undefined), label: "All", count: counts?.all, active: show === "all" },
          { href: tab("unread"), label: "Unread", count: counts?.unread ?? unread, alert: (counts?.unread ?? unread) > 0, active: show === "unread" },
          ...ALERT_GROUPS.map((g) => ({ href: tab(g.key), label: g.label, count: counts?.[g.key], active: show === g.key })),
        ]}
      />
      <FilterCard count={countOf(total, "alert")} search="Search alerts…" value={sp.q} keep={{ show: sp.show }} clearHref={tab(sp.show)} />
      <Card className="overflow-clip p-0">
        {items.length === 0 ? (
          <EmptyState
            framed
            title={sp.q ? "No alert matches" : show === "all" ? "No alerts yet" : "Nothing here"}
            description={
              sp.q
                ? "Try other words, or clear the search."
                : show === "all"
                  ? "You are told here when an inquiry is given to you, a quotation is answered, a payment arrives or an order needs something."
                  : "No alerts of this kind right now."
            }
            action={
              sp.q || show !== "all" ? (
                <ButtonLink href="/notifications" size="sm">
                  All alerts
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <>
            <DataTable label="Alerts" className="max-sm:hidden" tableClassName="text-md">
              <THead>
                <tr>
                  <Th>
                    <span className="sr-only">New</span>
                  </Th>
                  <Th>Kind</Th>
                  <Th>What happened</Th>
                  <Th className="text-right">When</Th>
                </tr>
              </THead>
              <tbody>
                {items.map((n) => {
                  const kind = alertKind(n.type, n.message);
                  return (
                    <DataRow key={n.id} href={openHref(n)} className={cn(!n.readAt && "bg-primary-soft/40")}>
                      <Td className="w-6 pr-0">{!n.readAt && <span className="block size-2 rounded-full bg-primary-solid" role="img" aria-label="New" />}</Td>
                      <Td>
                        <Badge tone={kind.tone}>{kind.label}</Badge>
                      </Td>
                      <Td>
                        <Link href={openHref(n)} prefetch={false} className="font-medium text-text hover:underline">
                          {readableDates(n.title)}
                        </Link>
                        {n.body && <span className="text-text-2"> · {readableDates(n.body)}</span>}
                      </Td>
                      <Td className="text-right whitespace-nowrap text-text-2">
                        <time dateTime={n.createdAt} title={dateTime(n.createdAt)}>
                          {timeAgo(n.createdAt)}
                        </time>
                      </Td>
                    </DataRow>
                  );
                })}
              </tbody>
            </DataTable>
            <PhoneList label="Alerts">
              {items.map((n) => {
                const kind = alertKind(n.type, n.message);
                return (
                  <PhoneRow
                    key={n.id}
                    href={openHref(n)}
                    prefetch={false}
                    title={readableDates(n.title)}
                    line={n.body ? readableDates(n.body) : timeAgo(n.createdAt)}
                    status={<Badge tone={kind.tone}>{!n.readAt ? `New · ${kind.label}` : kind.label}</Badge>}
                    figure={n.body ? timeAgo(n.createdAt) : undefined}
                  />
                );
              })}
            </PhoneList>
          </>
        )}
      </Card>
      <Pager base="/notifications" params={keep} page={page} pageSize={PAGE_SIZE} total={total} bare />
    </>
  );
}
