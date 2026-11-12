import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { can, CHANNEL_LABEL, PRIORITY_LABEL } from "@kebo/shared";
import { Avatar, buttonClass, Card, CardBody, CardHeader } from "@kebo/ui";
import { DetailsCard } from "@/components/common/record";
import { requireUser } from "@/lib/session";
import { date } from "@/lib/format";
import { dealHistoryOf, dealOf } from "@/lib/deal-data";
import { optional } from "@/components/print/data";
import { PanelButton } from "@/components/orders/step-view";
import { assignAction, holdAction, moveStageAction, noteAction } from "../actions";
import { AssignForm, DecisionButtons, NoteForm } from "./panels";
import { guidance } from "./steps";
import { getPeople } from "@/lib/loaders";

export const metadata = { title: "Inquiry" };

/**
 * The inquiry's Overview (board: Inquiry — Overview): what to do next, the request (customer, contact,
 * how it came, category, priority, needed by, what they need) and, beside it, the actions (who handles
 * it, hold, lost) and the activity (notes and the latest changes).
 */
export default async function DealOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const d = await dealOf(id);
  const [people, history] = await Promise.all([getPeople(), optional(() => dealHistoryOf(id))]);
  const contact = d.customer.contacts.find((c) => c.id === d.contactId) ?? d.customer.contacts[0];
  const base = `/inquiries/${d.id}`;
  const g = guidance(d);
  const name = (uid: string | null) => (uid ? (d.people[uid] ?? "Someone") : "System");

  return (
    <div className="flex flex-col gap-4">
      {(g.lead || g.text) && (
        <section aria-label="What next" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#f6d3bd] bg-action-soft px-5 py-4 dark:border-action/30">
          <p className="min-w-0">
            {g.lead && <strong className="block font-bold text-[#8a3a07] dark:text-action">{g.lead}</strong>}
            <span className="block text-sm text-text-2">{g.text}</span>
          </p>
          {g.href && (
            <Link href={g.href} className={buttonClass("primary", "md", "max-sm:w-full")}>
              {g.label} <ArrowRight aria-hidden />
            </Link>
          )}
        </section>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* The request (board): who, how it came, what they need. */}
        <DetailsCard
          title="The request"
          items={[
            {
              label: "Customer",
              value: (
                <Link href={`/customers/${d.customer.id}`} className="text-primary hover:underline">
                  {d.customer.name}
                </Link>
              ),
            },
            { label: "Contact", value: contact ? [contact.name, contact.whatsapp ?? contact.phone ?? contact.email].filter(Boolean).join(" · ") : null },
            { label: "Came by", value: `${CHANNEL_LABEL[d.channel]} · ${date(d.createdAt)}` },
            { label: "Category", value: d.category },
            { label: "Priority", value: PRIORITY_LABEL[d.priority] },
            { label: "Needed by", value: d.requiredBy ? date(d.requiredBy) : null },
            { label: "What they need", value: d.requirements && <span className="whitespace-pre-line">{d.requirements}</span>, wide: true },
          ]}
          editHref={d.allowed.edit ? `${base}/edit` : undefined}
        />

        <aside aria-label="Beside the inquiry" className="flex min-w-0 flex-col gap-4">
          {/* Actions (board): who handles it, hold, lost. */}
          <Card>
            <CardHeader title="Actions" />
            <CardBody className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span>
                  <span className="block text-xs text-muted">Handles it</span>
                  <strong className="font-semibold">{d.assignee?.name ?? "Nobody yet"}</strong>
                </span>
                {d.allowed.assign && (can(me, "inquiries.assign") || !d.assignee) && (
                  <PanelButton
                    variant="secondary"
                    size="sm"
                    label={can(me, "inquiries.assign") ? "Change" : "Take it"}
                    title="Who handles this inquiry"
                    description="They get its notifications and the work on its steps."
                    body={<AssignForm action={assignAction.bind(null, d.id)} people={people} current={d.assignee?.id ?? null} canAssignOthers={can(me, "inquiries.assign")} meId={me.id} />}
                  />
                )}
              </div>
              {d.canWork && (
                <DecisionButtons
                  stage={d.stage}
                  onHold={d.onHold}
                  canHold={d.allowed.hold}
                  canReopen={d.allowed.reopen}
                  stageAction={moveStageAction.bind(null, d.id)}
                  holdAction={holdAction.bind(null, d.id)}
                />
              )}
            </CardBody>
          </Card>

          {/* Activity (board): the latest changes and notes. */}
          <Card>
            <CardHeader
              title="Activity"
              actions={
                <Link href={`${base}/history`} className="text-[13px] font-semibold text-primary hover:underline">
                  History
                </Link>
              }
            />
            <CardBody className="flex flex-col gap-3">
              <NoteForm action={noteAction.bind(null, d.id)} />
              <ol className="flex flex-col gap-3">
                {d.notes.slice(0, 3).map((n) => (
                  <li key={n.id} className="flex gap-2.5">
                    <Avatar name={name(n.authorId)} size={30} />
                    <span className="min-w-0 text-[13px]">
                      <span className="line-clamp-2 whitespace-pre-line">{n.body}</span>
                      <span className="block text-xs text-muted">
                        {name(n.authorId)} · {date(n.createdAt)}
                      </span>
                    </span>
                  </li>
                ))}
                {(history ?? []).slice(0, 4).map((e) => (
                  <li key={e.id} className="flex gap-2.5">
                    <Avatar name={e.by?.name ?? "System"} size={30} />
                    <span className="min-w-0 text-[13px]">
                      <span className="line-clamp-2">{e.summary ?? e.action}</span>
                      <span className="block text-xs text-muted">
                        {e.by?.name ?? "System"} · {date(e.at)}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}

