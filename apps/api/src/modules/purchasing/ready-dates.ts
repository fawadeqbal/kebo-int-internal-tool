import { fromDbDateOrNull, readyByOf, readySelect, toDbDateOrNull } from "@kebo/database";
import type { FactoryReadyRow } from "@kebo/shared";
import type { ISODate } from "@kebo/utils";
import type { PrismaService, Tx } from "../../database/prisma.service";
import { openPurchaseOrdersNow } from "./purchase-orders";

/* The readers (readySelect, readyOnOf, readyByOf, factoryReadyOf) are in @kebo/database: every module reads the dates. */

type Db = PrismaService["db"] | Tx;

/**
 * Set ready dates: each supplier's purchase order gets its date (factoryId null: the order's goods when no
 * line names a supplier). Returns the dates before and after, for the history, or null when nothing changed.
 */
export async function setReadyDates(tx: Db, orderId: string, changes: { factoryId: string | null; readyOn: ISODate | null }[]) {
  const select = { ...readySelect, lines: { select: { factoryId: true } } };
  const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select });
  const ids = [...new Set(o.lines.flatMap((l) => (l.factoryId ? [l.factoryId] : [])))];
  const before = readyByOf(o);
  let changed = false;
  for (const c of changes) {
    // Only the order's own suppliers (or the goods' one date when the lines name none).
    if (c.factoryId ? !ids.includes(c.factoryId) : ids.length > 0) continue;
    const was = c.factoryId ? (o.purchaseOrders.find((p) => p.supplierId === c.factoryId)?.readyOn ?? null) : o.goodsReadyOn;
    if ((fromDbDateOrNull(was) ?? null) === c.readyOn) continue;
    changed = true;
    if (c.factoryId) {
      // A supplier on the lines always has its purchase order (made with the order); one made before then gets it now.
      await openPurchaseOrdersNow(tx, orderId);
      await tx.purchaseOrder.update({ where: { orderId_supplierId: { orderId, supplierId: c.factoryId } }, data: { readyOn: toDbDateOrNull(c.readyOn) } });
    } else await tx.order.update({ where: { id: orderId }, data: { goodsReadyOn: toDbDateOrNull(c.readyOn) } });
  }
  if (!changed) return null;
  const after = readyByOf(await tx.order.findUniqueOrThrow({ where: { id: orderId }, select }));
  return { before, after };
}

/** One date for every factory of the order (the stage move, the phone app, a paper's fix): each factory gets it. */
export async function setReadyAll(tx: Db, orderId: string, readyOn: ISODate | null) {
  const lines = await tx.orderLine.findMany({ where: { orderId }, select: { factoryId: true } });
  const ids = [...new Set(lines.flatMap((l) => (l.factoryId ? [l.factoryId] : [])))];
  return setReadyDates(tx, orderId, ids.length ? ids.map((factoryId) => ({ factoryId, readyOn })) : [{ factoryId: null, readyOn }]);
}

/** "Ready 1 Apr" / "A 1 Mar, B 1 Apr", for the history. */
export function readyWords(rows: FactoryReadyRow[], names: Map<string, string>): string {
  if (rows.length === 1) return rows[0]!.readyOn ?? "not set";
  return rows.map((r) => `${(r.factoryId && names.get(r.factoryId)) || "factory"} ${r.readyOn ?? "not set"}`).join(", ");
}
