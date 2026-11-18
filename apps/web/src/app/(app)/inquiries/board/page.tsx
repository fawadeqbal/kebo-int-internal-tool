import Link from "next/link";
import { NewInquiryWindow } from "../inquiry-windows";
import { can, INQUIRY } from "@kebo/shared";
import { Badge, buildHref, RULES } from "@kebo/ui";
import { Board } from "@/components/lists/board";
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
const COLUMNS = (["new", "sourcing", "quoted", "on_hold"] as const).map((key) => ({ key, label: INQUIRY.states[key].words, tone: INQUIRY.states[key].tone }));
type Column = (typeof COLUMNS)[number]["key"];
const SHOWN = RULES.board.perColumn;

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

  const closed = (
    <section aria-label="Closed" className="rounded-xl border border-dashed border-line-strong bg-surface p-3 text-[13px] leading-5">
      <h2 className="mb-1.5 text-[13.5px] font-bold">Closed</h2>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link href={listOf("won")} className="inline-flex items-center gap-1.5 hover:underline">
          <Badge tone={INQUIRY.states.won.tone}>{INQUIRY.states.won.words}</Badge> {counts.won ?? 0}
        </Link>
        <Link href={listOf("lost")} className="inline-flex items-center gap-1.5 hover:underline">
          <Badge tone={INQUIRY.states.lost.tone}>{INQUIRY.states.lost.words}</Badge> {counts.lost ?? 0}
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
        count={countOf(open, `open ${INQUIRY.name.one}`, `open ${INQUIRY.name.many}`)}
        selects={inquiryFilters(f, people, me.id, settings.sales.categories)}
      />
      <Board
        columns={cols.map((c) => ({ ...c, empty: c.key === "on_hold" ? "Nothing on hold." : `No ${c.label.toLowerCase()} ${INQUIRY.name.many}.`, moreHref: listOf(c.key) }))}
        card={(d) => <Card d={d} today={today} />}
        rowKey={(d) => d.id}
        closed={closed}
        phoneKey={phoneKey}
        phoneHref={(key) => buildHref("/inquiries/board", keep, { stage: key })}
      />

      {sp.panel === "new-inquiry" && <NewInquiryWindow customerId={sp.for} />}
    </div>
  );
}
