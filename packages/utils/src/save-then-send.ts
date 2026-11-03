/**
 * A record saved by a form, then its file sent by the new record's id (a
 * payment's bank slip, an expense's receipt). Files cannot go with the save
 * itself (server actions cap bodies at 1 MB), so they follow it.
 *
 * The file is sent inside the same call as the save, not by the form after it
 * has re-drawn: saving a payment can tick a checklist item, and the row whose
 * button opened the form then goes away with the form in it, so a send left
 * for later never happened. Here it always does, and its outcome comes back
 * with the save's (`fileError`: what went wrong, or null).
 */
export async function saveThenSend<R extends { ok?: boolean; data?: unknown }>(
  save: () => Promise<R>,
  file: unknown,
  send: (id: string) => Promise<string | null>,
  idOf: (data: unknown) => string | null | undefined = (d) => (d && typeof d === "object" ? (d as { createdId?: string }).createdId : null),
): Promise<R & { fileError?: string | null }> {
  const saved = await save();
  if (!saved.ok || !file) return saved;
  const id = idOf(saved.data);
  if (!id) return { ...saved, fileError: "The record was saved without its id, so the file could not follow it." };
  let error: string | null;
  try {
    error = await send(id);
  } catch {
    error = "The connection dropped. Try again.";
  }
  return { ...saved, fileError: error };
}
