import type { QuotationStatus } from "@/lib/db/schema";

/** Quotation lifecycle: draft → sent → accepted / rejected / expired. */
export const QUOTATION_TRANSITIONS: Record<QuotationStatus, { to: QuotationStatus; label: string }[]> = {
  draft: [{ to: "sent", label: "Mark as sent to customer" }],
  sent: [
    { to: "accepted", label: "Customer accepted" },
    { to: "rejected", label: "Customer rejected" },
    { to: "expired", label: "Mark expired" },
  ],
  accepted: [],
  rejected: [],
  expired: [],
};

export const canMoveQuotation = (from: QuotationStatus, to: QuotationStatus) => QUOTATION_TRANSITIONS[from].some((t) => t.to === to);

/** Only drafts can be edited; anything already sent is changed by creating a new version. */
export const isEditable = (status: QuotationStatus) => status === "draft";
