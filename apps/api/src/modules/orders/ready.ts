import { fromDbDateOrNull, readyByOf, readySelect, toDbDateOrNull } from "@kebo/database";
import type { SupplierReadyRow } from "@kebo/shared";
import type { ISODate } from "@kebo/utils";
import type { PrismaService, Tx } from "../../database/prisma.service";

/* The readers (readySelect, readyOnOf, readyByOf, supplierReadyOf) are in @kebo/database: every module reads the dates. */

type Db = PrismaService["db"] | Tx;

/**
 * Set ready dates: each supplier sent gets its date (supplierId null: the order's goods when no line names a
 * supplier). Returns the dates before and after, for the history, or null when nothing changed.
 */
export async function setReadyDates(tx: Db, orderId: string, changes: { supplierId: string | null; readyOn: ISODate | null }[]) {
  const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { ...readySelect, lines: { select: { supplierId: true } } } });
  const ids = [...new Set(o.lines.flatMap((l) => (l.supplierId ? [l.supplierId] : [])))];
  const before = readyByOf(o);
  let changed = false;
  for (const c of changes) {
    // Only the order's own suppliers (or the goods' one date when the lines name none).
    if (c.supplierId ? !ids.includes(c.supplierId) : ids.length > 0) continue;
    const row = o.suppliers.find((f) => f.supplierId === c.supplierId);
    if ((fromDbDateOrNull(row?.readyOn ?? null) ?? null) === c.readyOn) continue;
    changed = true;
    const existing = await tx.orderSupplier.findFirst({ where: { orderId, supplierId: c.supplierId }, select: { id: true } });
    if (existing) await tx.orderSupplier.update({ where: { id: existing.id }, data: { readyOn: toDbDateOrNull(c.readyOn) } });
    else await tx.orderSupplier.create({ data: { orderId, supplierId: c.supplierId, readyOn: toDbDateOrNull(c.readyOn) } });
  }
  if (!changed) return null;
  const after = readyByOf(await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { ...readySelect, lines: { select: { supplierId: true } } } }));
  return { before, after };
}

/** One date for every supplier of the order (the stage move, the phone app, a paper's fix): each supplier gets it. */
export async function setReadyAll(tx: Db, orderId: string, readyOn: ISODate | null) {
  const lines = await tx.orderLine.findMany({ where: { orderId }, select: { supplierId: true } });
  const ids = [...new Set(lines.flatMap((l) => (l.supplierId ? [l.supplierId] : [])))];
  return setReadyDates(tx, orderId, ids.length ? ids.map((supplierId) => ({ supplierId, readyOn })) : [{ supplierId: null, readyOn }]);
}

/** "Ready 1 Apr" / "A 1 Mar, B 1 Apr", for the history. */
export function readyWords(rows: SupplierReadyRow[], names: Map<string, string>): string {
  if (rows.length === 1) return rows[0]!.readyOn ?? "not set";
  return rows.map((r) => `${(r.supplierId && names.get(r.supplierId)) || "factory"} ${r.readyOn ?? "not set"}`).join(", ");
}
