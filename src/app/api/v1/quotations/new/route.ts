import { ApiError, apiUser, handle, json, searchParams } from "@/lib/api/http";
import { addDaysISO, todayISO } from "@/lib/utils/dates";
import { isUuid } from "@/lib/utils/ids";
import { getQueryDetail } from "@/modules/queries/repository";
import { getSettings } from "@/modules/settings/service";

export const runtime = "nodejs";

/** ?query=<inquiry id> → the starting values the web form uses for a new quotation. */
export const GET = handle(async (request: Request) => {
  const user = await apiUser("quotations.manage");
  const id = searchParams(request).query;
  const detail = isUuid(id) ? await getQueryDetail(user, id) : null;
  if (!detail) throw new ApiError(404, "Inquiry not found");
  const settings = await getSettings();
  return json({
    query: { id: detail.query.id, refNo: detail.query.refNo, title: detail.query.title, status: detail.query.status },
    customer: detail.customer,
    version: detail.quotations.length + 1,
    currency: settings.currency,
    initial: {
      items: [{ description: detail.query.title, quantity: String(detail.query.quantity), unitPrice: "" }],
      discount: "0",
      taxRate: String(settings.defaultTaxRate),
      dueDate: addDaysISO(todayISO(), settings.quotationValidityDays),
      submittedAt: "",
      terms: settings.defaultQuotationTerms,
      notes: "",
    },
  });
});
