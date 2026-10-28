"use server";

import { redirect } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { ActionState } from "@/lib/actions";
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
