import { REQUEST_STATE_LABEL, type RequestState } from "@kebo/shared";
import type { SentWith } from "@/lib/types-money";

/**
 * Payment requests: where their pages are and their status in words. Plain functions, so the server's
 * pages and the browser's components both use them.
 */

const dayMonth = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Where the pages of one request are. */
export const requestHref = (orderId: string, ref: string) => `/operations/payment-requests/${orderId}/${ref}`;
export const requestPrintHref = (orderId: string, ref: string, q: { now?: boolean; v?: number; back?: string } = {}) =>
  `/print/orders/${orderId}/payment-request?${new URLSearchParams({ ref, ...(q.now ? { now: "1" } : {}), ...(q.v ? { v: String(q.v) } : {}), ...(q.back ? { back: q.back } : {}) })}`;
export const requestPdfHref = (orderId: string, ref: string, v?: number) =>
  `/pdf/payment-request/${orderId}?${new URLSearchParams({ ref, ...(v ? { v: String(v) } : {}) })}`;

/** "Sent 12 Nov · R2", "Sent with the proforma", "At the bank since 3 Nov", "Not sent", "Part paid", "Paid", "Cancelled". */
export function requestWords(r: {
  state: RequestState | "cancelled";
  with: SentWith | null;
  sentOn: string | null;
  revision: number | null;
  through?: "customer" | "bank";
}): string {
  if (r.state === "cancelled") return "Cancelled";
  // A bank route's balance is asked for with the papers: until they go to our bank it waits for them.
  if (r.state === "not_sent" && r.through === "bank") return "Papers not at the bank yet";
  if (r.state !== "sent") return REQUEST_STATE_LABEL[r.state];
  if (r.with === "proforma") return "Sent with the proforma";
  if (r.with === "bank") return `At the bank${r.sentOn ? ` since ${dayMonth(r.sentOn)}` : ""}`;
  return `Sent${r.sentOn ? ` ${dayMonth(r.sentOn)}` : ""}${r.revision && r.revision > 1 ? ` · R${r.revision}` : ""}`;
}
