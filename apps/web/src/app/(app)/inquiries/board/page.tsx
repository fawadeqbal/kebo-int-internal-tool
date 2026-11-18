import Link from "next/link";
import { NewInquiryWindow } from "../inquiry-windows";
import { can } from "@kebo/shared";
import { Badge, buildHref, LinkTabs } from "@kebo/ui";
import { FilterCard } from "@/components/common/filter-card";
import { FactLine, FollowUpDay, PriorityTag, Responsible } from "@/components/lists/list-parts";
import { getPeople, getSettings } from "@/lib/loaders";
import { api } from "@/lib/api";
import { hasFeature, requireUser } from "@/lib/session";
import { companyToday, countOf, soonDay } from "@/lib/format";
import type { DealRow, Paged } from "@/lib/types";
import type { Funnel } from "@/lib/types-facts";
import { inquiryFacts, inquiryFilters, InquiriesHeader, readFilters, whereItStands } from "../list-shared";

export const metadata = { title: "Inquiries · Board" };

type Params = Record<string, string | undefined>;

/** The open stages are the columns; won and lost fold into one small Closed column. */
const COLUMNS = [
  { key: "new", label: "New", tone: "neutral" },
  { key: "sourcing", label: "Sourcing", tone: "info" },
  { key: "quoted", label: "Quoted", tone: "warn" },
  { key: "on_hold", label: "On hold", tone: "neutral" },
] as const;
type Column = (typeof COLUMNS)[number]["key"];
const SHOWN = 12;

/** One inquiry on the board: the row's facts in the row's order (number, what, who for, where it stands, who, next). */
function Card({ d, today }: { d: DealRow; today: string }) {
  return (
    <li>
      <Link href={`/inquiries/${d.id}`} className="block rounded-[10px] border border-line bg-surface px-3 py-2.5 text-[13px] leading-[18px] transition-colors hover:border-primary-line">
        <span className="block text-xs text-muted tabular">{d.refNo}</span>
        <span className="block text-[13.5px] font-semibold text-text">
          {d.title}
          <PriorityTag priority={d.priority} />
        </span>
        <span className="block truncate text-[12.5px] text-text-2">{d.customer.name}</span>
        <span className="mt-1 block text-text-2">{whereItStands(d, today)}</span>
        <span className="mt-2 flex items-center justify-between gap-2 text-[12.5px]">
          <Responsible name={d.assignee?.name} short />
          <FollowUpDay next={d.nextFollowUp} day={soonDay} />
        </span>
      </Link>
    </li>
  );
}

/**
 * Inquiries · Board (design "RFQ Desk — list pages", 18 Nov 2026): the same list in columns, with the same header,
 * facts, search and filters; the stages are the columns, so there are no tabs. Won and Lost fold into one Closed
 * column (the List's Won and Lost tabs show them in full). On a phone and a tablet one column at a time.
 */
export default async function InquiryBoardPage({ searchParams }: { searchParams: Promise<Params> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const f = readFilters(sp);
  const year = new Date().getFullYear();
  const insights = can(me, "reports.view") && (await hasFeature("insights"));
  const [settings, people, excel, funnel, ...lists] = await Promise.all([
    getSettings(),
    getPeople().catch(() => []),
    hasFeature("excel"),
    insights ? api.get<Funnel>("/insights/facts/funnel", { from: `${year}-01-01`, to: `${year}-12-31` }).catch(() => null) : null,
    ...COLUMNS.map((c) => api.get<Paged<DealRow> & { counts: Record<string, number> }>("/inquiries", { stage: c.key, held: c.key === "on_hold" ? undefined : "no", ...f, sort: "newest", pageSize: SHOWN })),
  ]);
  const counts = lists[0]!.counts;
  // On hold has its own column: the open stages' columns hold only the ones going on (held=no).
  const cols = COLUMNS.map((c, i) => ({ ...c, rows: lists[i]!.rows, total: lists[i]!.total }));
  const open = (counts.new ?? 0) + (counts.sourcing ?? 0) + (counts.quoted ?? 0);
  const today = companyToday();
  const keep = { q: sp.q, assignee: f.assignee, category: f.category, channel: f.channel, priority: f.priority, customer: sp.customer };
  const phoneKey: Column = cols.some((c) => c.key === sp.stage) ? (sp.stage as Column) : "new";
  const listOf = (stage: string) => buildHref("/inquiries", {}, { ...keep, stage });

  const column = (c: (typeof cols)[number], hideTitle = false) => (
    <section key={c.key} aria-label={c.label} className="flex min-w-0 flex-col gap-2 rounded-xl bg-surface-3/70 p-2.5">
      {!hideTitle && (
        <h2 className="mx-0.5 flex items-center gap-2 text-[13.5px] font-bold">
          <Badge tone={c.tone}>{c.label}</Badge>
          <span className="text-[12.5px] font-semibold text-muted">{c.total}</span>
        </h2>
      )}
      {c.rows.length ? (
        <ul className="flex flex-col gap-2">
          {c.rows.map((d) => (
            <Card key={d.id} d={d} today={today} />
          ))}
        </ul>
      ) : (
        <p className="px-1 pt-1 pb-2 text-[13px] text-muted">{c.key === "on_hold" ? "Nothing on hold." : `No ${c.label.toLowerCase()} inquiries.`}</p>
      )}
      {c.total > c.rows.length && (
        <Link href={listOf(c.key)} className="px-1 text-[13px] font-semibold text-primary hover:underline">
          Show {c.total - c.rows.length} more
        </Link>
      )}
    </section>
  );
  const closed = (
    <section aria-label="Closed" className="rounded-xl border border-dashed border-line-strong bg-surface p-3 text-[13px] leading-5">
      <h2 className="mb-1.5 text-[13.5px] font-bold">Closed</h2>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link href={listOf("won")} className="inline-flex items-center gap-1.5 hover:underline">
          <Badge tone="ok">Won</Badge> {counts.won ?? 0}
        </Link>
        <Link href={listOf("lost")} className="inline-flex items-center gap-1.5 hover:underline">
          <Badge tone="bad">Lost</Badge> {counts.lost ?? 0}
        </Link>
      </p>
    </section>
  );

  return (
    <div>
      <InquiriesHeader me={me} view="board" excel={excel} query={keep} />
      <FactLine facts={inquiryFacts(funnel, counts.late_follow_ups ?? 0, settings.sales.currency)} />
      <FilterCard
        search="Search number, title, customer…"
        value={sp.q}
        keep={{ customer: sp.customer }}
        count={countOf(open, "open inquiry", "open inquiries")}
        selects={inquiryFilters(f, people, me.id, settings.sales.categories)}
      />
      <div className="xl:hidden">
        <LinkTabs
          label="Stage"
          look="tabs"
          className="mb-4"
          tabs={cols.map((c) => ({ href: buildHref("/inquiries/board", keep, { stage: c.key }), label: c.label, count: c.total, active: c.key === phoneKey }))}
        />
        {column(cols.find((c) => c.key === phoneKey)!, true)}
        <div className="mt-3">{closed}</div>
      </div>
      <div className="hidden items-start gap-3 xl:grid xl:grid-cols-[repeat(4,minmax(0,1fr))_200px]">
        {cols.map((c) => column(c))}
        {closed}
      </div>

      {sp.panel === "new-inquiry" && <NewInquiryWindow customerId={sp.for} />}
    </div>
  );
}
