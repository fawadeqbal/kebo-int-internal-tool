import { cache } from "react";
import { api } from "@/lib/api";
import { sourcingOf } from "@/lib/deal-data";
import type { FactoryRequests } from "@/lib/types-flow";
import type { OfferFacts } from "./steps";

/** The inquiry's factory requests (who was asked, who answered). Read once per page, shared by the frame and the tab. */
export const requestsOf = cache((id: string) => api.get<FactoryRequests>(`/inquiries/${id}/factory-requests`).catch(() => null));

/** What the frame says about the factory side: offers in, factories asked and answered, who is still to answer. For people who see factory prices. */
export async function offerFactsOf(id: string): Promise<OfferFacts> {
  const [s, r] = await Promise.all([sourcingOf(id).catch(() => null), requestsOf(id)]);
  const asked = r?.items ?? [];
  const waiting = asked.filter((x) => !x.factoryQuoteId && x.status === "sent");
  return {
    offers: s?.quotes.length ?? 0,
    asked: asked.length,
    answered: asked.length - waiting.length,
    waiting: waiting.map((x) => ({ name: x.factory.name, replyBy: x.replyBy })),
  };
}
