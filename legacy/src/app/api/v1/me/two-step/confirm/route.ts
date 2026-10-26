import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { ApiError, formBody, handle, json, parse } from "@/lib/api/http";
import { confirmTwoStep } from "@/modules/users/two-step";

export const runtime = "nodejs";

/** { code } from the authenticator app → turns two-step on; returns the 10 recovery codes (shown once). */
export const POST = handle(async (request: Request) => {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "Please sign in again.");
  const { code } = parse(z.object({ code: z.string().trim().min(6, "Enter the 6-digit code").max(10) }), await formBody(request));
  return json({ recoveryCodes: await confirmTwoStep(user, code) });
});
