import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { can, CHANNEL_LABEL, INQUIRY_STAGE_LABEL, LOST_REASON_LABEL, PRIORITY_LABEL } from "@kebo/shared";

const STAGE_WORD = INQUIRY_STAGE_LABEL;
import { Avatar, Badge, buttonClass, Card, CardBody, CardHeader, RefCode } from "@kebo/ui";
import { DetailsCard } from "@/components/common/record";
import { requireUser } from "@/lib/session";
import { date, dateTime, money } from "@/lib/format";
import { dealHistoryOf, dealOf, quotationOf } from "@/lib/deal-data";
import { optional } from "@/components/print/data";
import { PanelButton } from "@/components/orders/step-view";
import { assignAction, holdAction, moveStageAction, noteAction } from "../actions";
import { AssignForm, AssignSelect, DecisionButtons, NoteForm } from "./panels";
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

  const next = (g.lead || g.text) && d.stage !== "lost" && !d.onHold && (
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
  );
  // Board "Inquiry — on hold and lost states": what holds it, or why it was lost, with the way back.
  const lastHold = d.onHold ? (history ?? []).find((e) => /hold/i.test(e.summary ?? e.action)) : null;
  const state = d.onHold ? (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#ddd0f3] bg-[#f1ecfa] px-5 py-4 dark:border-violet-400/30 dark:bg-violet-500/10">
      <div>
        <strong className="text-[#5b3a9e] dark:text-violet-300">On hold{lastHold ? ` since ${date(lastHold.at)}` : ""}.</strong>
        <span className="block text-sm text-text-2">Reminders are paused. The stage stays “{STAGE_WORD[d.stage]}”.</span>
      </div>
      {d.canWork && d.allowed.hold && (
        <DecisionButtons stage={d.stage} onHold canHold canReopen={false} only="hold" stageAction={moveStageAction.bind(null, d.id)} holdAction={holdAction.bind(null, d.id)} />
      )}
    </section>
  ) : d.stage === "lost" ? (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#f3c7c2] bg-bad-soft px-5 py-4">
      <div>
        <strong className="text-[#8f1d1d] dark:text-bad">
          Lost{d.closedAt ? ` on ${date(d.closedAt)}` : ""}
          {d.lostReason ? ` · ${LOST_REASON_LABEL[d.lostReason]}` : ""}.
        </strong>
        <span className="block text-sm text-text-2">{d.allowed.reopen ? "A manager can reopen it and quote again." : "Ask a manager to reopen it if they come back."}</span>
      </div>
      {d.canWork && d.allowed.reopen && (
        <DecisionButtons stage={d.stage} onHold={false} canHold={false} canReopen stageAction={moveStageAction.bind(null, d.id)} holdAction={holdAction.bind(null, d.id)} />
      )}
    </section>
  ) : null;

  // Won (board InquiryWon): when and how fast, the deal (sale, planned cost and profit), what was made from it, and the activity.
  const order = d.stage === "won" ? d.orders.find((o) => o.status !== "cancelled") : undefined;
  if (order) {
    const q = await optional(() => quotationOf(id));
    const rev = q?.revisions.find((r) => r.status === "accepted");
    const opt = rev?.options.find((o) => o.status === "accepted") ?? rev?.options[0];
    const others = rev?.options.filter((o) => o.id !== opt?.id) ?? [];
    const wonOn = rev?.answeredOn ?? order.orderedOn;
    const days = Math.max(0, Math.round((Date.parse(wonOn) - Date.parse(d.createdAt.slice(0, 10))) / 86_400_000));
    const costing = can(me, "sourcing.manage") ? opt?.costing : null;
    const c = rev?.currency ?? order.currency;
    const row = (label: string, value: React.ReactNode) => (
      <div className="flex justify-between gap-3">
        <span className="text-text-2">{label}</span>
        <strong className="text-right tabular">{value}</strong>
      </div>
    );
    return (
      <div className="flex flex-col gap-4">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary-line bg-primary-soft/60 px-5 py-4">
          <p className="min-w-0">
            <strong className="block font-bold text-primary">
              Won on {date(wonOn)} · {days === 0 ? "the day of the first message" : `${days} day${days === 1 ? "" : "s"} from first message`}.
            </strong>
            <span className="block text-sm text-text-2">
              {rev ? `R${rev.number}${opt && rev.options.length > 1 ? ` Option ${opt.letter}` : ""} accepted. ` : ""}The work continues on the order.
            </span>
          </p>
          <Link href={`/orders/${order.id}`} className={buttonClass("primary", "md", "max-sm:w-full")}>
            <ArrowRight aria-hidden /> Open {order.refNo}
          </Link>
        </section>
        <div className="grid items-start gap-4 md:grid-cols-2">
          <Card>
            <CardHeader title="The deal" />
            <CardBody className="flex flex-col gap-2 text-sm">
              {opt && row("Accepted", `Option ${opt.letter}${opt.factory ? ` · ${opt.factory.name.split(" ")[0]}` : ""}`)}
              {row("Sale", money(opt?.total ?? order.total, c))}
              {costing && row("Planned cost", money(costing.cost, c))}
              {costing && row("Planned profit", `${money(costing.profit, c)}${costing.marginPercent != null ? ` · ${costing.marginPercent.toFixed(1)}%` : ""}`)}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Made from it" />
            <CardBody className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <span className="block text-xs text-muted">Sales order</span>
                <Link href={`/orders/${order.id}`} className="hover:opacity-80">
                  <RefCode>{order.refNo}</RefCode>
                </Link>
              </div>
              {opt?.factory && (
                <div>
                  <span className="block text-xs text-muted">Purchase order</span>
                  <Link href={`/orders/${order.id}`} className="text-text hover:underline">
                    {opt.factory.name}
                  </Link>
                </div>
              )}
              <div>
                <span className="block text-xs text-muted">Customer ref.</span>
                {order.customerRef ?? "—"}
              </div>
              {others.map((o) => (
                <div key={o.id}>
                  <span className="block text-xs text-muted">Option {o.letter}</span>
                  <Badge>Not chosen</Badge>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
        <Card>
          <CardHeader
            title="Activity"
            actions={
              <Link href={`${base}/history`} className="text-[13px] font-semibold text-primary hover:underline">
                History
              </Link>
            }
          />
          <CardBody>
            <ol className="flex flex-col gap-3">
              {(history ?? []).slice(0, 6).map((e) => (
                <li key={e.id} className="flex gap-2.5">
                  <Avatar name={e.by?.name ?? "System"} size={30} />
                  <span className="min-w-0 text-[13px]">
                    <span className="line-clamp-2">{e.summary ?? e.action}</span>
                    <span className="block text-xs text-muted">{dateTime(e.at)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          {state}
          {next}
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
        </div>

        <aside aria-label="Beside the inquiry" className="flex min-w-0 flex-col gap-4">
          {/* Actions (board): who handles it, hold, lost. */}
          <Card>
            <CardHeader title="Actions" />
            <CardBody className="flex flex-col gap-3 text-sm">
              {d.allowed.assign && can(me, "inquiries.assign") ? (
                <AssignSelect action={assignAction.bind(null, d.id)} people={people} current={d.assignee?.id ?? null} />
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <span>
                    <span className="block text-xs text-muted">Handles it</span>
                    <strong className="font-semibold">{d.assignee?.name ?? "Nobody yet"}</strong>
                  </span>
                  {d.allowed.assign && !d.assignee && (
                    <PanelButton
                      variant="secondary"
                      size="sm"
                      label="Take it"
                      title="Who handles this inquiry"
                      description="They get its notifications and the work on its steps."
                      body={<AssignForm action={assignAction.bind(null, d.id)} people={people} current={null} canAssignOthers={false} meId={me.id} />}
                    />
                  )}
                </div>
              )}
              {d.canWork && (
                <DecisionButtons
                  refNo={d.refNo}
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

