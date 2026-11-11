import type { Prisma } from "./generated/prisma/client";

/**
 * Every stored file is an attachment row (ERPNext's File, attached to a record): a deal's files, and the proof of a
 * payment entry, an expense or money sent for approval (one live file per record; a new one replaces it).
 */

/** A record's live proof, to include: `files: liveFile`. */
export const liveFile = {
  where: { deletedAt: null },
  orderBy: { createdAt: "desc" },
  take: 1,
  select: { id: true, storageKey: true, fileName: true, mimeType: true, size: true },
} as const satisfies Prisma.MoneyMovement$filesArgs;

type LiveFile = { storageKey: string; fileName: string; mimeType: string; size: number };

/** A record's proof as its key, name, type and size (all null when it has none). */
export function fileOf(files: readonly LiveFile[] | undefined) {
  const f = files?.[0];
  return {
    fileKey: f?.storageKey ?? null,
    fileName: f?.fileName ?? null,
    fileType: f?.mimeType ?? null,
    fileSize: f?.size ?? null,
  };
}

/** Which record a proof is on. */
export type ProofOf = { movementId: string } | { expenseId: string } | { submissionId: string };
