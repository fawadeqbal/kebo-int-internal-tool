/**
 * The one word for where an order stands, the same on its own page, in the lists, on the board and on Home:
 * Confirmed → In production → Shipped → Arrived → Delivered → Done (or Cancelled). It is worked out from what
 * is stored (the day we ordered from the factory, the shipments, the delivery, closed), never typed, so two
 * screens cannot say different things about the same order.
 */
export type OrderWord = "Confirmed" | "In production" | "Shipped" | "Arrived" | "Delivered" | "Done" | "Cancelled";
export const ORDER_WORD_TONE: Record<OrderWord, "ok" | "info" | "warn" | "neutral"> = {
  Confirmed: "warn",
  "In production": "info",
  Shipped: "info",
  Arrived: "info",
  Delivered: "ok",
  Done: "ok",
  Cancelled: "neutral",
};

/** The board's column (and the list's chip) a word falls under: arrived and delivered orders are still under Shipped until closed. */
export const orderWordColumn = (w: OrderWord): "confirmed" | "in_production" | "shipped" | "done" =>
  w === "Confirmed" ? "confirmed" : w === "In production" ? "in_production" : w === "Done" || w === "Cancelled" ? "done" : "shipped";

export interface OrderWordFacts {
  status: "open" | "closed" | "cancelled";
  /** We ordered from the factory. */
  ordered: boolean;
  /** Each shipment: its status, and whether a day it left is recorded. */
  shipments: { status: string; left: boolean }[];
  delivered: boolean;
}

const LEFT_PORT = ["departed", "arrived", "cleared"];
const IN_PORT = ["arrived", "cleared"];

/** `features`: the company's modules (null: all on); a switched-off module's facts are not read, as in the to-do list. */
export function orderWord(f: OrderWordFacts, features: readonly string[] | null): OrderWord {
  const on = (m: string) => !features || features.includes(m);
  if (f.status === "cancelled") return "Cancelled";
  if (f.status === "closed") return "Done";
  if (on("delivery_sat") && f.delivered) return "Delivered";
  if (on("shipping")) {
    if (f.shipments.length > 0 && f.shipments.every((s) => IN_PORT.includes(s.status))) return "Arrived";
    if (f.shipments.some((s) => LEFT_PORT.includes(s.status))) return "Shipped";
  } else if (f.shipments.some((s) => s.left)) return "Shipped";
  return f.ordered ? "In production" : "Confirmed";
}
