import { ApiError, apiUser, handle, json, searchParams } from "@/lib/api/http";
import { isUuid } from "@/lib/utils/ids";
import { quotationDraft } from "@/modules/documents/drafts";

export const runtime = "nodejs";

/** ?query=<inquiry id> → starting values: the requested items (v1) or the latest version's lines. */
export const GET = handle(async (request: Request) => {
  const user = await apiUser("quotations.manage");
  const id = searchParams(request).query;
  if (!isUuid(id)) throw new ApiError(404, "Inquiry not found");
  const d = await quotationDraft(user, id);
  return json({
    query: { id: d.query.id, refNo: d.query.refNo, title: d.query.title, status: d.query.status },
    customer: d.customer,
    requestedItems: d.requestedItems,
    version: d.version,
    currency: d.currency,
    initial: d.initial,
  });
});
