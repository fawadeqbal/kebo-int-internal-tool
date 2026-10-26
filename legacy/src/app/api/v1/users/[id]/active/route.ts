import { z } from "zod";
import { apiUser, formBody, handle, idParam, json, parse } from "@/lib/api/http";
import { setUserActive } from "@/modules/users/service";

export const runtime = "nodejs";

/** { isActive: true|false } — deactivating signs them out everywhere. */
export const POST = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await apiUser("users.manage");
  const { isActive } = parse(z.object({ isActive: z.enum(["true", "false"]) }), await formBody(request));
  await setUserActive(actor, await idParam(params), isActive === "true");
  return json({ ok: true });
});
