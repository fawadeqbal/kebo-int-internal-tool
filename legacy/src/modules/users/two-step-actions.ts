"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, getSessionUser, requireUser } from "@/lib/auth/session";
import { checkRateLimit, clientIp } from "@/lib/auth/rate-limit";
import { safeNext } from "@/lib/auth/next-path";
import { sessionCookieOptions, TWO_STEP_COOKIE, verifyTwoStepToken } from "@/lib/auth/token";
import { toActionError } from "@/lib/utils/action";
import type { ActionState } from "@/lib/utils/result";
import { adminResetTwoStep, confirmTwoStep, pendingTwoStepSecret, regenerateRecoveryCodes, turnOffTwoStep, verifySecondStep } from "./two-step";

const codeOf = (formData: FormData) => String(formData.get("code") ?? "").trim().slice(0, 20);

/** Sign-in, second step: the code from the app (or a recovery code). */
export async function verifySecondStepAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const store = await cookies();
  const userId = await verifyTwoStepToken(store.get(TWO_STEP_COOKIE)?.value);
  if (!userId) redirect("/login?ended=1");
  const code = codeOf(formData);
  if (!code) return { ok: false, errors: { code: ["Enter the 6-digit code from your app."] } };

  const ip = clientIp(await headers());
  if (!checkRateLimit(`2fa:${userId}:${ip}`, 6).allowed) return { ok: false, message: "Too many attempts. Try again in a few minutes." };

  const result = await verifySecondStep(userId, code, ip);
  if (!result.ok)
    return {
      ok: false,
      message: result.lockedMinutes ? `Too many attempts. Try again in ${result.lockedMinutes} minutes.` : "That code is not right. Enter the newest code from your app.",
    };

  store.set(TWO_STEP_COOKIE, "", sessionCookieOptions(0));
  await createSession(userId);
  const next = safeNext(formData.get("next"));
  if (result.usedRecovery)
    redirect(`/account?toast=${encodeURIComponent(`Signed in with a recovery code. ${result.recoveryLeft} left — make new ones if you're running low.`)}`);
  redirect(next);
}

/** Setup: show a fresh secret (if the first QR code didn't work). */
export async function restartTwoStepSetupAction() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await pendingTwoStepSecret(user.id, true);
  redirect("/two-step/setup");
}

/** Setup: the first code from the app turns it on. Returns the recovery codes to show once. */
export async function confirmTwoStepAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  try {
    const codes = await confirmTwoStep(user, codeOf(formData));
    return { ok: true, meta: { codes } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function regenerateRecoveryCodesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    const codes = await regenerateRecoveryCodes(user, codeOf(formData));
    revalidatePath("/account");
    return { ok: true, meta: { codes } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function turnOffTwoStepAction(mode: "off" | "new_phone", _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    await turnOffTwoStep(user, codeOf(formData), mode);
  } catch (error) {
    return toActionError(error);
  }
  if (mode === "new_phone") redirect("/two-step/setup");
  revalidatePath("/account");
  redirect("/account?toast=Two-step+sign-in+turned+off");
}

export async function adminResetTwoStepAction(userId: string) {
  const actor = await requireUser();
  try {
    await adminResetTwoStep(actor, userId);
  } catch (error) {
    redirect(`/users/${userId}?toast=${encodeURIComponent(toActionError(error).message ?? "Could not reset")}`);
  }
  revalidatePath(`/users/${userId}`);
  redirect(`/users/${userId}?toast=Two-step+sign-in+reset;+they+set+it+up+at+next+sign-in`);
}
