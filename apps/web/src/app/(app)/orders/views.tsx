import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { ORDER_STAGE_LABEL, ORDER_STAGE_TONE, STAGE_FLOW, UNKNOWN_COUNTRY, type FlowStep, type OrderStage } from "@kebo/shared";
import {
  buildHref,
  ButtonLink,
  Card,
  cn,
  DataRow,
  EmptyState,
  LinkTabs,
  ListToolbar,
  OrderStageBadge,
  PageHeader,
  Pager,
  PhoneList,
  PhoneRow,
  StatusBadge,
  Td,
  Th,
  THead,
  toPage,
} from "@kebo/ui";
import { AutoSelect } from "@kebo/ui/client";
import { api } from "@/lib/api";
import { ExportLink } from "@/components/sheets/export-link";
import { DataTable } from "@/components/common/data-table";
import { RowMenu, type MenuEntry } from "@/components/common/more-menu";
import { hasFeature } from "@/lib/session";
import { optional } from "@/components/print/data";
import { crumbsFor, labelFor } from "@/lib/nav";
import { date, money, plural } from "@/lib/format";
import type { Paged } from "@/lib/types";
import type { OrderRow } from "@/lib/types-orders";

export type Params = Record<string, string | undefined>;

/** How many finished orders the board's Done column shows. */
const RECENT_DONE = 8;

const STATUSES = ["open", "late", "closed", "cancelled", "all"] as const;
type Status = (typeof STATUSES)[number];
const STATUS_CHIP: Record<Status, string> = { open: "Open", late: "Late", closed: "Done", cancelled: "Cancelled", all: "All" };

/**
 * Orders, two pages of the sidebar's Orders module. The list (design system: List frame): a chip
 * per status with its count (Open, the working list, first; Late is worked out from what each order
 * needs), "handled by", the search and Excel in one row; rows open the order, ⋯ at the end; 25 a
 * page, every filter in the URL. ?mine=1 (or the reminders' ?view=mine): my orders;
 * ?view=cancelled: the cancelled ones. The board (/orders/board, a step from the dashboard with
 * ?stage=…): a column per step, each card with what it needs now.
 */
function statusBadge(o: OrderRow) {
  if (o.status === "cancelled") return <StatusBadge meaning="neutral">Cancelled</StatusBadge>;
  return <StatusBadge meaning={ORDER_STAGE_TONE[o.stage]}>{ORDER_STAGE_LABEL[o.stage]}</StatusBadge>;
}

export async function List({ sp, mine }: { sp: Params; mine: boolean }) {
  const status: Status = STATUSES.includes(sp.status as Status) ? (sp.status as Status) : sp.view === "cancelled" ? "cancelled" : "open";
  const keep = { q: sp.q, mine: mine ? "1" : undefined, status: status === "open" ? undefined : status };
  const href = (patch: Params) => buildHref("/orders", keep, { page: undefined, ...patch });
  const data = await api.get<Paged<OrderRow> & { counts: Record<Status, number> }>("/orders/page", {
    status,
    mine: mine ? "true" : undefined,
    q: sp.q,
    page: toPage(sp.page),
  });
  const c = data.counts;
  const narrowed = !!(sp.q || mine);

  const chips = STATUSES.filter((s) => s === status || s === "open" || s === "all" || c[s] > 0).map((s) => ({
    key: s,
    label: STATUS_CHIP[s],
    count: c[s],
    href: href({ status: s === "open" ? undefined : s }),
    active: status === s,
  }));

  const rowMenu = (o: OrderRow): MenuEntry[] => [
    { label: "Open", href: `/orders/${o.id}` },
    { label: `Inquiry ${o.inquiry.refNo}`, href: `/inquiries/${o.inquiry.id}` },
    { label: "The customer", href: `/customers/${o.customer.id}` },
    { label: "Copy link", copy: `/orders/${o.id}` },
  ];

  const due = (o: OrderRow) =>
    o.status === "cancelled" ? <span className="text-text-2">—</span> : Number(o.due) > 0 ? money(o.due, o.currency) : <span className="font-medium text-ok">Paid</span>;

  return (
    <div>
      <PageHeader
        crumbs={crumbsFor("/orders")}
        title="Orders"
        summary={
          <>
            {plural(c.open, "open order")}
            {c.late > 0 && <span className="text-bad"> · {c.late} late</span>}
            <span className="max-sm:hidden"> · each says what it needs now</span>
          </>
        }
      />

      <ListToolbar
        search={{ placeholder: "Search order no., customer, inquiry…", value: sp.q, clearHref: href({ q: undefined }) }}
        keep={keep}
        chips={chips}
        label="Filter orders"
        filters={
          <form className="flex items-center gap-1.5">
            {sp.q && <input type="hidden" name="q" value={sp.q} />}
            {keep.status && <input type="hidden" name="status" value={keep.status} />}
            <AutoSelect name="mine" defaultValue={mine ? "1" : ""} aria-label="Handled by" className="w-28">
              <option value="">Anyone</option>
              <option value="1">Mine</option>
            </AutoSelect>
          </form>
        }
        end={<ExportLink what="orders" query={{ status, mine: keep.mine, q: sp.q }} />}
      />

      <Card className="overflow-clip p-0">
        {data.rows.length === 0 ? (
          c.all === 0 && !narrowed ? (
            <EmptyState
              framed
              title="No orders yet"
              description="An order appears here when a customer accepts a quotation, with what it needs next."
              action={
                <ButtonLink href="/inquiries?stage=quoted" size="sm">
                  Quoted inquiries
                </ButtonLink>
              }
            />
          ) : (
            <EmptyState
              framed
              title="No orders match these filters"
              description={sp.q ? `Nothing matches “${sp.q}” here. Try part of the order number, the customer or the inquiry.` : "Try another status, or clear the filters."}
              action={
                <ButtonLink href={c.open > 0 && !narrowed ? "/orders" : "/orders?status=all"} size="sm">
                  Clear filters
                </ButtonLink>
              }
            />
          )
        ) : (
          <>
            <PhoneList label="Orders">
              {data.rows.map((o) => (
                <PhoneRow
                  key={o.id}
                  href={`/orders/${o.id}`}
                  title={o.customer.name}
                  line={`${o.refNo} · ${o.needs ? `${o.needs.title}${o.needs.late ? " (late)" : ""}` : o.inquiry.title}`}
                  status={o.needs?.late ? <StatusBadge meaning="bad">Late</StatusBadge> : statusBadge(o)}
                  figure={due(o)}
                  muted={o.status === "cancelled"}
                />
              ))}
            </PhoneList>
            <DataTable label="Orders" className="max-sm:hidden">
              <THead>
                <tr>
                  <Th>Order</Th>
                  <Th>Customer</Th>
                  <Th>Status</Th>
                  <Th>Needs now</Th>
                  <Th className="text-right">Still due</Th>
                  <Th className="max-xl:hidden">Handled by</Th>
                  <Th className="w-12">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <tbody>
                {data.rows.map((o) => (
                  <DataRow key={o.id} href={`/orders/${o.id}`} className={cn(o.status === "cancelled" && "text-text-2")}>
                    <Td>
                      <Link href={`/orders/${o.id}`} className="font-semibold whitespace-nowrap hover:text-primary">
                        {o.refNo}
                      </Link>
                      <span className="block max-w-40 truncate text-xs text-text-2">{o.inquiry.title}</span>
                    </Td>
                    <Td>
                      <span className="block max-w-40 truncate">{o.customer.name}</span>
                      {o.customer.country === UNKNOWN_COUNTRY && <span className="block text-xs text-warn">Country not set</span>}
                    </Td>
                    <Td>{statusBadge(o)}</Td>
                    <Td>
                      {o.needs ? (
                        <>
                          <span className="block max-w-48 truncate text-sm" title={o.needs.title}>
                            {o.needs.title}
                          </span>
                          <span className={cn("block text-xs", o.needs.late ? "font-medium text-bad" : "text-text-2")}>
                            {o.needs.late ? `Was due ${date(o.needs.due)}` : `By ${date(o.needs.due)}`}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-text-2">{o.status === "open" ? "Nothing now" : "—"}</span>
                      )}
                    </Td>
                    <Td className="text-right whitespace-nowrap tabular">
                      {due(o)}
                      <span className="block text-xs text-text-2">of {money(o.total, o.currency)}</span>
                    </Td>
                    <Td className="max-xl:hidden">{o.inquiry.assignee?.name ?? <span className="text-xs text-text-2">Nobody</span>}</Td>
                    <Td className="text-right">
                      <RowMenu items={rowMenu(o)} label={`Actions for ${o.refNo}`} />
                    </Td>
                  </DataRow>
                ))}
              </tbody>
            </DataTable>
          </>
        )}
        <Pager base="/orders" params={keep} page={data.page} pageSize={data.pageSize} total={data.total} />
      </Card>
    </div>
  );
}

/**
 * The board: Confirmed, In production, Shipped and the recently Done (or, with
 * the orders board module, a column per step after acceptance), each card with
 * what it needs now (late in red). On a phone, one column at a time.
 */
export async function Board({ sp, mine }: { sp: Params; mine: boolean }) {
  const keep = { mine: mine ? "1" : undefined };
  const q = { mine: mine ? "true" : undefined };
  // Done: only the latest few and how many there are (a company has thousands over the years).
  const [openRows, recentDone, doneCount] = await Promise.all([
    api.get<OrderRow[]>("/orders", { ...q, status: "open" }),
    api.get<OrderRow[]>("/orders", { ...q, status: "closed", recent: "true", limit: String(RECENT_DONE) }),
    api.get<{ count: number }>("/orders/count", { ...q, status: "closed" }).then((r) => r.count),
  ]);
  const late = openRows.filter((o) => o.needs?.late).length;
  const header = (
    <>
      <PageHeader
        crumbs={crumbsFor("/orders/board")}
        title={labelFor("/orders/board")}
        summary={
          <>
            {plural(openRows.length, "open order")}
            {late > 0 && <span className="text-bad"> · {late} late</span>}
            <span className="max-sm:hidden"> · each card says what it needs now</span>
          </>
        }
      />
      <ListToolbar
        chips={[
          { key: "all", label: "Everyone's", href: "/orders/board", active: !mine },
          { key: "mine", label: "Mine", href: "/orders/board?mine=1", active: mine },
        ]}
        label="Whose orders"
        end={<ExportLink what="orders" query={{ mine: keep.mine }} />}
      />
    </>
  );
  const empty = (
    <Card className="p-0">
      <EmptyState
        framed
        title={mine ? "No orders of yours yet" : "No orders yet"}
        description="An order appears here when a customer accepts a quotation, with what it needs next."
        action={
          <ButtonLink href="/inquiries?stage=quoted" size="sm">
            Quoted inquiries
          </ButtonLink>
        }
      />
    </Card>
  );

  // With the orders board module, the columns are the steps after acceptance (the design's board); else the four stages.
  const flow = (await hasFeature("orders_board")) ? await optional(() => api.get<{ items: { id: string; current: { key: FlowStep; label: string; sub: string } | null }[] }>("/order-board", q)) : null;
  if (flow) {
    const at = new Map(flow.items.map((i) => [i.id, i.current]));
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
        {header}
        {openRows.length + doneCount === 0 ? (
          empty
        ) : (
          <>
            <div className="xl:hidden">
              <LinkTabs label="Step" className="mb-4" tabs={cols.map((c) => ({ href: buildHref("/orders/board", keep, { stage: c.key }), label: c.label, count: c.count ?? c.rows.length, active: c.key === phoneKey }))} />
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

  const columns: { stage: OrderStage; rows: OrderRow[]; note?: string; count?: number }[] = STAGE_FLOW.map((stage) => ({
    stage,
    rows: stage === "done" ? recentDone : openRows.filter((r) => r.stage === stage),
    note: stage === "done" && doneCount > RECENT_DONE ? `The latest ${RECENT_DONE} of ${doneCount}` : undefined,
    count: stage === "done" ? doneCount : undefined,
  }));
  const phoneStage: OrderStage = STAGE_FLOW.includes(sp.stage as OrderStage) ? (sp.stage as OrderStage) : (columns.find((c) => c.stage !== "done" && c.rows.length)?.stage ?? "confirmed");
  const phone = columns.find((c) => c.stage === phoneStage)!;
  return (
    <div>
      {header}
      {openRows.length + doneCount === 0 ? (
        empty
      ) : (
        <>
          {/* Phones and small tablets: one stage at a time. */}
          <div className="lg:hidden">
            <LinkTabs
              label="Stage"
              className="mb-4"
              tabs={columns.map((c) => ({ href: buildHref("/orders/board", keep, { stage: c.stage }), label: ORDER_STAGE_LABEL[c.stage], count: c.count ?? c.rows.length, active: c.stage === phoneStage }))}
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
