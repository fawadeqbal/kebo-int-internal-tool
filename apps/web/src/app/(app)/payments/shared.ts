import { can, type PaymentRow } from "@kebo/shared";

/** Who opens Treasury › Payments: anyone who sees some kind of money (the API decides which rows). */
export function opensPayments(me: Parameters<typeof can>[0]) {
  return ["payments.record", "sourcing.manage", "expenses.manage", "ledger.view", "money.submit"].some((p) =>
    can(me, p as Parameters<typeof can>[1]),
  );
}

/** One payment's page. */
export const paymentHref = (r: Pick<PaymentRow, "kind" | "id">) => `/payments/${r.kind}/${r.id}`;
