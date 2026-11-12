import { nextReference } from "./counters";
import type { ISODate } from "@kebo/utils";
import type { Db as Client } from "./client";
import { fromDbDateOrNull } from "./convert";
import { readyInclude } from "./ready";

type Db = Pick<Client, "$queryRaw" | "orderLine" | "purchaseOrder">;

/**
 * Makes the order's purchase orders: one per supplier named on its lines that has none yet, numbered on their
 * own (PO-2026-0001), in the supplier's currency from its offer. Called when an order is made (Purchasing, the
 * demo seed, the data loaders); a supplier's lines never move afterwards. Returns the purchase orders made.
 */
export async function openPurchaseOrders(db: Db, orderId: string, year: number) {
  const [lines, have] = await Promise.all([
    db.orderLine.findMany({ where: { orderId, factoryId: { not: null } }, select: { factoryId: true, factoryCurrency: true }, orderBy: { sortOrder: "asc" } }),
    db.purchaseOrder.findMany({ where: { orderId }, select: { supplierId: true } }),
  ]);
  const made = [];
  const known = new Set(have.map((p) => p.supplierId));
  for (const l of lines) {
    if (known.has(l.factoryId!)) continue;
    known.add(l.factoryId!);
    const currency = lines.find((x) => x.factoryId === l.factoryId && x.factoryCurrency)?.factoryCurrency ?? null;
    made.push(
      await db.purchaseOrder.create({
        data: { orderId, supplierId: l.factoryId!, number: await nextReference(db, "purchaseOrder", year), currency },
        select: { id: true, number: true, supplierId: true },
      }),
    );
  }
  return made;
}

/** When the order's purchase orders were placed with their suppliers, and their numbers for them. */
export const placedSelect = readyInclude;

type Placed = { purchaseOrders: { supplierId: string; sentOn: Date | null; supplierRef: string | null }[] };

/** One supplier's: the day we placed its purchase order and its own number for it. */
export function placedWith(o: Placed, supplierId: string): { orderedOn: ISODate | null; orderNo: string | null } {
  const p = o.purchaseOrders.find((x) => x.supplierId === supplierId);
  return { orderedOn: fromDbDateOrNull(p?.sentOn ?? null), orderNo: p?.supplierRef ?? null };
}

/**
 * The whole order's: placed once every purchase order is (the last of their days); the suppliers' numbers
 * together. An order with no purchase order is never placed.
 */
export function placedOf(o: Placed): { orderedOn: ISODate | null; orderNo: string | null } {
  const days = o.purchaseOrders.map((p) => fromDbDateOrNull(p.sentOn));
  const all = days.length > 0 && days.every(Boolean);
  const refs = [...new Set(o.purchaseOrders.flatMap((p) => (p.supplierRef ? [p.supplierRef] : [])))];
  return { orderedOn: all ? (days as ISODate[]).sort().at(-1)! : null, orderNo: refs.length ? refs.join(", ") : null };
}
