import { requirePermission } from "@/lib/session";
import { supplierOf, partyNotesOf } from "@/lib/party-data";
import { NotesTab } from "@/components/notes/notes-tab";
import { dataOf, failedWhat } from "@/lib/part";
import { addNoteAction } from "../../../follow-ups/actions";
import { supplierTitle } from "@/lib/titles";

export const generateMetadata = supplierTitle("Notes");

/** The supplier's Notes tab (as the customer's, board "Customer — Notes tab"): notes and calls, and Add a note. */
export default async function SupplierNotes({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("sourcing.manage");
  const [f, notesPart] = await Promise.all([supplierOf(id), partyNotesOf("suppliers", id)]);
  return (
    <NotesTab
      notes={dataOf(notesPart) ?? []}
      failed={failedWhat(notesPart)}
      add={addNoteAction.bind(null, { key: "supplierId", id: f.id })}
    />
  );
}
