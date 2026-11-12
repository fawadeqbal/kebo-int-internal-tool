import type { Prisma } from "@kebo/database";
import { DomainError } from "@kebo/utils";
import type { PrismaService, Tx } from "../../database/prisma.service";

type Db = Tx | PrismaService["db"];

/** A version of a made document (order_papers): the proforma, a contract, a commercial invoice… */
export interface VersionRow {
  id: string;
  orderId: string;
  kind: string;
  ref: string;
  number: string;
  version: number;
  status: string;
  options: unknown;
}

/**
 * The life of a made document, the same for every kind (one set of rules for the proforma, the packing
 * list and the papers): a draft can change and can be deleted; a final version stays exactly as it was
 * printed; "Make again" starts the next version as a draft, with the same number.
 */

/** Version 1, as a draft. */
export async function startDraft(
  tx: Db,
  v: { orderId: string; kind: string; ref?: string; number: string; options: Prisma.InputJsonValue; byId: string },
) {
  return tx.orderPaper.create({
    data: { orderId: v.orderId, kind: v.kind, ref: v.ref ?? "", number: v.number, version: 1, status: "draft", options: v.options, madeById: v.byId },
  });
}

/** The draft's options (prices shown, HS codes, stamp…). */
export async function saveDraft(tx: Db, row: VersionRow, options: Prisma.InputJsonValue) {
  if (row.status !== "draft") throw new DomainError(`Version ${row.version} is final. Use Make again for a new version.`);
  await tx.orderPaper.update({ where: { id: row.id }, data: { options } });
}

/**
 * Makes the open version final with what it prints now (`snapshot`), or version 1 straight away as final
 * when there is none yet. Returns the version made final.
 */
export async function makeFinal(
  tx: Db,
  open: VersionRow | null,
  v: { orderId: string; kind: string; ref?: string; number: string; byId: string; snapshot: Prisma.InputJsonValue; options?: Prisma.InputJsonValue },
): Promise<number> {
  const data = { status: "final", snapshot: v.snapshot, finalAt: new Date(), ...(v.options !== undefined ? { options: v.options } : {}) };
  if (open) {
    if (open.status !== "draft") throw new DomainError(`Version ${open.version} is already final.`);
    await tx.orderPaper.update({ where: { id: open.id }, data });
    return open.version;
  }
  await tx.orderPaper.create({
    data: { orderId: v.orderId, kind: v.kind, ref: v.ref ?? "", number: v.number, version: 1, madeById: v.byId, options: v.options ?? {}, ...data },
  });
  return 1;
}

/** "Make again": the next version as a draft, same number and options; the final one stays as printed. */
export async function makeAgain(tx: Db, latest: VersionRow, byId: string) {
  if (latest.status !== "final") throw new DomainError(`Version ${latest.version} is still a draft: change it and make it final, or delete it.`);
  const version = latest.version + 1;
  await tx.orderPaper.create({
    data: {
      orderId: latest.orderId,
      kind: latest.kind,
      ref: latest.ref,
      number: latest.number,
      version,
      status: "draft",
      options: (latest.options ?? {}) as Prisma.InputJsonValue,
      madeById: byId,
    },
  });
  return version;
}

/** A draft goes; the earlier final version, if any, is the document again. */
export async function deleteDraft(tx: Db, row: VersionRow) {
  if (row.status !== "draft") throw new DomainError(`Version ${row.version} is final: it stays as it was printed. Make it again for a new version.`);
  await tx.orderPaper.delete({ where: { id: row.id } });
}

/**
 * Kept as sent (a payment request, a payment receipt): the next version, final straight away, with exactly
 * what it prints now. No draft: the action that sends it is what keeps it. Returns the version kept.
 */
export async function keepAsSent(
  tx: Db,
  v: { orderId: string; kind: string; ref: string; number: string; byId: string; snapshot: Prisma.InputJsonValue; options: Prisma.InputJsonValue },
): Promise<number> {
  const latest = await tx.orderPaper.findFirst({
    where: { orderId: v.orderId, kind: v.kind, ref: v.ref },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = (latest?.version ?? 0) + 1;
  await tx.orderPaper.create({
    data: {
      orderId: v.orderId,
      kind: v.kind,
      ref: v.ref,
      number: v.number,
      version,
      status: "final",
      options: v.options,
      snapshot: v.snapshot,
      madeById: v.byId,
      finalAt: new Date(),
    },
  });
  return version;
}

