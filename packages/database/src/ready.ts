import { factoryReadyOn, orderReadyOn, readyByFactory, type FactoryReadyRow } from "@kebo/shared";
import type { ISODate } from "@kebo/utils";
import { fromDbDateOrNull } from "./convert";
import type { Prisma } from "./generated/prisma/client";

/**
 * Single source of truth, PR 4: one ready date per factory (owner, 3 Nov 2026). Each factory of an order
 * keeps its own ready date (OrderFactory); the order's ready date is the latest of them (@kebo/shared
 * orderReadyOn), never stored. Each factory's purchase order, the "on the ready date" part of its payment
 * plan and its production items read that factory's date; the customer's plan reads the order's.
 */

/** What the ready dates are worked out from: each factory's row, and the factories on the lines. */
export const readySelect = {
  factories: { select: { factoryId: true, readyOn: true } },
} satisfies Prisma.OrderSelect;

export type ReadyOrder = { factories: { factoryId: string | null; readyOn: Date | null }[]; lines: { factoryId: string | null }[] };

const rowsOf = (o: ReadyOrder): FactoryReadyRow[] =>
  o.factories.map((f) => ({ factoryId: f.factoryId, readyOn: fromDbDateOrNull(f.readyOn) }));
const idsOf = (o: ReadyOrder) => [...new Set(o.lines.flatMap((l) => (l.factoryId ? [l.factoryId] : [])))];

/** The order's ready date: the latest of its factories', once each has given one. */
export const readyOnOf = (o: ReadyOrder): ISODate | null => orderReadyOn(idsOf(o), rowsOf(o));

/** Each factory of the order with its ready date (no factory on the lines: one row, factoryId null). */
export const readyByOf = (o: ReadyOrder) => readyByFactory(idsOf(o), rowsOf(o));

/** One factory's ready date (no factory: the order's). */
export const factoryReadyOf = (o: ReadyOrder, factoryId: string | null): ISODate | null => factoryReadyOn(idsOf(o), rowsOf(o), factoryId);
