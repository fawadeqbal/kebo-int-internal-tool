import { ApiError, apiUser, handle, json, searchParams } from "@/lib/api/http";
import { addDaysISO, todayISO } from "@/lib/utils/dates";
import { isUuid } from "@/lib/utils/ids";
import { getQuotationDetail } from "@/modules/quotations/repository";
import { getSettings } from "@/modules/settings/service";

export const runtime = "nodejs";

/** ?quotation=<id> → the web form's starting values (lines copied from the accepted quotation). */
export const GET = handle(async (request: Request) => {
  const user = await apiUser("invoices.manage");
  const id = searchParams(request).quotation;
  const detail = isUuid(id) ? await getQuotationDetail(user, id) : null;
  if (!detail) throw new ApiError(404, "Quotation not found");
  const q = detail.quotation;
  if (q.status !== "accepted") throw new ApiError(400, "Only an accepted quotation can be invoiced.");
  if (detail.invoices.some((i) => i.status !== "cancelled")) throw new ApiError(400, "This quotation already has an invoice.");
  const settings = await getSettings();
  const today = todayISO();
  return json({
    quotation: { id: q.id, refNo: q.refNo, version: q.version },
    query: { id: detail.query.id, refNo: detail.query.refNo, title: detail.query.title },
    customer: detail.customer,
    currency: settings.currency,
    initial: {
      items: detail.items.map((i) => ({ description: i.description, quantity: String(Number(i.quantity)), unitPrice: String(Number(i.unitPrice)) })),
      discount: String(Number(q.discount)),
      taxRate: String(Number(q.taxRate)),
      issueDate: today,
      dueDate: addDaysISO(today, settings.invoicePaymentDays),
      notes: "",
    },
  });
});
