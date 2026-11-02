"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { attempt, formBody, formValues, reasonOf, type ActionState } from "@/lib/actions";

/**
 * An order's checklist (see the API's /orders/:id/steps). One action for every
 * change, bound to the order on the page and to the change and item in the row:
 * add, tick, untick, skip, delete, edit (own items) and auto (an automatic
 * item's due date, person, note or skip). Forms send plain fields, or a JSON
 * `payload` for the values an item collected.
 */
export type ChecklistOp = "add" | "tick" | "untick" | "skip" | "delete" | "edit" | "auto";

const DONE: Record<ChecklistOp, string> = {
  add: "Added.",
  tick: "Ticked.",
  untick: "Open again.",
  skip: "Skipped.",
  delete: "Removed.",
  edit: "Saved.",
  auto: "Saved.",
};

export async function checklistAction(
  orderId: string,
  op: ChecklistOp,
  target: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const body = formBody(form);
  const call = () => {
    switch (op) {
      case "add":
        return api.post(`/orders/${orderId}/checklist`, body);
      case "tick":
        return api.post(`/checklist/${target}/tick`, body);
      case "untick":
        return api.post(`/checklist/${target}/untick`);
      case "skip":
        return api.post(`/checklist/${target}/skip`, { reason: body.reason ?? "" });
      case "delete":
        return api.delete(`/checklist/${target}`);
      case "edit":
        return api.patch(`/checklist/${target}`, body);
      case "auto":
        return api.put(`/orders/${orderId}/checklist/auto/${target}`, body);
    }
  };
  const r = await attempt(form, call, DONE[op]);
  if (r.ok) {
    revalidatePath(`/orders/${orderId}`, "layout");
    revalidatePath("/orders");
  }
  return { ...r, data: undefined };
}

/** The ready date the factory gave (only that field of the order's details). */
export async function readyDateAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const v = formValues(form);
  const r = await attempt(
    form,
    () => api.patch(`/orders/${orderId}/details`, { readyOn: v.readyOn || null, reason: reasonOf(form) }),
    "Ready date saved.",
  );
  if (r.ok) revalidatePath(`/orders/${orderId}`, "layout");
  return r;
}
