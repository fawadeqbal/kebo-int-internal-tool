import { apiUser, formBody, handle, idParam, json, parse } from "@/lib/api/http";
import { statusChangeSchema } from "@/modules/queries/schema";
import { changeStatus } from "@/modules/queries/service";

export const runtime = "nodejs";

/** { status, reason? } — reason required for "not_completed". */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await apiUser();
  const id = await idParam(params);
  const data = parse(statusChangeSchema, await formBody(request));
  await changeStatus(user, id, data.status, data.reason);
  return json({ ok: true, message: "Status updated." });
});
