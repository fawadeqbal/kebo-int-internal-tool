import { apiUser, formBody, handle, idParam, json, parse } from "@/lib/api/http";
import { itemPriceSchema } from "@/modules/sourcing/schema";
import { clearItemFactoryPrice, setItemFactoryPrice } from "@/modules/sourcing/service";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

const ids = async (params: Ctx["params"]) => {
  const p = await params;
  return { id: await idParam(Promise.resolve({ id: p.id })), itemId: await idParam(Promise.resolve({ id: p.itemId })) };
};

/** { factoryName, unitPrice, currency?, vatRate?, pricesIncludeVat, leadTime? } — the one factory price for this customer item (saving again replaces it). */
export const PUT = handle(async (request: Request, { params }: Ctx) => {
  const user = await apiUser("sourcing.manage");
  const { id, itemId } = await ids(params);
  await setItemFactoryPrice(user, id, itemId, parse(itemPriceSchema, await formBody(request)));
  return json({ ok: true });
});

export const DELETE = handle(async (_request: Request, { params }: Ctx) => {
  const user = await apiUser("sourcing.manage");
  const { id, itemId } = await ids(params);
  await clearItemFactoryPrice(user, id, itemId);
  return json({ ok: true });
});
