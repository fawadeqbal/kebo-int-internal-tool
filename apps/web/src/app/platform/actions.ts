"use server";

import QRCode from "qrcode";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { api, apiFetch, platformApi, PLATFORM_COOKIE, SESSION_COOKIE } from "@/lib/api";
import { attempt, formValues, type ActionState } from "@/lib/actions";
import { FLASH_COOKIE } from "@/lib/platform";

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.COOKIE_SECURE === "true",
  path: "/",
  maxAge,
});
/** Passwords are never sent back to the browser. */
const forget = (r: ActionState): ActionState => ({ ...r, values: undefined });
const num = (v: string | undefined) => (v === undefined || v.trim() === "" ? null : Number(v));
const bool = (v: string | undefined) => v === "on" || v === "true" || v === "1";

/* ---------------------------------------------------------------- signing in */

export async function platformLoginAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const email = String(form.get("email") ?? "");
  const res = await apiFetch("/platform/auth/login", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ email, password: String(form.get("password") ?? "") }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, message: body.error ?? "Could not sign in.", errors: body.fieldErrors, values: { email } };
  (await cookies()).set(PLATFORM_COOKIE, body.token, cookieOptions(body.expiresInSeconds));
  redirect(body.twoStepRequired ? "/platform/two-step" : "/platform/set-up-two-step");
}

export async function platformTwoStepAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const res = await apiFetch("/platform/auth/two-step", {
    method: "POST",
    platform: true,
    body: JSON.stringify({ code: String(form.get("code") ?? "") }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && /password/i.test(body.error ?? "")) redirect("/platform/login");
  if (!res.ok) return { ok: false, message: body.error ?? "That code is not right.", errors: body.fieldErrors };
  redirect("/platform");
}

export async function platformLogoutAction() {
  await apiFetch("/platform/auth/logout", { method: "POST", platform: true, body: "{}" }).catch(() => undefined);
  (await cookies()).set(PLATFORM_COOKIE, "", cookieOptions(0));
  redirect("/platform/login");
}

export async function platformStartTwoStepAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => platformApi.post<{ secret: string; otpauthUrl: string }>("/auth/two-step/start"));
  if (!r.ok) return r;
  const { secret, otpauthUrl } = r.data as { secret: string; otpauthUrl: string };
  return { ok: true, data: { secret, qr: await QRCode.toString(otpauthUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) } };
}

export async function platformConfirmTwoStepAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return forget(
    await attempt(form, () => platformApi.post("/auth/two-step/confirm", { code: formValues(form).code }), "Two-step sign-in is on."),
  );
}

/** Not offered for platform admins (two-step stays on): kept for the shared panel. */
export async function platformNoopAction(): Promise<ActionState> {
  return { ok: false, message: "Two-step sign-in stays on for platform admins." };
}

export async function platformPasswordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  if (v.next !== v.confirm)
    return { ok: false, message: "The two new passwords are not the same.", errors: { confirm: ["Type the same new password again"] } };
  return forget(
    await attempt(
      form,
      () => platformApi.post("/auth/password", { current: v.current, next: v.next }),
      "Password changed. Your other devices are signed out.",
    ),
  );
}

/* ---------------------------------------------------------------- working inside a company */

/** Open a company: its session replaces any company session in this browser, then its Home. */
export async function openCompanyAction(id: string) {
  const r = await platformApi.post<{ token: string; expiresInSeconds: number }>(`/companies/${id}/open`);
  (await cookies()).set(SESSION_COOKIE, r.token, cookieOptions(r.expiresInSeconds));
  redirect("/dashboard");
}

/** Leave the company the platform admin opened: back to the platform. */
export async function leaveCompanyAction() {
  await api.post("/auth/logout").catch(() => undefined);
  (await cookies()).set(SESSION_COOKIE, "", cookieOptions(0));
  redirect("/platform/companies");
}

/* ---------------------------------------------------------------- companies */

export async function createCompanyAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () =>
    platformApi.post<{ id: string; link: string | null; emailed: boolean }>("/companies", {
      name: v.name,
      slug: v.slug,
      kind: v.kind || "client",
      planId: v.planId || null,
      adminName: v.adminName,
      adminEmail: v.adminEmail,
      sampleData: bool(v.sampleData),
      days: num(v.days),
      renewsOn: v.renewsOn || null,
      leadId: v.leadId || null,
      notes: v.notes,
    }),
  );
  if (!r.ok) return r;
  const made = r.data as { id: string; link: string | null; emailed: boolean };
  await flash(made);
  redirect(`/platform/companies/${made.id}`);
}

const after = (id: string) => () => revalidatePath(`/platform/companies/${id}`);

/** The set-password link of a company just made, shown once on its page (a short-lived cookie, not the address bar). */
async function flash(made: { id: string; link: string | null; emailed: boolean }) {
  (await cookies()).set(FLASH_COOKIE, JSON.stringify({ id: made.id, link: made.link, emailed: made.emailed }), {
    ...cookieOptions(300),
    path: "/platform",
  });
}

export async function updateCompanyAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () =>
      platformApi.patch(`/companies/${id}`, {
        name: v.name,
        slug: v.slug,
        planId: v.planId || null,
        renewsOn: v.renewsOn || null,
        contactName: v.contactName,
        contactEmail: v.contactEmail,
        notes: v.notes,
      }),
    "Saved.",
  );
  after(id)();
  return r;
}

export async function companyStatusAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => platformApi.post(`/companies/${id}/status`, { status: v.status, reason: v.reason || null }), "Done.");
  after(id)();
  return r;
}

export async function extendAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => platformApi.post(`/companies/${id}/extend`, { days: num(formValues(form).days) }), "Extended.");
  after(id)();
  return r;
}

export async function endAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => platformApi.post(`/companies/${id}/end`), "Ended.");
  after(id)();
  return r;
}

export async function makeRealAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () =>
      platformApi.post(`/companies/${id}/make-real`, {
        keepData: v.keepData === "keep",
        planId: v.planId || null,
        renewsOn: v.renewsOn || null,
      }),
    "It is a client now.",
  );
  after(id)();
  return r;
}

export async function deleteCompanyAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => platformApi.delete(`/companies/${id}`, { confirm: v.confirm, reason: v.reason || null }));
  if (!r.ok) return r;
  redirect("/platform/companies?toast=Company+deleted");
}

export async function adminPasswordAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () =>
    platformApi.post<{ link: string; emailed: boolean; email: string }>(`/companies/${id}/admin-password`, {
      userId: formValues(form).userId || null,
    }),
  );
  if (!r.ok) return r;
  const d = r.data as { link: string; emailed: boolean; email: string };
  return {
    ok: true,
    message: d.emailed ? `Emailed ${d.email} a link to set a new password.` : `Email is not set up: send ${d.email} this link yourself.`,
    data: d,
  };
}

export async function paymentAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () =>
      platformApi.post(`/companies/${id}/payments`, {
        amount: num(v.amount),
        currency: v.currency,
        paidOn: v.paidOn,
        paidUntil: v.paidUntil,
        note: v.note,
      }),
    "Payment recorded.",
  );
  after(id)();
  return r;
}

export async function removePaymentAction(id: string, paymentId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => platformApi.delete(`/companies/${id}/payments/${paymentId}`), "Payment removed.");
  after(id)();
  return r;
}

/* ---------------------------------------------------------------- plans */

const planBody = (form: FormData) => {
  const v = formValues(form);
  return {
    name: v.name,
    description: v.description,
    price: num(v.price) ?? 0,
    currency: v.currency || "USD",
    period: v.period || "month",
    maxUsers: num(v.maxUsers),
    maxStorageMb: v.maxStorageGb ? Math.round(Number(v.maxStorageGb) * 1024) : null,
    features: form.getAll("features").map(String),
    isActive: v.isActive !== "off",
  };
};

export async function createPlanAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => platformApi.post("/plans", planBody(form)), "Plan made.");
  revalidatePath("/platform/plans");
  return r;
}

export async function updatePlanAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => platformApi.put(`/plans/${id}`, planBody(form)), "Plan saved.");
  revalidatePath("/platform/plans");
  return r;
}

export async function deletePlanAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => platformApi.delete(`/plans/${id}`), "Plan deleted.");
  revalidatePath("/platform/plans");
  return r;
}

/* ---------------------------------------------------------------- leads */

export async function createLeadAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () =>
    platformApi.post<{ id: string }>("/leads", {
      companyName: v.companyName,
      name: v.name,
      email: v.email,
      phone: v.phone,
      country: v.country,
      teamSize: v.teamSize || null,
      message: v.message,
    }),
  );
  if (!r.ok) return r;
  redirect(`/platform/leads/${(r.data as { id: string }).id}`);
}

export async function updateLeadAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () =>
      platformApi.patch(`/leads/${id}`, {
        ...(v.status ? { status: v.status } : {}),
        ...("lostReason" in v ? { lostReason: v.lostReason } : {}),
        ...("followUpOn" in v ? { followUpOn: v.followUpOn || null } : {}),
      }),
    "Saved.",
  );
  revalidatePath(`/platform/leads/${id}`);
  return r;
}

export async function leadNoteAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => platformApi.post(`/leads/${id}/notes`, { text: formValues(form).text }));
  revalidatePath(`/platform/leads/${id}`);
  return r.ok ? { ok: true } : r;
}

export async function giveDemoAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () =>
    platformApi.post<{ id: string; link: string | null; emailed: boolean }>(`/leads/${id}/demo`, {
      days: num(v.days),
      sampleData: v.sampleData !== "off",
      slug: v.slug || null,
      planId: v.planId || null,
    }),
  );
  if (!r.ok) return r;
  const made = r.data as { id: string; link: string | null; emailed: boolean };
  await flash(made);
  redirect(`/platform/companies/${made.id}`);
}

export async function deleteLeadAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => platformApi.delete(`/leads/${id}`));
  if (!r.ok) return r;
  redirect("/platform/leads?toast=Lead+deleted");
}
