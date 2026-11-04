"use server";

import { revalidatePath } from "next/cache";
import { startOfDayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { attempt, formValues, type ActionState } from "@/lib/actions";
import type { RecordKey } from "@/lib/types-notes";

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";

/** "2026-11-04T09:02" typed in the company's time zone → the moment, as the API takes it. Empty: now. */
function happenedAt(local: string | undefined): string | undefined {
  const m = local?.trim().match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!m) return local?.trim() || undefined;
  return new Date(startOfDayIn(m[1]!, TZ).getTime() + (Number(m[2]) * 60 + Number(m[3])) * 60_000).toISOString();
}

/** The record's notes endpoint. */
const NOTES_PATH = { orderId: "orders", customerId: "customers", factoryId: "factories", inquiryId: "inquiries" } as const;

/** A note or call log on an order, customer or factory: { body, kind, contactId, at }. */
export async function addNoteAction(on: RecordKey, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () => api.post(`/${NOTES_PATH[on.key]}/${on.id}/notes`, { body: v.body, kind: v.kind || undefined, contactId: v.contactId || null, at: happenedAt(v.at) }),
    "Note saved.",
  );
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/** Its author, or a manager. */
export async function removeNoteAction(noteId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.delete(`/notes/${noteId}`), "Note removed.");
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/** A new follow-up, on the record the card is on (or the one chosen), for the person chosen. */
export async function addFollowUpAction(on: RecordKey | null, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () =>
      api.post("/follow-ups", {
        title: v.title,
        kind: v.kind || undefined,
        dueOn: v.dueOn,
        dueAt: v.dueAt || null,
        place: v.place || null,
        note: v.note || null,
        assigneeId: v.assigneeId || null,
        ...(on ? { [on.key]: on.id } : {}),
      }),
    "Follow-up added.",
  );
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function followUpDoneAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(form, () => api.post(`/follow-ups/${id}/done`, { note: v.note || null }), "Done.");
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function followUpReopenAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.post(`/follow-ups/${id}/reopen`, {}), "Reopened.");
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function removeFollowUpAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await attempt(form, () => api.delete(`/follow-ups/${id}`), "Follow-up removed.");
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
