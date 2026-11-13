import type { ReactNode } from "react";
import Link from "next/link";
import { can, CHANNEL_LABEL } from "@kebo/shared";
import { cn } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { requireUser } from "@/lib/session";
import { date, TZ } from "@/lib/format";
import { dealOf, sourcingOf } from "@/lib/deal-data";
import { getPeople } from "@/lib/loaders";
import { PanelButton } from "@/components/orders/step-view";
import { SIDE_COLUMNS } from "@/components/orders/step-page";
import { SidePanelCard, SideSection } from "@/components/orders/side-panel-parts";
import { assignAction, holdAction, moveStageAction, noteAction } from "../actions";
import { AssignForm, AssignSelect, DecisionButtons, NoteForm } from "./panels";
import { offerFactsOf } from "./facts";
import { quotationStatus, statusWords } from "./steps";

const quiet = "text-[13px] font-medium text-primary hover:underline";

/** One row of a section: the label on the left, its value on the right. */
function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className="shrink-0 text-text-2">{label}</span>
      <span className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">{children}</span>
    </li>
  );
}

/**
 * The one panel beside every tab of an inquiry, the same sections in the same order: Inquiry (status, who
 * handles it, needed by, how it came; hold and lost), Customer (the contact and the ways to reach them),
 * Documents (the quotation, the sales order), Files and Notes.
 */
export async function InquirySide({ id }: { id: string }) {
  const me = await requireUser();
  const d = await dealOf(id);
  const sourcing = can(me, "sourcing.manage");
  const [people, facts, s] = await Promise.all([getPeople().catch(() => []), sourcing ? offerFactsOf(id) : null, sourcing ? sourcingOf(id).catch(() => null) : null]);
  const base = `/inquiries/${d.id}`;
  const status = statusWords(d, facts, todayIn(TZ));
  const contact = d.customer.contacts.find((c) => c.id === d.contactId) ?? d.customer.contacts.find((c) => c.isPrimary) ?? d.customer.contacts[0];
  const phone = contact?.whatsapp ?? contact?.phone ?? null;
  const order = d.orders.find((o) => o.status !== "cancelled");
  const name = (uid: string | null) => (uid ? (d.people[uid] ?? "Someone") : "Website form");
  const files = [
    ...d.attachments.map((f) => ({ id: f.id, name: f.fileName, from: `${name(f.uploadedById)} · ${date(f.createdAt)}` })),
    ...(s?.quotes ?? []).flatMap((q) => q.files.map((f) => ({ id: f.id, name: f.fileName, from: `${q.factory.name} · factory offer` }))),
  ];
  const mayAssign = d.allowed.assign && can(me, "inquiries.assign");

  return (
    <SidePanelCard>
      <SideSection
        title="Inquiry"
        footer={
          <>
            {mayAssign && (
              <div className="mt-2">
                <AssignSelect action={assignAction.bind(null, d.id)} people={people} current={d.assignee?.id ?? null} />
              </div>
            )}
            {d.canWork && (
              <div className="mt-3">
                <DecisionButtons
                  refNo={d.refNo}
                  stage={d.stage}
                  onHold={d.onHold}
                  canHold={d.allowed.hold}
                  canReopen={d.allowed.reopen}
                  stageAction={moveStageAction.bind(null, d.id)}
                  holdAction={holdAction.bind(null, d.id)}
                />
              </div>
            )}
          </>
        }
      >
        <Row label="Status">
          <span className={cn(status.tone === "ok" && "text-ok", status.tone === "bad" && "text-bad")}>{status.text.split(" · ")[0]}</span>
        </Row>
        {!mayAssign && (
          <Row label="Handles it">
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
        <Row label="Needed by">{d.requiredBy ? date(d.requiredBy) : <span className="font-normal text-muted">Not said</span>}</Row>
        <Row label="Came by">
          {CHANNEL_LABEL[d.channel]} · {date(d.createdAt)}
        </Row>
      </SideSection>

      <SideSection title="Customer">
        <Row label={d.customer.name}>
          <Link href={`/customers/${d.customer.id}`} className={quiet}>
            Open
          </Link>
        </Row>
        {contact ? (
          <Row label={contact.name}>
            <span className="flex flex-wrap justify-end gap-x-3">
              {phone && (
                <a href={`tel:${phone.replace(/[^+\d]/g, "")}`} className={quiet}>
                  Call
                </a>
              )}
              {phone && (
                <a href={`https://wa.me/${phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className={quiet}>
                  WhatsApp
                </a>
              )}
              {contact.email && (
                <a href={`mailto:${contact.email}`} className={quiet}>
                  Email
                </a>
              )}
              {!phone && !contact.email && <span className="font-normal text-muted">No phone or email</span>}
            </span>
          </Row>
        ) : (
          <Row label="Contact">
            <span className="font-normal text-muted">Nobody named</span>
          </Row>
        )}
      </SideSection>

      <SideSection title="Documents">
        <Row label="Quotation">
          {d.quotation ? (
            <>
              <Link href={`${base}/quotation`} className="font-semibold text-primary hover:underline">
                {d.quotation.refNo}
              </Link>
              <span className="font-normal text-text-2"> · {quotationStatus(d)}</span>
            </>
          ) : (
            <span className="font-normal text-muted">Not made yet</span>
          )}
        </Row>
        <Row label="Sales order">
          {order ? (
            <Link href={`/orders/${order.id}`} className="font-semibold text-primary hover:underline">
              {order.refNo}
            </Link>
          ) : (
            <span className="font-normal text-muted">when the customer accepts</span>
          )}
        </Row>
      </SideSection>

      <SideSection
        title="Files"
        count={files.length || undefined}
        action={
          <Link href={`${base}/files`} className={quiet}>
            {d.canWork ? "Add a file" : "All files"}
          </Link>
        }
        empty="No files yet."
      >
        {files.map((f) => (
          <li key={f.id} className="flex flex-col py-1.5">
            <a href={`/files/${f.id}?view=1`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary [overflow-wrap:anywhere] hover:underline">
              {f.name}
            </a>
            <span className="text-xs text-text-2">{f.from}</span>
          </li>
        ))}
      </SideSection>

      <SideSection
        title="Notes"
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
  );
}

/**
 * A tab of the inquiry with the side panel beside it: `top` spans both (the tab's own "Do next"), then
 * the tab's cards on the left and the one panel on the right (under them on a phone).
 */
export function WithSide({ id, top, children }: { id: string; top?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      {top}
      <div className={cn("grid items-start gap-4", SIDE_COLUMNS)}>
        <div className="flex min-w-0 flex-col gap-4">{children}</div>
        <aside aria-label="Beside the inquiry" className="flex min-w-0 flex-col gap-4">
          <InquirySide id={id} />
        </aside>
      </div>
    </div>
  );
}
