import { apiUser, formBody, handle, idParam, json, parse } from "@/lib/api/http";
import { offerSchema } from "@/modules/sourcing/schema";
import { createOffer } from "@/modules/sourcing/service";

export const runtime = "nodejs";

/** A new factory offer: { supplierId | newSupplierName, quotedOn, currency, pricesIncludeVat, items: [{ sourceId, description, quantity, unit, unitPrice, vatRate }] … } */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await apiUser("sourcing.manage");
  const created = await createOffer(user, await idParam(params), parse(offerSchema, await formBody(request)));
  return json({ id: created.id }, 201);
});
