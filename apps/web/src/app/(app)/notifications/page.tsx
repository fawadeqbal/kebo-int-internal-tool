import Link from "next/link";
import type { ReactNode } from "react";
import { AlarmClock, BadgeDollarSign, Bell, CheckCheck, ClipboardList, FileText, Trophy, UserPlus, type LucideIcon } from "lucide-react";
import { Card, cn, EmptyState, LinkTabs, PageHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { dateTime, timeAgo } from "@/lib/format";
import type { NotificationItem } from "@/lib/types-people";
import { ConfirmAction } from "@/components/people/confirm-action";
import { markAllReadAction, openNotificationAction } from "./actions";

export const metadata = { title: "Notifications" };

/** A picture for each kind of notification (by the start of its type, e.g. "inquiry.created"). */
function iconFor(type: string): LucideIcon {
  if (type.startsWith("reminder") || type.includes("due") || type.includes("late")) return AlarmClock;
  if (type.startsWith("payment")) return BadgeDollarSign;
  if (type.includes("assigned")) return UserPlus;
  if (type.includes("won")) return Trophy;
  if (type.startsWith("revision") || type.startsWith("quotation")) return FileText;
  if (type.startsWith("inquiry")) return ClipboardList;
  return Bell;
}

function Row({ n }: { n: NotificationItem }) {
  const Icon = iconFor(n.type);
  const unread = !n.readAt;
  const body: ReactNode = (
    <span className="flex w-full items-start gap-3 px-4 py-3 text-left">
      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", unread ? "bg-primary-soft text-primary" : "bg-surface-2 text-muted")}>
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm", unread ? "font-semibold text-text" : "text-text-2")}>{n.title}</span>
        {n.body && <span className="mt-0.5 block text-sm text-muted">{n.body}</span>}
        <time dateTime={n.createdAt} title={dateTime(n.createdAt)} className="mt-0.5 block text-xs text-muted">
          {timeAgo(n.createdAt)}
        </time>
      </span>
      {unread && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
    </span>
  );
  if (unread)
    return (
      <form action={openNotificationAction.bind(null, n.id, n.link)}>
        <button type="submit" className="block w-full bg-primary-soft/30 transition-colors hover:bg-primary-soft/60">
          {body}
        </button>
      </form>
    );
  return n.link ? (
    <Link href={n.link} className="block transition-colors hover:bg-surface-2/60">
      {body}
    </Link>
  ) : (
    <div>{body}</div>
  );
}

/** My notifications: new ones first and highlighted; opening one marks it read. */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireUser();
  const { show } = await searchParams;
  const onlyUnread = show === "unread";
  const { unread, items } = await api.get<{ unread: number; items: NotificationItem[] }>("/notifications", { unread: onlyUnread ? "true" : undefined, take: 100 });
  const fresh = items.filter((n) => !n.readAt);
  const earlier = items.filter((n) => n.readAt);
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Notifications"
        description={unread ? `${unread} new. Open one to go to it; it is then marked read.` : "You are all caught up."}
        actions={unread > 0 && <ConfirmAction action={markAllReadAction} label="Mark all as read" pendingText="Marking…" variant="secondary" showSuccess={false} icon={<CheckCheck aria-hidden />} />}
      />
      <LinkTabs
        label="Which notifications"
        className="mb-4"
        tabs={[
          { href: "/notifications", label: "All", active: !onlyUnread },
          { href: "/notifications?show=unread", label: "Unread", count: unread, active: onlyUnread },
        ]}
      />
      {items.length === 0 ? (
        <Card>
          <EmptyState icon={Bell} title={onlyUnread ? "Nothing new" : "No notifications yet"} description="You are told here when a deal is assigned to you, a quotation is answered, a payment arrives or a step is due." />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {fresh.length > 0 && (
            <section aria-label="New">
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">New</h2>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-line">
                  {fresh.map((n) => (
                    <li key={n.id}>
                      <Row n={n} />
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}
          {earlier.length > 0 && (
            <section aria-label="Earlier">
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Earlier</h2>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-line">
                  {earlier.map((n) => (
                    <li key={n.id}>
                      <Row n={n} />
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}
          {items.length >= 100 && <p className="text-xs text-muted">Showing the latest 100.</p>}
        </div>
      )}
    </div>
  );
}
