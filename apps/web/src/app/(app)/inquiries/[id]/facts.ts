import { cache } from "react";
import { api } from "@/lib/api";
import { sourcingOf } from "@/lib/deal-data";
import type { SupplierRequests } from "@/lib/types-flow";
import type { OfferFacts } from "./steps";

/** The inquiry's supplier requests (who was asked, who answered). Read once per page, shared by the frame and the tab. */
export const requestsOf = cache((id: string) => api.get<SupplierRequests>(`/inquiries/${id}/factory-requests`).catch(() => null));

/** What the frame says about the supplier side: offers in, suppliers asked and answered, who is still to answer. For people who see supplier prices. */
export async function offerFactsOf(id: string): Promise<OfferFacts> {
  const [s, r] = await Promise.all([sourcingOf(id).catch(() => null), requestsOf(id)]);
  const asked = r?.items ?? [];
  const waiting = asked.filter((x) => !x.supplierQuoteId && x.status === "sent");
  return {
    offers: s?.quotes.length ?? 0,
    asked: asked.length,
    answered: asked.length - waiting.length,
    waiting: waiting.map((x) => ({ name: x.factory.name, replyBy: x.replyBy })),
  };
}
