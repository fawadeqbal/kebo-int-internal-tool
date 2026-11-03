import { fromDbDateOrNull, toDbDateOrNull, type Prisma } from "@kebo/database";
import { portsOf, shipmentsInOrder, shippedOnOf, type PortsOrder, type ShipmentStatus } from "@kebo/shared";
import type { ISODate } from "@kebo/utils";
import type { PrismaService, Tx } from "../../database/prisma.service";

/**
 * Single source of truth, PR 3: the shipment is the shipment. The B/L, the day the goods left, the
 * container and the ports are read from the order's shipments only, through @kebo/shared's rules:
 * Shipment 1 (primaryShipment, the first made) is what the papers print; "shipped on" is the earliest
 * day any shipment left (shippedOnOf).
 */

/** An order's shipments in their order, for Prisma (the same order as shipmentsInOrder). */
export const SHIPMENT_ORDER: Prisma.ShipmentOrderByWithRelationInput[] = [{ createdAt: "asc" }, { id: "asc" }];

/** What the order's screens read of its shipments. */
export const shipmentFactsSelect = {
  id: true,
  createdAt: true,
  mode: true,
  status: true,
  blNo: true,
  containerNo: true,
  departedOn: true,
  portOfLoading: true,
  portOfDischarge: true,
  eta: true,
} satisfies Prisma.ShipmentSelect;

export const orderShipments = { orderBy: SHIPMENT_ORDER, select: shipmentFactsSelect } as const;

type Row = { id: string; createdAt: Date; departedOn: Date | null; blNo: string | null; containerNo: string | null };

/** Shipment 1, shipped on (the earliest departure), and Shipment 1's B/L and container. */
export function shipFacts<T extends Row>(shipments: readonly T[]) {
  const list = shipmentsInOrder(shipments);
  const primary = list[0] ?? null;
  return {
    list,
    primary,
    shippedOn: shippedOnOf(list.map((s) => ({ departedOn: fromDbDateOrNull(s.departedOn) }))),
    blNo: primary?.blNo ?? null,
    containerNo: primary?.containerNo ?? null,
  };
}

const LEFT: ShipmentStatus[] = ["departed", "arrived", "cleared"];

/**
 * Writes shipping facts typed on the order (the Details card without the shipping module, the move to
 * Shipped, the packing form, a paper's fix) where they belong: on Shipment 1, made when the order has none
 * (sea, ports from the order's terms). A departure date moves it on to "departed". Returns its id and
 * what it held before (for the history).
 */
export async function onPrimaryShipment(
  tx: Tx | PrismaService["db"],
  order: { id: string } & PortsOrder,
  facts: { departedOn?: ISODate | null; blNo?: string | null; containerNo?: string | null },
) {
  const first = await tx.shipment.findFirst({ where: { orderId: order.id }, orderBy: SHIPMENT_ORDER });
  const data: Prisma.ShipmentUncheckedUpdateInput = {};
  if (facts.blNo !== undefined) data.blNo = facts.blNo;
  if (facts.containerNo !== undefined) data.containerNo = facts.containerNo;
  if (facts.departedOn !== undefined) {
    data.departedOn = toDbDateOrNull(facts.departedOn);
    if (facts.departedOn && !LEFT.includes(first?.status ?? "planned")) data.status = "departed";
  }
  const before = {
    departedOn: fromDbDateOrNull(first?.departedOn ?? null),
    blNo: first?.blNo ?? null,
    containerNo: first?.containerNo ?? null,
  };
  if (first) {
    if (Object.keys(data).length) await tx.shipment.update({ where: { id: first.id }, data });
    return { id: first.id, made: false, before };
  }
  const made = await tx.shipment.create({
    data: {
      orderId: order.id,
      mode: "sea",
      status: facts.departedOn ? "departed" : "planned",
      ...portsOf(order),
      blNo: facts.blNo ?? null,
      containerNo: facts.containerNo ?? null,
      departedOn: toDbDateOrNull(facts.departedOn ?? null),
    },
  });
  return { id: made.id, made: true, before };
}
