import type { ProofOf } from "@kebo/database";
import type { Tx } from "../../database/prisma.service";

/** A stored file's facts (where it is kept, what it is called). */
export interface StoredFile {
  key: string;
  name: string;
  type: string;
  size: number;
}

/**
 * The proof of a payment entry, an expense or money sent for approval: one live attachment per record. Setting
 * one replaces the one before (kept, deleted); the caller removes the old stored file once the transaction holds.
 * Returns the storage key it replaced, if any.
 */
export async function setProof(tx: Tx, of: ProofOf, file: StoredFile, uploadedById: string): Promise<string | null> {
  const old = await removeProof(tx, of);
  await tx.attachment.create({
    data: { ...of, storageKey: file.key, fileName: file.name, mimeType: file.type, size: file.size, uploadedById },
  });
  return old;
}

/** Takes the record's proof off (the row is kept, deleted). Returns its storage key, if there was one. */
export async function removeProof(tx: Tx, of: ProofOf): Promise<string | null> {
  const live = await tx.attachment.findFirst({ where: { ...of, deletedAt: null }, select: { id: true, storageKey: true } });
  if (!live) return null;
  await tx.attachment.update({ where: { id: live.id }, data: { deletedAt: new Date() } });
  return live.storageKey;
}

/** Renames a record's proof. */
export async function renameProof(tx: Tx, of: ProofOf, name: string) {
  await tx.attachment.updateMany({ where: { ...of, deletedAt: null }, data: { fileName: name } });
}
