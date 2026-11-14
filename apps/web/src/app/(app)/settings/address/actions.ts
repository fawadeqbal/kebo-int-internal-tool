"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { OwnDomainView } from "@kebo/shared";
import { api, ApiError } from "@/lib/api";
import { attempt, formValues, type ActionState } from "@/lib/actions";
import type { AddressView } from "./types";

/** Whether a short name is free (the live check while typing). */
export async function checkAddressAction(slug: string): Promise<AddressView["check"]> {
  const s = slug.trim().toLowerCase();
  if (!s) return null;
  const r = await api.get<AddressView>("/company/address", { slug: s }).catch(() => null);
  return r?.check ?? null;
}

/** The new address; the session stays at the old one, so it is off to sign in at the new one. */
export async function changeAddressAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const slug = String(form.get("slug") ?? "")
    .trim()
    .toLowerCase();
  let url: string;
  try {
    url = (await api.put<{ slug: string; url: string }>("/company/address", { slug })).url;
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, message: e.message, errors: e.body.fieldErrors, values: { slug } };
    throw e;
  }
  redirect(`${url}/login?moved=1`);
}

/* ---------------------------------------------------------------- the company's own domain */

/** Connects a domain the company owns; it is looked up at once. */
export async function connectDomainAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const domain = String(form.get("domain") ?? "").trim();
  const r = await attempt(form, () => api.put("/company/domain", { domain }));
  if (r.ok) revalidatePath("/settings/address");
  return r;
}

/** "Check now": looks the domain's record up again. */
export async function checkDomainAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.post<OwnDomainView>("/company/domain/check", {}));
  if (!r.ok) return r;
  revalidatePath("/settings/address");
  const v = r.data as OwnDomainView;
  return { ok: true, message: v.status === "connected" ? `${v.domain} is connected.` : "The record is not found yet." };
}

/** Removes the domain: the team is back at the company's address under ours, where they sign in again. */
export async function removeDomainAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let ours: string;
  try {
    ours = (await api.delete<OwnDomainView>("/company/domain")).ours;
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, message: e.message, values: formValues(form) };
    throw e;
  }
  revalidatePath("/settings/address");
  // Opened at the domain that was just removed: on to the address that still works.
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
  if (host && host !== ours) redirect(`https://${ours}/login?moved=1`);
  return { ok: true, message: "Domain removed." };
}
