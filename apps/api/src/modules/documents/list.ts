import type { Prisma } from "@kebo/database";
import type { PrismaService, Tx } from "../../database/prisma.service";

type Db = Tx | PrismaService["db"];

/**
 * The order's document list (order_documents): every paper the trade needs, with its state (missing, ready,
 * kept elsewhere…), its number, its file and, for a paper the app makes, the final version it is.
 */

export async function addDocument(tx: Db, data: Prisma.OrderDocumentUncheckedCreateInput) {
  return tx.orderDocument.create({ data });
}

export async function changeDocument(tx: Db, id: string, data: Prisma.OrderDocumentUncheckedUpdateInput) {
  await tx.orderDocument.update({ where: { id }, data });
}

export async function removeDocument(tx: Db, id: string) {
  await tx.orderDocument.delete({ where: { id } });
}

/** A paper made final: its row in the list is ready, with the paper's number and today's date. */
export async function paperReady(
  tx: Db,
  v: { orderId: string; kind: Prisma.OrderDocumentUncheckedCreateInput["kind"]; rowId: string | null; paperId: string; number: string; today: string },
) {
  const data = { status: "ready" as const, number: v.number, issuedOn: new Date(`${v.today}T00:00:00Z`), paperId: v.paperId, keptWhere: null };
  if (v.rowId) await tx.orderDocument.update({ where: { id: v.rowId }, data });
  else await tx.orderDocument.create({ data: { orderId: v.orderId, kind: v.kind, ...data } });
}

/** A file replaced by a new version: the documents that had the old one have the new one. */
export async function fileReplaced(tx: Db, oldId: string, newId: string) {
  await tx.orderDocument.updateMany({ where: { attachmentId: oldId }, data: { attachmentId: newId } });
}

/** A file deleted: a document that was only its upload is missing again; a made paper keeps its own state. */
export async function fileRemoved(tx: Db, fileId: string) {
  await tx.orderDocument.updateMany({ where: { attachmentId: fileId, paperId: null, status: "ready" }, data: { status: "missing" } });
  await tx.orderDocument.updateMany({ where: { attachmentId: fileId }, data: { attachmentId: null } });
}
