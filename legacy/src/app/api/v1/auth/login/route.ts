import { headers } from "next/headers";
import { createSession } from "@/lib/auth/session";
import { checkRateLimit, clientIp, resetRateLimit } from "@/lib/auth/rate-limit";
import { twoStepRequired } from "@/lib/auth/permissions";
import { signTwoStepToken } from "@/lib/auth/token";
import { ApiError, formBody, handle, json, parse } from "@/lib/api/http";
import { loginSchema } from "@/modules/users/schema";
import { authenticate } from "@/modules/users/service";

export const runtime = "nodejs";

/**
 * App sign-in, step 1: email + password (same limits and lock as the web).
 * → { token, user } or, with two-step sign-in on, { twoStep: true, challenge } (valid 5 minutes).
 */
export const POST = handle(async (request: Request) => {
  const data = parse(loginSchema, await formBody(request));
  const ip = clientIp(await headers());
  const perIp = checkRateLimit(`login-ip:${ip}`, 30);
  const key = `${ip}:${data.email}`;
  const limit = perIp.allowed ? checkRateLimit(key) : perIp;
  if (!limit.allowed) throw new ApiError(429, `Too many attempts. Try again in ${limit.retryInMin} minutes.`);

  const result = await authenticate(data.email, data.password, ip);
  if (!result.ok) {
    if (result.lockedMinutes) throw new ApiError(429, `Too many attempts. Try again in ${result.lockedMinutes} minutes.`);
    throw new ApiError(401, "Email or password is not correct.");
  }
  resetRateLimit(key);
  const u = result.user;
  if (u.totpEnabledAt) return json({ twoStep: true, challenge: await signTwoStepToken(u.id) });
  const token = await createSession(u.id, { setCookie: false });
  return json({ token, user: { id: u.id, name: u.name, email: u.email, role: u.role }, twoStepSetupRequired: twoStepRequired(u.role) });
});
