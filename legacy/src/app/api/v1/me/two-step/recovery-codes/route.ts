import { z } from "zod";
import { apiUser, formBody, handle, json, parse } from "@/lib/api/http";
import { regenerateRecoveryCodes } from "@/modules/users/two-step";

export const runtime = "nodejs";

/** { code } → 10 new recovery codes (the old ones stop working). */
export const POST = handle(async (request: Request) => {
  const user = await apiUser();
  const { code } = parse(z.object({ code: z.string().trim().min(6).max(10) }), await formBody(request));
  return json({ recoveryCodes: await regenerateRecoveryCodes(user, code) });
});
