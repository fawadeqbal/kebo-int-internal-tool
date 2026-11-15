"use server";

import { revalidatePath } from "next/cache";
import { api } from "./api";
import { attempt, type ActionState, type UndoWhat } from "./actions";

/**
 * The note's Undo (design "knowing what happened"): takes back what an action said it can (ActionState.undo).
 * Only safe things, each checked again by the API (whoever did it, just now): "Mark as lost" goes back to the
 * stage it had. Money and papers have no Undo: they keep their history and change with a reason.
 */
export async function undoAction(what: UndoWhat): Promise<ActionState> {
  switch (what.type) {
    case "inquiry-lost": {
      const r = await attempt(null, () => api.post<{ refNo?: string }>(`/inquiries/${encodeURIComponent(what.id)}/undo-lost`, {}));
      if (r.ok) revalidatePath(`/inquiries/${what.id}`, "layout");
      return r;
    }
  }
}
