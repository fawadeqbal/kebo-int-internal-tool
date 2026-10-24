import { apiUser, formBody, handle, idParam, json, parse } from "@/lib/api/http";
import { quotationStatusSchema } from "@/modules/quotations/schema";
import { changeQuotationStatus } from "@/modules/quotations/service";

export const runtime = "nodejs";

/** { status: "sent" | "accepted" | "rejected" | "expired", submittedAt? } */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await apiUser("quotations.manage");
  const data = parse(quotationStatusSchema, await formBody(request));
  await changeQuotationStatus(user, await idParam(params), data.status, data.submittedAt);
  return json({ ok: true, message: "Quotation status updated." });
});
