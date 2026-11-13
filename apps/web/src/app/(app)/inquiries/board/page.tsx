import Link from "next/link";
import { OpenPanelButton } from "@/components/common/panel";
import { NewInquiryWindow } from "../inquiry-windows";
import { LayoutGrid, List, MessageSquareText, Package, Plus } from "lucide-react";
import { can, INQUIRY_STAGE_LABEL, LOST_REASON_LABEL, REVISION_STATUS_LABEL, type InquiryStage } from "@kebo/shared";
import { Badge, buildHref, ButtonLink, LinkTabs, PageHeader, RefCode, StatusBadge } from "@kebo/ui";
import { FilterCard } from "@/components/common/filter-card";
import { getPeople, getSettings } from "@/lib/loaders";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { plural, short, whole } from "@/lib/format";
import type { DealRow, Paged } from "@/lib/types";

export const metadata = { title: "Inquiry pipeline" };

type Params = Record<string, string | undefined>;
const COLUMNS: { key: InquiryStage; note: string }[] = [
  { key: "new", note: "Not asked factories yet" },
  { key: "sourcing", note: "Getting factory prices" },
  { key: "quoted", note: "Waiting for the customer" },
  { key: "won", note: "The latest won" },
  { key: "lost", note: "The latest lost" },
];
const LATEST = 8;

/** One inquiry on the board: its number, what it is, the customer, the quotation or the order, and what to watch. */
function DealCard({ d }: { d: DealRow }) {
  const r = d.quotation?.latest;
  return (
    <li>
      <Link href={`/inquiries/${d.id}`} className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface p-3 shadow-card transition-colors hover:border-primary-line">
        <span className="flex items-center justify-between gap-2">
          <RefCode>{d.refNo}</RefCode>
          {d.onHold ? (
            <Badge tone="primary" dot>
              On hold
            </Badge>
          ) : d.stage === "won" ? (
            <StatusBadge meaning="ok">Won</StatusBadge>
          ) : d.stage === "lost" ? (
            <StatusBadge meaning="bad">{d.lostReason ? LOST_REASON_LABEL[d.lostReason] : "Lost"}</StatusBadge>
          ) : d.priority === "urgent" ? (
            <StatusBadge meaning="bad">Urgent</StatusBadge>
          ) : !d.assignee ? (
            <StatusBadge meaning="warn">Assign</StatusBadge>
          ) : d.overdue ? (
            <StatusBadge meaning="bad">Past needed-by</StatusBadge>
          ) : d.stage === "sourcing" && d.offers && !r ? (
            <StatusBadge meaning="info">Make quotation</StatusBadge>
          ) : d.priority === "high" ? (
            <StatusBadge meaning="warn">High</StatusBadge>
          ) : null}
        </span>
        <span className="truncate text-[13px] font-bold text-text">{d.title}</span>
        <span className="truncate text-xs text-text-2">
          {d.order
            ? `${d.order.refNo}${r ? ` · ${whole(r.total, r.currency)}` : ""}`
            : [
                d.customer.name,
                r ? `R${r.number} ${REVISION_STATUS_LABEL[r.status].toLowerCase()}` : d.offers ? `${d.offers} offer${d.offers === 1 ? "" : "s"}` : (d.assignee?.name ?? "nobody yet"),
              ].join(" · ")}
        </span>
      </Link>
    </li>
  );
}

/**
 * The inquiry pipeline (board): one column per stage — New, Sourcing, Quoted, then the latest won and lost.
 * Each card opens its inquiry, where the stage moves (asking factories, sending, accepting, lost). On a
 * phone and a tablet one column at a time, picked with chips.
 */
export default async function InquiryBoardPage({ searchParams }: { searchParams: Promise<Params> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const mine = sp.mine === "1" || sp.assignee === "me";
  const keep = { mine: mine ? "1" : undefined, q: sp.q, assignee: sp.assignee, category: sp.category };
  const [settings, people] = await Promise.all([getSettings(), getPeople().catch(() => [])]);
  const lists = await Promise.all(
    COLUMNS.map((c) =>
      api.get<Paged<DealRow>>("/inquiries", {
        stage: c.key,
        assignee: mine ? "me" : sp.assignee || undefined,
        q: sp.q?.trim() || undefined,
        category: sp.category || undefined,
        sort: "newest",
        pageSize: c.key === "won" || c.key === "lost" ? LATEST : 50,
      }),
    ),
  );
  const currency = settings.sales.currency;
  // A column's worth: its quotations' latest totals in the main currency (the cards shown).
  const cols = COLUMNS.map((c, i) => ({
    ...c,
    rows: lists[i]!.rows,
    total: lists[i]!.total,
    value: lists[i]!.rows.reduce((t, d) => t + (d.quotation?.latest && d.quotation.latest.currency === currency ? Number(d.quotation.latest.total) : 0), 0),
  }));
  const open = cols.filter((c) => c.key === "new" || c.key === "sourcing" || c.key === "quoted").reduce((t, c) => t + c.total, 0);
  const phoneKey = cols.some((c) => c.key === sp.stage) ? sp.stage! : "new";
  const column = (c: (typeof cols)[number], hideTitle = false) => (
    <section key={c.key} aria-label={INQUIRY_STAGE_LABEL[c.key]} className="flex min-w-0 flex-col gap-2.5 rounded-2xl bg-surface-3/60 p-3">
      {!hideTitle && (
        <header className="flex items-baseline justify-between gap-2 px-1">
          <h2 className="text-sm font-bold">
            {INQUIRY_STAGE_LABEL[c.key]} <span className="font-medium text-muted">{c.total}</span>
          </h2>
          <span className="truncate text-xs text-muted" title={c.note}>
            {c.value ? short(c.value, currency) : c.note}
          </span>
        </header>
      )}
      {c.rows.length ? (
        <ul className="flex flex-col gap-2">
          {c.rows.map((d) => (
            <DealCard key={d.id} d={d} />
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border-2 border-dashed border-line-strong px-3 py-6 text-center text-xs text-muted">Nothing here</p>
      )}
      {c.total > c.rows.length && (
        <Link href={`/inquiries?stage=${c.key}`} className="px-1 text-xs font-medium text-primary hover:underline">
          All {c.total}
        </Link>
      )}
    </section>
  );

  return (
    <div>
      <PageHeader
        crumbs={[{ label: "Overview" }, { label: "Pipelines" }]}
        icon={LayoutGrid}
        title="Inquiry pipeline"
        summary={`${plural(open, "open inquiry", "open inquiries")} · open a card to move its stage. Won and lost ask for the details first.`}
        actions={
          <ButtonLink href="/inquiries" variant="secondary">
            <List aria-hidden /> List
          </ButtonLink>
        }
        primary={
          can(me, "inquiries.create") && (
            <OpenPanelButton panel="new-inquiry" variant="primary">
              <Plus aria-hidden /> New inquiry
            </OpenPanelButton>
          )
        }
      />
      <LinkTabs
        label="Boards"
        className="mb-4"
        tabs={[
          { href: "/inquiries/board", label: <><MessageSquareText aria-hidden />Inquiries</>, active: true },
          { href: "/orders/board", label: <><Package aria-hidden />Orders</>, active: false },
        ]}
      />
      <FilterCard
        search="Search…"
        value={sp.q}
        clearHref="/inquiries/board"
        selects={[
          { name: "assignee", label: "Handles", value: mine ? "me" : sp.assignee, options: [{ value: "me", label: "Me" }, { value: "unassigned", label: "Nobody yet" }, ...people.map((p) => ({ value: p.id, label: p.name }))] },
          { name: "category", label: "Category", value: sp.category, options: settings.sales.categories.map((x) => ({ value: x, label: x })) },
        ]}
      />
      <div className="xl:hidden">
        <LinkTabs
          label="Stage"
          className="mb-4"
          tabs={cols.map((c) => ({ href: buildHref("/inquiries/board", keep, { stage: c.key }), label: INQUIRY_STAGE_LABEL[c.key], count: c.total, active: c.key === phoneKey }))}
        />
        {column(cols.find((c) => c.key === phoneKey)!, true)}
      </div>
      <div className="hidden items-start gap-3 xl:grid xl:grid-cols-5">{cols.map((c) => column(c))}</div>

      {sp.panel === "new-inquiry" && <NewInquiryWindow customerId={sp.for} />}
    </div>
  );
}
