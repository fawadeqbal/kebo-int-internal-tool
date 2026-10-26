import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/db";
import { notifications, users } from "@/lib/db/schema";
import { pushNotifications } from "./push";

export interface NewNotification {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  dedupeKey?: string;
}

/** Saves in-app notifications and sends them to the recipients' phones (in the background). */
export async function insertNotifications(tx: DbOrTx, items: NewNotification[]): Promise<number> {
  if (items.length === 0) return 0;
  const rows = await tx
    .insert(notifications)
    .values(items)
    .onConflictDoNothing()
    .returning({ userId: notifications.userId, type: notifications.type, title: notifications.title, body: notifications.body, link: notifications.link });
  void pushNotifications(rows);
  return rows.length;
}

export async function listForUser(userId: string, limit = 50) {
  return db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(limit);
}

export async function unreadCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

export async function markRead(userId: string, ids?: string[]) {
  const where = ids?.length
    ? and(eq(notifications.userId, userId), inArray(notifications.id, ids))
    : and(eq(notifications.userId, userId), isNull(notifications.readAt));
  await db.update(notifications).set({ readAt: new Date() }).where(where);
}

export async function managerIds(tx: DbOrTx = db): Promise<string[]> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isActive, true), inArray(users.role, ["admin", "manager"])));
  return rows.map((r) => r.id);
}
