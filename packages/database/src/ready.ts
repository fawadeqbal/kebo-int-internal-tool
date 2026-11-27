import { supplierReadyOn, orderReadyOn, readyBySupplier, type SupplierReadyRow } from "@kebo/shared";
import type { ISODate } from "@kebo/utils";
import { fromDbDateOrNull } from "./convert";
import type { Prisma } from "./generated/prisma/client";

/**
 * Single source of truth, PR 4: one ready date per supplier (owner, 3 Nov 2026). Each supplier of an order
 * keeps its own ready date (OrderSupplier); the order's ready date is the latest of them (@kebo/shared
 * orderReadyOn), never stored. Each supplier's purchase order, the "on the ready date" part of its payment
 * plan and its production items read that supplier's date; the customer's plan reads the order's.
 */

/** What the ready dates are worked out from: each supplier's row, and the suppliers on the lines. */
export const readySelect = {
  factories: { select: { supplierId: true, readyOn: true } },
} satisfies Prisma.OrderSelect;

export type ReadyOrder = { factories: { supplierId: string | null; readyOn: Date | null }[]; lines: { supplierId: string | null }[] };

const rowsOf = (o: ReadyOrder): SupplierReadyRow[] =>
  o.factories.map((f) => ({ supplierId: f.supplierId, readyOn: fromDbDateOrNull(f.readyOn) }));
const idsOf = (o: ReadyOrder) => [...new Set(o.lines.flatMap((l) => (l.supplierId ? [l.supplierId] : [])))];

/** The order's ready date: the latest of its suppliers', once each has given one. */
export const readyOnOf = (o: ReadyOrder): ISODate | null => orderReadyOn(idsOf(o), rowsOf(o));

/** Each supplier of the order with its ready date (no supplier on the lines: one row, supplierId null). */
export const readyByOf = (o: ReadyOrder) => readyBySupplier(idsOf(o), rowsOf(o));

/** One supplier's ready date (no supplier: the order's). */
export const supplierReadyOf = (o: ReadyOrder, supplierId: string | null): ISODate | null => supplierReadyOn(idsOf(o), rowsOf(o), supplierId);
