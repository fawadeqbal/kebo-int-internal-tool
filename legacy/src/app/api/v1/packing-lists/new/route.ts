import { ApiError, apiUser, handle, json, searchParams } from "@/lib/api/http";
import { isUuid } from "@/lib/utils/ids";
import { packingDraft } from "@/modules/documents/drafts";

export const runtime = "nodejs";

/** ?invoice=<id> → starting values: every invoice line, ready for packages and weights. */
export const GET = handle(async (request: Request) => {
  await apiUser("invoices.manage");
  const id = searchParams(request).invoice;
  if (!isUuid(id)) throw new ApiError(404, "Invoice not found");
  const { detail, initial } = await packingDraft(id);
  return json({
    invoice: { id: detail.invoice.id, invoiceNo: detail.invoice.invoiceNo },
    query: { id: detail.query.id, refNo: detail.query.refNo, title: detail.query.title },
    customer: detail.customer,
    initial,
  });
});
