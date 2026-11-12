import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { FOLLOW_UP_KIND_LABEL } from "@kebo/shared";
import { Card, CardBody, CardHeader, cn, StatusBadge } from "@kebo/ui";
import { ConfirmAction } from "@/components/people/confirm-action";
import { PanelButton } from "@/components/orders/step-view";
import {
  addFollowUpAction,
  addNoteAction,
  followUpDoneAction,
  followUpReopenAction,
  removeFollowUpAction,
  removeNoteAction,
} from "@/app/(app)/follow-ups/actions";
import type { FollowUp, Note, RecordKey } from "@/lib/types-notes";
import { dueText, KindIcon, todayHere, whenText } from "./kinds";
import { FollowUpForm, FollowUpToggle, NoteAddForm } from "./note-forms";

/**
 * A record's notes and call logs (orders, customers, factories): the add form on top for those who may
 * add, then the latest first, each with its kind's icon, what happened, who it was with, and "by Sana ·
 * 9:02" (when it happened).
 */
export function NotesCard({
  on,
  notes,
  canAdd,
  contacts,
  footer,
}: {
  on: RecordKey;
  notes: Note[];
  canAdd: boolean;
  contacts?: { id: string; name: string }[];
  footer?: React.ReactNode;
}) {
  return (
    <Card id="notes" className="scroll-mt-32" aria-labelledby={`notes-${on.id}`}>
      <div className="flex min-h-14 items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 id={`notes-${on.id}`} className="text-[15px] font-semibold text-text">
            Notes · {notes.length}
          </h2>
          <p className="mt-0.5 text-xs text-muted">Calls, visits and messages, the latest first</p>
        </div>
      </div>
      <CardBody className="flex flex-col gap-4">
        {canAdd && <NoteAddForm action={addNoteAction.bind(null, on)} contacts={contacts} />}
        {notes.length > 0 ? (
          <ul aria-label="Notes" className="flex flex-col divide-y divide-line">
            {notes.map((n) => (
              <li key={n.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                <KindIcon kind={n.kind} of="note" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">{n.body}</p>
                  <p className="mt-0.5 text-xs text-text-2">
                    {n.contact && <>with {n.contact.name} · </>}by {n.author.name} · <time dateTime={n.at}>{whenText(n.at)}</time>
                    {n.editedAt && <span className="text-muted"> · edited</span>}
                  </p>
                </div>
                {n.can.delete && (
                  <ConfirmAction
                    action={removeNoteAction.bind(null, n.id)}
                    confirm="Remove this note? It stays in the history."
                    label=""
                    icon={
                      <>
                        <Trash2 aria-hidden />
                        <span className="sr-only">Remove the note by {n.author.name}</span>
                      </>
                    }
                    size="icon-sm"
                    variant="ghost"
                    pendingText="…"
                    showSuccess={false}
                  />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No notes yet.{canAdd ? " Log a call or a visit above." : ""}</p>
        )}
        {footer}
      </CardBody>
    </Card>
  );
}

/** One follow-up as a row: its kind, what, when (late in the bad tone, with the word), for whom, where; Done / Reopen. */
export function FollowUpRow({
  f,
  showRecord,
  today,
  removable,
}: {
  f: FollowUp;
  showRecord?: boolean;
  today?: string;
  removable?: boolean;
}) {
  const what = `${f.title}, ${dueText(f.dueOn, f.dueAt, today)}`;
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <KindIcon kind={f.kind} of="followUp" />
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium [overflow-wrap:anywhere]", f.done && "text-text-2 line-through decoration-text-2/50")}>
          {f.title}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-text-2">
          {f.late && <StatusBadge meaning="bad">Late</StatusBadge>}
          {f.done && <StatusBadge meaning="ok">Done</StatusBadge>}
          <span className={cn(f.late && "font-medium text-bad")}>
            {f.late ? "was due" : "due"} {dueText(f.dueOn, f.dueAt, today)}
          </span>
          <span>· for {f.assignee.name}</span>
          {f.createdBy.id !== f.assignee.id && <span>· from {f.createdBy.name}</span>}
          {f.place && <span>· {f.place}</span>}
          {showRecord && f.target && (
            <span>
              ·{" "}
              <Link href={f.link} className="font-medium text-primary hover:underline">
                {f.target.label}
              </Link>
            </span>
          )}
          <span className="sr-only">{FOLLOW_UP_KIND_LABEL[f.kind]}</span>
        </p>
        {f.done && f.doneNote && <p className="mt-1 text-xs text-text-2">{f.doneNote}</p>}
      </div>
      {f.can.done && (
        <FollowUpToggle action={(f.done ? followUpReopenAction : followUpDoneAction).bind(null, f.id)} done={f.done} what={what} />
      )}
      {removable && f.can.delete && (
        <ConfirmAction
          action={removeFollowUpAction.bind(null, f.id)}
          confirm={`Remove "${f.title}"? It stays in the history.`}
          label=""
          icon={
            <>
              <Trash2 aria-hidden />
              <span className="sr-only">Remove {what}</span>
            </>
          }
          size="icon-sm"
          variant="ghost"
          pendingText="…"
          showSuccess={false}
        />
      )}
    </li>
  );
}

/**
 * A record's follow-ups (inquiries, orders, customers, factories): the open ones by when they are due, the
 * late ones in the bad tone with the word; the last few done under them; "+ Follow-up" opens the side
 * panel, on this record.
 */
export function FollowUpsCard({
  on,
  label,
  rows,
  people,
  meId,
}: {
  on: RecordKey;
  label: string;
  rows: FollowUp[];
  people: { id: string; name: string }[];
  meId: string;
}) {
  const today = todayHere();
  const open = rows.filter((r) => !r.done);
  const done = rows.filter((r) => r.done).slice(-3);
  const late = open.filter((r) => r.late).length;
  return (
    <Card id="follow-ups" className="scroll-mt-32 overflow-clip">
      <CardHeader
        title={`Follow-ups · ${open.length}`}
        description={
          late ? <span className="font-medium text-bad">{late} late</span> : open.length ? "Planned calls and visits" : "Nothing planned"
        }
        actions={
          <PanelButton
            variant="ghost"
            size="sm"
            icon={<Plus aria-hidden />}
            label="Follow-up"
            title="New follow-up"
            description="Shows on Home with a reminder"
            body={<FollowUpForm action={addFollowUpAction.bind(null, on)} people={people} meId={meId} today={today} record={label} />}
          />
        }
      />
      {open.length + done.length > 0 ? (
        <ul aria-label="Follow-ups" className="divide-y divide-line">
          {open.map((f) => (
            <FollowUpRow key={f.id} f={f} today={today} />
          ))}
          {done.map((f) => (
            <FollowUpRow key={f.id} f={f} today={today} />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-sm text-muted">
          No calls or visits planned. Add one and it shows on Home on its day, with a reminder.
        </p>
      )}
    </Card>
  );
}
