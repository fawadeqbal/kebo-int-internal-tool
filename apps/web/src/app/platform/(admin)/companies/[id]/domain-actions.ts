"use server";

import { revalidatePath } from "next/cache";
import { platformApi } from "@/lib/api";
import { attempt, type ActionState } from "@/lib/actions";
import type { PlatformDomainView } from "./domain-types";

const page = (id: string) => `/platform/companies/${id}`;

/** "Check now": looks the company's domain up again and says what was found. */
export async function platformCheckDomainAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => platformApi.post<PlatformDomainView>(`/companies/${id}/domain/check`));
  if (!r.ok) return r;
  revalidatePath(page(id));
  const v = r.data as PlatformDomainView;
  return { ok: true, message: v.status === "connected" ? `${v.domain} is connected.` : "Checked: not connected yet." };
}

/** Connects a domain for the company (the client asked); it is looked up at once. */
export async function platformConnectDomainAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const domain = String(form.get("domain") ?? "").trim();
  const r = await attempt(form, () => platformApi.put<PlatformDomainView>(`/companies/${id}/domain`, { domain }));
  if (r.ok) revalidatePath(page(id));
  return r.ok ? { ...r, message: "Domain added." } : r;
}

/** Removes the domain: the company's people are back at its address under ours. */
export async function platformRemoveDomainAction(id: string): Promise<ActionState> {
  const r = await attempt(null, () => platformApi.delete<PlatformDomainView>(`/companies/${id}/domain`));
  if (r.ok) revalidatePath(page(id));
  return r.ok ? { ok: true, message: "Domain removed." } : r;
}
