import { apiUser, handle, idParam, json } from "@/lib/api/http";
import { reviseQuotation } from "@/modules/quotations/service";

export const runtime = "nodejs";

/** A new draft version with the same lines (the sent one stays as the customer saw it). → { id } */
export const POST = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await apiUser("quotations.manage");
  const created = await reviseQuotation(user, await idParam(params));
  return json({ id: created.id }, 201);
});
