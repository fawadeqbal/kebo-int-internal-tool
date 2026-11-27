import { cache } from "react";
import { api } from "@/lib/api";
import { sourcingOf } from "@/lib/deal-data";
import type { SupplierRequests } from "@/lib/types-flow";
import type { OfferFacts } from "./steps";
import { failedWhat, isFailed, part, type Failed } from "@/lib/part";

/** The inquiry's supplier requests (who was asked, who answered). Read once per page, shared by the frame and the tab. */
export const requestsOf = cache((id: string) =>
  part("who was asked for prices", () => api.get<SupplierRequests>(`/inquiries/${id}/factory-requests`)),
);

/** What the frame says about the supplier side: offers in, suppliers asked and answered, who is still to answer. For people who see supplier prices. */
export async function offerFactsOf(id: string): Promise<OfferFacts | Failed> {
  const [sPart, rPart] = await Promise.all([part("the supplier offers", () => sourcingOf(id)), requestsOf(id)]);
  // Not read: the frame says so, and does not count offers it could not see (no "Ask suppliers" on a guess).
  // Named for what failed: the offers, who was asked, or both.
  if (isFailed(sPart) || isFailed(rPart)) return { failed: true, what: failedWhat(sPart, rPart)! };
  const s = sPart;
  const asked = rPart?.items ?? [];
  const waiting = asked.filter((x) => !x.supplierQuoteId && x.status === "sent");
  return {
    offers: s?.quotes.length ?? 0,
    asked: asked.length,
    answered: asked.length - waiting.length,
    waiting: waiting.map((x) => ({ name: x.factory.name, replyBy: x.replyBy })),
  };
}
