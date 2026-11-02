import "server-only";
import { cache } from "react";
import { api } from "./api";
import { load } from "./session";
import type { OrderCosts, OrderMoney } from "./types-money";
import type { OrderView, PaymentsView } from "./types-orders";
import type { OrderDefaults, OrderFlow } from "./types-flow";
import type { OrderSteps } from "./types-checklist";
import type { HistoryEntry } from "./types";
import type { OrderPapers } from "./types-papers";

/**
 * An order's data, fetched once per request: the order layout (steps, Now
 * bar, numbers) and each tab ask for the same things.
 */
export const orderOf = cache((id: string) => load(() => api.get<OrderView>(`/orders/${id}`)));
export const orderPaymentsOf = cache((id: string) => api.get<PaymentsView>(`/orders/${id}/payments`));
export const orderMoneyOf = cache((id: string) => api.get<OrderMoney>(`/orders/${id}/money`));
/** The order's costs and profit (managers with the expenses feature; 403 otherwise). */
export const orderCostsOf = cache((id: string) => api.get<OrderCosts>(`/orders/${id}/costs`));

/** What a step's row fills in from earlier orders and the quote (the forwarder, the banks, the lead time). */
export const orderDefaultsOf = cache((id: string) => api.get<OrderDefaults>(`/orders/${id}/defaults`));

/** The flow after acceptance (payment route, production, shipping, papers and banks, delivery and SAT). */
export const orderFlowOf = cache((id: string) => api.get<OrderFlow>(`/orders/${id}/flow`));

/** The six steps, each a checklist, and "do this now". */
export const orderStepsOf = cache((id: string) => api.get<OrderSteps>(`/orders/${id}/steps`));

/** The order's history, all of it or one step's (newest first). */
export const orderHistoryOf = cache((id: string, step?: string, limit?: number) =>
  api.get<(HistoryEntry & { step: string | null })[]>("/history", {
    type: "order",
    id,
    ...(step ? { step } : {}),
    ...(limit ? { limit: String(limit) } : {}),
  }),
);

/** Every paper of the order with where it stands (step pages, Documents). */
export const orderPapersOf = cache((id: string) => api.get<OrderPapers>(`/orders/${id}/papers`));
