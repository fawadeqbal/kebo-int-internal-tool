"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, destroySession } from "@/lib/auth/session";
import { checkRateLimit, clientIp, resetRateLimit } from "@/lib/auth/rate-limit";
import { formToObject, type ActionState } from "@/lib/utils/result";
import { z } from "zod";
import { loginSchema } from "./schema";
import { authenticate } from "./service";

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const raw = formToObject(formData);
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, errors: z.flattenError(parsed.error).fieldErrors, values: { email: raw.email } };

  const ip = clientIp(await headers());
  const key = `${ip}:${parsed.data.email}`;
  const tooMany = (min: number) => ({ ok: false, message: `Too many attempts. Try again in ${min} minute${min === 1 ? "" : "s"}.`, values: { email: parsed.data.email } });
  // Per IP across all emails (password spraying), then per IP + email.
  const perIp = checkRateLimit(`login-ip:${ip}`, 30);
  if (!perIp.allowed) return tooMany(perIp.retryInMin);
  const limit = checkRateLimit(key);
  if (!limit.allowed) return tooMany(limit.retryInMin);

  const result = await authenticate(parsed.data.email, parsed.data.password, ip);
  if (!result.ok) return result.lockedMinutes ? tooMany(result.lockedMinutes) : { ok: false, message: "Email or password is not correct.", values: { email: parsed.data.email } };

  resetRateLimit(key);
  await createSession(result.user.id);
  redirect(safeNext(raw.next));
}

/** Only same-site paths: "/x" yes; "//evil.com", "/\\evil.com" and full URLs no. */
function safeNext(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/dashboard";
  try {
    const url = new URL(next, "http://app.local");
    return url.origin === "http://app.local" ? `${url.pathname}${url.search}${url.hash}` : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
