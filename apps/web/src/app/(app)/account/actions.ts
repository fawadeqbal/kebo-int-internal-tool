"use server";

import QRCode from "qrcode";
import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formValues, type ActionState } from "@/lib/actions";

/** Passwords are never sent back to the browser, not even after an error. */
const forget = (r: ActionState): ActionState => ({ ...r, values: undefined });

export async function changePasswordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  if (v.next && v.confirm !== v.next) return { ok: false, message: "The two new passwords are not the same.", errors: { confirm: ["Type the same new password again"] } };
  return forget(await attempt(form, () => api.post("/me/password", { current: v.current, next: v.next }), "Password changed. Your other devices are signed out."));
}

export type TwoStepSetup = { secret: string; qr: string };

/** Start setup: a new secret, and its otpauth:// link drawn as a QR code (SVG) for the authenticator app. */
export async function startTwoStepAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => api.post<{ secret: string; otpauthUrl: string }>("/me/two-step/setup"));
  if (!r.ok) return r;
  const { secret, otpauthUrl } = r.data as { secret: string; otpauthUrl: string };
  const qr = await QRCode.toString(otpauthUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { ok: true, data: { secret, qr } satisfies TwoStepSetup };
}

export async function confirmTwoStepAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post<{ recoveryCodes: string[] }>("/me/two-step/confirm", { code: v.code }), "Two-step sign-in is on.");
  if (r.ok) revalidatePath("/account");
  return forget(r);
}

export async function newRecoveryCodesAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post<{ recoveryCodes: string[] }>("/me/two-step/recovery-codes", { code: v.code }), "New recovery codes made. The old ones no longer work.");
  if (r.ok) revalidatePath("/account");
  return forget(r);
}

export async function turnOffTwoStepAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post("/me/two-step/off", { code: v.code }), "Two-step sign-in is off.");
  if (r.ok) revalidatePath("/account");
  return forget(r);
}

/** Sign out one of my own devices. */
export async function endMySessionAction(id: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => api.delete(`/me/sessions/${id}`), "Signed out.");
  if (r.ok) revalidatePath("/account");
  return r;
}

export async function signOutOthersAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => api.post<{ ended: number }>("/me/sessions/sign-out-others"));
  if (!r.ok) return r;
  revalidatePath("/account");
  const n = (r.data as { ended: number }).ended;
  return { ok: true, message: n ? `Signed out ${n} other device${n === 1 ? "" : "s"}.` : "No other devices were signed in." };
}
