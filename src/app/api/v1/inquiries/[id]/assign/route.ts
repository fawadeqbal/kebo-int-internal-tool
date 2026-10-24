import { apiUser, formBody, handle, idParam, json, parse } from "@/lib/api/http";
import { assignSchema } from "@/modules/queries/schema";
import { assignQuery } from "@/modules/queries/service";

export const runtime = "nodejs";

/** { assignedTo: <user id> | "" } */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await apiUser();
  const id = await idParam(params);
  const data = parse(assignSchema, await formBody(request));
  await assignQuery(user, id, data.assignedTo ?? null);
  return json({ ok: true, message: "Assignment saved." });
});
