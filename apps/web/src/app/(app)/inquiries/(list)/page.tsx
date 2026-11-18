import Link from "next/link";
import { OpenPanelButton } from "@/components/common/panel";
import { NewInquiryWindow } from "../inquiry-windows";
import { MessageSquareText, Plus, X } from "lucide-react";
import { can, UNKNOWN_COUNTRY } from "@kebo/shared";
import { buildHref, ButtonLink, Card, DataRow, EmptyState, LinkTabs, Pager, PhoneList, THead, Td, Th, toPage } from "@kebo/ui";
import { api } from "@/lib/api";
import { DataTable } from "@/components/common/data-table";
import { FilterCard } from "@/components/common/filter-card";
import { FactLine, FollowUpDay, ListRow, PriorityTag, Responsible, Stands } from "@/components/lists/list-parts";
import { SelectButton, SelectCell, SelectHead, SelectionFrame, WhenSelecting } from "@/components/lists/selection";
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
const TAB_LABEL: Record<Tab, string> = { open: "Open", new: "New", sourcing: "Sourcing", quoted: "Quoted", on_hold: "On hold", won: "Won", lost: "Lost", overdue: "Past needed-by", all: "All" };

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
        count={countOf(data.total, "inquiry", "inquiries")}
        search="Search number, title, customer…"
        value={sp.q}
        keep={{ stage: keep.stage, customer: sp.customer }}
        selects={inquiryFilters(f, people, me.id, settings.sales.categories)}
      />
      </WhenSelecting>

      <Card className="overflow-clip p-0">
        {data.rows.length === 0 ? (
          <EmptyState
            icon={MessageSquareText}
            title={narrowed ? "No inquiries match" : "No inquiries yet"}
            action={
              narrowed ? (
                <ButtonLink href="/inquiries">
                  <X aria-hidden /> Clear filters
                </ButtonLink>
              ) : canCreate ? (
                <OpenPanelButton panel="new-inquiry" variant="primary">
                  <Plus aria-hidden /> New inquiry
                </OpenPanelButton>
              ) : undefined
            }
          />
        ) : (
          <>
            <PhoneList label="Inquiries">
              {data.rows.map((d) => (
                <ListRow
                  key={d.id}
                  href={`/inquiries/${d.id}`}
                  title={d.title}
                  tag={<PriorityTag priority={d.priority} />}
                  end={<FollowUpDay next={d.nextFollowUp} day={soonDay} />}
                  line={`${d.customer.name} · ${d.refNo}`}
                  stands={<Stands pill={<StagePill d={d} />} fact={whereItStands(d, today)} />}
                  who={<Responsible name={d.assignee?.name} short />}
                />
              ))}
            </PhoneList>
            <DataTable label="Inquiries" className="max-sm:hidden" tableClassName="min-w-[960px] text-[13.5px]">
              <THead>
                <tr>
                  <SelectHead />
                  <Th>No.</Th>
                  <Th>Inquiry</Th>
                  <Th>Received</Th>
                  <Th>Responsible person</Th>
                  <Th>Where it stands</Th>
                  <Th>Next follow-up</Th>
                </tr>
              </THead>
              <tbody>
                {data.rows.map((d) => (
                  <DataRow key={d.id} href={`/inquiries/${d.id}`}>
                    <SelectCell id={d.id} label={d.refNo} />
                    <Td className="w-[124px] text-[13px] whitespace-nowrap text-muted tabular">{d.refNo}</Td>
                    <Td>
                      <span className="flex max-w-[26rem] items-baseline">
                        <Link href={`/inquiries/${d.id}`} className="truncate font-semibold hover:text-primary">
                          {d.title}
                        </Link>
                        <PriorityTag priority={d.priority} />
                      </span>
                      <span className="block max-w-[26rem] truncate text-[12.5px] text-text-2">
                        {d.customer.name}
                        {d.customer.country === UNKNOWN_COUNTRY && <span className="text-warn"> · country not set</span>}
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap">{dayMonth(d.createdAt)}</Td>
                    <Td>
                      <Responsible name={d.assignee?.name} />
                    </Td>
                    <Td>
                      <Stands pill={<StagePill d={d} />} fact={whereItStands(d, today)} />
                      {d.overdue && d.requiredBy && <span className="mt-0.5 block text-xs font-medium text-bad">needed by {date(d.requiredBy)}</span>}
                    </Td>
                    <Td>
                      <FollowUpDay next={d.nextFollowUp} day={soonDay} />
                    </Td>
                  </DataRow>
                ))}
              </tbody>
            </DataTable>
          </>
        )}
      </Card>
      </SelectionFrame>
      <Pager base="/inquiries" params={keep} page={data.page} pageSize={data.pageSize} total={data.total} bare />

      {sp.panel === "new-inquiry" && <NewInquiryWindow customerId={sp.for} />}
    </div>
  );
}
