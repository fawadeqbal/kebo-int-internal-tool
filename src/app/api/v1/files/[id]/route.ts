import { apiUser, handle, idParam, json } from "@/lib/api/http";
import { removeAttachment } from "@/modules/queries/service";

export const runtime = "nodejs";

/**
 * Remove a file (uploader or a manager). Upload: POST /api/queries/{inquiry id}/attachments
 * (multipart, field "files"); download: GET /api/attachments/{file id} — both accept the bearer token.
 */
export const DELETE = handle(async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await apiUser();
  await removeAttachment(user, await idParam(params));
  return json({ ok: true });
});
