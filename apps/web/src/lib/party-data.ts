import "server-only";
import { cache } from "react";
import { api } from "./api";
import { load } from "./session";
import type { CustomerDetail, FactoryDetail } from "./types-people";
import type { CustomerPayments, Payable } from "./types-money";
import type { HistoryEntry } from "./types";
import type { Note } from "./types-notes";

/**
 * A customer's or supplier's data, fetched once per request: the record's layout (header, figures, tab
 * counts) and each tab ask for the same things.
 */
export const customerOf = cache((id: string) => load(() => api.get<CustomerDetail>(`/customers/${id}`)));
/** What the customer paid and still owes, order by order (null when it cannot be read). */
export const customerPaymentsOf = cache((id: string) => api.get<CustomerPayments>("/payments", { customerId: id }).catch(() => null));

export const factoryOf = cache((id: string) => load(() => api.get<FactoryDetail>(`/factories/${id}`)));
/** What we still owe this supplier (Finance › Payables, one row per supplier and currency). */
export const factoryPayablesOf = cache(async (id: string) =>
  ((await api.get<Payable[]>("/money/payables").catch(() => [] as Payable[])) ?? []).filter((p) => p.factory.id === id),
);

export const partyHistoryOf = cache((type: "customer" | "factory", id: string) =>
  api.get<HistoryEntry[]>("/history", { type, id }).catch(() => [] as HistoryEntry[]),
);
export const partyNotesOf = cache((kind: "customers" | "factories", id: string) => api.get<Note[]>(`/${kind}/${id}/notes`).catch(() => [] as Note[]));
