import { apiUser, formBody, handle, idParam, json, parse } from "@/lib/api/http";
import { cancelInvoiceSchema } from "@/modules/invoices/schema";
import { cancelInvoice } from "@/modules/invoices/service";

export const runtime = "nodejs";

/** { reason } — only before any payment. */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await apiUser("invoices.manage");
  const data = parse(cancelInvoiceSchema, await formBody(request));
  await cancelInvoice(user, await idParam(params), data.reason);
  return json({ ok: true });
});
