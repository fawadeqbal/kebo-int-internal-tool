import type { BalanceWhen, LcTerms, PaymentRoute, RouteTerms } from "@kebo/shared";

/**
 * How the customer pays an order (order_payment_terms, one row per order): the route and its terms. Load with
 * `...termsSelect` (or `paymentTerms: true`), read with termsOf / routeOf: no row reads as nothing chosen.
 */
export const termsSelect = {
  paymentTerms: { select: { route: true, balanceWhen: true, lcTerms: true, lcDays: true } },
} as const;

export type WithTerms = {
  paymentTerms: { route: PaymentRoute | null; balanceWhen: string | null; lcTerms: string | null; lcDays: number | null } | null;
};

/** The route's terms as stored on an order. */
export const termsOf = (o: WithTerms): RouteTerms => ({
  route: o.paymentTerms?.route ?? null,
  balanceWhen: (o.paymentTerms?.balanceWhen as BalanceWhen | null) ?? null,
  lcTerms: (o.paymentTerms?.lcTerms as LcTerms | null) ?? null,
  lcDays: o.paymentTerms?.lcDays ?? null,
});

/** The order's payment route (null: not chosen yet). */
export const routeOf = (o: WithTerms): PaymentRoute | null => o.paymentTerms?.route ?? null;
