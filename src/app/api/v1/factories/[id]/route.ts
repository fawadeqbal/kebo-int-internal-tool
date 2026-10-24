import { ApiError, apiUser, formBody, handle, idParam, json, parse } from "@/lib/api/http";
import { findSupplier, offersOfSupplier } from "@/modules/sourcing/repository";
import { supplierSchema } from "@/modules/sourcing/schema";
import { deleteSupplier, updateSupplier } from "@/modules/sourcing/service";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** The factory and its offers (newest first, with the inquiry each was for). */
export const GET = handle(async (_request: Request, { params }: Ctx) => {
  const user = await apiUser("sourcing.manage");
  const id = await idParam(params);
  const supplier = await findSupplier(id);
  if (!supplier) throw new ApiError(404, "Factory not found");
  return json({ supplier, offers: await offersOfSupplier(id), can: { delete: user.role !== "staff" } });
});

export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const user = await apiUser("sourcing.manage");
  await updateSupplier(user, await idParam(params), parse(supplierSchema, await formBody(request)));
  return json({ ok: true });
});

export const DELETE = handle(async (_request: Request, { params }: Ctx) => {
  const user = await apiUser("sourcing.manage");
  await deleteSupplier(user, await idParam(params));
  return json({ ok: true });
});
