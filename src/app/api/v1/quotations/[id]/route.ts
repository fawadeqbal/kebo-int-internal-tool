import { can } from "@/lib/auth/permissions";
import { ApiError, apiUser, formBody, handle, idParam, json, parse } from "@/lib/api/http";
import { getQuotationDetail } from "@/modules/quotations/repository";
import { quotationSchema } from "@/modules/quotations/schema";
import { deleteDraftQuotation, updateQuotation } from "@/modules/quotations/service";
import { quotationAbilities, quotationChanges } from "@/modules/documents/abilities";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, { params }: Ctx) => {
  const user = await apiUser();
  const id = await idParam(params);
  const detail = await getQuotationDetail(user, id);
  if (!detail) throw new ApiError(404, "Quotation not found");
  const abilities = quotationAbilities(user, detail);
  return json({
    ...detail,
    invoices: can(user.role, "invoices.manage") ? detail.invoices : [],
    changes: quotationChanges(detail),
    pdf: `/api/quotations/${id}/pdf`,
    can: { ...abilities, activeInvoice: undefined },
  });
});

/** Drafts only (same body as create, without queryId). */
export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const user = await apiUser("quotations.manage");
  await updateQuotation(user, await idParam(params), parse(quotationSchema, await formBody(request)));
  return json({ ok: true });
});

/** Delete a draft. → { queryId } */
export const DELETE = handle(async (_request: Request, { params }: Ctx) => {
  const user = await apiUser("quotations.manage");
  return json({ queryId: await deleteDraftQuotation(user, await idParam(params)) });
});
