import { ApiError, apiUser, formBody, handle, idParam, json, parse } from "@/lib/api/http";
import { packingTotals } from "@/lib/packing";
import { getPackingListDetail } from "@/modules/packing/repository";
import { packingEditValues } from "@/modules/documents/drafts";
import { packingListSchema } from "@/modules/packing/schema";
import { deletePackingList, updatePackingList } from "@/modules/packing/service";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, { params }: Ctx) => {
  await apiUser("invoices.manage");
  const id = await idParam(params);
  const detail = await getPackingListDetail(id);
  if (!detail) throw new ApiError(404, "Packing list not found");
  // `initial` = the edit form's values (every invoice line with how it is packed).
  const { initial } = await packingEditValues(id);
  return json({ ...detail, totals: packingTotals(detail.items), initial, pdf: `/api/packing-lists/${id}/pdf` });
});

export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const user = await apiUser("invoices.manage");
  await updatePackingList(user, await idParam(params), parse(packingListSchema, await formBody(request)));
  return json({ ok: true });
});

/** → { queryId } */
export const DELETE = handle(async (_request: Request, { params }: Ctx) => {
  const user = await apiUser("invoices.manage");
  const pl = await deletePackingList(user, await idParam(params));
  return json({ queryId: pl.queryId });
});
