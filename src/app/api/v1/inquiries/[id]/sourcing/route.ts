import { ApiError, apiUser, formBody, handle, idParam, json, parse } from "@/lib/api/http";
import { canWorkOn, getAccessibleQuery } from "@/modules/queries/service";
import { sourcingForQuery } from "@/modules/sourcing/repository";
import { choicesSchema } from "@/modules/sourcing/schema";
import { chooseOffers } from "@/modules/sourcing/service";
import { getSettings } from "@/modules/settings/service";
import { isUuid } from "@/lib/utils/ids";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Factory offers on the inquiry and, per requested item, every offered line with its cost in the main currency. */
export const GET = handle(async (_request: Request, { params }: Ctx) => {
  const user = await apiUser("sourcing.manage");
  const id = await idParam(params);
  const query = await getAccessibleQuery(user, id);
  const settings = await getSettings();
  const sourcing = await sourcingForQuery(id, settings.currency, settings.currency, settings.exchangeRates);
  return json({ query: { id: query.id, refNo: query.refNo, title: query.title }, ...sourcing, defaultMarginPercent: settings.defaultMarginPercent, can: { edit: canWorkOn(user, query) } });
});

/** { choices: { [requestedItemId]: offerLineId | null } } — which factory line each item is quoted from. */
export const POST = handle(async (request: Request, { params }: Ctx) => {
  const user = await apiUser("sourcing.manage");
  const id = await idParam(params);
  const { choices } = parse(choicesSchema, await formBody(request));
  if (!Object.keys(choices).every(isUuid)) throw new ApiError(422, "Unknown item");
  await chooseOffers(user, id, choices);
  return json({ ok: true });
});
