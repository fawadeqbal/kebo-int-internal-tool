import Link from "next/link";
import { Check, Clock, Download, Factory, FileText, LayoutGrid, List, MessageSquareText, Plus, Target, TrendingUp, UserRound, X } from "lucide-react";
import {
  can,
  CHANNEL_LABEL,
  INQUIRY_CHANNELS,
  INQUIRY_STAGE_LABEL,
  INQUIRY_STAGE_TONE,
  LOST_REASON_LABEL,
  PRIORITIES,
  PRIORITY_LABEL,
  REVISION_STATUS_LABEL,
  UNKNOWN_COUNTRY,
  type Priority,
} from "@kebo/shared";
import { Badge, buildHref, ButtonLink, Card, DataRow, EmptyState, LinkTabs, PageHeader, Pager, PhoneList, PhoneRow, RefCode, StatRow, StatTile, StatusBadge, THead, Td, Th, toPage } from "@kebo/ui";
import { api } from "@/lib/api";
import { DataTable } from "@/components/common/data-table";
import { FilterCard } from "@/components/common/filter-card";
import { hasFeature, requireUser } from "@/lib/session";
import { date, short } from "@/lib/format";
import { getPeople, getSettings } from "@/lib/loaders";
import type { DealRow, Paged } from "@/lib/types";
import type { Funnel } from "@/lib/types-facts";
import { crumbsFor, labelFor } from "@/lib/nav";

export const metadata = { title: "Inquiries (RFQs)" };

type Params = Record<string, string | undefined>;

/** The chips (board): the working list (All open) first, then each stage, on hold, and Mine. */
const CHIPS = ["open", "new", "sourcing", "quoted", "on_hold", "won", "lost", "overdue"] as const;
type Chip = (typeof CHIPS)[number];

const PRIORITY_TONE: Record<Priority, "neutral" | "warn" | "bad"> = { low: "neutral", normal: "neutral", high: "warn", urgent: "bad" };

/** "Where it is": the quotation's last step, else how far the asking got. */
function whereItIs(d: DealRow): string {
  if (d.order) return `Order ${d.order.refNo}`;
  const r = d.quotation?.latest;
  if (r) return `R${r.number} ${REVISION_STATUS_LABEL[r.status].toLowerCase()}${d.onHold ? " · on hold" : ""}`;
  if (d.asked || d.offers) return [d.asked ? `${d.asked} asked` : null, d.offers ? `${d.offers} offer${d.offers === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
  return "—";
}

function Stage({ d }: { d: DealRow }) {
  if (d.stage === "lost") return <StatusBadge meaning="bad">{d.lostReason ? `Lost · ${LOST_REASON_LABEL[d.lostReason].toLowerCase()}` : "Lost"}</StatusBadge>;
  if (d.onHold)
    return (
      <Badge tone="primary" dot>
        {INQUIRY_STAGE_LABEL[d.stage]} · on hold
      </Badge>
    );
  return <StatusBadge meaning={d.stage === "new" ? "neutral" : d.stage === "quoted" ? "warn" : INQUIRY_STAGE_TONE[d.stage]}>{INQUIRY_STAGE_LABEL[d.stage]}</StatusBadge>;
}

/**
 * Inquiries (board "Inquiries — list"): Board, Export CSV and New inquiry; Open, Quoted value, Won this month,
 * Win rate and Avg. days to quote; chips by stage with counts and Mine; search with Category, Came by,
 * Handles and Priority; each inquiry with what, who, how it came, when, who handles it, priority, where it is
 * and its stage.
 */
export default async function DealsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const mine = sp.mine === "1";
  const chip: Chip = CHIPS.includes(sp.stage as Chip) ? (sp.stage as Chip) : "open";
  const channel = INQUIRY_CHANNELS.find((c) => c === sp.channel);
  const priority = PRIORITIES.find((p) => p === sp.priority);
  const assignee = mine ? "me" : sp.assignee || undefined;
  const year = new Date().getFullYear();
  const month = new Date().toISOString().slice(0, 7);
  const insights = can(me, "reports.view") && (await hasFeature("insights"));
  const query = { stage: chip, q: sp.q?.trim() || undefined, assignee, customerId: sp.customer, priority, channel, category: sp.category || undefined };
  const [data, settings, people, yearFunnel, monthFunnel] = await Promise.all([
    api.get<Paged<DealRow> & { counts: Record<string, number> }>("/inquiries", { ...query, page: toPage(sp.page) }),
    getSettings(),
    getPeople().catch(() => []),
    insights ? api.get<Funnel>("/insights/facts/funnel", { from: `${year}-01-01`, to: `${year}-12-31` }).catch(() => null) : null,
    insights ? api.get<Funnel>("/insights/facts/funnel", { from: `${month}-01`, to: `${month}-31` }).catch(() => null) : null,
  ]);
  const c = data.counts;
  const count = (s: Chip) => (s === "open" ? (c.new ?? 0) + (c.sourcing ?? 0) + (c.quoted ?? 0) : (c[s] ?? 0));
  const keep = { stage: chip === "open" ? undefined : chip, mine: mine ? "1" : undefined, q: sp.q, assignee: mine ? undefined : sp.assignee, customer: sp.customer, priority, channel, category: sp.category };
  const href = (patch: Params) => buildHref("/inquiries", keep, { page: undefined, ...patch });
  const narrowed = !!(sp.q || sp.assignee || sp.customer || priority || channel || sp.category || mine || chip !== "open");
  const canCreate = can(me, "inquiries.create");
  const currency = settings.sales.currency;

  const chipLabel = (s: Chip) =>
    ({ open: "All", new: "New", sourcing: "Sourcing", quoted: "Quoted", on_hold: "On hold", won: "Won", lost: "Lost", overdue: "Past needed-by" })[s];
  const chipIcon = { open: List, new: Plus, sourcing: Factory, quoted: FileText, on_hold: Clock, won: Check, lost: X, overdue: Clock } as const;

  return (
    <div>
      <PageHeader
        crumbs={crumbsFor("/inquiries")}
        icon={MessageSquareText}
        title={labelFor("/inquiries")}
        summary="Every request for a price, from the first message to won or lost"
        papers={
          <>
            <ButtonLink href="/inquiries/board">
              <LayoutGrid aria-hidden /> Board
            </ButtonLink>
            <ButtonLink href={buildHref("/sheets/export/inquiries", {}, { ...query, customer: sp.customer, format: "csv" })} prefetch={false}>
              <Download aria-hidden /> Export CSV
            </ButtonLink>
          </>
        }
        primary={
          canCreate && (
            <ButtonLink href="/inquiries/new" variant="primary">
              <Plus aria-hidden /> <span className="sm:hidden">New</span>
              <span className="max-sm:hidden">New inquiry</span>
            </ButtonLink>
          )
        }
      />

      <StatRow className="mb-4">
        <StatTile icon={MessageSquareText} iconColor={1} label="Open" value={count("open")} sub={`${c.new ?? 0} new · ${c.sourcing ?? 0} sourcing · ${c.quoted ?? 0} quoted`} href="/inquiries" />
        {yearFunnel && <StatTile icon={FileText} iconColor={3} label="Quoted value" value={short(yearFunnel.quotedValue, currency)} sub={`${yearFunnel.quoted} quotations this year`} />}
        {monthFunnel && <StatTile icon={TrendingUp} iconColor={2} label="Won this month" value={monthFunnel.won} tone="ok" sub={short(monthFunnel.wonValue, currency)} />}
        {yearFunnel && <StatTile icon={Target} iconColor={4} label="Win rate" value={yearFunnel.winRate === null ? "—" : `${Math.round(yearFunnel.winRate)}%`} sub="this year" />}
        {yearFunnel && (
          <StatTile
            icon={Clock}
            iconColor={5}
            label="Avg. days to quote"
            value={yearFunnel.medianDaysToFirstQuote === null ? "—" : yearFunnel.medianDaysToFirstQuote.toLocaleString("en-US", { maximumFractionDigits: 1 })}
            sub="new → R1 sent"
          />
        )}
      </StatRow>

      <LinkTabs
        label="Which inquiries"
        className="mb-4"
        tabs={[
          ...CHIPS.filter((s) => s !== "overdue" || count(s) > 0 || chip === s).map((s) => {
            const Icon = chipIcon[s];
            const n = s === "won" || s === "lost" ? null : count(s);
            return {
              href: href({ stage: s === "open" ? undefined : s, mine: undefined }),
              label: (
                <>
                  <Icon aria-hidden />
                  {chipLabel(s)}
                  {n ? ` ${n}` : ""}
                </>
              ),
              active: chip === s && !mine,
            };
          }),
          {
            href: href({ mine: mine ? undefined : "1", stage: undefined }),
            label: (
              <>
                <UserRound aria-hidden />
                Mine
              </>
            ),
            active: mine,
          },
        ]}
      />

      <FilterCard
        search="Search number, title, customer…"
        value={sp.q}
        keep={{ stage: keep.stage, mine: keep.mine, customer: sp.customer }}
        clearHref={href({ q: undefined })}
        selects={[
          { name: "category", label: "Category", value: sp.category, options: settings.sales.categories.map((x) => ({ value: x, label: x })) },
          { name: "channel", label: "Came by", value: channel, options: INQUIRY_CHANNELS.map((x) => ({ value: x, label: CHANNEL_LABEL[x] })) },
          ...(mine ? [] : [{ name: "assignee", label: "Handles", value: sp.assignee, options: [{ value: "unassigned", label: "Nobody yet" }, ...people.map((p) => ({ value: p.id, label: p.name }))] }]),
          { name: "priority", label: "Priority", value: priority, options: PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] })) },
        ]}
      />

      <Card className="overflow-clip p-0">
        {data.rows.length === 0 ? (
          <EmptyState
            icon={MessageSquareText}
            title={narrowed ? "No inquiries match" : "No inquiries yet"}
            description={
              narrowed
                ? sp.q
                  ? `Nothing matches “${sp.q}” here. Try part of the RFQ number, the customer or an item.`
                  : "Try another stage or filter, or clear the filters."
                : "Every RFQ shows here, from the first message to won or lost. Inquiries from the website arrive by themselves."
            }
            action={
              narrowed ? (
                <ButtonLink href="/inquiries">
                  <X aria-hidden /> Clear filters
                </ButtonLink>
              ) : canCreate ? (
                <ButtonLink href="/inquiries/new">
                  <Plus aria-hidden /> Add the first inquiry
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <>
            <PhoneList label="Inquiries">
              {data.rows.map((d) => (
                <PhoneRow key={d.id} href={`/inquiries/${d.id}`} title={d.title} line={`${d.refNo} · ${d.customer.name}`} status={<Stage d={d} />} figure={whereItIs(d)} />
              ))}
            </PhoneList>
            <DataTable label="Inquiries" className="max-sm:hidden" tableClassName="min-w-[1120px] text-[13px]">
                <THead>
                  <tr>
                    <Th>Inquiry</Th>
                    <Th>What · customer</Th>
                    <Th>Category</Th>
                    <Th>Came by</Th>
                    <Th>Received</Th>
                    <Th>Handles</Th>
                    <Th>Priority</Th>
                    <Th>Where it is</Th>
                    <Th>Stage</Th>
                  </tr>
                </THead>
                <tbody>
                  {data.rows.map((d) => (
                    <DataRow key={d.id} href={`/inquiries/${d.id}`}>
                      <Td>
                        <RefCode href={`/inquiries/${d.id}`}>{d.refNo}</RefCode>
                      </Td>
                      <Td>
                        <Link href={`/inquiries/${d.id}`} className="block max-w-72 truncate font-semibold hover:text-primary">
                          {d.title}
                        </Link>
                        <span className="block max-w-72 truncate text-xs text-text-2">
                          {d.customer.name}
                          {d.customer.country === UNKNOWN_COUNTRY && <span className="text-warn"> · country not set</span>}
                        </span>
                      </Td>
                      <Td>{d.category}</Td>
                      <Td>
                        <Badge>{CHANNEL_LABEL[d.channel].replace(" form", "")}</Badge>
                      </Td>
                      <Td className="whitespace-nowrap">{date(d.createdAt)}</Td>
                      <Td>{d.assignee?.name ?? <StatusBadge meaning="warn">Nobody yet</StatusBadge>}</Td>
                      <Td>
                        <Badge tone={PRIORITY_TONE[d.priority]}>{PRIORITY_LABEL[d.priority]}</Badge>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {whereItIs(d)}
                        {d.overdue && d.requiredBy && <span className="block text-xs font-medium text-bad">needed by {date(d.requiredBy)}</span>}
                      </Td>
                      <Td>
                        <Stage d={d} />
                      </Td>
                    </DataRow>
                  ))}
                </tbody>
            </DataTable>
          </>
        )}
      </Card>
      <Pager base="/inquiries" params={keep} page={data.page} pageSize={data.pageSize} total={data.total} bare />
    </div>
  );
}
