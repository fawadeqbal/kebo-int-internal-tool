import { ApiError, apiUser, handle, json, searchParams } from "@/lib/api/http";
import { isUuid } from "@/lib/utils/ids";
import { invoiceDraft } from "@/modules/documents/drafts";

export const runtime = "nodejs";

/** ?quotation=<id> → starting values: the accepted quotation's lines. */
export const GET = handle(async (request: Request) => {
  const user = await apiUser("invoices.manage");
  const id = searchParams(request).quotation;
  if (!isUuid(id)) throw new ApiError(404, "Quotation not found");
  const { detail, currency, initial } = await invoiceDraft(user, id);
  const q = detail.quotation;
  return json({
    quotation: { id: q.id, refNo: q.refNo, version: q.version },
    /** What is invoiced: exactly the accepted quotation (read-only). */
    items: detail.items.map((i) => ({ id: i.id, description: i.description, model: i.model, hsCode: i.hsCode, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice, lineTotal: i.lineTotal })),
    totals: { subtotal: q.subtotal, discount: q.discount, taxRate: q.taxRate, pricesIncludeVat: q.pricesIncludeVat, taxAmount: q.taxAmount, total: q.total },
    query: { id: detail.query.id, refNo: detail.query.refNo, title: detail.query.title },
    customer: detail.customer,
    currency,
    initial,
  });
});
