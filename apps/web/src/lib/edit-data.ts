import "server-only";
import { cache } from "react";
import { api } from "@/lib/api";
import type { EditRecordType, EditsView } from "@/lib/types-edits";

/** Every card's edits of a record (empty when the person may not see them). */
export const editsOf = cache(
  async (type: EditRecordType, id: string): Promise<EditsView> =>
    api.get<EditsView>("/edits", { type, id }).catch(() => ({ cards: {} })),
);
