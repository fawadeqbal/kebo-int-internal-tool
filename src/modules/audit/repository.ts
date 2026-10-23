import { and, count, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, users } from "@/lib/db/schema";

export interface AuditFilters {
  page?: number;
  pageSize?: number;
  entityType?: string;
  userId?: string;
  from?: string;
  to?: string;
}

export async function listAudit({ page = 1, pageSize = 50, entityType, userId, from, to }: AuditFilters) {
  const where: SQL | undefined = and(
    entityType ? eq(auditLogs.entityType, entityType) : undefined,
    userId ? eq(auditLogs.userId, userId) : undefined,
    from ? gte(auditLogs.createdAt, new Date(`${from}T00:00:00`)) : undefined,
    to ? lte(auditLogs.createdAt, new Date(`${to}T23:59:59.999`)) : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        summary: auditLogs.summary,
        oldValues: auditLogs.oldValues,
        newValues: auditLogs.newValues,
        createdAt: auditLogs.createdAt,
        userName: users.name,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.userId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(auditLogs).where(where),
  ]);
  return { rows, total, page, pageSize };
}
