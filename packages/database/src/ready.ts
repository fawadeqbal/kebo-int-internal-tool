import { factoryReadyOn, orderReadyOn, readyByFactory, type FactoryReadyRow } from "@kebo/shared";
import type { ISODate } from "@kebo/utils";
import { fromDbDateOrNull } from "./convert";
import type { Prisma } from "./generated/prisma/client";

/**
 * Single source of truth, PR 4: one ready date per supplier (owner, 3 Nov 2026). Each purchase order keeps
 * its supplier's ready date; the order's ready date is the latest of them (@kebo/shared orderReadyOn), never
 * stored. An order whose lines name no supplier has no purchase order: its goods' date is on the order
 * (goodsReadyOn). The "on the ready date" part of a supplier's payment plan and its production items read
 * that supplier's date; the customer's plan reads the order's.
 */

/**
 * What the ready dates are worked out from, in an `include` (every column of the order comes with it, the
 * goods' date too): each purchase order's dates. The same purchase order fields as placedSelect.
 */
export const readyInclude = {
  purchaseOrders: { select: { id: true, number: true, supplierId: true, readyOn: true, sentOn: true, supplierRef: true } },
} satisfies Prisma.OrderInclude;

/** …and in a `select`: each purchase order's dates and the goods' date. */
export const readySelect = { ...readyInclude, goodsReadyOn: true } satisfies Prisma.OrderSelect;

export type ReadyOrder = {
  purchaseOrders: { supplierId: string; readyOn: Date | null }[];
  goodsReadyOn: Date | null;
  lines: { factoryId: string | null }[];
};

const rowsOf = (o: ReadyOrder): FactoryReadyRow[] => [
  ...o.purchaseOrders.map((p) => ({ factoryId: p.supplierId, readyOn: fromDbDateOrNull(p.readyOn) })),
  ...(o.goodsReadyOn ? [{ factoryId: null, readyOn: fromDbDateOrNull(o.goodsReadyOn) }] : []),
];
const idsOf = (o: ReadyOrder) => [...new Set(o.lines.flatMap((l) => (l.factoryId ? [l.factoryId] : [])))];

/** The order's ready date: the latest of its factories', once each has given one. */
export const readyOnOf = (o: ReadyOrder): ISODate | null => orderReadyOn(idsOf(o), rowsOf(o));

/** Each factory of the order with its ready date (no factory on the lines: one row, factoryId null). */
export const readyByOf = (o: ReadyOrder) => readyByFactory(idsOf(o), rowsOf(o));

/** One factory's ready date (no factory: the order's). */
export const factoryReadyOf = (o: ReadyOrder, factoryId: string | null): ISODate | null => factoryReadyOn(idsOf(o), rowsOf(o), factoryId);
