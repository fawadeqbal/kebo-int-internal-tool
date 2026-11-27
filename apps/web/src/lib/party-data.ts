import "server-only";
import { cache } from "react";
import { api } from "./api";
import { load } from "./session";
import type { CustomerDetail, SupplierDetail } from "./types-people";
import type { CustomerPayments, Payable } from "./types-money";

import type { Note } from "./types-notes";
import { part } from "@/lib/part";

/**
 * A customer's or supplier's data, fetched once per request: the record's layout (header, figures, tab
 * counts) and each tab ask for the same things.
 */
export const customerOf = cache((id: string) => load(() => api.get<CustomerDetail>(`/customers/${id}`)));
/** What the customer paid and still owes, order by order (null when it cannot be read). */
/** Their orders' money (null: this person may not see it; a Failed: it could not be read, and the parts using it say so). */
export const customerPaymentsOf = cache((id: string) => part("their payments", () => api.get<CustomerPayments>("/payments", { customerId: id })));

export const supplierOf = cache((id: string) => load(() => api.get<SupplierDetail>(`/factories/${id}`)));
/** What we still owe this supplier (Finance › Payables, one row per supplier and currency); a Failed: not read, and the tab says so. */
export const supplierPayablesOf = cache((id: string) => part("what we still owe them", () => api.get<Payable[]>("/money/payables", { factory: id })));
/** The record's notes and calls; a Failed: not read, and the list says so (never "No notes yet"). */
export const partyNotesOf = cache((kind: "customers" | "factories", id: string) => part("the notes", () => api.get<Note[]>(`/${kind}/${id}/notes`)));
