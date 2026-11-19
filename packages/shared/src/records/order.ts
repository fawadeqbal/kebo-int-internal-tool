import { addDays, type ISODate } from "@kebo/utils";
import type { OrderWord } from "../workflows/progress";
import type { OrderTab } from "../workflows/order-sections";
import { recordType } from "./types";

/**
 * The order (canvas "RFQ Desk — the pieces", row "The order on the same pieces", board "One record type"): its
 * states as people see them. Confirmed waits on us; the middle ones are moving; Delivered and Done are good.
 */
export const ORDER = recordType<OrderWord>({
  name: { one: "order", many: "orders" },
  states: {
    Confirmed: { words: "Confirmed", tone: "warn" },
    "In production": { words: "In production", tone: "info" },
    Shipped: { words: "Shipped", tone: "info" },
    Arrived: { words: "Arrived", tone: "info" },
    Delivered: { words: "Delivered", tone: "ok" },
    Done: { words: "Done", tone: "ok" },
    Cancelled: { words: "Cancelled", tone: "neutral" },
  },
});

/** What the header's next step reads from an order (worked out from what is saved). */
export interface OrderStepFacts {
  status: "open" | "closed" | "cancelled";
  /** Closed, and this person may open it again. */
  canReopen: boolean;
  /** Delivered (or gone, without Delivery & SAT), paid, and this person may close it. */
  canClose: boolean;
  /** How the customer pays is chosen (T/T, a bank contract, an LC). */
  routeChosen: boolean;
  /** The deposit still to come (0: none asked, or in). */
  depositDue: number;
  /** The company keeps purchase orders and production (the Purchase order and Production tabs). */
  production: boolean;
  /** The purchase order went to the supplier. */
  poSent: boolean;
  /** The supplier's deposit (their part due when we order) still to pay (0: none, or paid). */
  supplierDepositDue: number;
  /** The supplier's ready date (null: none given). */
  readyOn: ISODate | null;
  /** Every goods line came in from the supplier. */
  goodsIn: boolean;
  /** The company keeps shipments (the Shipping tab's shipments). */
  shipping: boolean;
  /** Shipment 1: booked (has a booking or is past planned), left, arrived; its ETD and ETA. */
  booked: boolean;
  etd: ISODate | null;
  sailed: boolean;
  eta: ISODate | null;
  arrived: boolean;
  /** The balance is due before shipment, and still to come. */
  balanceBeforeShipment: number;
  /** The shipping advice went to the customer (null: this company does not make one). */
  adviceSent: boolean | null;
  /** The company keeps Delivery & SAT. */
  deliverySat: boolean;
  delivered: boolean;
  /** A site test was agreed (planned, or points to check), and it is not signed off yet. */
  satOpen: boolean;
}

/** The order's acts the header can offer, in the order they are checked. */
export type OrderStepKey =
  | "choose_route"
  | "record_deposit"
  | "send_po"
  | "pay_supplier"
  | "set_ready"
  | "goods_in"
  | "book"
  | "ask_balance"
  | "sailed"
  | "send_advice"
  | "arrived"
  | "delivered"
  | "sign_sat"
  | "close"
  | "reopen";

/** The header's one strong button: what it says, the tab it works on, and the window there it opens. */
export interface OrderStep {
  key: OrderStepKey;
  label: string;
  tab: OrderTab;
  /** The window on that tab the button opens (its `name`); none: the tab itself. */
  window?: string;
}

const STEP: Record<OrderStepKey, Omit<OrderStep, "key">> = {
  choose_route: { label: "Choose how they pay", tab: "payment", window: "route" },
  record_deposit: { label: "Record the deposit", tab: "payment", window: "record-payment" },
  send_po: { label: "Send the PO", tab: "factory", window: "send-po" },
  pay_supplier: { label: "Pay the supplier's deposit", tab: "factory" },
  set_ready: { label: "Set the ready date", tab: "production", window: "ready-date" },
  goods_in: { label: "Goods received", tab: "production", window: "all-received" },
  book: { label: "Book the shipment", tab: "shipping" },
  ask_balance: { label: "Ask for the balance", tab: "payment" },
  sailed: { label: "Sailed", tab: "shipping" },
  send_advice: { label: "Send the shipping advice", tab: "shipping" },
  arrived: { label: "Arrived", tab: "shipping" },
  delivered: { label: "Delivered", tab: "delivery", window: "all-delivered" },
  sign_sat: { label: "Sign off the SAT", tab: "delivery", window: "sign-off" },
  close: { label: "Close the order", tab: "overview" },
  reopen: { label: "Reopen", tab: "overview" },
};

/**
 * The order's next step (canvas board "The whole order, from accepted to closed"): the first of these that is
 * true — one rule list, the same on every tab, on Home and on the phone. Nothing waits for anything else (a stage
 * can be worked on any day); this only says what is due first. Null: nothing is due now (waiting on someone).
 */
export function orderNextStep(f: OrderStepFacts, today: ISODate): OrderStep | null {
  const step = (key: OrderStepKey): OrderStep => ({ key, ...STEP[key] });
  if (f.status === "cancelled") return null;
  if (f.status === "closed") return f.canReopen ? step("reopen") : null;
  if (!f.routeChosen) return step("choose_route");
  if (f.depositDue > 0) return step("record_deposit");
  const gone = f.sailed || f.arrived || f.delivered;
  if (f.production && !gone) {
    if (!f.poSent) return step("send_po");
    if (f.supplierDepositDue > 0) return step("pay_supplier");
    if (!f.goodsIn && !f.readyOn) return step("set_ready");
    if (!f.goodsIn && f.readyOn && f.readyOn <= today) return step("goods_in");
  }
  if (f.shipping && !gone) {
    const soon = f.goodsIn || (!!f.readyOn && f.readyOn <= addDays(today, 14));
    if (!f.booked && soon) return step("book");
    if (f.balanceBeforeShipment > 0 && (f.booked || f.goodsIn)) return step("ask_balance");
    if (f.booked && f.etd && f.etd <= today) return step("sailed");
  }
  if (f.shipping && f.sailed && f.adviceSent === false && !f.delivered) return step("send_advice");
  if (f.shipping && f.sailed && !f.arrived && !f.delivered && f.eta && f.eta <= today) return step("arrived");
  if (f.deliverySat && f.arrived && !f.delivered) return step("delivered");
  if (f.deliverySat && f.delivered && f.satOpen) return step("sign_sat");
  if (f.canClose) return step("close");
  return null;
}
