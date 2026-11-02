import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { ORDER_STAGE_LABEL, STAGE_FLOW, type FlowStep, type OrderStage } from "@kebo/shared";
import { buildHref, Card, cn, EmptyState, FilterBar, FilterChip, LinkTabs, OrderStageBadge, PageHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { ExportLink } from "@/components/sheets/export-link";
import { hasFeature, requireUser } from "@/lib/session";
import { optional } from "@/components/print/data";
import { date, money } from "@/lib/format";
import type { OrderRow } from "@/lib/types-orders";

export const metadata = { title: "Orders" };

/** How many finished orders the Done column shows. */
const RECENT_DONE = 8;

/**
 * Orders as a board: Confirmed, In production, Shipped and the recently Done,
 * each card with what it needs now (late in red). On a phone, one stage at a
 * time with tabs. ?mine=1 for my orders, ?view=cancelled for cancelled ones.
 */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ view?: string; mine?: string; stage?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  // ?view=mine is what the reminders link to.
  const mine = sp.mine === "1" || sp.view === "mine";
  const cancelled = sp.view === "cancelled";
  const keep = { mine: mine ? "1" : undefined, view: cancelled ? "cancelled" : undefined };
  const q = { mine: mine ? "true" : undefined };
  // Done: only the latest few and how many there are (a company has thousands over the years).
  const [openRows, recentDone, doneCount, cancelledRows] = await Promise.all([
    cancelled ? Promise.resolve([] as OrderRow[]) : api.get<OrderRow[]>("/orders", { ...q, status: "open" }),
    cancelled ? Promise.resolve([] as OrderRow[]) : api.get<OrderRow[]>("/orders", { ...q, status: "closed", recent: "true", limit: String(RECENT_DONE) }),
    cancelled ? Promise.resolve(0) : api.get<{ count: number }>("/orders/count", { ...q, status: "closed" }).then((r) => r.count),
    cancelled ? api.get<OrderRow[]>("/orders", { ...q, status: "cancelled", recent: "true" }) : Promise.resolve([] as OrderRow[]),
  ]);
  const columns: { stage: OrderStage; rows: OrderRow[]; note?: string; count?: number }[] = STAGE_FLOW.map((stage) => ({
    stage,
    rows: stage === "done" ? recentDone : openRows.filter((r) => r.stage === stage),
    note: stage === "done" && doneCount > RECENT_DONE ? `The latest ${RECENT_DONE} of ${doneCount}` : undefined,
    count: stage === "done" ? doneCount : undefined,
  }));
  // With the orders board module, the columns are the steps after acceptance (the design's board); else the four stages.
  const board = !cancelled && (await hasFeature("orders_board")) ? await optional(() => api.get<{ items: { id: string; current: { key: FlowStep; label: string; sub: string } | null }[] }>("/order-board", q)) : null;
  if (board) {
    const at = new Map(board.items.map((i) => [i.id, i.current]));
    const on = {
      production: await hasFeature("production"),
      shipping: await hasFeature("shipping"),
      documents: await hasFeature("bank_documents"),
      delivery: await hasFeature("delivery_sat"),
    };
    const flowCols: { key: string; label: string; steps: FlowStep[] }[] = [
      { key: "payment", label: "Customer payment", steps: ["payment"] },
      { key: "production", label: on.production ? "Factory & production" : "Factory order", steps: ["factory", "production"] },
      ...(on.shipping ? [{ key: "shipping", label: "Shipping", steps: ["shipping"] as FlowStep[] }] : []),
      ...(on.documents ? [{ key: "documents", label: "Documents & bank", steps: ["documents"] as FlowStep[] }] : []),
      ...(on.delivery ? [{ key: "delivery", label: "Delivery & SAT", steps: ["delivery"] as FlowStep[] }] : []),
    ];
    const last = flowCols[flowCols.length - 1]!;
    const cols: BoardCol[] = [
      ...flowCols.map((c) => ({
        key: c.key,
        label: c.label,
        rows: openRows
          .filter((r) => {
            const cur = at.get(r.id);
            return cur ? c.steps.includes(cur.key) : c === last;
          })
          .map((r) => ({ ...r, flow: (at.get(r.id)?.sub ?? "Every step done: close the order").replace(/\d{4}-\d{2}-\d{2}/g, (d) => date(d)) })),
      })),
      { key: "done", label: "Done (recent)", rows: recentDone, count: doneCount, note: doneCount > RECENT_DONE ? `The latest ${RECENT_DONE} of ${doneCount}` : undefined },
    ];
    const phoneKey = cols.some((c) => c.key === sp.stage) ? sp.stage! : (cols.find((c) => c.key !== "done" && c.rows.length)?.key ?? "payment");
    const phoneCol = cols.find((c) => c.key === phoneKey)!;
    return (
      <div>
        <PageHeader
          title="Orders"
          description={`${openRows.length} open · each card says what it needs now`}
          actions={<ExportLink what="orders" query={{ mine: mine ? "1" : undefined }} />}
        />
        <Filters mine={mine} cancelled={false} keep={keep} />
        {openRows.length + doneCount === 0 ? (
          <EmptyState title={mine ? "No orders of yours yet" : "No orders yet"} description="An order appears when a customer accepts a quotation." />
        ) : (
          <>
            <div className="xl:hidden">
              <LinkTabs label="Step" className="mb-4" tabs={cols.map((c) => ({ href: buildHref("/orders", keep, { stage: c.key }), label: c.label, count: c.count ?? c.rows.length, active: c.key === phoneKey }))} />
              <BoardColumn col={phoneCol} hideTitle />
            </div>
            <div className="hidden gap-3 xl:grid" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
              {cols.map((c) => (
                <BoardColumn key={c.key} col={c} />
              ))}
            </div>
          </>
        )}
      </div>
    );
  }
  const phoneStage: OrderStage = STAGE_FLOW.includes(sp.stage as OrderStage) ? (sp.stage as OrderStage) : (columns.find((c) => c.stage !== "done" && c.rows.length)?.stage ?? "confirmed");
  const phone = columns.find((c) => c.stage === phoneStage)!;

  return (
    <div>
      <PageHeader
        title="Orders"
        description="Every order moves Confirmed → In production → Shipped → Done. Each card says what it needs now."
        actions={<ExportLink what="orders" query={{ mine: mine ? "1" : undefined, view: cancelled ? "cancelled" : undefined }} />}
      />
      <Filters mine={mine} cancelled={cancelled} keep={keep} />

      {cancelled ? (
        cancelledRows.length === 0 ? (
          <EmptyState title="No cancelled orders" description="Orders the customer called off are kept here." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {cancelledRows.map((o) => (
              <OrderCard key={o.id} o={o} />
            ))}
          </div>
        )
      ) : openRows.length + doneCount === 0 ? (
        <EmptyState title={mine ? "No orders of yours yet" : "No orders yet"} description="An order appears when a customer accepts a quotation." />
      ) : (
        <>
          {/* Phones and small tablets: one stage at a time. */}
          <div className="lg:hidden">
            <LinkTabs
              label="Stage"
              className="mb-4"
              tabs={columns.map((c) => ({ href: buildHref("/orders", keep, { stage: c.stage }), label: ORDER_STAGE_LABEL[c.stage], count: c.count ?? c.rows.length, active: c.stage === phoneStage }))}
            />
            <Column stage={phone.stage} rows={phone.rows} note={phone.note} hideTitle />
          </div>
          {/* Wide screens: the board. */}
          <div className="hidden gap-4 lg:grid lg:grid-cols-4">
            {columns.map((c) => (
              <Column key={c.stage} stage={c.stage} rows={c.rows} note={c.note} count={c.count} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Filters({ mine, cancelled, keep }: { mine: boolean; cancelled: boolean; keep: { mine?: string; view?: string } }) {
  return (
    <FilterBar className="mb-5 rounded-xl border bg-surface">
      <FilterChip href={buildHref("/orders", { view: keep.view }, {})} active={!mine}>
        All
      </FilterChip>
      <FilterChip href={buildHref("/orders", { view: keep.view }, { mine: "1" })} active={mine}>
        Mine
      </FilterChip>
      <span className="mx-1 h-5 w-px bg-line" aria-hidden />
      <FilterChip href={buildHref("/orders", { mine: keep.mine }, cancelled ? {} : { view: "cancelled" })} active={cancelled}>
        Cancelled
      </FilterChip>
    </FilterBar>
  );
}

type BoardRow = OrderRow & { flow?: string };
interface BoardCol {
  key: string;
  label: string;
  rows: BoardRow[];
  count?: number;
  note?: string;
}

function BoardColumn({ col, hideTitle }: { col: BoardCol; hideTitle?: boolean }) {
  return (
    <section aria-label={col.label} className="flex min-w-0 flex-col gap-3">
      {!hideTitle && (
        <h2 className="flex items-center justify-between gap-2 text-sm font-semibold">
          <span className="truncate">{col.label}</span> <span className="text-xs font-normal text-muted">{col.count ?? col.rows.length}</span>
        </h2>
      )}
      {col.rows.map((o) => (
        <OrderCard key={o.id} o={o} />
      ))}
      {col.rows.length === 0 && <p className="rounded-lg border border-dashed border-line p-3 text-xs text-muted">Nothing here</p>}
      {col.note && <p className="text-xs text-muted">{col.note}</p>}
    </section>
  );
}

function Column({ stage, rows, note, count, hideTitle }: { stage: OrderStage; rows: OrderRow[]; note?: string; count?: number; hideTitle?: boolean }) {
  return (
    <section aria-label={ORDER_STAGE_LABEL[stage]} className="flex min-w-0 flex-col gap-3">
      {!hideTitle && (
        <h2 className="flex items-center justify-between text-sm font-semibold">
          {stage === "done" ? "Done (recent)" : ORDER_STAGE_LABEL[stage]} <span className="text-xs font-normal text-muted">{count ?? rows.length}</span>
        </h2>
      )}
      {rows.map((o) => (
        <OrderCard key={o.id} o={o} />
      ))}
      {rows.length === 0 && <p className="rounded-lg border border-dashed border-line p-3 text-xs text-muted">Nothing here</p>}
      {note && <p className="text-xs text-muted">{note}</p>}
    </section>
  );
}

function OrderCard({ o }: { o: BoardRow }) {
  const late = o.needs?.late;
  return (
    <Link href={`/orders/${o.id}`} className="block min-w-0">
      <Card className={cn("p-3 transition-colors hover:border-line-strong", late && "border-bad/40")}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold whitespace-nowrap">{o.refNo}</span>
          {o.status === "cancelled" ? <span className="text-xs text-muted">Cancelled</span> : o.flow === undefined && <OrderStageBadge stage={o.stage} />}
        </div>
        <p className="mt-0.5 truncate text-sm">{o.customer.name}</p>
        <p className="truncate text-xs text-muted">{o.inquiry.title}</p>
        {o.flow && <p className="mt-1 text-xs font-medium text-primary">{o.flow}</p>}
        <div className="mt-2 flex items-baseline justify-between gap-2 text-xs">
          <span className="font-medium tabular">{money(o.total, o.currency)}</span>
          {Number(o.due) > 0 && o.status !== "cancelled" ? <span className="text-muted tabular">{money(o.due, o.currency)} due</span> : o.status !== "cancelled" && <span className="text-ok">Paid</span>}
        </div>
        {o.needs && (
          <div className={cn("mt-2 rounded-md px-2 py-1.5 text-xs", late ? "bg-bad-soft text-bad" : "bg-surface-2 text-text-2")}>
            <span className="font-medium">{o.needs.title}</span>
            <span className="block">
              {late && <AlertTriangle className="mr-1 inline size-3" aria-hidden />}
              {late ? `Late — was due ${date(o.needs.due)}` : `By ${date(o.needs.due)}`}
            </span>
          </div>
        )}
        {o.inquiry.assignee && <p className="mt-2 text-xs text-muted">{o.inquiry.assignee.name}</p>}
      </Card>
    </Link>
  );
}
