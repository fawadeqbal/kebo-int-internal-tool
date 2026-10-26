import { auditLogs } from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db";

export interface AuditEntry {
  userId: string | null;
  action: string; // e.g. "create", "update", "status_change", "delete"
  entityType: string; // e.g. "query", "customer"
  entityId?: string | null;
  summary?: string;
  oldValues?: unknown;
  newValues?: unknown;
}

/** Record who changed what and when. Call inside the same transaction as the change. */
export async function recordAudit(tx: DbOrTx, entry: AuditEntry) {
  await tx.insert(auditLogs).values({
    userId: entry.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    summary: entry.summary,
    oldValues: entry.oldValues ?? null,
    newValues: entry.newValues ?? null,
  });
}

/** Only keep fields that actually changed, so the audit log stays readable. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const a = before[key];
    const b = after[key];
    if (String(a ?? "") !== String(b ?? "")) {
      oldValues[key] = a ?? null;
      newValues[key] = b ?? null;
    }
  }
  return { oldValues, newValues, changed: Object.keys(newValues).length > 0 };
}
