import { formatMinor, splitDeposit, type Minor } from "@kebo/money";
import { addDays, type ISODate } from "@kebo/utils";
import type { BalanceTerms, OrderStage, OrderStatus } from "../enums";
import { ORDER_STAGE_LABEL } from "../labels";

/**
 * An order moves through four stages, one button at a time:
 *
 *   Confirmed → In production → Shipped → Done
 *
 * Nothing blocks a move. When something looks off (no deposit yet, money still
 * due) the person is warned and confirms. The same rules run in the API, the
 * web, the phone app and the reminders, and nothing here touches the database.
 */

export const STAGE_FLOW: readonly OrderStage[] = ["confirmed", "in_production", "shipped", "done"];

export const nextStage = (s: OrderStage): OrderStage | null => STAGE_FLOW[STAGE_FLOW.indexOf(s) + 1] ?? null;
export const previousStage = (s: OrderStage): OrderStage | null => STAGE_FLOW[STAGE_FLOW.indexOf(s) - 1] ?? null;

/** The button that moves an order into a stage. */
export const STAGE_BUTTON: Record<OrderStage, string> = {
  confirmed: "Back to Confirmed",
  in_production: "Start production",
  shipped: "Mark as shipped",
  done: "Close the order",
};

/** What the money looks like, in minor units of the order's currency. */
export interface OrderMoney {
  totalMinor: Minor;
  /** Received from the customer so far (bank charges they bore count as paid). */
  receivedMinor: Minor;
  depositPercent: number;
}

export const depositOf = (m: OrderMoney): Minor => (m.depositPercent > 0 ? splitDeposit(m.totalMinor, m.depositPercent).deposit : 0);
export const dueOf = (m: OrderMoney): Minor => Math.max(m.totalMinor - m.receivedMinor, 0);

export interface StageWarning {
  code: "no_deposit" | "balance_before_shipping" | "money_due";
  message: string;
}

/**
 * Things worth a second look before moving forward. Moving back never warns.
 * The person may still go ahead: they confirm, and the move is recorded.
 */
export function stageWarnings(to: OrderStage, m: OrderMoney & { currency: string; balanceTerms: BalanceTerms }): StageWarning[] {
  const due = dueOf(m);
  const deposit = depositOf(m);
  const out: StageWarning[] = [];
  if (to === "in_production" && deposit > 0 && m.receivedMinor < deposit) {
    out.push({ code: "no_deposit", message: `The deposit (${formatMinor(deposit, m.currency)}) has not been received yet.` });
  }
  if (to === "shipped" && m.balanceTerms === "before_shipment" && due > 0) {
    out.push({ code: "balance_before_shipping", message: `${formatMinor(due, m.currency)} is still due, and the terms say the balance is paid before shipping.` });
  }
  if (to === "done" && due > 0) {
    out.push({ code: "money_due", message: `${formatMinor(due, m.currency)} is still due from the customer.` });
  }
  return out;
}

export type MoveCheck = { ok: true; warnings: StageWarning[] } | { ok: false; code: "order_not_open" | "not_next_or_previous" | "same_stage"; message: string };

/** Whether an order may move to a stage: only one step forward or back, and only while it is not cancelled. */
export function checkMove(from: OrderStage, to: OrderStage, status: OrderStatus, money: OrderMoney & { currency: string; balanceTerms: BalanceTerms }): MoveCheck {
  if (status === "cancelled") return { ok: false, code: "order_not_open", message: "This order is cancelled." };
  if (from === to) return { ok: false, code: "same_stage", message: `This order is already ${ORDER_STAGE_LABEL[to]}.` };
  if (to === nextStage(from)) return { ok: true, warnings: stageWarnings(to, money) };
  if (to === previousStage(from)) return { ok: true, warnings: [] };
  return { ok: false, code: "not_next_or_previous", message: `An order moves one stage at a time: from ${ORDER_STAGE_LABEL[from]} it can go to ${[nextStage(from), previousStage(from)].filter(Boolean).map((s) => ORDER_STAGE_LABEL[s!]).join(" or ")}.` };
}

/** How long a stage may sit before someone is reminded. Settings → reminders can change them. */
export interface OrderReminderDays {
  /** Confirmed without the deposit for this many days. */
  depositDays: number;
  /** In production this long when the factory gave no ready date. */
  productionDays: number;
  /** Shipped with money still due this many days after the ship date. */
  balanceDays: number;
}

export const DEFAULT_ORDER_REMINDER_DAYS: OrderReminderDays = { depositDays: 7, productionDays: 45, balanceDays: 14 };

export interface OrderFacts extends OrderMoney {
  stage: OrderStage;
  status: OrderStatus;
  currency: string;
  /** The day the stage was entered. */
  stageSince: ISODate;
  /** Expected ready date from the factory, if known. */
  readyOn: ISODate | null;
  shippedOn: ISODate | null;
}

/** What an open order needs from someone now, and by when. Null when nothing (done or cancelled). */
export interface OrderNeed {
  title: string;
  due: ISODate;
  late: boolean;
}

export function orderNeeds(o: OrderFacts, today: ISODate, days: OrderReminderDays = DEFAULT_ORDER_REMINDER_DAYS): OrderNeed | null {
  const due = dueOf(o);
  const need = (title: string, by: ISODate): OrderNeed => ({ title, due: by, late: by < today });
  const balanceBy = addDays(o.shippedOn ?? o.stageSince, days.balanceDays);
  if (o.status === "cancelled") return null;
  // Closed with money still owed (closed anyway, or a payment removed later): keep chasing it.
  if (o.status === "closed") return due > 0 ? need(`Get the balance (${formatMinor(due, o.currency)}) — the order is closed`, balanceBy) : null;
  switch (o.stage) {
    case "confirmed": {
      const deposit = depositOf(o);
      if (deposit > 0 && o.receivedMinor < deposit) return need(`Get the deposit (${formatMinor(deposit - o.receivedMinor, o.currency)})`, addDays(o.stageSince, days.depositDays));
      return need(deposit > 0 ? "Deposit is in: start production" : "Start production (no deposit on these terms)", addDays(o.stageSince, days.depositDays));
    }
    case "in_production":
      return o.readyOn ? need(`Goods due from the factory`, o.readyOn) : need("Ask the factory for the ready date", addDays(o.stageSince, days.productionDays));
    case "shipped":
      return need(due > 0 ? `Get the balance (${formatMinor(due, o.currency)})` : "Paid in full: close the order", balanceBy);
    case "done":
      return due > 0 ? need(`Get the balance (${formatMinor(due, o.currency)})`, balanceBy) : null;
  }
}
