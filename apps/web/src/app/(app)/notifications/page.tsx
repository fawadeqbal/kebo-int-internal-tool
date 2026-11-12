import { Bell, Check } from "lucide-react";
import { Badge, buildHref, ButtonLink, Card, cn, EmptyState, LinkTabs, PageHeader, Pager, toPage } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { dateTime, timeAgo } from "@/lib/format";
import { ALERT_GROUPS, alertKind, type AlertGroup } from "@/lib/alerts";
import type { NotificationItem } from "@/lib/types-people";
import { ConfirmAction } from "@/components/people/confirm-action";
import { markAllReadAction } from "./actions";

export const metadata = { title: "Alerts" };

const PAGE_SIZE = 25;

/** Where a row goes: through /notifications/open (marks it read) when new, else straight to its link. */
const openHref = (n: NotificationItem) =>
  n.readAt ? (n.link ?? "/notifications") : buildHref("/notifications/open", {}, { id: n.id, to: n.link ?? undefined });

/**
 * Alerts (board "Alerts"): "N new" and Mark all read; chips All / Unread N /
 * Payments / Inquiries / Orders / Follow-ups; each alert a row with a dot when
 * new, its kind as a label, what happened, when, and Open. 25 a page.
 */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ show?: string; page?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const onlyUnread = sp.show === "unread";
  const group = ALERT_GROUPS.find((g) => g.key === sp.show)?.key as AlertGroup | undefined;
  const page = toPage(sp.page);
  type Mine = { unread: number; total: number; items: NotificationItem[] };
  const { unread, total, items } = await api.get<Mine>("/notifications", {
    unread: onlyUnread ? "true" : undefined,
    group,
    take: PAGE_SIZE,
    page,
  });
  const keep = { show: sp.show };
  const show = onlyUnread ? "unread" : (group ?? "all");

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Alerts" }]}
        icon={Bell}
        title="Alerts"
        summary={unread ? `${unread} new` : "You are all caught up"}
        primary={
          unread > 0 && (
            <ConfirmAction
              action={markAllReadAction}
              label="Mark all read"
              pendingText="Marking…"
              variant="secondary"
              showSuccess={false}
              icon={<Check aria-hidden />}
            />
          )
        }
      />
      <LinkTabs
        label="Which alerts"
        className="mb-4"
        tabs={[
          { href: "/notifications", label: "All", active: show === "all" },
          { href: "/notifications?show=unread", label: unread ? `Unread ${unread}` : "Unread", active: show === "unread" },
          ...ALERT_GROUPS.map((g) => ({ href: `/notifications?show=${g.key}`, label: g.label, active: show === g.key })),
        ]}
      />
      <Card className="overflow-clip p-0">
        {items.length === 0 ? (
          <EmptyState
            framed
            title={show === "all" ? "No alerts yet" : "Nothing here"}
            description={
              show === "all"
                ? "You are told here when an inquiry is given to you, a quotation is answered, a payment arrives or an order needs something."
                : "No alerts of this kind right now."
            }
            action={
              show !== "all" ? (
                <ButtonLink href="/notifications" size="sm">
                  All alerts
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <ul aria-label="Alerts">
            {items.map((n, i) => {
              const fresh = !n.readAt;
              const kind = alertKind(n.type);
              return (
                <li
                  key={n.id}
                  className={cn("flex gap-3 px-4 py-3.5 sm:px-5", i > 0 && "border-t border-surface-2", fresh && "bg-primary-soft/40")}
                >
                  <span className="w-2.5 flex-none pt-2">
                    {fresh && <span className="block size-2 rounded-full bg-primary-solid" aria-label="New" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <Badge tone={kind.tone}>{kind.label}</Badge>
                    <span className="mt-1.5 block text-sm text-text">
                      {n.title}
                      {n.body && <span className="text-text-2"> · {n.body}</span>}
                    </span>
                    <time dateTime={n.createdAt} title={dateTime(n.createdAt)} className="text-xs text-muted">
                      {timeAgo(n.createdAt)}
                    </time>
                  </span>
                  <ButtonLink
                    href={openHref(n)}
                    prefetch={false}
                    size="sm"
                    className="flex-none self-start"
                    aria-label={`Open: ${n.title}`}
                  >
                    Open
                  </ButtonLink>
                </li>
              );
            })}
          </ul>
        )}
        <Pager base="/notifications" params={keep} page={page} pageSize={PAGE_SIZE} total={total} />
      </Card>
    </>
  );
}
