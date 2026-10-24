import { ApiError, apiUser, formBody, handle, idParam, json, parse } from "@/lib/api/http";
import { getAccessibleQuery } from "@/modules/queries/service";
import { findOffer } from "@/modules/sourcing/repository";
import { offerSchema } from "@/modules/sourcing/schema";
import { deleteOffer, updateOffer } from "@/modules/sourcing/service";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, { params }: Ctx) => {
  const user = await apiUser("sourcing.manage");
  const offer = await findOffer(await idParam(params));
  if (!offer) throw new ApiError(404, "Factory offer not found");
  await getAccessibleQuery(user, offer.offer.queryId);
  return json(offer);
});

export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const user = await apiUser("sourcing.manage");
  await updateOffer(user, await idParam(params), parse(offerSchema, await formBody(request)));
  return json({ ok: true });
});

/** → { queryId } */
export const DELETE = handle(async (_request: Request, { params }: Ctx) => {
  const user = await apiUser("sourcing.manage");
  return json({ queryId: await deleteOffer(user, await idParam(params)) });
});
