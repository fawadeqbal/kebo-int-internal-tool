import { NOTE_KIND_LABEL, type NoteKind } from "@kebo/shared";
import { Avatar, Badge, Card, CardHeader, EmptyState } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { date, TZ } from "@/lib/format";
import type { ActionState } from "@/lib/actions";
import type { Note } from "@/lib/types-notes";
import { NoteCardForm } from "./note-forms";

const KIND_TONE: Record<NoteKind, "neutral" | "info" | "primary" | "ok" | "outline"> = {
  note: "neutral",
  call: "info",
  visit: "primary",
  whatsapp: "ok",
  email: "outline",
};

/**
 * A customer's or supplier's Notes tab (board "Customer — Notes tab"): "Notes and calls", the latest first —
 * who, the kind, the day and with whom, what was said — beside the "Add a note" card.
 */
export function NotesTab({
  notes,
  add,
  contacts,
}: {
  notes: Note[];
  /** Adding (null: may only read). */
  add: ((prev: ActionState, form: FormData) => Promise<ActionState>) | null;
  /** The record's people, for "With" (suppliers have none to choose). */
  contacts?: { id: string; name: string }[];
}) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader title="Notes and calls" />
        {notes.length === 0 ? (
          <EmptyState title="No notes yet" description="Calls, visits and messages show here, the latest first." />
        ) : (
          <ol className="px-5 pb-4" aria-label="Notes and calls">
            {notes.map((n) => (
              <li key={n.id} className="flex gap-3 border-t border-surface-2 py-3.5">
                <Avatar name={n.author.name} size={34} />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    <strong>{n.author.name}</strong>
                    <Badge tone={KIND_TONE[n.kind]}>{NOTE_KIND_LABEL[n.kind]}</Badge>
                    <span className="text-xs text-muted">
                      {date(n.at)}
                      {n.contact && ` · with ${n.contact.name}`}
                    </span>
                  </span>
                  <span className="mt-1 block whitespace-pre-line [overflow-wrap:anywhere]">{n.body}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
      {add && (
        <Card>
          <CardHeader title="Add a note" />
          <div className="p-5">
            <NoteCardForm action={add} contacts={contacts} today={todayIn(TZ)} />
          </div>
        </Card>
      )}
    </div>
  );
}
