import { z } from "zod";
import { apiUser, formBody, handle, json, parse } from "@/lib/api/http";
import { turnOffTwoStep } from "@/modules/users/two-step";

export const runtime = "nodejs";

/** { code, mode: "off" | "new_phone" }. "new_phone" clears it so setup starts again. "off" only where the role allows. */
export const POST = handle(async (request: Request) => {
  const user = await apiUser();
  const data = parse(z.object({ code: z.string().trim().min(6).max(10), mode: z.enum(["off", "new_phone"]) }), await formBody(request));
  await turnOffTwoStep(user, data.code, data.mode);
  return json({ ok: true, setupRequired: data.mode === "new_phone" });
});
