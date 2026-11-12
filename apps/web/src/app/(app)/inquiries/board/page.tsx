import Link from "next/link";
import { List, Plus } from "lucide-react";
import { can, INQUIRY_STAGE_LABEL, PRIORITY_LABEL, REVISION_STATUS_LABEL, type InquiryStage } from "@kebo/shared";
import { buildHref, ButtonLink, LinkTabs, ListToolbar, PageHeader, StatusBadge } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { date, money, plural } from "@/lib/format";
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
          <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-text-2">{d.refNo}</span>
          {d.onHold ? (
            <StatusBadge meaning="neutral">On hold</StatusBadge>
          ) : d.priority === "urgent" || d.priority === "high" ? (
            <StatusBadge meaning={d.priority === "urgent" ? "bad" : "warn"}>{PRIORITY_LABEL[d.priority]}</StatusBadge>
          ) : d.overdue ? (
            <StatusBadge meaning="bad">Past needed-by</StatusBadge>
          ) : null}
        </span>
        <span className="truncate text-[13px] font-bold text-text">{d.title}</span>
        <span className="truncate text-xs text-text-2">
          {d.customer.name}
          {d.assignee ? ` · ${d.assignee.name}` : " · nobody yet"}
        </span>
        <span className="truncate text-xs text-muted">
          {d.order
            ? `Order ${d.order.refNo}`
            : r
              ? `R${r.number} ${REVISION_STATUS_LABEL[r.status].toLowerCase()} · ${money(r.total, r.currency)}`
              : d.requiredBy
                ? `needed by ${date(d.requiredBy)}`
                : plural(d.items, "item")}
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
  const mine = sp.mine === "1";
  const keep = { mine: mine ? "1" : undefined };
  const lists = await Promise.all(
    COLUMNS.map((c) =>
      api.get<Paged<DealRow>>("/inquiries", {
        stage: c.key,
        assignee: mine ? "me" : undefined,
        sort: "newest",
        pageSize: c.key === "won" || c.key === "lost" ? LATEST : 50,
      }),
    ),
  );
  const cols = COLUMNS.map((c, i) => ({ ...c, rows: lists[i]!.rows, total: lists[i]!.total }));
  const open = cols.filter((c) => c.key === "new" || c.key === "sourcing" || c.key === "quoted").reduce((t, c) => t + c.total, 0);
  const phoneKey = cols.some((c) => c.key === sp.stage) ? sp.stage! : "new";
  const column = (c: (typeof cols)[number], hideTitle = false) => (
    <section key={c.key} aria-label={INQUIRY_STAGE_LABEL[c.key]} className="flex min-w-0 flex-col gap-2.5 rounded-2xl bg-surface-3/60 p-3">
      {!hideTitle && (
        <header className="flex items-baseline justify-between gap-2 px-1">
          <h2 className="text-sm font-bold">
            {INQUIRY_STAGE_LABEL[c.key]} <span className="font-medium text-muted">{c.total}</span>
          </h2>
          <span className="truncate text-xs text-muted">{c.note}</span>
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
        crumbs={[{ label: "Operations & trading" }, { label: "Inquiries", href: "/inquiries" }, { label: "Pipeline" }]}
        title="Inquiry pipeline"
        summary={`${plural(open, "open inquiry", "open inquiries")} · open a card to move it on`}
        actions={
          <ButtonLink href="/inquiries" variant="secondary">
            <List aria-hidden /> List
          </ButtonLink>
        }
        primary={
          can(me, "inquiries.create") && (
            <ButtonLink href="/inquiries/new" variant="primary">
              <Plus aria-hidden /> New inquiry
            </ButtonLink>
          )
        }
      />
      <ListToolbar
        chips={[
          { key: "all", label: "Everyone's", href: "/inquiries/board", active: !mine },
          { key: "mine", label: "Mine", href: "/inquiries/board?mine=1", active: mine },
        ]}
        label="Whose inquiries"
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
    </div>
  );
}
