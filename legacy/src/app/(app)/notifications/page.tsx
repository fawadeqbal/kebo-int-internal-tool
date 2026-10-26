import { Bell, CheckCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { listForUser } from "@/modules/notifications/repository";
import { markAllReadAction, openNotificationAction } from "@/modules/notifications/actions";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";
import { formatDateTime, timeAgo } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const items = await listForUser(user.id, 100);
  const unread = items.filter((n) => !n.readAt).length;
  const now = new Date();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="Notifications"
        description={unread ? `${unread} unread` : "You're all caught up"}
        actions={
          unread > 0 && (
            <form action={markAllReadAction}>
              <SubmitButton variant="secondary" size="sm" pendingText="Marking…">
                <CheckCheck aria-hidden /> Mark all as read
              </SubmitButton>
            </form>
          )
        }
      />
      <Card className="overflow-hidden">
        {items.length === 0 ? (
          <EmptyState icon={Bell} title="No notifications yet" description="You'll be told here when work is assigned to you, statuses change, or deadlines come close." />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((n) => (
              <li key={n.id}>
                <form action={openNotificationAction.bind(null, n.id, n.link)}>
                  <button className={cn("flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/70", !n.readAt && "bg-primary-soft/40")}>
                    <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", n.readAt ? "bg-surface-2 text-muted" : "bg-primary-soft text-primary")}>
                      <Bell className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm text-text", !n.readAt && "font-semibold")}>{n.title}</span>
                      {n.body && <span className="block truncate text-sm text-muted">{n.body}</span>}
                      <time dateTime={new Date(n.createdAt).toISOString()} title={formatDateTime(n.createdAt)} className="text-xs text-muted">
                        {timeAgo(n.createdAt, now)}
                      </time>
                    </span>
                    {!n.readAt && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary-solid" aria-label="Unread" />}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
