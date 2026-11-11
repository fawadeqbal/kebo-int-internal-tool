import type { PaymentRoute } from "@kebo/shared";
import type { Tx } from "../../database/prisma.service";

export type PaymentTerms = { route: PaymentRoute | null; balanceWhen: string | null; lcTerms: string | null; lcDays: number | null };

/** How the customer pays an order (order_payment_terms, one row per order): set when the order is made, changed on its Payment step. */
export async function setPaymentTerms(tx: Tx, orderId: string, terms: PaymentTerms) {
  await tx.orderPaymentTerms.upsert({ where: { orderId }, create: { ...terms, orderId }, update: terms });
}
