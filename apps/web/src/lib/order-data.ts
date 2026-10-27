import "server-only";
import { cache } from "react";
import { api } from "./api";
import { load } from "./session";
import type { OrderMoney } from "./types-money";
import type { OrderView, PaymentsView } from "./types-orders";

/**
 * An order's data, fetched once per request: the order layout (steps, Now
 * bar, numbers) and each tab ask for the same things.
 */
export const orderOf = cache((id: string) => load(() => api.get<OrderView>(`/orders/${id}`)));
export const orderPaymentsOf = cache((id: string) => api.get<PaymentsView>(`/orders/${id}/payments`));
export const orderMoneyOf = cache((id: string) => api.get<OrderMoney>(`/orders/${id}/money`));
