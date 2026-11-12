import { requirePermission } from "@/lib/session";
import { factoryOf, partyNotesOf } from "@/lib/party-data";
import { NotesTab } from "@/components/notes/notes-tab";
import { addNoteAction } from "../../../follow-ups/actions";

export const metadata = { title: "Supplier notes" };

/** The supplier's Notes tab (as the customer's, board "Customer — Notes tab"): notes and calls, and Add a note. */
export default async function FactoryNotes({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("sourcing.manage");
  const [f, notes] = await Promise.all([factoryOf(id), partyNotesOf("factories", id)]);
  return <NotesTab notes={notes} add={addNoteAction.bind(null, { key: "factoryId", id: f.id })} />;
}
