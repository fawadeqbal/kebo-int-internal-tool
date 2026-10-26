import type { HandlerMap } from "@/modules/events";
import { emailNewQuery, emailPayment, emailQueryClosed, emailQuotationDecision } from "./admin-email";

/**
 * Admin emails for important events. Sending runs in the background so the
 * person clicking the button never waits for the mail server.
 */
export const emailHandlers: HandlerMap = {
  "query.created": [
    async (e) => {
      void emailNewQuery(e.queryId);
    },
  ],
  "query.statusChanged": [
    async (e) => {
      if (e.to === "completed" || e.to === "not_completed") void emailQueryClosed(e.queryId, e.actorId);
    },
  ],
  "quotation.statusChanged": [
    async (e) => {
      if (e.status === "accepted" || e.status === "rejected") void emailQuotationDecision(e.quotationId);
    },
  ],
  "payment.recorded": [
    async (e) => {
      void emailPayment(e.invoiceId, e.amount);
    },
  ],
};
