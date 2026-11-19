import type { ReactNode } from "react";
import { can, isOpen } from "@kebo/shared";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { date } from "@/lib/format";
import { dealOf } from "@/lib/deal-data";
import { getPeople } from "@/lib/loaders";
import type { FollowUpList } from "@/lib/types-notes";
import { dueText } from "@/components/notes/kinds";
import { PanelButton } from "@/components/orders/step-view";
import { PanelCard, PanelNotes, PanelWho } from "@/components/records/panel-pieces";
import { assignAction, noteAction } from "../actions";
import { AssignForm, AssignSelect, NoteForm } from "./panels";

/**
 * The one panel beside every tab of an inquiry (design "the record page", 17 Nov): the work around it — who
 * handles it and the next follow-up — then its notes. What the client sent (who asked, the details, their
 * files) is on the Overview, and the decisions (hold, lost) are in the header's ⋯. On a phone it folds into
 * one bar that opens it as a sheet.
 */
export async function InquirySide({ id }: { id: string }) {
  const me = await requireUser();
  const d = await dealOf(id);
  const [people, followUps] = await Promise.all([
    getPeople().catch(() => []),
    api.get<FollowUpList>("/follow-ups", { inquiryId: id, open: "true" }).catch(() => null),
  ]);
  // The next follow-up: the earliest one still open. An open inquiry is never meant to be without one.
  const nextUp = [...(followUps?.rows ?? [])].sort((a, b) => `${a.dueOn}${a.dueAt ?? ""}`.localeCompare(`${b.dueOn}${b.dueAt ?? ""}`))[0];
  const base = `/inquiries/${d.id}`;
  const name = (uid: string | null) => (uid ? (d.people[uid] ?? "Someone") : "Website form");
  const mayAssign = d.allowed.assign && can(me, "inquiries.assign");
  const followUp = nextUp ? `${dueText(nextUp.dueOn, nextUp.dueAt)}${nextUp.late ? " · missed" : ""}` : null;
  const summary = [
    d.assignee?.name ?? "Nobody handles it",
    followUp ? `follow-up ${followUp}` : null,
    d.notes.length ? `${d.notes.length} note${d.notes.length === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <PanelCard title="Inquiry" bar={[summary]}>
      <PanelWho
        title="Inquiry"
        responsible={d.assignee?.name ?? null}
        picker={mayAssign ? <AssignSelect action={assignAction.bind(null, d.id)} people={people} current={d.assignee?.id ?? null} /> : undefined}
        take={
          d.allowed.assign && !d.assignee ? (
            <PanelButton
              variant="secondary"
              size="sm"
              label="Take it"
              title="Who handles this inquiry"
              description="They get its notifications and the work on its steps."
              body={<AssignForm action={assignAction.bind(null, d.id)} people={people} current={null} canAssignOthers={false} meId={me.id} />}
            />
          ) : undefined
        }
        followUp={nextUp || (followUps && isOpen(d.stage)) ? { text: followUp ?? "None · set one", late: !nextUp || nextUp.late, href: `${base}/history#follow-ups` } : null}
      />
      <PanelNotes
        notes={d.notes.map((n) => ({ id: n.id, body: n.body, by: name(n.authorId), when: date(n.createdAt) }))}
        allHref={`${base}/history`}
        form={<NoteForm action={noteAction.bind(null, d.id)} />}
      />
    </PanelCard>
  );
}

/**
 * A tab of an inquiry: only its boxes. The inquiry's top and its panel are drawn once by its layout
 * (RecordFrame), so they stay as the tabs change.
 */
export function WithSide({ children }: { id?: string; children: ReactNode }) {
  return <>{children}</>;
}
