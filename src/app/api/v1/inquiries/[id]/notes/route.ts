import { apiUser, formBody, handle, idParam, json, parse } from "@/lib/api/http";
import { commentSchema } from "@/modules/queries/schema";
import { addComment } from "@/modules/queries/service";

export const runtime = "nodejs";

/** { body } — an internal note on the inquiry. */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await apiUser();
  const id = await idParam(params);
  const data = parse(commentSchema, await formBody(request));
  await addComment(user, id, data.body);
  return json({ ok: true }, 201);
});
