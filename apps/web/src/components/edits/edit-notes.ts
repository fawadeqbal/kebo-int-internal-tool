import { toast } from "@kebo/ui/client";
import { recordEditAction } from "@/lib/edit-actions";

type EditNote = Parameters<typeof recordEditAction>[0];

/**
 * The notes of what changed, kept after a save (each card's history, "Edited n×"). The save itself stands when a
 * note is not kept, so it is not an error, but it is said once (engineering standards: no failure is swallowed),
 * as a "partly done" note in place of the form's own "Saved".
 */
export function editNotes() {
  const missed: string[] = [];
  return {
    async keep(note: EditNote): Promise<void> {
      const r = await recordEditAction(note).catch((e: unknown) => ({
        ok: false,
        message: e instanceof Error ? e.message : "The connection dropped.",
      }));
      if (!r.ok) missed.push(r.message ?? "");
    },
    /** After the notes: says, once, that some were not kept. */
    tell(): void {
      if (!missed.length) return;
      const why = missed.find(Boolean);
      toast({
        kind: "part",
        message: "Saved, but the note of what changed was not kept",
        detail: `${why ? `${why} ` : ""}The history may not show this change.`,
      });
    },
  };
}
