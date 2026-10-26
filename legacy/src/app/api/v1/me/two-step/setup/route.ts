import { getSessionUser } from "@/lib/auth/session";
import { otpauthUrl } from "@/lib/auth/totp";
import { ApiError, handle, json } from "@/lib/api/http";
import { pendingTwoStepSecret } from "@/modules/users/two-step";

export const runtime = "nodejs";

async function setup(restart: boolean) {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "Please sign in again.");
  const secret = await pendingTwoStepSecret(user.id, restart);
  return json({ secret, otpauthUrl: otpauthUrl("Kebo RFQ Desk", user.email, secret), required: user.twoStepSetupRequired });
}

/** The key to add to an authenticator app (made once, kept until confirmed). */
export const GET = handle(() => setup(false));
/** A fresh key (if the first one did not work). */
export const POST = handle(() => setup(true));
