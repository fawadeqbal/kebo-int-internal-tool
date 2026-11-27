"use server";

import { unstable_rethrow } from "next/navigation";
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
  /** What changed on each line (or field), by its key. */
  lines?: Record<string, string[]>;
}): Promise<{ ok: boolean; n?: number; message?: string }> {
  try {
    const r = await api.post<{ n: number }>("/edits", input);
    return { ok: true, n: r.n };
  } catch (e) {
    unstable_rethrow(e);
    console.error(
      `[edits] the note of a change on ${input.type} ${input.id} (${input.card}) was not kept: ${e instanceof Error ? e.message : e}`,
    );
    return { ok: false, message: e instanceof Error ? e.message : "The edit was saved but not counted." };
  }
}
