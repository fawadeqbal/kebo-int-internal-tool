"use server";

import { revalidatePath } from "next/cache";
import { startOfDayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { attempt, formValues, type ActionState } from "@/lib/actions";
import type { RecordKey } from "@/lib/types-notes";
import { TZ } from "@/lib/format";

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

const RECORD_KEYS = ["inquiryId", "orderId", "customerId", "factoryId"] as const;

/** The About select's "orderId:…" → { orderId: "…" } (anything else: on nothing). */
function chosenRecord(about: string | undefined): Partial<Record<RecordKey["key"], string>> {
  const [key, id] = (about ?? "").split(":");
  return id && (RECORD_KEYS as readonly string[]).includes(key!) ? { [key!]: id } : {};
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
        ...(on ? { [on.key]: on.id } : chosenRecord(v.about)),
      }),
    "Follow-up added.",
  );
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/** A follow-up's fields changed (What, Who does it, Due, At, Place) from the list's pencil. */
export async function editFollowUpAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () => api.patch(`/follow-ups/${id}`, { title: v.title, dueOn: v.dueOn, dueAt: v.dueAt || null, place: v.place || null, assigneeId: v.assigneeId || undefined }),
    "Follow-up saved.",
  );
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function followUpDoneAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  // The last open follow-up of an open inquiry is finished together with the next one (its day is asked for).
  const next = v.nextDueOn ? { dueOn: v.nextDueOn, dueAt: v.nextDueAt || null, title: v.nextTitle?.trim() || undefined } : undefined;
  const r = await attempt(form, () => api.post(`/follow-ups/${id}/done`, { note: v.note || null, ...(next ? { next } : {}) }), next ? "Done. The next follow-up is set." : "Done.");
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
