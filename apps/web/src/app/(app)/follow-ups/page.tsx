import Link from "next/link";
import { crumbsFor } from "@/lib/nav";
import { Pencil, Plus } from "lucide-react";
import { Badge, Card, cn, EmptyState, linkClass, LinkTabs, PageHeader, Pager, PhoneList, PhoneRow, Segmented, Td, Th, THead, toPage, toPageSize } from "@kebo/ui";
import { can, type Tone } from "@kebo/shared";
import { api } from "@/lib/api";
import { allPages } from "@/lib/exports";
import { requireUser } from "@/lib/session";
import { countOf, date } from "@/lib/format";
import { FilterCard } from "@/components/common/filter-card";
import type { DealRow, Person } from "@/lib/types";
import type { OrderRow } from "@/lib/types-orders";
import type { FollowUp, FollowUpList } from "@/lib/types-notes";
import { PanelButton } from "@/components/orders/step-view";
import { FollowUpCheck, FollowUpDoneNext, FollowUpFields, type AboutOption } from "@/components/notes/note-forms";
import { dueText, todayHere } from "@/components/notes/kinds";
import { DataTable } from "@/components/common/data-table";
import { NewFollowUpBody } from "@/components/notes/new-follow-up";
import { addFollowUpAction, editFollowUpAction, followUpDoneAction, followUpReopenAction, removeFollowUpAction } from "./actions";
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
  searchParams: Promise<{
    view?: string;
    status?: string;
    q?: string;
    due?: string;
    who?: string;
    about?: string;
    page?: string;
    size?: string;
  }>;
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
  const [list, people, orders, inquiries, customers, suppliers, other] = await Promise.all([
    api.get<FollowUpList>("/follow-ups", {
      mine: viewAll && !everyone ? "true" : undefined,
      open: status === "done" ? "false" : "true",
      late: status === "late" ? "true" : undefined,
      ...filters,
      page,
      pageSize: toPageSize(sp.size),
    }),
    getPeople().catch(() => [] as Person[]),
    api.get<OrderRow[]>("/orders", { status: "open" }).catch(() => [] as OrderRow[]),
    // Every open inquiry, customer and supplier too (review 24 Nov: 100 inquiries, and no customers or suppliers).
    allPages<DealRow>("/inquiries", { stage: "open" }).catch(() => [] as DealRow[]),
    api.get<{ id: string; name: string }[]>("/customers/names").catch(() => [] as { id: string; name: string }[]),
    allPages<{ id: string; name: string }>("/factories", {}).catch(() => [] as { id: string; name: string }[]),
    // The other of Mine / Everyone, for its tab's count (the same search).
    viewAll
      ? api
          .get<FollowUpList>("/follow-ups", { mine: everyone ? "true" : undefined, open: "true", ...filters, page: 1, pageSize: 1 })
          .catch(() => null)
      : null,
  ]);
  const who = viewAll ? people.find((p) => p.id === sp.who)?.id : undefined;
  const keep = { view: everyone ? "everyone" : undefined, status: status === "open" ? undefined : status, q, due, who, about };
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...keep, ...patch }).filter((e): e is [string, string] => !!e[1]));
    return `/follow-ups${p.size ? `?${p}` : ""}`;
  };
  const aboutOptions: AboutOption[] = [
    ...orders.map((o) => ({ value: `orderId:${o.id}`, label: `${o.refNo} · ${o.customer.name}`, group: "Orders" })),
    ...inquiries.map((d) => ({ value: `inquiryId:${d.id}`, label: `${d.refNo} · ${d.customer.name}`, group: "Inquiries" })),
    ...customers.map((c) => ({ value: `customerId:${c.id}`, label: c.name, group: "Customers" })),
    ...suppliers.map((f) => ({ value: `factoryId:${f.id}`, label: f.name, group: "Suppliers" })),
  ];

  // The tick and the pencil, the same in the table and in the phone's list.
  const doneButton = (f: (typeof list.rows)[number]) =>
    f.can.done &&
    (!f.done && f.needsNext ? (
      <FollowUpDoneNext action={followUpDoneAction.bind(null, f.id)} title={f.title} what={f.title} inquiryHref={f.link} as="check" />
    ) : (
      <FollowUpCheck action={(f.done ? followUpReopenAction : followUpDoneAction).bind(null, f.id)} done={f.done} what={f.title} />
    ));
  const editButton = (f: (typeof list.rows)[number]) =>
    f.can.edit && (
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
              remove={f.can.delete ? removeFollowUpAction.bind(null, f.id) : undefined}
            />
          </div>
        }
      />
    );
  // Whose (Mine · Everyone) is a switch of its own, apart from which (Open · Late · Done) — review 24 Nov, S-15:
  // Late and Done sat as tabs beside Mine and Everyone, their counts changing with them.
  const whose = viewAll ? (
    <Segmented
      label="Whose"
      options={[
        { href: href({ view: undefined, page: undefined }), active: !everyone, label: `Mine · ${(everyone ? other?.counts.open : list.counts.open) ?? 0}` },
        { href: href({ view: "everyone", page: undefined }), active: everyone, label: `Everyone · ${(everyone ? list.counts.open : other?.counts.open) ?? 0}` },
      ]}
    />
  ) : null;
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
            body={
              <NewFollowUpBody
                action={addFollowUpAction.bind(null, null)}
                people={people}
                meId={me.id}
                today={today}
                about={aboutOptions}
              />
            }
          />
        }
        views={whose && <span className="max-md:hidden">{whose}</span>}
      />
      {/* A list's header switch is not on a phone (the header folds away): there it sits over the tabs. */}
      {whose && <div className="md:hidden">{whose}</div>}
      <LinkTabs
        label="Which follow-ups"
        tabs={[
          { href: href({ status: undefined, page: undefined }), label: "Open", count: list.counts.open, active: status === "open" },
          { href: href({ status: "late", page: undefined }), label: "Late", count: list.counts.late, alert: list.counts.late > 0, active: status === "late" },
          { href: href({ status: "done", page: undefined }), label: "Done", count: list.counts.done, active: status === "done" },
        ]}
      />
      <FilterCard
        search="Search follow-ups…"
        value={q}
        keep={{ view: keep.view, status: keep.status }}
        selects={[
          { name: "due", label: "Due", value: due, options: DUE.map((d) => ({ value: d.value, label: d.label })), all: "Any day" },
          ...(viewAll
            ? [{ name: "who", label: "Person", value: who, options: people.map((p) => ({ value: p.id, label: p.name })), all: "Everyone" }]
            : []),
          { name: "about", label: "About", value: about, options: ABOUT.map((a) => ({ value: a.value, label: a.label })) },
        ]}
        count={countOf(list.total, "follow-up")}
      />
      <div className="flex min-w-0 flex-col gap-4">
        <Card className="min-w-0 overflow-clip">
          {list.rows.length === 0 ? (
            <EmptyState
              framed
              // A search that finds nothing says so, not "Nothing planned" (review 24 Nov, S-28).
              title={q || due || who || about ? "Nothing matches" : status === "done" ? "Nothing done yet" : status === "late" ? "Nothing late" : "Nothing planned"}
              description={
                q || due || who || about
                  ? "No follow-up matches this search. Clear it to see them all."
                  : status === "done"
                  ? "Follow-ups ticked done show here, the latest first."
                  : "Add a follow-up here, or on an order, a customer, a supplier or an inquiry. It shows on the dashboard on its day, with a reminder."
              }
            />
          ) : (
            <>
              {/* On a phone, rows like every other list (review 24 Nov, X-10: a desktop table with an empty column). */}
              <PhoneList label="Follow-ups">
                {list.rows.map((f) => {
                  const pill = duePill(f, today);
                  return (
                    <PhoneRow
                      key={f.id}
                      title={<span className={cn(f.done && "line-through")}>{f.title}</span>}
                      line={[f.target?.label, f.place, f.assignee.id === me.id ? "Me" : f.assignee.name].filter(Boolean).join(" · ")}
                      status={
                        <Badge tone={pill.tone} dot>
                          {pill.text}
                        </Badge>
                      }
                      muted={f.done}
                      extra={
                        <span className="flex items-center justify-between gap-2">
                          {doneButton(f)}
                          {f.target && (
                            <Link href={f.link} className={cn(linkClass, "text-sm")}>
                              Open {ON_LABEL[f.target.type].toLowerCase()}
                            </Link>
                          )}
                          {editButton(f)}
                        </span>
                      }
                    />
                  );
                })}
              </PhoneList>
              <DataTable label="Follow-ups" className="max-sm:hidden">
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
                        <Td>{doneButton(f)}</Td>
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
                        <Td className="text-right">{editButton(f)}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </DataTable>
            </>
          )}
        </Card>
        <Pager base="/follow-ups" params={keep} page={page} pageSize={toPageSize(sp.size)} total={list.total} bare />
      </div>
    </>
  );
}
