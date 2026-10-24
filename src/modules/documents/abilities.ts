import { can } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/session";
import { compareLines } from "@/lib/revisions";
import type { getQuotationDetail } from "@/modules/quotations/repository";
import { isEditable, QUOTATION_TRANSITIONS } from "@/modules/quotations/workflow";

type QuotationDetail = NonNullable<Awaited<ReturnType<typeof getQuotationDetail>>>;

/**
 * What a person may do with a quotation, for the web page and the app alike.
 * Only the newest version is live: older ones are superseded and read-only.
 */
export function quotationAbilities(user: SessionUser, d: QuotationDetail) {
  const manage = can(user.role, "quotations.manage");
  const q = d.quotation;
  const live = !d.superseded;
  const activeInvoice = d.invoices.find((i) => i.status !== "cancelled") ?? null;
  return {
    edit: manage && live && isEditable(q.status),
    revise: manage && live && !isEditable(q.status) && !activeInvoice,
    delete: manage && live && q.status === "draft",
    transitions: manage && live ? QUOTATION_TRANSITIONS[q.status] : [],
    invoice: live && q.status === "accepted" && !activeInvoice && can(user.role, "invoices.manage"),
    activeInvoice,
  };
}

/** What changed since the previous version ([] for v1). */
export const quotationChanges = (d: QuotationDetail) => (d.previous ? compareLines(d.previous.items, d.items) : []);
