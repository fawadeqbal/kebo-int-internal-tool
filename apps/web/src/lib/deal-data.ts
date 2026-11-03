import "server-only";
import { cache } from "react";
import { api } from "./api";
import { load } from "./session";
import type { DealDetail, HistoryEntry } from "./types";
import type { QuotationView, SourcingView } from "./types-deals";

/**
 * An inquiry's data, fetched once per request: the inquiry layout (its steps
 * bar) and each step page ask for the same things.
 */
export const dealOf = cache((id: string) => load(() => api.get<DealDetail>(`/inquiries/${id}`)));
/** The factory offers, costed (people who see factory prices; 403 otherwise). */
export const sourcingOf = cache((id: string) => api.get<SourcingView>(`/inquiries/${id}/sourcing`));
export const quotationOf = cache((id: string) => api.get<QuotationView>(`/inquiries/${id}/quotation`));
/** Every change on the inquiry, its offers, quotation, files and order (newest first). */
export const dealHistoryOf = cache((id: string) => api.get<HistoryEntry[]>("/history", { type: "deal", id }));
