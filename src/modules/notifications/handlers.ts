import { db } from "@/lib/db";
import type { HandlerMap } from "@/modules/events";
import { insertNotifications, managerIds } from "./repository";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  processing: "Processing",
  on_hold: "On Hold",
  completed: "Completed",
  not_completed: "Not Completed",
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
};

const others = (ids: (string | null | undefined)[], actorId: string) =>
  [...new Set(ids.filter((id): id is string => !!id && id !== actorId))];

export const notificationHandlers: HandlerMap = {
  "query.assigned": [
    async (e) => {
      if (!e.assignedTo || e.assignedTo === e.actorId) return;
      await insertNotifications(db, [
        {
          userId: e.assignedTo,
          type: "query.assigned",
          title: `New work assigned: ${e.refNo}`,
          body: e.title,
          link: `/queries/${e.queryId}`,
        },
      ]);
    },
  ],
  "query.statusChanged": [
    async (e) => {
      const recipients = others(e.notify, e.actorId);
      await insertNotifications(
        db,
        recipients.map((userId) => ({
          userId,
          type: "query.statusChanged",
          title: `${e.refNo} is now ${STATUS_LABEL[e.to] ?? e.to}`,
          body: e.title,
          link: `/queries/${e.queryId}`,
        })),
      );
    },
  ],
  "quotation.statusChanged": [
    async (e) => {
      const recipients = others([...e.notify, ...(await managerIds())], e.actorId);
      await insertNotifications(
        db,
        recipients.map((userId) => ({
          userId,
          type: "quotation.statusChanged",
          title: `Quotation ${e.refNo} marked ${STATUS_LABEL[e.status] ?? e.status}`,
          link: `/quotations/${e.quotationId}`,
        })),
      );
    },
  ],
  "payment.recorded": [
    async (e) => {
      const recipients = others(await managerIds(), e.actorId);
      await insertNotifications(
        db,
        recipients.map((userId) => ({
          userId,
          type: "payment.recorded",
          title: `Payment received on ${e.invoiceNo}`,
          body: e.amount,
          link: `/invoices/${e.invoiceId}`,
        })),
      );
    },
  ],
};
