import { can } from "@kebo/shared";
import { requireUser } from "@/lib/session";
import { customerOf, partyNotesOf } from "@/lib/party-data";
import { NotesTab } from "@/components/notes/notes-tab";
import { addNoteAction } from "../../../follow-ups/actions";

export const metadata = { title: "Customer notes" };

/** The customer's Notes tab (board): notes and calls, and Add a note. */
export default async function CustomerNotes({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const [c, notes] = await Promise.all([customerOf(id), partyNotesOf("customers", id)]);
  return (
    <NotesTab
      notes={notes}
      add={can(me, "customers.manage") ? addNoteAction.bind(null, { key: "customerId", id: c.id }) : null}
      contacts={c.contacts.map((p) => ({ id: p.id, name: p.name }))}
    />
  );
}
