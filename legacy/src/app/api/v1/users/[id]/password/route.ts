import { apiUser, formBody, handle, idParam, json, parse } from "@/lib/api/http";
import { resetPasswordSchema } from "@/modules/users/schema";
import { resetPassword } from "@/modules/users/service";

export const runtime = "nodejs";

/** { password } — a new temporary password; they are signed out everywhere. */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await apiUser("users.manage");
  const data = parse(resetPasswordSchema, await formBody(request));
  await resetPassword(actor, await idParam(params), data.password);
  return json({ ok: true, message: "Password updated. Share it with the user securely." });
});
