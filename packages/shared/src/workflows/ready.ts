import type { ISODate } from "@kebo/utils";

/**
 * One ready date per supplier (owner, 3 Nov 2026). An order's suppliers are the ones its lines are bought
 * from; each gives its own ready date, which drives that supplier's purchase order, the "on the ready date"
 * part of its payment plan and its production items. The order's ready date is the latest of them, known
 * once every supplier has given one (the goods are ready when the last supplier is). An order whose lines name
 * no supplier keeps one date for all its goods (supplierId null).
 */
export interface SupplierReadyRow {
  supplierId: string | null;
  readyOn: ISODate | null;
}

/** Each supplier of the order with its ready date (null: not given yet); no supplier: one row for the goods. */
export function readyBySupplier(supplierIds: readonly string[], rows: readonly SupplierReadyRow[]): SupplierReadyRow[] {
  const ids = [...new Set(supplierIds)];
  if (!ids.length) return [{ supplierId: null, readyOn: rows.find((r) => r.supplierId === null)?.readyOn ?? null }];
  return ids.map((id) => ({ supplierId: id, readyOn: rows.find((r) => r.supplierId === id)?.readyOn ?? null }));
}

/** The order's ready date: the latest of its suppliers', once each has given one. */
export function orderReadyOn(supplierIds: readonly string[], rows: readonly SupplierReadyRow[]): ISODate | null {
  const each = readyBySupplier(supplierIds, rows);
  if (each.some((r) => !r.readyOn)) return null;
  return each.map((r) => r.readyOn!).sort().at(-1) ?? null;
}

/** One supplier's ready date on the order (no supplier id, or none named on the lines: the order's). */
export function supplierReadyOn(supplierIds: readonly string[], rows: readonly SupplierReadyRow[], supplierId: string | null): ISODate | null {
  if (!supplierId || !supplierIds.includes(supplierId)) return orderReadyOn(supplierIds, rows);
  return rows.find((r) => r.supplierId === supplierId)?.readyOn ?? null;
}

/** One goods line of a supplier, as the "actually ready" rule reads it. */
export interface ReceivedLine {
  quantity: number | string;
  receivedQty: number | string;
  receivedOn: ISODate | null;
}

/**
 * When a supplier's goods were actually ready (Insights): the day the last of its goods lines came in from it in
 * full, or the day the order first shipped (the goods had left, so they were ready), whichever is earlier.
 * Null while neither has happened.
 */
export function supplierReadyActual(lines: readonly ReceivedLine[], shippedOn: ISODate | null): ISODate | null {
  const all = lines.length > 0 && lines.every((l) => Number(l.receivedQty) >= Number(l.quantity) && !!l.receivedOn);
  const received = all ? lines.map((l) => l.receivedOn!).sort().at(-1)! : null;
  return [received, shippedOn].filter((d): d is ISODate => !!d).sort()[0] ?? null;
}

/** Ready against the promise: on time when ready by the promised day, and the days late (0 when on time); null when either is not known. */
export function readyDelay(promised: ISODate | null, actual: ISODate | null): { onTime: boolean | null; daysLate: number | null } {
  if (!promised || !actual) return { onTime: null, daysLate: null };
  const days = Math.round((Date.parse(`${actual}T00:00:00Z`) - Date.parse(`${promised}T00:00:00Z`)) / 86_400_000);
  return { onTime: days <= 0, daysLate: Math.max(days, 0) };
}
