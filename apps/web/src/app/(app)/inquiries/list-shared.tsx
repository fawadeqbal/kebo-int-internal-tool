import { LayoutGrid, List, Plus } from "lucide-react";
import { can, CHANNEL_LABEL, INQUIRY_CHANNELS, INQUIRY_STAGE_LABEL, LOST_REASON_LABEL, PRIORITIES, PRIORITY_LABEL, REVISION_STATUS_LABEL } from "@kebo/shared";
import { Badge, buildHref, PageHeader } from "@kebo/ui";
import { OpenPanelButton } from "@/components/common/panel";
import { MoreMenu, type MenuEntry } from "@/components/common/more-menu";
import { ViewSwitch } from "@/components/common/view-switch";
import type { FilterSelect } from "@/components/common/filter-card";
import type { Fact } from "@/components/lists/list-parts";
import { countOf, dayMonth, daysText, short } from "@/lib/format";
import type { DealRow } from "@/lib/types";
import type { Me } from "@/lib/session";
import type { Funnel } from "@/lib/types-facts";
import { crumbsFor, labelFor } from "@/lib/nav";

/*
 * What the inquiries list and its Board share (design "RFQ Desk — list pages", 18 Nov 2026): the header, the facts
 * line, the filters, and how an inquiry says where it stands.
 */

type Params = Record<string, string | undefined>;

/** The filters, from the address: ?mine=1 (old links) is "Responsible person: Me". */
export function readFilters(sp: Params) {
  return {
    assignee: sp.mine === "1" ? "me" : sp.assignee || undefined,
    channel: INQUIRY_CHANNELS.find((c) => c === sp.channel),
    priority: PRIORITIES.find((p) => p === sp.priority),
    category: sp.category || undefined,
    q: sp.q?.trim() || undefined,
    customerId: sp.customer || undefined,
  };
}

/** Search's neighbours: Responsible person first (Me its first choice), then Category, Came by, Priority. */
export function inquiryFilters(f: ReturnType<typeof readFilters>, people: { id: string; name: string }[], meId: string, categories: string[]): FilterSelect[] {
  return [
    {
      name: "assignee",
      label: "Responsible person",
      value: f.assignee,
      all: "Anyone",
      options: [{ value: "me", label: "Me" }, { value: "unassigned", label: "Nobody yet" }, ...people.filter((p) => p.id !== meId).map((p) => ({ value: p.id, label: p.name }))],
    },
    { name: "category", label: "Category", value: f.category, options: categories.map((x) => ({ value: x, label: x })) },
    { name: "channel", label: "Came by", value: f.channel, options: INQUIRY_CHANNELS.map((x) => ({ value: x, label: CHANNEL_LABEL[x] })) },
    { name: "priority", label: "Priority", value: f.priority, options: PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] })) },
  ];
}

/** One slim line: only what the tabs do not already say. */
export function inquiryFacts(funnel: Funnel | null, lateFollowUps: number, currency: string): Fact[] {
  return [
    ...(funnel
      ? [
          { label: "Quoted this year", value: short(funnel.quotedValue, currency), sub: countOf(funnel.quoted, "quotation") },
          { label: "Won", value: funnel.winRate === null ? "—" : `${Math.round(funnel.winRate)}%`, sub: "this year" },
          { label: "Time to quote", value: daysText(funnel.medianDaysToFirstQuote), sub: "typical" },
        ]
      : []),
    { label: "Follow-ups late", value: lateFollowUps, tone: lateFollowUps > 0 ? ("bad" as const) : undefined },
  ];
}

/**
 * The header: one strong button, New inquiry (on a phone the + in the bottom bar); List | Board and ⋯ beside it.
 * `query`: the filters on screen, for Export to Excel.
 */
export function InquiriesHeader({ me, view, excel, query }: { me: Me; view: "list" | "board"; excel: boolean; query: Params }) {
  const more: MenuEntry[] = [
    ...(excel ? [{ label: "Export to Excel", href: buildHref("/sheets/export/inquiries", {}, query), download: true }] : []),
    { label: "Order board", href: "/orders/board" },
  ];
  return (
    <PageHeader
      crumbs={crumbsFor("/inquiries")}
      icon={null}
      title={labelFor("/inquiries")}
      views={
        <span className="max-sm:hidden">
          <ViewSwitch
            label="View"
            current={view}
            compact
            views={[
              { key: "list", label: "List", icon: <List aria-hidden />, href: buildHref("/inquiries", {}, { ...query, stage: undefined }) },
              { key: "board", label: "Board", icon: <LayoutGrid aria-hidden />, href: buildHref("/inquiries/board", {}, { ...query, stage: undefined }) },
            ]}
          />
        </span>
      }
      more={<MoreMenu label="More for inquiries" items={more} phoneItems={[view === "list" ? { label: "Board", href: "/inquiries/board" } : { label: "List", href: "/inquiries" }]} />}
      primary={
        can(me, "inquiries.create") && (
          <span className="max-sm:hidden">
            <OpenPanelButton panel="new-inquiry" variant="primary" label="New inquiry">
              <Plus aria-hidden /> New inquiry
            </OpenPanelButton>
          </span>
        )
      }
    />
  );
}

/** The stage, as a pill: on hold says so in place of its stage. */
export function StagePill({ d }: { d: DealRow }) {
  if (d.onHold && (d.stage === "new" || d.stage === "sourcing" || d.stage === "quoted")) return <Badge tone="neutral">On hold</Badge>;
  const tone = { new: "neutral", sourcing: "info", quoted: "warn", won: "ok", lost: "bad" } as const;
  return <Badge tone={tone[d.stage]}>{INQUIRY_STAGE_LABEL[d.stage]}</Badge>;
}

/** Where it stands: the one fact that matters now, beside the stage ("1 of 3 suppliers answered", "R1 sent 16 Nov"). */
export function whereItStands(d: DealRow, today: string): string {
  if (d.order) return `Order ${d.order.refNo}`;
  if (d.stage === "lost") return d.lostReason ? LOST_REASON_LABEL[d.lostReason].toLowerCase() : "";
  const r = d.quotation?.latest;
  const quote = r ? (r.status === "draft" ? `R${r.number} draft` : `R${r.number} ${REVISION_STATUS_LABEL[r.status].toLowerCase()}${r.sentOn ? ` ${dayMonth(r.sentOn)}` : ""}`) : null;
  if (d.stage === "new") {
    // Lower case inside the sentence, names as they are ("came by email", "came by WhatsApp").
    const by = CHANNEL_LABEL[d.channel].replace(" form", "").split(" / ")[0]!;
    return `came by ${/^[A-Z][a-z]+$/.test(by) ? by.toLowerCase() : by} ${d.createdAt.slice(0, 10) === today ? "today" : dayMonth(d.createdAt)}`;
  }
  const asked = d.asked ?? 0;
  const offers = d.offers ?? 0;
  const sourcing =
    offers === 0
      ? asked
        ? `${asked} asked · none answered`
        : r
          ? null
          : "no supplier asked yet"
      : asked > offers
        ? `${offers} of ${asked} suppliers answered`
        : `${offers} offer${offers === 1 ? "" : "s"} in`;
  if (d.stage === "quoted" && quote) return quote;
  return [sourcing, quote].filter(Boolean).join(" · ");
}
