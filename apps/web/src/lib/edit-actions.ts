"use server";

import { api } from "@/lib/api";
import type { EditRecordType } from "@/lib/types-edits";

/** Counts one Save changes on a card: its first save, or an edit with its reason (POST /edits). */
export async function recordEditAction(input: {
  type: EditRecordType;
  id: string;
  card: string;
  kind: "first" | "edit";
  reason?: string;
  changes: string[];
  keys: string[];
}): Promise<{ ok: boolean; n?: number; message?: string }> {
  try {
    const r = await api.post<{ n: number }>("/edits", input);
    return { ok: true, n: r.n };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The edit was saved but not counted." };
  }
}
