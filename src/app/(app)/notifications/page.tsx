import { Bell, CheckCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { listForUser } from "@/modules/notifications/repository";
import { markAllReadAction, openNotificationAction } from "@/modules/notifications/actions";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";
import { formatDateTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const items = await listForUser(user.id, 100);
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <>
      <PageHeader
        title="Notifications"
        description={unread ? `${unread} unread` : "You're all caught up"}
        actions={
          unread > 0 && (
            <form action={markAllReadAction}>
              <SubmitButton variant="secondary" pendingText="Marking…">
                <CheckCheck className="h-4 w-4" aria-hidden /> Mark all as read
              </SubmitButton>
            </form>
          )
        }
      />
      <Card>
        {items.length === 0 ? (
          <EmptyState title="No notifications yet" description="You'll be told here when work is assigned to you, statuses change, or deadlines come close." />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((n) => (
              <li key={n.id}>
                <form action={openNotificationAction.bind(null, n.id, n.link)}>
                  <button className={cn("flex w-full items-start gap-3 px-5 py-3.5 text-left hover:bg-canvas/60", !n.readAt && "bg-brand-50/40")}>
                    <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full", n.readAt ? "bg-canvas text-muted" : "bg-brand-100 text-brand-800")}>
                      <Bell className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm", !n.readAt && "font-semibold")}>{n.title}</span>
                      {n.body && <span className="block truncate text-sm text-muted">{n.body}</span>}
                      <span className="text-xs text-muted">{formatDateTime(n.createdAt)}</span>
                    </span>
                    {!n.readAt && <span className="mt-2 h-2 w-2 rounded-full bg-brand-500" aria-label="Unread" />}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
