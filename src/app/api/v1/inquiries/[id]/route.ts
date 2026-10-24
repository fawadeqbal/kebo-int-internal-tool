import { apiUser, formBody, handle, idParam, json, parse } from "@/lib/api/http";
import { can } from "@/lib/auth/permissions";
import { ApiError } from "@/lib/api/http";
import { listPackingListsForQuery } from "@/modules/packing/repository";
import { getQueryDetail } from "@/modules/queries/repository";
import { updateQuerySchema } from "@/modules/queries/schema";
import { canWorkOn, deleteQuery, updateQuery } from "@/modules/queries/service";
import { timeInStatus, TRANSITIONS } from "@/modules/queries/workflow";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Everything on the inquiry page: customer, files, notes, history, documents, and what this person may do. */
export const GET = handle(async (_request: Request, { params }: Ctx) => {
  const user = await apiUser();
  const id = await idParam(params);
  const detail = await getQueryDetail(user, id);
  if (!detail) throw new ApiError(404, "Inquiry not found");
  const money = can(user.role, "invoices.manage");
  const workable = canWorkOn(user, detail.query);
  const isManager = can(user.role, "queries.updateAny");
  return json({
    ...detail,
    invoices: money ? detail.invoices : [],
    packingLists: money ? await listPackingListsForQuery(id) : [],
    timeInStatus: timeInStatus(detail.history.map((h) => ({ toStatus: h.toStatus, changedAt: new Date(h.changedAt) }))),
    can: {
      work: workable,
      edit: workable,
      assign: can(user.role, "queries.assign"),
      delete: can(user.role, "queries.delete"),
      quote: can(user.role, "quotations.manage") && detail.query.status !== "not_completed",
      invoice: money,
      transitions: workable ? TRANSITIONS[detail.query.status].filter((t) => !t.reopen || isManager) : [],
    },
  });
});

/** Edit the inquiry (same fields as the web edit form). */
export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const user = await apiUser();
  const id = await idParam(params);
  await updateQuery(user, id, parse(updateQuerySchema, await formBody(request)));
  return json({ ok: true });
});

export const DELETE = handle(async (_request: Request, { params }: Ctx) => {
  const user = await apiUser();
  await deleteQuery(user, await idParam(params));
  return json({ ok: true });
});
