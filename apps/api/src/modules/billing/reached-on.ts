import { decimalToMinor, fromDbDate, type Prisma } from "@kebo/database";
import type { ISODate } from "@kebo/utils";

/** The first payment date by which the money (with the bank charges) reached `targetMinor` (payments in date order). */
export function reachedOn(payments: readonly { amount: Prisma.Decimal; bankCharges: Prisma.Decimal; on: Date }[], targetMinor: number): ISODate | null {
  let sum = 0;
  for (const p of payments) {
    sum += decimalToMinor(p.amount) + decimalToMinor(p.bankCharges);
    if (sum >= targetMinor) return fromDbDate(p.on);
  }
  return null;
}
