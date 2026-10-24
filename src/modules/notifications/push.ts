import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { deviceTokens, sessions, users } from "@/lib/db/schema";
import { pushEnabled, sendPush } from "@/lib/push/fcm";

export interface PushItem {
  userId: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
}

/** Phone push for new in-app notifications: same title, text and link. Never throws. */
export async function pushNotifications(items: PushItem[]): Promise<void> {
  if (items.length === 0 || !pushEnabled()) return;
  try {
    const userIds = [...new Set(items.map((i) => i.userId))];
    const rows = await db
      .select({ userId: deviceTokens.userId, token: deviceTokens.token })
      .from(deviceTokens)
      .innerJoin(users, eq(users.id, deviceTokens.userId))
      .innerJoin(sessions, eq(sessions.id, deviceTokens.sessionId))
      .where(and(inArray(deviceTokens.userId, userIds), eq(users.isActive, true), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())));
    if (rows.length === 0) return;
    const dead: string[] = [];
    for (const item of items) {
      const tokens = rows.filter((r) => r.userId === item.userId).map((r) => r.token);
      dead.push(...(await sendPush(tokens, { title: item.title, body: item.body, data: { link: item.link ?? "/notifications", type: item.type } })));
    }
    if (dead.length) await db.delete(deviceTokens).where(inArray(deviceTokens.token, [...new Set(dead)]));
  } catch (error) {
    console.error("[push] failed", error);
  }
}

export async function registerDevice(userId: string, sessionId: string | null, token: string, platform: string) {
  await db
    .insert(deviceTokens)
    .values({ userId, sessionId, token, platform })
    .onConflictDoUpdate({ target: deviceTokens.token, set: { userId, sessionId, platform, lastSeenAt: new Date() } });
}

export async function removeDevice(token: string, userId?: string) {
  await db.delete(deviceTokens).where(userId ? and(eq(deviceTokens.token, token), eq(deviceTokens.userId, userId)) : eq(deviceTokens.token, token));
}
