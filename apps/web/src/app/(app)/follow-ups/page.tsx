import Link from "next/link";
import { crumbsFor } from "@/lib/nav";
import { Pencil, Plus } from "lucide-react";
import { Badge, Card, cn, EmptyState, LinkTabs, PAGE_SIZE, PageHeader, Pager, Td, Th, THead, toPage } from "@kebo/ui";
import { can, type Tone } from "@kebo/shared";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { countOf, date } from "@/lib/format";
import { FilterCard } from "@/components/common/filter-card";
import type { DealRow, Paged, Person } from "@/lib/types";
import type { OrderRow } from "@/lib/types-orders";
import type { FollowUp, FollowUpList } from "@/lib/types-notes";
import { PanelButton } from "@/components/orders/step-view";
import { FollowUpCheck, FollowUpDoneNext, FollowUpFields, type AboutOption } from "@/components/notes/note-forms";
import { dueText, todayHere } from "@/components/notes/kinds";
import { DataTable } from "@/components/common/data-table";
import { NewFollowUpBody } from "@/components/notes/new-follow-up";
import { addFollowUpAction, editFollowUpAction, followUpDoneAction, followUpReopenAction } from "./actions";
import { getPeople } from "@/lib/loaders";

export const metadata = { title: "Follow-ups" };

const ON_LABEL = { inquiry: "Inquiry", order: "Order", customer: "Customer", factory: "Supplier" } as const;
const ABOUT = [
  { value: "inquiry", label: "Inquiries" },
  { value: "order", label: "Orders" },
  { value: "customer", label: "Customers" },
  { value: "factory", label: "Suppliers" },
  { value: "none", label: "Nothing in particular" },
] as const;
const DUE = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
] as const;

const plusDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The Due filter as days: today; this week (Monday to Sunday); this month. */
function dueRange(due: string | undefined, today: string): { from?: string; to?: string } {
  if (due === "today") return { from: today, to: today };
  if (due === "week") {
    const monday = plusDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
    return { from: monday, to: plusDays(monday, 6) };
  }
  if (due === "month") {
    const first = `${today.slice(0, 8)}01`;
    const next = new Date(`${first}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    return { from: first, to: plusDays(next.toISOString().slice(0, 10), -1) };
  }
  return {};
}

/** The Due column: done (green, with the day), late (red), today or tomorrow (amber), later (grey). */
function duePill(f: FollowUp, today: string): { text: string; tone: Tone } {
  if (f.done) return { text: f.doneAt ? `Done ${date(f.doneAt)}` : "Done", tone: "ok" };
  const words = dueText(f.dueOn, f.dueAt, today);
  const text = words.charAt(0).toUpperCase() + words.slice(1);
  if (f.late) return { text, tone: "bad" };
  return { text, tone: f.dueOn <= plusDays(today, 1) ? "warn" : "neutral" };
}

/**
 * Follow-ups (board "Follow-ups"): chips Mine / Everyone / Late / Done; search with Due, Person and About;
 * the list (tick to mark done, the pencil to change one) beside the "New follow-up" card.
 */
export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; status?: string; q?: string; due?: string; who?: string; about?: string; page?: string }>;
}) {
  const me = await requireUser();
  const sp = await searchParams;
  const today = todayHere();
  const status = sp.status === "done" ? "done" : sp.status === "late" ? "late" : "open";
  const page = toPage(sp.page);
  const viewAll = can(me, "followups.viewAll");
  const everyone = viewAll && sp.view === "everyone";
  const due = DUE.find((d) => d.value === sp.due)?.value;
  const about = ABOUT.find((a) => a.value === sp.about)?.value;
  const q = sp.q?.trim() || undefined;
  const filters = { ...dueRange(due, today), q, who: viewAll ? sp.who || undefined : undefined, about };
  const [list, people, orders, inquiries, other] = await Promise.all([
    api.get<FollowUpList>("/follow-ups", {
      mine: viewAll && !everyone ? "true" : undefined,
      open: status === "done" ? "false" : "true",
      late: status === "late" ? "true" : undefined,
      ...filters,
      page,
      pageSize: PAGE_SIZE,
    }),
    getPeople().catch(() => [] as Person[]),
    api.get<OrderRow[]>("/orders", { status: "open" }).catch(() => [] as OrderRow[]),
    api.get<Paged<DealRow>>("/inquiries", { stage: "open", pageSize: 100 }).catch(() => null),
    // The other of Mine / Everyone, for its tab's count (the same search).
    viewAll ? api.get<FollowUpList>("/follow-ups", { mine: everyone ? "true" : undefined, open: "true", ...filters, page: 1, pageSize: 1 }).catch(() => null) : null,
  ]);
  const who = viewAll ? people.find((p) => p.id === sp.who)?.id : undefined;
  const keep = { view: everyone ? "everyone" : undefined, status: status === "open" ? undefined : status, q, due, who, about };
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...keep, ...patch }).filter((e): e is [string, string] => !!e[1]));
    return `/follow-ups${p.size ? `?${p}` : ""}`;
  };
  const aboutOptions: AboutOption[] = [
    ...orders.map((o) => ({ value: `orderId:${o.id}`, label: `${o.refNo} · ${o.customer.name}`, group: "Orders" })),
    ...(inquiries?.rows ?? []).map((d) => ({ value: `inquiryId:${d.id}`, label: `${d.refNo} · ${d.customer.name}`, group: "Inquiries" })),
  ];

  return (
    <>
      <PageHeader
        kind="list"
        crumbs={crumbsFor("/follow-ups")}
        title="Follow-ups"
        primary={
          <PanelButton
            variant="strong"
            icon={<Plus aria-hidden />}
            label="Add follow-up"
            title="New follow-up"
            description="Shows on the dashboard on its day, with a reminder."
            body={<NewFollowUpBody action={addFollowUpAction.bind(null, null)} people={people} meId={me.id} today={today} about={aboutOptions} />}
          />
        }
      />
      <LinkTabs
        label="Which follow-ups"
        className="mb-4"
        tabs={[
          {
            href: href({ view: undefined, status: undefined, page: undefined }),
            label: "Mine",
            count: everyone ? other?.counts.open : list.counts.open,
            active: status === "open" && !everyone,
          },
          ...(viewAll
            ? [
                {
                  href: href({ view: "everyone", status: undefined, page: undefined }),
                  label: "Everyone",
                  count: everyone ? list.counts.open : other?.counts.open,
                  active: status === "open" && everyone,
                },
              ]
            : []),
          {
            href: href({ status: "late", page: undefined }),
            label: "Late",
            count: list.counts.late,
            alert: list.counts.late > 0,
            active: status === "late",
          },
          {
            href: href({ status: "done", page: undefined }),
            label: "Done",
            count: list.counts.done,
            active: status === "done",
          },
        ]}
      />
      <FilterCard
        search="Search follow-ups…"
        value={q}
        keep={{ view: keep.view, status: keep.status }}
        selects={[
          { name: "due", label: "Due", value: due, options: DUE.map((d) => ({ value: d.value, label: d.label })), all: "Any day" },
          ...(viewAll ? [{ name: "who", label: "Person", value: who, options: people.map((p) => ({ value: p.id, label: p.name })), all: "Everyone" }] : []),
          { name: "about", label: "About", value: about, options: ABOUT.map((a) => ({ value: a.value, label: a.label })) },
        ]}
        count={countOf(list.total, "follow-up")}
      />
      <div className="flex min-w-0 flex-col gap-4">
        <Card className="min-w-0 overflow-clip p-0">
          {list.rows.length === 0 ? (
            <EmptyState
              framed
              title={status === "done" ? "Nothing done yet" : status === "late" ? "Nothing late" : "Nothing planned"}
              description={
                status === "done"
                  ? "Follow-ups ticked done show here, the latest first."
                  : "Add a follow-up here, or on an order, a customer, a supplier or an inquiry. It shows on the dashboard on its day, with a reminder."
              }
            />
          ) : (
            <DataTable label="Follow-ups">
                <THead>
                  <tr>
                    <Th className="w-12">
                      <span className="sr-only">Done</span>
                    </Th>
                    <Th>Follow-up</Th>
                    <Th>On</Th>
                    <Th>Due</Th>
                    <Th>Who</Th>
                    <Th className="w-14">
                      <span className="sr-only">Edit</span>
                    </Th>
                  </tr>
                </THead>
                <tbody>
                  {list.rows.map((f) => {
                    const pill = duePill(f, today);
                    const sub = [f.target?.label, f.place].filter(Boolean).join(" · ");
                    return (
                      <tr key={f.id} className="border-t border-surface-2">
                        <Td>
                          {f.can.done &&
                            (!f.done && f.needsNext ? (
                              <FollowUpDoneNext action={followUpDoneAction.bind(null, f.id)} title={f.title} what={f.title} inquiryHref={f.link} as="check" />
                            ) : (
                              <FollowUpCheck
                                action={(f.done ? followUpReopenAction : followUpDoneAction).bind(null, f.id)}
                                done={f.done}
                                what={f.title}
                              />
                            ))}
                        </Td>
                        <Td>
                          <span className={cn("block font-semibold text-text [overflow-wrap:anywhere]", f.done && "line-through")}>
                            {f.title}
                          </span>
                          {sub &&
                            (f.target ? (
                              <Link href={f.link} className="block text-xs text-text-2 hover:text-primary">
                                {sub}
                              </Link>
                            ) : (
                              <span className="block text-xs text-text-2">{sub}</span>
                            ))}
                        </Td>
                        <Td className="whitespace-nowrap">{f.target ? ON_LABEL[f.target.type] : "—"}</Td>
                        <Td>
                          <Badge tone={pill.tone} dot>
                            {pill.text}
                          </Badge>
                        </Td>
                        <Td className="whitespace-nowrap">{f.assignee.id === me.id ? "Me" : f.assignee.name}</Td>
                        <Td className="text-right">
                          {f.can.edit && (
                            <PanelButton
                              variant="ghost"
                              size="icon-sm"
                              icon={<Pencil aria-hidden />}
                              label={<span className="sr-only">Edit {f.title}</span>}
                              title="Edit follow-up"
                              body={
                                <div className="p-5 sm:px-6">
                                  <FollowUpFields
                                    action={editFollowUpAction.bind(null, f.id)}
                                    people={people}
                                    meId={me.id}
                                    today={today}
                                    initial={{ title: f.title, assigneeId: f.assignee.id, dueOn: f.dueOn, dueAt: f.dueAt, place: f.place }}
                                    submit="Save follow-up"
                                  />
                                </div>
                              }
                            />
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
            </DataTable>
          )}
        </Card>
        <Pager base="/follow-ups" params={keep} page={page} pageSize={PAGE_SIZE} total={list.total} bare />
      </div>
    </>
  );
}
