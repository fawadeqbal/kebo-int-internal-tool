import "server-only";
import { cache } from "react";
import { api } from "@/lib/api";
import { dataOf, part } from "@/lib/part";
import type { EditRecordType, EditsView } from "@/lib/types-edits";

/**
 * Every card's edits of a record ("Edited n×" on each box). Empty when the person may not see them, and when they
 * could not be read (logged): the boxes show without their counts, and their history opens on its own.
 */
export const editsOf = cache(
  async (type: EditRecordType, id: string): Promise<EditsView> =>
    dataOf(await part("the edits", () => api.get<EditsView>("/edits", { type, id }))) ?? { cards: {} },
);
