import Link from "next/link";
import { can, INQUIRY_STAGE_LABEL, LOST_REASON_LABEL } from "@kebo/shared";
import { Card, CardBody, CardHeader, DetailList } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { dateTime, qty } from "@/lib/format";
import type { DealDetail, Person } from "@/lib/types";
import { assignAction, holdAction, moveStageAction } from "../actions";
import { AssignPanel, HoldPanel, StagePanel } from "./panels";
import { CustomerHistoryNote } from "@/components/money/customer-account";

export const metadata = { title: "Deal" };

export default async function DealOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const [d, people] = await Promise.all([api.get<DealDetail>(`/inquiries/${id}`), api.get<Person[]>("/users/people")]);
  const name = (uid: string | null) => (uid ? (d.people[uid] ?? "Someone") : "System");
  const contact = d.customer.contacts.find((c) => c.id === d.contactId) ?? d.customer.contacts[0];

  const timeline = [
    ...d.stageChanges.map((s) => ({
      at: s.changedAt,
      text: `${s.fromStage ? `${INQUIRY_STAGE_LABEL[s.fromStage]} → ` : ""}${INQUIRY_STAGE_LABEL[s.toStage]}${s.cause !== "manual" && s.cause !== "created" ? ` (${s.cause.replace(/_/g, " ")})` : ""}${s.lostReason ? ` — ${LOST_REASON_LABEL[s.lostReason]}` : ""}`,
      who: name(s.changedById),
      note: s.note,
    })),
    ...d.assignments.map((a) => ({
      at: a.assignedAt,
      text: a.assigneeId ? `Assigned to ${name(a.assigneeId)}` : "Unassigned",
      who: name(a.assignedById),
      note: null,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const managers = can(me, "expenses.manage");

  return (
    <>
      {managers && <CustomerHistoryNote customerId={d.customer.id} dealId={d.id} />}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader
              title="What the customer needs"
              description={(() => {
                const tops = d.items.filter((i) => !i.parentId).length;
                const parts = d.items.length - tops;
                return `${tops} item${tops === 1 ? "" : "s"}${parts ? `, ${parts} part${parts === 1 ? "" : "s"}` : ""}`;
              })()}
            />
            <CardBody className="flex flex-col gap-4">
              <ul className="divide-y divide-line rounded-lg border border-line">
                {d.items.map((it) => (
                  <li key={it.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                    <div className="flex min-w-0 gap-2.5">
                      <span className="w-7 shrink-0 text-sm text-muted tabular">{it.no}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium whitespace-pre-line">{it.description}</p>
                        {it.model && <p className="text-xs text-muted">{it.model}</p>}
                      </div>
                    </div>
                    <span className="shrink-0 text-sm tabular">
                      {qty(it.quantity)} {it.unit}
                    </span>
                  </li>
                ))}
              </ul>
              {d.requirements && <p className="rounded-lg bg-surface-2 p-3 text-sm whitespace-pre-line">{d.requirements}</p>}
            </CardBody>
          </Card>



        </div>

        <aside className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Customer" />
            <CardBody>
              <DetailList
                columns={1}
                items={[
                  {
                    label: "Company",
                    value: (
                      <Link href={`/customers/${d.customer.id}`} className="hover:underline">
                        {d.customer.name}
                      </Link>
                    ),
                  },
                  { label: "Contact", value: contact?.name, hidden: !contact },
                  {
                    label: "Email",
                    value: contact?.email && (
                      <a href={`mailto:${contact.email}`} className="hover:underline">
                        {contact.email}
                      </a>
                    ),
                    hidden: !contact?.email,
                  },
                  {
                    label: "WhatsApp",
                    value: (contact?.whatsapp ?? contact?.phone) && (
                      <a href={`https://wa.me/${(contact?.whatsapp ?? contact?.phone ?? "").replace(/\D/g, "")}`} className="hover:underline">
                        {contact?.whatsapp ?? contact?.phone}
                      </a>
                    ),
                    hidden: !(contact?.whatsapp ?? contact?.phone),
                  },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Handled by" description={d.assignee ? d.assignee.name : "Nobody yet"} />
            <CardBody>
              {d.allowed.assign ? (
                <AssignPanel
                  action={assignAction.bind(null, d.id)}
                  people={people}
                  current={d.assignee?.id ?? null}
                  canAssignOthers={can(me, "inquiries.assign")}
                  meId={me.id}
                />
              ) : (
                <p className="text-sm text-muted">Only a manager can reassign.</p>
              )}
            </CardBody>
          </Card>
          {d.canWork && (
            <Card>
              <CardHeader title="Decisions" description="Stages move by themselves as the work is done." />
              <CardBody className="flex flex-col gap-4">
                <StagePanel stage={d.stage} action={moveStageAction.bind(null, d.id)} canReopen={d.allowed.reopen} />
                {d.allowed.hold && <HoldPanel onHold={d.onHold} action={holdAction.bind(null, d.id)} />}
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Progress" description="Stages and who handled it. Every change is in History." />
            <CardBody>
              <ol className="flex flex-col gap-2.5">
                {timeline.map((t, i) => (
                  <li key={i} className="text-sm">
                    <p>{t.text}</p>
                    {t.note && <p className="text-xs text-text-2">{t.note}</p>}
                    <p className="text-xs text-muted">
                      {t.who} · {dateTime(t.at)}
                    </p>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}
