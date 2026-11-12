import type { OrderWordFacts } from "@kebo/shared";
import type { Db } from "./client";
import type { Prisma } from "./generated/prisma/client";

/**
 * What an order's one status word is worked out from (@kebo/shared orderWord): whether it is open, the day
 * we ordered from the factory, its shipments and its delivery. Every list that names where an order stands
 * loads these and asks the same rule, so the lists, the board and the order's own page agree.
 */
export const wordSelect = {
  status: true,
  factoryOrderedOn: true,
  shipments: { select: { status: true, departedOn: true } },
  delivery: { select: { deliveredOn: true } },
} satisfies Prisma.OrderSelect;

export type WordOrder = {
  status: "open" | "closed" | "cancelled";
  factoryOrderedOn: Date | null;
  shipments: { status: string; departedOn: Date | null }[];
  delivery: { deliveredOn: Date | null } | null;
};

export const wordFactsOf = (o: WordOrder): OrderWordFacts => ({
  status: o.status,
  ordered: !!o.factoryOrderedOn,
  shipments: o.shipments.map((s) => ({ status: s.status, left: !!s.departedOn })),
  delivered: !!o.delivery?.deliveredOn,
});

/** The word's facts for some orders by id, for lists that get their rows another way (a facts table, raw SQL). */
export async function wordFactsByOrder(db: Pick<Db, "order">, orderIds: string[]): Promise<Map<string, OrderWordFacts>> {
  if (!orderIds.length) return new Map();
  const rows = await db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, ...wordSelect } });
  return new Map(rows.map((o) => [o.id, wordFactsOf(o)]));
}
