import { apiUser, formBody, handle, json, parse } from "@/lib/api/http";
import { changeOwnPasswordSchema } from "@/modules/users/schema";
import { changeOwnPassword } from "@/modules/users/service";

export const runtime = "nodejs";

/** { currentPassword, password, confirm }. Other devices are signed out; this one stays. */
export const POST = handle(async (request: Request) => {
  const user = await apiUser();
  const data = parse(changeOwnPasswordSchema, await formBody(request));
  await changeOwnPassword(user, data.currentPassword, data.password);
  return json({ ok: true, message: "Your password has been changed." });
});
