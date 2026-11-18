import type { ReactNode } from "react";
import Link from "next/link";
import { can, isOpen } from "@kebo/shared";
import { cn } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { date } from "@/lib/format";
import { dealOf } from "@/lib/deal-data";
import { getPeople } from "@/lib/loaders";
import type { FollowUpList } from "@/lib/types-notes";
import { dueText } from "@/components/notes/kinds";
import { PanelButton } from "@/components/orders/step-view";
import { RecordBody } from "@/components/records/record-page";
import { SidePanelCard, SideSection } from "@/components/orders/side-panel-parts";
import { SideSheet } from "@/components/common/side-sheet";
import { assignAction, noteAction } from "../actions";
import { AssignForm, AssignSelect, NoteForm } from "./panels";

const quiet = "text-[13px] font-medium text-primary hover:underline";

/** One row of a section: the label on the left, its value on the right. */
function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className="max-w-[60%] shrink-0 text-text-2 [overflow-wrap:anywhere]">{label}</span>
      <span className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">{children}</span>
    </li>
  );
}

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
    <SideSheet title="Inquiry" summary={summary}>
      <SidePanelCard>
        <SideSection
          title="Inquiry"
          footer={
            mayAssign ? (
              <div className="mt-2">
                <AssignSelect action={assignAction.bind(null, d.id)} people={people} current={d.assignee?.id ?? null} />
              </div>
            ) : undefined
          }
        >
          {!mayAssign && (
            <Row label="Responsible person">
              {d.assignee?.name ?? "Nobody yet"}
              {d.allowed.assign && !d.assignee && (
                <span className="ml-2">
                  <PanelButton
                    variant="secondary"
                    size="sm"
                    label="Take it"
                    title="Who handles this inquiry"
                    description="They get its notifications and the work on its steps."
                    body={<AssignForm action={assignAction.bind(null, d.id)} people={people} current={null} canAssignOthers={false} meId={me.id} />}
                  />
                </span>
              )}
            </Row>
          )}
          {(nextUp || (followUps && isOpen(d.stage))) && (
            <Row label="Next follow-up">
              <Link href={`${base}/history#follow-ups`} className={cn("hover:underline", !nextUp || nextUp.late ? "text-bad" : "text-primary")}>
                {followUp ?? "None · set one"}
              </Link>
            </Row>
          )}
        </SideSection>

        <SideSection
          title="Notes"
          count={d.notes.length || undefined}
          action={
            <Link href={`${base}/history`} className={quiet}>
              All history
            </Link>
          }
          footer={
            <div className="mt-2">
              <NoteForm action={noteAction.bind(null, d.id)} />
            </div>
          }
          empty="No notes yet."
        >
          {d.notes.slice(0, 4).map((n) => (
            <li key={n.id} className="flex flex-col py-1.5">
              <span className="line-clamp-3 text-sm whitespace-pre-line">{n.body}</span>
              <span className="text-xs text-text-2">
                {name(n.authorId)} · {date(n.createdAt)}
              </span>
            </li>
          ))}
        </SideSection>
      </SidePanelCard>
    </SideSheet>
  );
}

/** Every tab of an inquiry: its boxes, and the inquiry's panel beside them (a bar first on a phone). */
export function WithSide({ id, top, children }: { id: string; top?: ReactNode; children: ReactNode }) {
  return (
    <RecordBody top={top} panel={{ label: "Beside the inquiry", sheet: <InquirySide id={id} /> }}>
      {children}
    </RecordBody>
  );
}
