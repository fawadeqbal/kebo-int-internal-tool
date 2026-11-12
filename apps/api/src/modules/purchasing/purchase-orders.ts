import { openPurchaseOrders, toDbDateOrNull } from "@kebo/database";
import type { ISODate } from "@kebo/utils";
import type { PrismaService, Tx } from "../../database/prisma.service";

type Db = PrismaService["db"] | Tx;

/**
 * Purchasing writes purchase_orders (claude/purchase-orders-design.md): one per supplier of a sales order,
 * numbered on their own. These are the commands other modules call; what a purchase order says is read with
 * the selects in @kebo/database (readySelect, placedSelect).
 */

/** The order's purchase orders, one per supplier on its lines, numbered in the year the order was made. */
export async function openPurchaseOrdersNow(tx: Db, orderId: string) {
  const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { orderedOn: true } });
  return openPurchaseOrders(tx, orderId, o.orderedOn.getUTCFullYear());
}

/**
 * Placed with the suppliers (the factory step's one form): every open purchase order of the order gets the
 * day and the supplier's number sent (undefined: unchanged; null: cleared). Returns how many were changed.
 */
export async function placePurchaseOrders(
  tx: Db,
  orderId: string,
  v: { orderedOn?: ISODate | null; supplierRef?: string | null; byId: string; earlyReason?: string | null },
) {
  await openPurchaseOrdersNow(tx, orderId);
  const data = {
    ...(v.orderedOn !== undefined
      ? { sentOn: toDbDateOrNull(v.orderedOn), sentById: v.orderedOn ? v.byId : null, sentEarlyReason: v.orderedOn ? (v.earlyReason ?? null) : null }
      : {}),
    ...(v.supplierRef !== undefined ? { supplierRef: v.supplierRef } : {}),
  };
  if (!Object.keys(data).length) return 0;
  return (await tx.purchaseOrder.updateMany({ where: { orderId, cancelledAt: null }, data })).count;
}

/** The sales order cancelled: its purchase orders are cancelled with it. */
export async function cancelPurchaseOrders(tx: Db, orderId: string, at = new Date()) {
  await tx.purchaseOrder.updateMany({ where: { orderId, cancelledAt: null }, data: { cancelledAt: at } });
}
