"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiFetch, SESSION_COOKIE } from "@/lib/api";
import type { ActionState } from "@/lib/actions";
import { localPath } from "@/lib/paths";

const cookieOptions = (maxAge: number) => ({ httpOnly: true, sameSite: "lax" as const, secure: process.env.COOKIE_SECURE === "true", path: "/", maxAge });
/** Only same-site paths after sign-in (no open redirects). */
const safeNext = (v: unknown) => localPath(v, "/dashboard");

export async function loginAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const email = String(form.get("email") ?? "");
  const res = await apiFetch("/auth/login", { method: "POST", body: JSON.stringify({ email, password: String(form.get("password") ?? "") }), auth: false });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, message: body.error ?? "Could not sign in.", errors: body.fieldErrors, values: { email } };
  (await cookies()).set(SESSION_COOKIE, body.token, cookieOptions(body.expiresInSeconds));
  redirect(body.twoStepRequired ? `/login/two-step?next=${encodeURIComponent(safeNext(form.get("next")))}` : body.twoStepSetupRequired ? "/login/set-up-two-step" : safeNext(form.get("next")));
}

export async function twoStepAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const res = await apiFetch("/auth/two-step", { method: "POST", body: JSON.stringify({ code: String(form.get("code") ?? "") }) });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && /password/i.test(body.error ?? "")) redirect("/login");
  if (!res.ok) return { ok: false, message: body.error ?? "That code is not right.", errors: body.fieldErrors };
  redirect(safeNext(form.get("next")));
}

export async function logoutAction() {
  await apiFetch("/auth/logout", { method: "POST", body: "{}" }).catch(() => undefined);
  (await cookies()).set(SESSION_COOKIE, "", cookieOptions(0));
  redirect("/login");
}
