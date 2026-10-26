"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { attempt, formBody, formValues, type ActionState } from "@/lib/actions";

const refresh = (id: string) => revalidatePath(`/deals/${id}`, "layout");

export async function moveStageAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post(`/inquiries/${id}/stage`, { to: v.to, lostReason: v.lostReason || null, note: v.note || null }), "Stage updated.");
  if (r.ok) refresh(id);
  return r;
}

export async function holdAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post(`/inquiries/${id}/hold`, { onHold: v.onHold === "true", note: v.note || null }), v.onHold === "true" ? "On hold." : "Resumed.");
  if (r.ok) refresh(id);
  return r;
}

export async function assignAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post(`/inquiries/${id}/assign`, { assigneeId: v.assigneeId || null }), "Assignment saved.");
  if (r.ok) refresh(id);
  return r;
}

export async function noteAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post(`/inquiries/${id}/notes`, { body: v.body }));
  if (r.ok) refresh(id);
  return r;
}

export async function uploadAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a file to upload." };
  const body = new FormData();
  body.set("file", file, file.name);
  const r = await attempt(null, () => api.upload(`/inquiries/${id}/files`, body), `Uploaded ${file.name}.`);
  if (r.ok) refresh(id);
  return r;
}

export async function removeFileAction(dealId: string, fileId: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const r = await attempt(null, () => api.delete(`/files/${fileId}`), "File removed.");
  if (r.ok) refresh(dealId);
  return r;
}

/** Create or edit a deal (the form sends JSON in `payload`, with its line items). */
export async function saveDealAction(id: string | null, _prev: ActionState, form: FormData): Promise<ActionState> {
  const body = formBody(form);
  const r = await attempt(form, () => (id ? api.put<{ id: string }>(`/inquiries/${id}`, body) : api.post<{ id: string }>("/inquiries", body)));
  if (!r.ok) return r;
  const newId = id ?? (r.data as { id: string }).id;
  refresh(newId);
  redirect(`/deals/${newId}`);
}
