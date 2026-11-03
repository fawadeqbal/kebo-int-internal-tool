import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { can, CHANNEL_LABEL } from "@kebo/shared";
import { buttonClass, Card, CardBody, CardHeader, cn, DetailList } from "@kebo/ui";
import { api } from "@/lib/api";
import { hasFeature, requireUser } from "@/lib/session";
import { date } from "@/lib/format";
import { dealHistoryOf, dealOf, quotationOf, sourcingOf } from "@/lib/deal-data";
import type { Person } from "@/lib/types";
import type { CustomerDetail } from "@/lib/types-people";
import type { FactoryRequests } from "@/lib/types-flow";
import { optional } from "@/components/print/data";
import { StateBadge, StepChanges } from "@/components/orders/step-page";
import { PanelButton } from "@/components/orders/step-view";
import { CHANGE_STEP_LABEL, changeStep } from "@/components/deals/inquiry-side";
import { assignAction, holdAction, moveStageAction, noteAction } from "../actions";
import { AssignForm, DecisionButtons, NoteForm } from "./panels";
import { guidance, inquirySteps, itemsLine, plural, revisionsOf, type InquiryStep } from "./steps";

export const metadata = { title: "Inquiry" };

/**
 * The inquiry at a glance (board InqV4Overview): what to do next, the three
 * steps as cards (state, one line, two numbers, the next action), notes; on
 * the side the customer, who handles it, the latest changes and the quiet
 * decisions (put on hold, mark as lost).
 */
export default async function DealOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const sourcing = can(me, "sourcing.manage");
  const d = await dealOf(id);
  const [people, history, q, s, cust] = await Promise.all([
    api.get<Person[]>("/users/people"),
    optional(() => dealHistoryOf(id)),
    optional(() => quotationOf(id)),
    sourcing ? optional(() => sourcingOf(id)) : null,
    optional(() => api.get<CustomerDetail>(`/customers/${d.customerId}`)),
  ]);
  const requests = sourcing && (await hasFeature("factory_requests")) ? await optional(() => api.get<FactoryRequests>(`/inquiries/${d.id}/factory-requests`)) : null;
  const name = (uid: string | null) => (uid ? (d.people[uid] ?? "Someone") : "System");
  const contact = d.customer.contacts.find((c) => c.id === d.contactId) ?? d.customer.contacts[0];
  const base = `/inquiries/${d.id}`;
  const g = guidance(d);
  const steps = inquirySteps(d, sourcing ? (s?.quotes.length ?? 0) : null);
  const byKey = Object.fromEntries(steps.map((x) => [x.key, x])) as Partial<Record<InquiryStep["key"], InquiryStep>>;

  // Needs
  const urs = d.attachments.find((f) => f.kind === "urs") ?? null;
  // Factory prices: the cheapest offer that covers the whole list.
  const complete = (s?.quotes ?? []).filter((o) => o.lines.length && o.totalCost !== null && !o.coverage.missing.length);
  const cheapest = complete.sort((a, b) => Number(a.totalCost) - Number(b.totalCost))[0] ?? null;
  // Quotation: the newest revision (a draft if one is open) and the one the customer has.
  const revs = q?.revisions ?? [];
  const current = revs.find((r) => r.status === "draft") ?? revs[0] ?? null;
  const live = revs.find((r) => r.status !== "draft") ?? null;
  const since = [...d.assignments].sort((a, b) => b.assignedAt.localeCompare(a.assignedAt))[0];
  const earlier = (cust?.inquiries ?? []).filter((i) => i.id !== d.id);
  const won = earlier.filter((i) => i.stage === "won").length;
  const lost = earlier.filter((i) => i.stage === "lost").length;
  const recent = (history ?? []).slice(0, 3).map((e) => {
    const st = changeStep(e);
    return { ...e, step: st ? CHANGE_STEP_LABEL[st] : null };
  });
  const latest = revisionsOf(d)[0];

  return (
    <div className="flex flex-col gap-5">
      {(g.lead || g.text) && (
        <section
          aria-label="What next"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary-soft/50 px-4 py-3"
        >
          <p className="flex min-w-0 items-start gap-2 text-sm">
            <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>
              {g.lead && <b className="font-semibold">{g.lead}</b>} {g.text}
            </span>
          </p>
          {g.href && (
            <Link href={g.href} className={buttonClass("primary", "sm", "max-sm:w-full")}>
              {g.label}
            </Link>
          )}
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="grid gap-3 md:grid-cols-3">
            {byKey.needs && (
              <StepCard
                step={byKey.needs}
                href={`${base}/needs`}
                line={[itemsLine(d), urs?.fileName].filter(Boolean).join(" · ")}
                rows={[
                  ["Came by", CHANNEL_LABEL[d.channel]],
                  ["Wanted by", d.requiredBy ? date(d.requiredBy) : "—"],
                ]}
              />
            )}
            {byKey.sourcing && (
              <StepCard
                step={byKey.sourcing}
                href={`${base}/sourcing`}
                line={s?.quotes.length ? `${plural(s.quotes.length, "offer")} in` : "No offers yet"}
                rows={[
                  ["Cheapest, all items", cheapest?.totalCost ? money0(cheapest.totalCost, s!.currency) : "—"],
                  requests ? ["Factories asked", String(requests.counts.asked)] : ["Offers with lines", String(s?.quotes.filter((o) => o.lines.length).length ?? 0)],
                ]}
                next={
                  byKey.sourcing.state === "now"
                    ? s?.quotes.some((o) => o.lines.length)
                      ? { href: `${base}/quotation`, label: "Make the quotation" }
                      : { href: `${base}/sourcing`, label: "Add factory prices" }
                    : undefined
                }
              />
            )}
            {byKey.quotation && (
              <StepCard
                step={byKey.quotation}
                href={`${base}/quotation`}
                line={
                  current
                    ? [
                        `R${current.number} ${current.status === "accepted" ? "accepted" : current.status}`,
                        live && live.id !== current.id && live.sentOn ? `R${live.number} sent ${date(live.sentOn)}` : current.sentOn ? `sent ${date(current.sentOn)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : "Not made yet"
                }
                rows={(current?.options ?? []).slice(0, 2).map((o) => [
                  current!.options.length > 1 ? `Option ${o.letter}` : "Total",
                  `${money0(o.total, current!.currency)}${o.costing?.marginPercent !== null && o.costing?.marginPercent !== undefined ? ` · ${o.costing.marginPercent.toFixed(1)}%` : ""}`,
                ])}
                next={
                  byKey.quotation.state === "now" && latest
                    ? latest.status === "draft"
                      ? { href: `${base}/quotation`, label: `Send R${latest.number} to the customer` }
                      : latest.status === "sent"
                        ? { href: `${base}/quotation#answer`, label: "Record the answer" }
                        : { href: `${base}/quotation`, label: "Open the quotation" }
                    : undefined
                }
              />
            )}
          </div>

          <Card id="notes">
            <CardHeader title="Notes" />
            <CardBody className="flex flex-col gap-3">
              <NoteForm action={noteAction.bind(null, d.id)} />
              {d.notes.length > 0 && (
                <ul className="flex flex-col divide-y divide-line">
                  {d.notes.map((n) => (
                    <li key={n.id} className="py-2 text-xs text-text-2 first:pt-0 last:pb-0">
                      <span className="font-semibold text-text">{name(n.authorId)}</span> · {date(n.createdAt)} —{" "}
                      <span className="whitespace-pre-line">{n.body}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <aside aria-label="Beside the inquiry" className="flex min-w-0 flex-col gap-5">
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
                    label: "WhatsApp",
                    value: (contact?.whatsapp ?? contact?.phone) && (
                      <a href={`https://wa.me/${(contact?.whatsapp ?? contact?.phone ?? "").replace(/\D/g, "")}`} className="hover:underline">
                        {contact?.whatsapp ?? contact?.phone}
                      </a>
                    ),
                    hidden: !(contact?.whatsapp ?? contact?.phone),
                  },
                  {
                    label: "Email",
                    value: contact?.email && (
                      <a href={`mailto:${contact.email}`} className="hover:underline">
                        {contact.email}
                      </a>
                    ),
                    hidden: !contact?.email,
                  },
                  { label: "Earlier deals", value: earlier.length ? `${won} won · ${lost} lost` : "None", hidden: !cust },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Handled by"
              actions={
                d.allowed.assign && (can(me, "inquiries.assign") || !d.assignee) ? (
                  <PanelButton
                    variant="ghost"
                    size="xs"
                    label={can(me, "inquiries.assign") ? "Change" : "Take it"}
                    title="Who handles this inquiry"
                    description="They get its notifications and the work on its steps."
                    body={
                      <AssignForm
                        action={assignAction.bind(null, d.id)}
                        people={people}
                        current={d.assignee?.id ?? null}
                        canAssignOthers={can(me, "inquiries.assign")}
                        meId={me.id}
                      />
                    }
                  />
                ) : undefined
              }
            />
            <CardBody>
              <DetailList
                columns={1}
                items={[
                  { label: "Person", value: d.assignee?.name ?? <span className="text-muted">Nobody yet</span> },
                  { label: "Since", value: since && d.assignee ? date(since.assignedAt) : null, hidden: !since || !d.assignee },
                ]}
              />
            </CardBody>
          </Card>
          {history && <StepChanges entries={recent} historyHref={`${base}/history`} showStep />}
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
        </aside>
      </div>
    </div>
  );
}

/** "USD 51,741": whole units for the overview's numbers. */
function money0(v: string | number, currency: string) {
  return `${currency} ${Math.round(Number(v)).toLocaleString("en-US")}`;
}

/** One step as a card: number, name, state, one line, two key numbers and, when it is the step now, what to do. */
function StepCard({
  step,
  href,
  line,
  rows,
  next,
}: {
  step: InquiryStep;
  href: string;
  line: string;
  rows: string[][];
  next?: { href: string; label: string };
}) {
  const now = step.state === "now";
  return (
    <Card className={cn("relative flex flex-col gap-2 p-4", now && "border-primary ring-1 ring-primary")}>
      <h2 className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs text-muted tabular">{step.number}</span>
        <Link href={href} className="font-semibold after:absolute after:inset-0 hover:text-primary">
          {step.label}
        </Link>
        <StateBadge state={step.state} label={step.stateLabel} />
      </h2>
      <p className="text-xs text-text-2">{line}</p>
      {rows.length > 0 && (
        <dl className="flex flex-col gap-1.5 pt-1">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="text-sm font-medium tabular">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {next && (
        <Link
          href={next.href}
          className="relative z-10 mt-auto flex items-center gap-1.5 rounded-lg bg-primary-soft/60 px-3 py-2 text-xs font-medium text-primary hover:bg-primary-soft"
        >
          <ArrowRight className="size-3.5" aria-hidden /> {next.label}
        </Link>
      )}
    </Card>
  );
}
