"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, destroySession } from "@/lib/auth/session";
import { checkRateLimit, resetRateLimit } from "@/lib/auth/rate-limit";
import { formToObject, type ActionState } from "@/lib/utils/result";
import { z } from "zod";
import { loginSchema } from "./schema";
import { authenticate } from "./service";

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const raw = formToObject(formData);
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, errors: z.flattenError(parsed.error).fieldErrors, values: { email: raw.email } };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${ip}:${parsed.data.email}`;
  const limit = checkRateLimit(key);
  if (!limit.allowed)
    return { ok: false, message: `Too many attempts. Try again in ${limit.retryInMin} minutes.`, values: { email: parsed.data.email } };

  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user) return { ok: false, message: "Email or password is not correct.", values: { email: parsed.data.email } };

  resetRateLimit(key);
  await createSession(user.id);
  const next = typeof raw.next === "string" && raw.next.startsWith("/") && !raw.next.startsWith("//") ? raw.next : "/dashboard";
  redirect(next);
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
