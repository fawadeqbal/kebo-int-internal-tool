"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { addressCompany, apiFetch, SESSION_COOKIE } from "@/lib/api";
import type { ActionState } from "@/lib/actions";
import { localPath } from "@/lib/paths";
import { REMEMBERED_COOKIE, REMEMBERED_MAX_AGE, rememberValue } from "@/lib/remembered";

const cookieOptions = (maxAge: number | undefined) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.COOKIE_SECURE === "true",
  path: "/",
  maxAge,
});
/** Only same-site paths after sign-in (no open redirects). */
const safeNext = (v: unknown) => localPath(v, "/dashboard");

export async function loginAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const email = String(form.get("email") ?? "");
  // At a company's own address only its accounts count; otherwise the person may have chosen one.
  const company = (await addressCompany()) ?? (String(form.get("company") ?? "") || undefined);
  const res = await apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: String(form.get("password") ?? ""), company }),
    auth: false,
  });
  const body = await res.json().catch(() => ({}));
  // Their email and password fit more than one company: they choose (and type the password again).
  if (res.status === 409 && body.code === "choose_company")
    return { ok: false, code: "choose_company", message: body.error, values: { email }, data: body.companies };
  if (!res.ok)
    return {
      ok: false,
      message: body.error ?? "Could not sign in.",
      errors: body.fieldErrors,
      values: { email, ...(company ? { company } : {}) },
    };
  // "Keep me signed in" off: the cookie goes when the browser closes (the session itself still ends on time).
  const keep = form.get("keep") !== null || form.get("keepAsked") === null;
  (await cookies()).set(SESSION_COOKIE, body.token, cookieOptions(keep ? body.expiresInSeconds : undefined));
  // Welcome back: this device remembers the account only when the person asked to stay signed in.
  if (keep) (await cookies()).set(REMEMBERED_COOKIE, rememberValue({ email, name: body.user?.name ?? null }), cookieOptions(REMEMBERED_MAX_AGE));
  else (await cookies()).set(REMEMBERED_COOKIE, "", cookieOptions(0));
  redirect(
    body.twoStepRequired
      ? `/login/two-step?next=${encodeURIComponent(safeNext(form.get("next")))}`
      : body.twoStepSetupRequired
        ? "/login/set-up-two-step"
        : safeNext(form.get("next")),
  );
}

export async function twoStepAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const res = await apiFetch("/auth/two-step", { method: "POST", body: JSON.stringify({ code: String(form.get("code") ?? "") }) });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && /password/i.test(body.error ?? "")) redirect("/login");
  if (!res.ok) return { ok: false, message: body.error ?? "That code is not right.", errors: body.fieldErrors };
  redirect(safeNext(form.get("next")));
}

/** "Not you?": this device forgets the remembered account; the sign-in asks for the email again. */
export async function forgetAccountAction() {
  (await cookies()).set(REMEMBERED_COOKIE, "", cookieOptions(0));
  redirect("/login");
}

export async function logoutAction() {
  await apiFetch("/auth/logout", { method: "POST", body: "{}" }).catch(() => undefined);
  (await cookies()).set(SESSION_COOKIE, "", cookieOptions(0));
  redirect("/login");
}
