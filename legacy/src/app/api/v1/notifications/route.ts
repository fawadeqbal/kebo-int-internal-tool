import { apiUser, handle, json } from "@/lib/api/http";
import { listForUser, unreadCount } from "@/modules/notifications/repository";

export const runtime = "nodejs";

/** The person's latest 50 notifications (link = the web path of what it is about). */
export const GET = handle(async () => {
  const user = await apiUser();
  const [items, unread] = await Promise.all([listForUser(user.id, 50), unreadCount(user.id)]);
  return json({ items, unread });
});
