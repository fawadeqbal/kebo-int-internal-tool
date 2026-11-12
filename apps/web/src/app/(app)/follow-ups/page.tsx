import Link from "next/link";
import { Check, Clock, Filter, Pencil, Plus, TriangleAlert, User, Users } from "lucide-react";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  cn,
  EmptyState,
  LinkTabs,
  PageHeader,
  Pager,
  SearchField,
  Select,
  Td,
  Th,
  THead,
  toPage,
} from "@kebo/ui";
import { can, type Tone } from "@kebo/shared";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { date } from "@/lib/format";
import type { DealRow, Paged, Person } from "@/lib/types";
import type { OrderRow } from "@/lib/types-orders";
import type { FollowUp, FollowUpList } from "@/lib/types-notes";
import { PanelButton } from "@/components/orders/step-view";
import { FollowUpCheck, FollowUpFields, type AboutOption } from "@/components/notes/note-forms";
import { dueText, todayHere } from "@/components/notes/kinds";
import { DataTable } from "@/components/common/data-table";
import { addFollowUpAction, editFollowUpAction, followUpDoneAction, followUpReopenAction } from "./actions";
import { getPeople } from "@/lib/loaders";

export const metadata = { title: "Follow-ups" };

const PAGE_SIZE = 50;

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
  const [list, people, orders, inquiries] = await Promise.all([
    api.get<FollowUpList>("/follow-ups", {
      mine: viewAll && !everyone ? "true" : undefined,
      open: status === "done" ? "false" : "true",
      late: status === "late" ? "true" : undefined,
      ...dueRange(due, today),
      q,
      who: viewAll ? sp.who || undefined : undefined,
      about,
      page,
      pageSize: PAGE_SIZE,
    }),
    getPeople().catch(() => [] as Person[]),
    api.get<OrderRow[]>("/orders", { status: "open" }).catch(() => [] as OrderRow[]),
    api.get<Paged<DealRow>>("/inquiries", { stage: "open", pageSize: 100 }).catch(() => null),
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
        crumbs={[{ label: "Follow-ups" }]}
        icon={Clock}
        title="Follow-ups"
        summary="Your reminders to call, visit or chase"
        primary={
          <ButtonLink href="#new-follow-up" variant="primary">
            <Plus aria-hidden />
            New follow-up
          </ButtonLink>
        }
      />
      <LinkTabs
        label="Which follow-ups"
        className="mb-4"
        tabs={[
          {
            href: href({ view: undefined, status: undefined, page: undefined }),
            label: (
              <>
                <User aria-hidden />
                Mine
              </>
            ),
            active: status === "open" && !everyone,
          },
          ...(viewAll
            ? [
                {
                  href: href({ view: "everyone", status: undefined, page: undefined }),
                  label: (
                    <>
                      <Users aria-hidden />
                      Everyone
                    </>
                  ),
                  active: status === "open" && everyone,
                },
              ]
            : []),
          {
            href: href({ status: "late", page: undefined }),
            label: (
              <>
                <TriangleAlert aria-hidden />
                {list.counts.late ? `Late ${list.counts.late}` : "Late"}
              </>
            ),
            active: status === "late",
          },
          {
            href: href({ status: "done", page: undefined }),
            label: (
              <>
                <Check aria-hidden />
                Done
              </>
            ),
            active: status === "done",
          },
        ]}
      />
      <form
        role="search"
        aria-label="Find follow-ups"
        className="mb-4 flex flex-wrap items-center gap-2.5 rounded-[14px] border border-line bg-surface p-3"
      >
        {keep.view && <input type="hidden" name="view" value={keep.view} />}
        {keep.status && <input type="hidden" name="status" value={keep.status} />}
        <SearchField
          defaultValue={q}
          placeholder="Search follow-ups…"
          label="Search follow-ups"
          clearHref={href({ q: undefined, page: undefined })}
          className="min-w-0 flex-[1_1_260px] sm:w-auto"
        />
        <label className="sr-only" htmlFor="fu-due">
          Due
        </label>
        <Select id="fu-due" name="due" defaultValue={due ?? ""} className="w-auto text-[13px]">
          <option value="">Due: Any day</option>
          {DUE.map((d) => (
            <option key={d.value} value={d.value}>
              Due: {d.label}
            </option>
          ))}
        </Select>
        {viewAll && (
          <>
            <label className="sr-only" htmlFor="fu-who">
              Person
            </label>
            <Select id="fu-who" name="who" defaultValue={who ?? ""} className="w-auto text-[13px]">
              <option value="">Person: All</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  Person: {p.name}
                </option>
              ))}
            </Select>
          </>
        )}
        <label className="sr-only" htmlFor="fu-about">
          About
        </label>
        <Select id="fu-about" name="about" defaultValue={about ?? ""} className="w-auto text-[13px]">
          <option value="">About: All</option>
          {ABOUT.map((a) => (
            <option key={a.value} value={a.value}>
              About: {a.label}
            </option>
          ))}
        </Select>
        <Button type="submit">
          <Filter aria-hidden />
          Filter
        </Button>
      </form>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="overflow-clip p-0">
          {list.rows.length === 0 ? (
            <EmptyState
              framed
              title={status === "done" ? "Nothing done yet" : status === "late" ? "Nothing late" : "Nothing planned"}
              description={
                status === "done"
                  ? "Follow-ups ticked done show here, the latest first."
                  : "Add a follow-up here, or on an order, a customer, a factory or an inquiry. It shows on the dashboard on its day, with a reminder."
              }
            />
          ) : (
            <DataTable label="Follow-ups">
              <table className="w-full min-w-[720px] text-[13px]">
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
                          {f.can.done && (
                            <FollowUpCheck
                              action={(f.done ? followUpReopenAction : followUpDoneAction).bind(null, f.id)}
                              done={f.done}
                              what={f.title}
                            />
                          )}
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
                              size="sm"
                              className="size-9 px-0"
                              icon={<Pencil aria-hidden />}
                              label={<span className="sr-only">Edit {f.title}</span>}
                              title="Edit follow-up"
                              body={
                                <div className="p-5">
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
              </table>
            </DataTable>
          )}
          <Pager base="/follow-ups" params={keep} page={page} pageSize={PAGE_SIZE} total={list.total} />
        </Card>
        <Card id="new-follow-up" className="scroll-mt-24">
          <CardHeader title="New follow-up" />
          <div className="p-5">
            <FollowUpFields
              action={addFollowUpAction.bind(null, null)}
              people={people}
              meId={me.id}
              today={today}
              about={aboutOptions}
              submit="Save follow-up"
            />
          </div>
        </Card>
      </div>
    </>
  );
}
