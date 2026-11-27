import { addMonths, type ISODate } from "@kebo/utils";
import type { OrderWord } from "./progress";
import type { WarrantyFrom } from "./terms";

/**
 * Facts of an order that are worked out, not stored, and that more than one screen or paper may say: the
 * warranty's dates and where each item is. Here, so the web, the API and the phone work them out one way
 * (review 27 Nov 2026: both were worked out inside a web page).
 */

export interface WarrantyDateFacts {
  /** Months typed on the order itself (an older order, before the terms travelled): they win. */
  typedMonths: number | null;
  /** What was agreed with the customer: the months, and what they count from. */
  agreed: { months: number | null; from: WarrantyFrom | null } | null;
  shippedOn: ISODate | null;
  deliveredOn: ISODate | null;
  satDoneOn: ISODate | null;
}

export interface WarrantyDates {
  months: number | null;
  /** What the months count from, when they are the agreed ones (null: typed months, counted the old way). */
  agreedFrom: WarrantyFrom | null;
  startsOn: ISODate | null;
  endsOn: ISODate | null;
}

/**
 * The order's warranty (design "terms that travel"). As agreed with the customer, it counts from the moment
 * agreed (shipment, delivery or the SAT) and from that day only: counted from the SAT, it has not started
 * until the SAT is done. Months typed on the order before stay as they were: from the SAT day or, without a
 * SAT, the delivery day.
 */
export function warrantyDates(f: WarrantyDateFacts): WarrantyDates {
  const agreed = !f.typedMonths && f.agreed?.months ? { months: f.agreed.months, from: f.agreed.from ?? ("shipment" as const) } : null;
  const months = f.typedMonths ?? agreed?.months ?? null;
  const startsOn = !agreed
    ? (f.satDoneOn ?? f.deliveredOn)
    : agreed.from === "shipment"
      ? f.shippedOn
      : agreed.from === "delivery"
        ? f.deliveredOn
        : f.satDoneOn;
  return { months, agreedFrom: agreed?.from ?? null, startsOn, endsOn: startsOn && months ? addMonths(startsOn, months) : null };
}

export interface ItemFacts {
  /** Goods are somewhere; a charge (freight, a fee) is not. */
  goods: boolean;
  quantity: number;
  deliveredQty: number;
  /** Delivered with a mark on its condition (damaged, short…). */
  deliveredMarked: boolean;
  /** Packed: it has cases. */
  packed: boolean;
  receivedQty: number;
  receivedOn: ISODate | null;
}

/** Where one item of an order is now: the furthest it has got. */
export type ItemWhere =
  | { at: "delivered"; marked: boolean }
  | { at: "part_delivered"; got: number; of: number }
  | { at: "arrived" }
  | { at: "on_its_way" }
  | { at: "packed" }
  | { at: "received"; on: ISODate | null }
  | { at: "part_received"; got: number; of: number }
  | { at: "at_supplier" }
  | { at: "not_ordered" };

/**
 * Where an item is, read from what is saved, the furthest first: delivered (in full or in part), then where the
 * order itself has got to (arrived, on its way), then packed, then received from the supplier (in full or in
 * part), then ordered or not. Null for a line that is not goods.
 */
export function itemWhere(item: ItemFacts, order: { word: OrderWord; poSent: boolean }): ItemWhere | null {
  if (!item.goods) return null;
  if (item.deliveredQty > 0)
    return item.deliveredQty >= item.quantity
      ? { at: "delivered", marked: item.deliveredMarked }
      : { at: "part_delivered", got: item.deliveredQty, of: item.quantity };
  if (order.word === "Arrived" || order.word === "Delivered" || order.word === "Done") return { at: "arrived" };
  if (order.word === "Shipped") return { at: "on_its_way" };
  if (item.packed) return { at: "packed" };
  if (item.receivedQty >= item.quantity && item.quantity > 0) return { at: "received", on: item.receivedOn };
  if (item.receivedQty > 0) return { at: "part_received", got: item.receivedQty, of: item.quantity };
  return order.poSent ? { at: "at_supplier" } : { at: "not_ordered" };
}

/** How each place reads: good news green, something short amber, the rest quiet. */
export const ITEM_WHERE_TONE: Record<ItemWhere["at"], "ok" | "warn" | "info" | "neutral"> = {
  delivered: "ok",
  part_delivered: "warn",
  arrived: "info",
  on_its_way: "info",
  packed: "info",
  received: "ok",
  part_received: "warn",
  at_supplier: "neutral",
  not_ordered: "neutral",
};
