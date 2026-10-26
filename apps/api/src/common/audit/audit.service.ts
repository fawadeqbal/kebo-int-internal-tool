import { Injectable } from "@nestjs/common";
import type { Prisma } from "@kebo/database";
import type { Tx } from "../../database/prisma.service";

export interface AuditEntry {
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
}

/** Writes the audit trail inside the caller's transaction, so the change and its record are saved together. */
@Injectable()
export class AuditService {
  async record(tx: Tx, e: AuditEntry) {
    await tx.auditLog.create({
      data: {
        userId: e.userId,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId ?? null,
        summary: e.summary,
        oldValues: (e.oldValues ?? undefined) as Prisma.InputJsonValue | undefined,
        newValues: (e.newValues ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
