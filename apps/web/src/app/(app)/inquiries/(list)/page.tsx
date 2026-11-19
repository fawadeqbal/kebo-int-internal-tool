import Link from "next/link";
import { OpenPanelButton } from "@/components/common/panel";
import { NewInquiryWindow } from "../inquiry-windows";
import { MessageSquareText, Plus, X } from "lucide-react";
import { can, INQUIRY, UNKNOWN_COUNTRY } from "@kebo/shared";
import { buildHref, ButtonLink, LinkTabs, Pager, toPage } from "@kebo/ui";
import { api } from "@/lib/api";
import { FilterCard } from "@/components/common/filter-card";
import { FactLine, FollowUpDay, PriorityTag, Responsible, Stands } from "@/components/lists/list-parts";
import { ListTable } from "@/components/lists/list-table";
import { SelectButton, SelectionFrame, WhenSelecting } from "@/components/lists/selection";
import { InquirySelectBar } from "./select-bar";
import { hasFeature, requireUser } from "@/lib/session";
import { companyToday, countOf, date, dayMonth, soonDay } from "@/lib/format";
import { getPeople, getSettings } from "@/lib/loaders";
import type { DealRow, Paged } from "@/lib/types";
import type { Funnel } from "@/lib/types-facts";
import { inquiryFacts, inquiryFilters, InquiriesHeader, readFilters, StagePill, whereItStands } from "../list-shared";

export const metadata = { title: "Inquiries" };

type Params = Record<string, string | undefined>;

/** The tabs are the stages (design "list pages" 18 Nov): Open first, then each stage, on hold, closed ones, All. */
const TABS = ["open", "new", "sourcing", "quoted", "on_hold", "won", "lost", "overdue", "all"] as const;
type Tab = (typeof TABS)[number];
const S = INQUIRY.states;
const TAB_LABEL: Record<Tab, string> = { open: "Open", new: S.new.words, sourcing: S.sourcing.words, quoted: S.quoted.words, on_hold: S.on_hold.words, won: S.won.words, lost: S.lost.words, overdue: "Past needed-by", all: "All" };

/**
 * Inquiries (design "RFQ Desk — list pages", 18 Nov 2026): one strong button, New inquiry (on a phone the + in
 * the bottom bar); List | Board and ⋯ (Export to Excel) beside it; one slim line of facts; the stages as tabs with
 * their counts; search and filters in one row (Responsible person first, Me its first choice); each inquiry with
 * its number, what and who, when it came, who is responsible, where it stands and its next follow-up.
 */
export default async function InquiriesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const f = readFilters(sp);
  const { assignee, channel, priority } = f;
  const tab: Tab = TABS.includes(sp.stage as Tab) ? (sp.stage as Tab) : "open";
  const year = new Date().getFullYear();
  const insights = can(me, "reports.view") && (await hasFeature("insights"));
  const excel = await hasFeature("excel");
  const query = { stage: tab, ...f };
  const [data, settings, people, yearFunnel] = await Promise.all([
    api.get<Paged<DealRow> & { counts: Record<string, number> }>("/inquiries", { ...query, page: toPage(sp.page) }),
    getSettings(),
    getPeople().catch(() => []),
    insights ? api.get<Funnel>("/insights/facts/funnel", { from: `${year}-01-01`, to: `${year}-12-31` }).catch(() => null) : null,
  ]);
  const c = data.counts;
  const count = (t: Tab) =>
    t === "open"
      ? (c.new ?? 0) + (c.sourcing ?? 0) + (c.quoted ?? 0)
      : t === "all"
        ? (c.new ?? 0) + (c.sourcing ?? 0) + (c.quoted ?? 0) + (c.won ?? 0) + (c.lost ?? 0)
        : (c[t] ?? 0);
  const keep = { stage: tab === "open" ? undefined : tab, q: sp.q, assignee, customer: sp.customer, priority, channel, category: sp.category };
  const href = (patch: Params) => buildHref("/inquiries", keep, { page: undefined, ...patch });
  const narrowed = !!(sp.q || assignee || sp.customer || priority || channel || sp.category || tab !== "open");
  const canCreate = can(me, "inquiries.create");
  const currency = settings.sales.currency;
  const today = companyToday();

  return (
    <div>
      <InquiriesHeader me={me} view="list" excel={excel} query={{ stage: keep.stage, q: sp.q, assignee, customer: sp.customer, priority, channel, category: sp.category }} />

      <FactLine facts={inquiryFacts(yearFunnel, c.late_follow_ups ?? 0, currency)} />

      <LinkTabs
        label="Which inquiries"
        look="tabs"
        className="mb-4"
        tabs={TABS.filter((t) => t !== "overdue" || count(t) > 0 || tab === t).map((t) => ({
          href: href({ stage: t === "open" ? undefined : t }),
          label: TAB_LABEL[t],
          count: count(t),
          alert: t === "overdue" && count(t) > 0,
          active: tab === t,
        }))}
      />

      <SelectionFrame ids={data.rows.map((d) => d.id)}>
      <WhenSelecting>
        <InquirySelectBar
          rows={data.rows.map((d) => ({ id: d.id, refNo: d.refNo, assigned: !!d.assignee, open: !d.onHold && (d.stage === "new" || d.stage === "sourcing" || d.stage === "quoted") }))}
          people={people.map((p) => ({ id: p.id, name: p.name }))}
          meId={me.id}
          canAssign={can(me, "inquiries.assign")}
          today={today}
        />
      </WhenSelecting>
      <WhenSelecting not>
      <FilterCard
        end={data.rows.length > 0 && <SelectButton />}
        count={countOf(data.total, INQUIRY.name.one, INQUIRY.name.many)}
        search="Search number, title, customer…"
        value={sp.q}
        keep={{ stage: keep.stage, customer: sp.customer }}
        selects={inquiryFilters(f, people, me.id, settings.sales.categories)}
      />
      </WhenSelecting>

      <ListTable
        label="Inquiries"
        rows={data.rows}
        rowKey={(d) => d.id}
        href={(d) => `/inquiries/${d.id}`}
        select={(d) => ({ id: d.id, label: d.refNo })}
        tableClassName="text-md"
        empty={{
          icon: MessageSquareText,
          title: narrowed ? `No ${INQUIRY.name.many} match` : `No ${INQUIRY.name.many} yet`,
          action: narrowed ? (
            <ButtonLink href="/inquiries">
              <X aria-hidden /> Clear filters
            </ButtonLink>
          ) : canCreate ? (
            <OpenPanelButton panel="new-inquiry" variant="strong">
              <Plus aria-hidden /> New inquiry
            </OpenPanelButton>
          ) : undefined,
        }}
        phone={(d) => ({
          title: d.title,
          tag: <PriorityTag priority={d.priority} />,
          end: <FollowUpDay next={d.nextFollowUp} day={soonDay} />,
          line: `${d.customer.name} · ${d.refNo}`,
          stands: <Stands pill={<StagePill d={d} />} fact={whereItStands(d, today)} />,
          who: <Responsible name={d.assignee?.name} short />,
        })}
        columns={[
          { key: "no", header: "No.", className: "w-[124px] text-md whitespace-nowrap text-muted tabular", cell: (d) => d.refNo },
          {
            key: "inquiry",
            header: "Inquiry",
            cell: (d) => (
              <>
                <span className="flex max-w-[26rem] items-baseline">
                  <Link href={`/inquiries/${d.id}`} className="truncate font-semibold hover:text-primary">
                    {d.title}
                  </Link>
                  <PriorityTag priority={d.priority} />
                </span>
                <span className="block max-w-[26rem] truncate text-xs text-text-2">
                  {d.customer.name}
                  {d.customer.country === UNKNOWN_COUNTRY && <span className="text-warn"> · country not set</span>}
                </span>
              </>
            ),
          },
          { key: "received", header: "Received", className: "whitespace-nowrap", cell: (d) => dayMonth(d.createdAt) },
          { key: "responsible", header: "Responsible person", cell: (d) => <Responsible name={d.assignee?.name} /> },
          {
            key: "stands",
            header: "Where it stands",
            cell: (d) => (
              <>
                <Stands pill={<StagePill d={d} />} fact={whereItStands(d, today)} />
                {d.overdue && d.requiredBy && <span className="mt-0.5 block text-xs font-medium text-bad">needed by {date(d.requiredBy)}</span>}
              </>
            ),
          },
          { key: "follow-up", header: "Next follow-up", cell: (d) => <FollowUpDay next={d.nextFollowUp} day={soonDay} /> },
        ]}
      />
      </SelectionFrame>
      <Pager base="/inquiries" params={keep} page={data.page} pageSize={data.pageSize} total={data.total} bare />

      {sp.panel === "new-inquiry" && <NewInquiryWindow customerId={sp.for} />}
    </div>
  );
}
