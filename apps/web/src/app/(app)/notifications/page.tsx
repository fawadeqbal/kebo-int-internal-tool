import Link from "next/link";
import { createElement } from "react";
import { AlarmClock, BadgeDollarSign, Bell, CheckCheck, ClipboardList, FileText, Trophy, UserPlus, type LucideIcon } from "lucide-react";
import { buildHref, ButtonLink, Card, cn, DataRow, EmptyState, ListToolbar, PageHeader, Pager, PhoneList, PhoneRow, StatusBadge, Td, Th, THead, toPage } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { dateTime, timeAgo } from "@/lib/format";
import type { NotificationItem } from "@/lib/types-people";
import { ConfirmAction } from "@/components/people/confirm-action";
import { DataTable } from "@/components/common/data-table";
import { RowMenu, type MenuEntry } from "@/components/common/more-menu";
import { markAllReadAction } from "./actions";

export const metadata = { title: "Notifications" };

const PAGE_SIZE = 25;

/** A picture for each kind of notification (by the start of its type, e.g. "inquiry.created"). */
const ICONS: [test: (type: string) => boolean, icon: LucideIcon][] = [
  [(t) => t.startsWith("reminder") || t.includes("due") || t.includes("late"), AlarmClock],
  [(t) => t.startsWith("payment"), BadgeDollarSign],
  [(t) => t.includes("assigned"), UserPlus],
  [(t) => t.includes("won"), Trophy],
  [(t) => t.startsWith("revision") || t.startsWith("quotation"), FileText],
  [(t) => t.startsWith("inquiry"), ClipboardList],
];

function TypeIcon({ type }: { type: string }) {
  const icon = ICONS.find(([test]) => test(type))?.[1] ?? Bell;
  return createElement(icon, { className: "size-4", "aria-hidden": true });
}

/** Where a row goes: through /notifications/open (marks it read) when new, else straight to its link. */
const openHref = (n: NotificationItem) => (n.readAt ? (n.link ?? "/notifications") : buildHref("/notifications/open", {}, { id: n.id, to: n.link ?? undefined }));

/**
 * My notifications (design system: List frame): All / Unread chips with their
 * counts, new ones in bold with a dot; a row opens what it is about and marks
 * it read; 25 a page. "Mark all as read" is the page's one button.
 */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ show?: string; page?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const onlyUnread = sp.show === "unread";
  const page = toPage(sp.page);
  type Mine = { unread: number; total: number; items: NotificationItem[] };
  const [{ unread, total, items }, every] = await Promise.all([
    api.get<Mine>("/notifications", { unread: onlyUnread ? "true" : undefined, take: PAGE_SIZE, page }),
    // The All chip's count, when Unread is shown.
    onlyUnread ? api.get<Mine>("/notifications", { take: 1 }) : null,
  ]);
  const all = every ? every.total : total;
  const keep = { show: onlyUnread ? "unread" : undefined };
  const rowMenu = (n: NotificationItem): MenuEntry[] => [
    { label: n.readAt ? "Open" : "Open and mark read", href: openHref(n) },
    ...(n.link ? [{ label: "Copy link", copy: n.link }] : []),
  ];

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Notifications"
        summary={unread ? `${unread} new · open one to go to it; it is then marked read` : "You are all caught up"}
        primary={unread > 0 && <ConfirmAction action={markAllReadAction} label="Mark all as read" pendingText="Marking…" variant="secondary" showSuccess={false} icon={<CheckCheck aria-hidden />} />}
      />
      <ListToolbar
        chips={[
          { key: "all", label: "All", count: all, href: "/notifications", active: !onlyUnread },
          { key: "unread", label: "Unread", count: unread, href: "/notifications?show=unread", active: onlyUnread },
        ]}
        label="Which notifications"
      />
      <Card className="overflow-clip p-0">
        {items.length === 0 ? (
          onlyUnread ? (
            <EmptyState
              framed
              title="Nothing new"
              description="You have read every notification."
              action={
                <ButtonLink href="/notifications" size="sm">
                  All notifications
                </ButtonLink>
              }
            />
          ) : (
            <EmptyState
              framed
              title="No notifications yet"
              description="You are told here when an inquiry is assigned to you, a quotation is answered, a payment arrives or an order needs something."
            />
          )
        ) : (
          <>
            <PhoneList label="Notifications">
              {items.map((n) => (
                <PhoneRow
                  key={n.id}
                  href={openHref(n)}
                  prefetch={false}
                  title={n.title}
                  line={n.body ?? undefined}
                  muted={!!n.readAt}
                  status={!n.readAt ? <StatusBadge meaning="info">New</StatusBadge> : undefined}
                  figure={timeAgo(n.createdAt)}
                />
              ))}
            </PhoneList>
            <DataTable label="Notifications" className="max-sm:hidden">
              <THead>
                <tr>
                  <Th>What happened</Th>
                  <Th className="text-right">When</Th>
                  <Th className="w-12">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <tbody>
                {items.map((n) => {
                  const unreadRow = !n.readAt;
                  return (
                    <DataRow key={n.id} href={openHref(n)} className={cn(unreadRow && "bg-primary-soft/30")}>
                      <Td className="py-2.5">
                        <span className="flex items-start gap-3">
                          <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", unreadRow ? "bg-primary-soft text-primary" : "bg-surface-2 text-muted")}>
                            <TypeIcon type={n.type} />
                          </span>
                          <span className="min-w-0">
                            <Link href={openHref(n)} prefetch={false} className={cn("block hover:text-primary", unreadRow ? "font-semibold text-text" : "text-text-2")}>
                              {n.title}
                              {unreadRow && <span className="sr-only"> (new)</span>}
                            </Link>
                            {n.body && <span className="mt-0.5 block text-sm text-text-2">{n.body}</span>}
                          </span>
                        </span>
                      </Td>
                      <Td className="text-right text-xs whitespace-nowrap text-text-2">
                        <span className="inline-flex items-center gap-2">
                          <time dateTime={n.createdAt} title={dateTime(n.createdAt)}>
                            {timeAgo(n.createdAt)}
                          </time>
                          {unreadRow && <span className="size-2 rounded-full bg-primary" aria-hidden />}
                        </span>
                      </Td>
                      <Td className="text-right">
                        <RowMenu items={rowMenu(n)} label={`Actions for ${n.title}`} />
                      </Td>
                    </DataRow>
                  );
                })}
              </tbody>
            </DataTable>
          </>
        )}
        <Pager base="/notifications" params={keep} page={page} pageSize={PAGE_SIZE} total={total} />
      </Card>
    </div>
  );
}
