import { headers } from "next/headers";
import { z } from "zod";
import { createSession } from "@/lib/auth/session";
import { checkRateLimit, clientIp } from "@/lib/auth/rate-limit";
import { verifyTwoStepToken } from "@/lib/auth/token";
import { ApiError, formBody, handle, json, parse } from "@/lib/api/http";
import { findUserById } from "@/modules/users/repository";
import { verifySecondStep } from "@/modules/users/two-step";

export const runtime = "nodejs";

/** App sign-in, step 2: { challenge, code } → { token, user } (code from the app, or a recovery code). */
export const POST = handle(async (request: Request) => {
  const data = parse(z.object({ challenge: z.string().min(10), code: z.string().trim().min(6, "Enter the 6-digit code from your app.").max(20) }), await formBody(request));
  const userId = await verifyTwoStepToken(data.challenge);
  if (!userId) throw new ApiError(401, "That took too long. Sign in again.");
  const ip = clientIp(await headers());
  if (!checkRateLimit(`2fa:${userId}:${ip}`, 6).allowed) throw new ApiError(429, "Too many attempts. Try again in a few minutes.");
  const result = await verifySecondStep(userId, data.code, ip);
  if (!result.ok) {
    if (result.lockedMinutes) throw new ApiError(429, `Too many attempts. Try again in ${result.lockedMinutes} minutes.`);
    throw new ApiError(401, "That code is not right. Enter the newest code from your app.");
  }
  const token = await createSession(userId, { setCookie: false });
  const u = await findUserById(userId);
  return json({ token, user: u && { id: u.id, name: u.name, email: u.email, role: u.role }, usedRecoveryCode: result.usedRecovery, recoveryCodesLeft: result.recoveryLeft });
});
