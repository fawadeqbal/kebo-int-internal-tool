import { percentOfMinor, type Minor } from "./core";

/**
 * Payment terms and what the customer has paid against them. Standard export terms are a
 * deposit (often 30%) before production and the balance before shipment or
 * against a copy of the bill of lading.
 */
export interface DepositSplit {
  deposit: Minor;
  balance: Minor;
}

/** Deposit and balance that always add up to the total. */
export function splitDeposit(totalMinor: Minor, depositPercent: number): DepositSplit {
  const pct = Math.min(Math.max(depositPercent, 0), 100);
  const deposit = percentOfMinor(totalMinor, pct);
  return { deposit, balance: totalMinor - deposit };
}

export interface PaymentLike {
  /** What arrived (or was sent). */
  amountMinor: Minor;
  /**
   * Bank charges taken on the way (the payer's or intermediary bank). They
   * still count towards settling the amount due: the customer paid it, the
   * bank kept part of it.
   */
  bankChargesMinor?: Minor;
}

export type SettlementStatus = "unpaid" | "deposit_paid" | "partly_paid" | "paid" | "overpaid";

export interface Settlement {
  dueMinor: Minor;
  /** Received plus bank charges. */
  settledMinor: Minor;
  receivedMinor: Minor;
  bankChargesMinor: Minor;
  outstandingMinor: Minor;
  /** How much of the deposit is still missing (0 when covered). */
  depositOutstandingMinor: Minor;
  status: SettlementStatus;
}

/**
 * Where a deal stands against its terms. A small shortfall within
 * `toleranceMinor` (e.g. an unrecorded bank fee) is treated as paid, so a deal
 * does not stay "partly paid" forever over a few dollars.
 */
export function settle(dueMinor: Minor, payments: PaymentLike[], depositPercent = 0, toleranceMinor = 0): Settlement {
  const received = payments.reduce((s, p) => s + p.amountMinor, 0);
  const charges = payments.reduce((s, p) => s + (p.bankChargesMinor ?? 0), 0);
  const settled = received + charges;
  const { deposit } = splitDeposit(dueMinor, depositPercent);
  const outstanding = Math.max(dueMinor - settled, 0);
  let status: SettlementStatus;
  if (settled <= 0) status = "unpaid";
  else if (settled > dueMinor) status = "overpaid";
  else if (outstanding <= toleranceMinor) status = "paid";
  else if (deposit > 0 && settled >= deposit) status = "deposit_paid";
  else status = "partly_paid";
  return {
    dueMinor,
    settledMinor: settled,
    receivedMinor: received,
    bankChargesMinor: charges,
    outstandingMinor: status === "paid" ? 0 : outstanding,
    depositOutstandingMinor: Math.max(deposit - settled, 0),
    status,
  };
}
