import { formatMinor, payInstalments, splitDeposit, type Minor } from "@kebo/money";
import { addDays, type ISODate } from "@kebo/utils";

export interface PlanItem {
  label: string;
  amountMinor: Minor;
  dueOn: ISODate | null;
}

/**
 * The plan an order starts with, from its terms: the deposit (due a few days
 * after the order) and the balance (dated once the ship date is known).
 */
export function defaultPlan(totalMinor: Minor, depositPercent: number, orderedOn: ISODate, depositDays: number): PlanItem[] {
  const { deposit, balance } = splitDeposit(totalMinor, depositPercent);
  const items: PlanItem[] = [];
  if (deposit > 0) items.push({ label: `Deposit ${depositPercent}%`, amountMinor: deposit, dueOn: addDays(orderedOn, depositDays) });
  // The terms ("before shipment", "against B/L copy") are shown next to the plan; the balance is dated when the ship date is known.
  if (balance > 0) items.push({ label: deposit > 0 ? "Balance" : "Payment", amountMinor: balance, dueOn: null });
  return items;
}

export type InstalmentStatus = "paid" | "part_paid" | "late" | "due_soon" | "open";

export const INSTALMENT_STATUS_LABEL: Record<InstalmentStatus, string> = {
  paid: "Paid",
  part_paid: "Part paid",
  late: "Late",
  due_soon: "Due soon",
  open: "Not due yet",
};

/**
 * Each instalment with what is paid on it (money received pays the earliest
 * first) and where it stands today.
 */
export function planStatus<T extends PlanItem>(items: T[], settledMinor: Minor, today: ISODate, dueSoonDays: number) {
  return payInstalments(items, settledMinor).map(({ item, paidMinor, openMinor }) => {
    const status: InstalmentStatus =
      openMinor <= 0
        ? "paid"
        : item.dueOn && item.dueOn < today
          ? "late"
          : item.dueOn && item.dueOn <= addDays(today, dueSoonDays)
            ? "due_soon"
            : paidMinor > 0
              ? "part_paid"
              : "open";
    return { ...item, paidMinor, openMinor: Math.max(openMinor, 0), status };
  });
}

/**
 * Where a payment request stands (the plan row with a status, claude/core-plan.md phase 1): not sent yet,
 * sent (the request itself, or the proforma for the deposit), part paid, paid. Worked out, never typed:
 * paid and part paid from the money received (earliest row first), sent from the copy kept when it was sent.
 * A row paid without a request ever being sent is simply paid.
 */
export type RequestState = "not_sent" | "sent" | "part_paid" | "paid";

export const REQUEST_STATE_LABEL: Record<RequestState, string> = {
  not_sent: "Not sent",
  sent: "Sent",
  part_paid: "Part paid",
  paid: "Paid",
};

export const requestState = (row: { paidMinor: Minor; openMinor: Minor }, sent: boolean): RequestState =>
  row.openMinor <= 0 ? "paid" : row.paidMinor > 0 ? "part_paid" : sent ? "sent" : "not_sent";

/** "Deposit 30%: USD 3,000.00 is late (due 1 Nov)" for reminders. */
export const instalmentSentence = (label: string, openMinor: Minor, currency: string, dueOn: ISODate | null) =>
  `${label}: ${formatMinor(openMinor, currency)}${dueOn ? ` due ${dueOn}` : ""}`;
