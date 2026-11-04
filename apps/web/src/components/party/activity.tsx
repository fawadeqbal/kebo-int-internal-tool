import Link from "next/link";
import { Check, Plus } from "lucide-react";
import { StatusBadge } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PanelBody } from "@/components/common/panel";
import { PanelButton } from "@/components/orders/step-view";
import { FollowUpForm, NoteAddForm } from "@/components/notes/note-forms";
import { dueText } from "@/components/notes/kinds";
import { addFollowUpAction, addNoteAction, followUpDoneAction } from "@/app/(app)/follow-ups/actions";
import type { FollowUp, Note, RecordKey } from "@/lib/types-notes";
import type { HistoryEntry } from "@/lib/types";
import { ActivityLine, ChipRow, EmptyLine, OverviewFrame, PartyCard, type ActivityItem, type ActivityKind } from "./parts";
import { when } from "./format";

/** Notes, follow-ups done and changes as timeline items (payments, quotations and orders are added by each page). */
export function baseActivity(notes: Note[], followUps: FollowUp[], history: HistoryEntry[]): ActivityItem[] {
  return [
    ...notes.map((n): ActivityItem => ({ key: `n-${n.id}`, at: n.at, kind: "note", who: n.author.name, text: n.contact ? `${n.body} (with ${n.contact.name})` : n.body })),
    ...followUps
      .filter((f) => f.done)
      .map((f): ActivityItem => ({ key: `f-${f.id}`, at: f.doneAt ?? f.updatedAt, kind: "follow_up", who: f.doneBy?.name ?? f.assignee.name, text: f.doneNote ? `${f.title}: ${f.doneNote}` : f.title })),
    ...history.map((h): ActivityItem => ({ key: `h-${h.id}`, at: h.at, kind: "change", who: h.by?.name ?? null, text: changeText(h) })),
  ];
}

const changeText = (h: HistoryEntry) => {
  const c = h.changes.filter((x) => x.from !== x.to).slice(0, 2);
  const parts = c.map((x) => `${x.field}: ${x.from ?? "—"} → ${x.to ?? "—"}`);
  return [h.summary, ...parts].filter(Boolean).join(" · ") + (h.reason ? ` (${h.reason})` : "");
};

/** Newest first. */
export const sortActivity = (items: ActivityItem[]) => [...items].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

const FILTERS: { key: string; label: string; kinds: ActivityKind[] }[] = [
  { key: "notes", label: "Notes", kinds: ["note"] },
  { key: "follow-ups", label: "Follow-ups", kinds: ["follow_up"] },
  { key: "payments", label: "Payments", kinds: ["payment"] },
  { key: "quotations", label: "Quotations", kinds: ["quotation", "supplier_quote", "inquiry", "order"] },
  { key: "changes", label: "Changes", kinds: ["change"] },
];

/** "Mark done" on a follow-up that is due. */
export function MarkDone({ f }: { f: FollowUp }) {
  return (
    <ActionForm action={followUpDoneAction.bind(null, f.id)} showSuccess={false}>
      <SubmitButton size="sm" variant="ghost" pendingText="Saving…" aria-label={`Mark done: ${f.title}`}>
        <Check aria-hidden /> Mark done
      </SubmitButton>
    </ActionForm>
  );
}

/** The follow-up's state on its due day: Overdue · Due today · Planned. */
export function FollowUpBadge({ f, today }: { f: FollowUp; today: string }) {
  if (f.dueOn < today) return <StatusBadge meaning="bad">Overdue</StatusBadge>;
  if (f.dueOn === today) return <StatusBadge meaning="warn">Due today</StatusBadge>;
  return <StatusBadge meaning="neutral">Planned</StatusBadge>;
}

export function AddNoteButton({ on, contacts, label }: { on: RecordKey; contacts?: { id: string; name: string }[]; label: string }) {
  return (
    <PanelButton
      size="sm"
      variant="secondary"
      icon={<Plus aria-hidden />}
      label="Add note"
      title={`Add note · ${label}`}
      body={
        <PanelBody>
          <NoteAddForm action={addNoteAction.bind(null, on)} contacts={contacts} />
        </PanelBody>
      }
    />
  );
}

export function AddFollowUpButton({ on, label, people, meId, today }: { on: RecordKey; label: string; people: { id: string; name: string }[]; meId: string; today: string }) {
  return (
    <PanelButton
      size="sm"
      variant="secondary"
      icon={<Plus aria-hidden />}
      label="Add follow-up"
      title="Add follow-up"
      body={<FollowUpForm action={addFollowUpAction.bind(null, on)} people={people} meId={meId} today={today} record={label} />}
    />
  );
}

/**
 * The Activity tab: one timeline of notes, follow-ups, payments, quotations and changes, filtered by kind, with
 * Add note and Add follow-up; the planned follow-ups on the right.
 */
export function ActivityTab({
  base,
  filter,
  items,
  followUps,
  today,
  canNote,
  on,
  label,
  contacts,
  people,
  meId,
}: {
  base: string;
  filter?: string;
  items: ActivityItem[];
  followUps: FollowUp[];
  today: string;
  canNote: boolean;
  on: RecordKey;
  label: string;
  contacts?: { id: string; name: string }[];
  people: { id: string; name: string }[];
  meId: string;
}) {
  const f = FILTERS.find((x) => x.key === filter);
  const shown = f ? items.filter((i) => f.kinds.includes(i.kind)) : items;
  const planned = followUps.filter((x) => !x.done).sort((a, b) => (a.dueOn < b.dueOn ? -1 : 1));
  const href = (k?: string) => `${base}?tab=activity${k ? `&kind=${k}` : ""}`;
  return (
    <>
      <ChipRow
        chips={[
          { href: href(), label: "All", count: items.length, active: !f },
          ...FILTERS.map((x) => ({ href: href(x.key), label: x.label, count: items.filter((i) => x.kinds.includes(i.kind)).length, active: f?.key === x.key })).filter((c) => c.count > 0 || c.active),
        ]}
        end={
          <>
            {canNote && <AddNoteButton on={on} contacts={contacts} label={label} />}
            <AddFollowUpButton on={on} label={label} people={people} meId={meId} today={today} />
          </>
        }
      />
      <OverviewFrame
        main={
          <PartyCard title="Timeline">
            {shown.length ? (
              <ul className="divide-y divide-line">
                {shown.slice(0, 100).map((a) => (
                  <ActivityLine key={a.key} a={a} when={when(a.at, today)} />
                ))}
              </ul>
            ) : (
              <EmptyLine>{f ? "Nothing matches these filters." : "No activity yet."}</EmptyLine>
            )}
          </PartyCard>
        }
        side={
          <PartyCard title="Follow-ups" count={`${planned.length} planned`}>
            {planned.length ? (
              <ul className="divide-y divide-line">
                {planned.map((x) => (
                  <li key={x.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium [overflow-wrap:anywhere]">{x.title}</span>
                      <span className="block text-xs text-text-2">
                        {dueText(x.dueOn, x.dueAt, today).replace(/^./, (c) => c.toUpperCase())} · {x.assignee.name}
                      </span>
                    </span>
                    <FollowUpBadge f={x} today={today} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyLine>No follow-ups yet.</EmptyLine>
            )}
          </PartyCard>
        }
      />
    </>
  );
}

/** Overview's Latest activity: three lines, then All → to the Activity tab. */
export function LatestActivity({ items, base, today }: { items: ActivityItem[]; base: string; today: string }) {
  return (
    <PartyCard
      title="Latest activity"
      action={
        items.length > 0 && (
          <Link href={`${base}?tab=activity`} className="text-[13px] font-medium text-primary hover:underline">
            All →
          </Link>
        )
      }
    >
      {items.length ? (
        <ul className="divide-y divide-line">
          {items.slice(0, 3).map((a) => (
            <ActivityLine key={a.key} a={a} when={when(a.at, today)} />
          ))}
        </ul>
      ) : (
        <EmptyLine>No activity yet.</EmptyLine>
      )}
    </PartyCard>
  );
}

