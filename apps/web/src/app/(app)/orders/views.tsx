import Link from "next/link";
import { AlertTriangle, Check, Download, Factory, FileText, LayoutGrid, List as ListIcon, Lock, MessageSquare, Package, PieChart, Ship, X } from "lucide-react";
import { ORDER_STAGE_LABEL, ORDER_STAGE_TONE, STAGE_FLOW, UNKNOWN_COUNTRY, type FlowStep, type OrderStage } from "@kebo/shared";
import { ButtonLink, Card, DataRow, EmptyState, LinkTabs, PageHeader, Pager, PhoneList, PhoneRow, RefCode, StatRow, StatTile, StatusBadge, THead, Td, Th, buildHref, cn, toPage } from "@kebo/ui";
import { api } from "@/lib/api";
import { DataTable } from "@/components/common/data-table";
import { RowMenu, type MenuEntry } from "@/components/common/more-menu";
import { optional } from "@/components/print/data";
import { crumbsFor } from "@/lib/nav";
import { date, money, short } from "@/lib/format";
import { FilterCard } from "@/components/common/filter-card";
import { getPeople, getSettings } from "@/lib/loaders";
import type { Paged } from "@/lib/types";
import type { OrderRow } from "@/lib/types-orders";

export type Params = Record<string, string | undefined>;

/** How many finished orders the board's Done column shows. */
const RECENT_DONE = 8;

const STATUSES = ["open", "late", "closed", "cancelled", "all"] as const;
type Status = (typeof STATUSES)[number];

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
  const stage = (["confirmed", "in_production", "shipped", "done"] as const).find((x) => x === sp.stage);
  const keep = { q: sp.q, mine: mine ? "1" : undefined, status: status === "open" ? undefined : status, stage, customer: sp.customer, assignee: sp.assignee };
  const href = (patch: Params) => buildHref("/orders", keep, { page: undefined, ...patch });
  const year = new Date().getFullYear();
  const [data, owed, facts, shipments, customers, people, settings] = await Promise.all([
    api.get<Paged<OrderRow & { purchaseOrders?: string[] }> & { counts: Record<Status | OrderStage | "lateInProduction", number> }>("/orders/page", {
      status,
      stage,
      customer: sp.customer,
      assignee: mine ? undefined : sp.assignee,
      mine: mine ? "true" : undefined,
      q: sp.q,
      page: toPage(sp.page),
    }),
    optional(() => api.get<{ currency: string; rows: { total: string; overdue: string }[] }>("/insights/facts/owed", { side: "receivable" })),
    optional(() => api.get<{ currency: string; rows: { sales: string; profitExpected: string | null; margin: number | null }[] }>("/insights/facts/orders/groups", { from: `${year}-01-01`, to: `${year}-12-31`, period: "all" })),
    optional(() => api.get<{ status: string; eta: string | null; arrivedOn: string | null }[]>("/operations/shipments", {})),
    api.get<Paged<{ id: string; name: string }>>("/customers", { status: "order", pageSize: 100 }).catch(() => null),
    getPeople().catch(() => []),
    getSettings(),
  ]);
  const c = data.counts;
  const narrowed = !!(sp.q || mine || sp.customer || sp.assignee || stage);
  const main = owed?.currency ?? settings.sales.currency;
  const owedTotal = (owed?.rows ?? []).reduce((t, r) => t + Number(r.total), 0);
  const owedLate = (owed?.rows ?? []).reduce((t, r) => t + Number(r.overdue), 0);
  const yearRow = facts?.rows[0];
  const atSea = (shipments ?? []).filter((x) => x.status === "departed");
  const nextEta = atSea.map((x) => x.eta).filter((x): x is string => !!x).sort()[0];

  const chips = [
    { key: "open", label: "Open", icon: ListIcon, n: c.open, href: href({ status: undefined, stage: undefined }), active: status === "open" && !stage },
    { key: "confirmed", label: "Confirmed", icon: Check, n: c.confirmed, href: href({ status: undefined, stage: "confirmed" }), active: stage === "confirmed" },
    { key: "in_production", label: "In production", icon: Factory, n: c.in_production, href: href({ status: undefined, stage: "in_production" }), active: stage === "in_production" },
    { key: "shipped", label: "Shipped", icon: Ship, n: c.shipped, href: href({ status: undefined, stage: "shipped" }), active: stage === "shipped" },
    { key: "done", label: "Done", icon: Package, n: 0, href: href({ status: undefined, stage: "done" }), active: stage === "done" },
    { key: "late", label: "Late", icon: AlertTriangle, n: c.late, href: href({ status: "late", stage: undefined }), active: status === "late" },
    { key: "closed", label: "Closed", icon: Lock, n: 0, href: href({ status: "closed", stage: undefined }), active: status === "closed" },
    { key: "cancelled", label: "Cancelled", icon: X, n: 0, href: href({ status: "cancelled", stage: undefined }), active: status === "cancelled" },
  ].filter((x) => x.key !== "late" || c.late > 0 || status === "late");

  const rowMenu = (o: OrderRow): MenuEntry[] => [
    { label: "Open", href: `/orders/${o.id}` },
    { label: `Inquiry ${o.inquiry.refNo}`, href: `/inquiries/${o.inquiry.id}` },
    { label: "The customer", href: `/customers/${o.customer.id}` },
    { label: "Copy link", copy: `/orders/${o.id}` },
  ];

  const due = (o: OrderRow) =>
    o.status === "cancelled" ? <span className="text-text-2">—</span> : Number(o.due) > 0 ? money(o.due, o.currency) : <span className="text-text-2">—</span>;

  return (
    <div>
      <PageHeader
        crumbs={crumbsFor("/orders")}
        icon={Package}
        title="Sales orders"
        description="An order is made when a customer accepts a quotation"
        actions={
          <>
            <ButtonLink href="/orders/board">
              <LayoutGrid aria-hidden /> Board
            </ButtonLink>
            <ButtonLink href={buildHref("/sheets/export/orders", { status, mine: keep.mine, q: sp.q, format: "csv" }, {})}>
              <Download aria-hidden /> Export CSV
            </ButtonLink>
          </>
        }
      />

      <StatRow className="mb-4">
        <StatTile icon={Package} iconColor={1} label="Open orders" value={c.open} href={href({ status: undefined, stage: undefined })} />
        <StatTile
          icon={FileText}
          iconColor={2}
          label="Customers owe"
          value={short(owedTotal, main)}
          tone={owedLate > 0 ? "bad" : undefined}
          sub={owedLate > 0 ? `${short(owedLate, main)} late` : "nothing late"}
          href="/finance/receivables"
        />
        <StatTile
          icon={Factory}
          iconColor={3}
          label="In production"
          value={c.in_production}
          sub={c.lateInProduction ? `${c.lateInProduction} late` : undefined}
          href={href({ status: undefined, stage: "in_production" })}
        />
        <StatTile icon={Ship} iconColor={4} label="At sea" value={atSea.length} sub={nextEta ? `next ETA ${date(nextEta)}` : undefined} href="/operations/shipments" />
        {yearRow && (
          <StatTile
            icon={PieChart}
            iconColor={5}
            label="Profit this year"
            value={short(yearRow.profitExpected ?? "0", facts!.currency)}
            tone="ok"
            sub={yearRow.margin !== null ? `margin ${yearRow.margin.toFixed(1)}%` : undefined}
          />
        )}
      </StatRow>

      <LinkTabs
        label="Which orders"
        className="mb-4"
        tabs={chips.map((x) => {
          const Icon = x.icon;
          return {
            href: x.href,
            active: x.active,
            label: (
              <>
                <Icon aria-hidden />
                {x.label}
                {x.n ? ` ${x.n}` : ""}
              </>
            ),
          };
        })}
      />

      <FilterCard
        search="Search SO, PO, customer, container…"
        value={sp.q}
        keep={{ status: keep.status, stage: keep.stage, mine: keep.mine }}
        clearHref={href({ q: undefined })}
        selects={[
          { name: "customer", label: "Customer", value: sp.customer, options: (customers?.rows ?? []).map((x) => ({ value: x.id, label: x.name })) },
          ...(mine ? [] : [{ name: "assignee", label: "Handles", value: sp.assignee, options: people.map((p) => ({ value: p.id, label: p.name })) }]),
        ]}
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
                  <Th>What · customer</Th>
                  <Th>Purchase order</Th>
                  <Th>Date</Th>
                  <Th className="text-right">Total</Th>
                  <Th className="text-right">They owe</Th>
                  <Th>Now</Th>
                  <Th>Stage</Th>
                  <Th className="w-12">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <tbody>
                {data.rows.map((o) => (
                  <DataRow key={o.id} href={`/orders/${o.id}`} className={cn(o.status === "cancelled" && "text-text-2")}>
                    <Td>
                      <RefCode href={`/orders/${o.id}`}>{o.refNo}</RefCode>
                    </Td>
                    <Td>
                      <span className="block max-w-56 truncate font-semibold">{o.inquiry.title}</span>
                      <span className="block max-w-56 truncate text-xs text-muted">{o.customer.name}</span>
                      {o.customer.country === UNKNOWN_COUNTRY && <span className="block text-xs text-warn">Country not set</span>}
                    </Td>
                    <Td>
                      {(o as OrderRow & { purchaseOrders?: string[] }).purchaseOrders?.length ? (
                        <span className="flex flex-col items-start gap-1">
                          {(o as OrderRow & { purchaseOrders?: string[] }).purchaseOrders!.map((n) => (
                            <RefCode key={n}>{n}</RefCode>
                          ))}
                        </span>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">{date(o.orderedOn)}</Td>
                    <Td className="text-right whitespace-nowrap tabular">{money(o.total, o.currency)}</Td>
                    <Td className="text-right whitespace-nowrap tabular">{due(o)}</Td>
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
                    <Td>{statusBadge(o)}</Td>
                    <Td className="text-right">
                      <RowMenu items={rowMenu(o)} label={`Actions for ${o.refNo}`} />
                    </Td>
                  </DataRow>
                ))}
              </tbody>
            </DataTable>
          </>
        )}
      </Card>
      <Pager base="/orders" params={keep} page={data.page} pageSize={data.pageSize} total={data.total} bare />
    </div>
  );
}

/**
 * The board: Confirmed, In production, Shipped and the recently Done (or, with
 * the orders board module, a column per step after acceptance), each card with
 * what it needs now (late in red). On a phone, one column at a time.
 */
export async function Board({ sp, mine }: { sp: Params; mine: boolean }) {
  const q = { mine: mine ? "true" : undefined, q: sp.q || undefined, customer: sp.customer || undefined };
  // Done: only the latest few (a company has thousands over the years).
  const [openRows, recentDone, customers, flow] = await Promise.all([
    api.get<OrderRow[]>("/orders", { ...q, status: "open" }),
    api.get<OrderRow[]>("/orders", { ...q, status: "closed", recent: "true", limit: String(RECENT_DONE) }),
    api.get<Paged<{ id: string; name: string }>>("/customers", { status: "order", pageSize: 100 }).catch(() => null),
    optional(() => api.get<{ items: { id: string; current: { key: FlowStep; label: string; sub: string } | null }[] }>("/order-board", { mine: q.mine })),
  ]);
  const at = new Map((flow?.items ?? []).map((i) => [i.id, i.current]));
  const cols = STAGE_FLOW.map((stage) => ({ stage, rows: stage === "done" ? recentDone : openRows.filter((r) => r.stage === stage) }));
  const valueOf = (rows: OrderRow[]) => {
    const cur = rows[0]?.currency;
    return cur && rows.every((r) => r.currency === cur) ? short(rows.reduce((t, r) => t + Number(r.total), 0), cur) : null;
  };
  // Each card's pill and line (board): where it stands now, in a word or two.
  const pill = (o: OrderRow): [string, "warn" | "info" | "bad" | "ok" | "neutral"] => {
    if (o.needs?.late) return ["Late", "bad"];
    if (o.stage === "done" || o.status === "closed") return Number(o.due) > 0 ? ["To collect", "warn"] : ["Paid", "ok"];
    if (o.stage === "shipped") return ["At sea", "info"];
    const cur = at.get(o.id);
    if (o.stage === "confirmed") return cur?.key === "payment" ? ["Deposit", Number(o.received) > 0 ? "warn" : "neutral"] : ["PO", "warn"];
    return [cur?.label ?? "Production", "info"];
  };
  const line = (o: OrderRow) => {
    const who = o.customer.name.split(" ").slice(0, 2).join(" ");
    const sub = o.needs ? (o.needs.late ? `was ${date(o.needs.due)}` : o.needs.title.toLowerCase()) : (at.get(o.id)?.sub ?? "");
    return [who, sub.replace(/\d{4}-\d{2}-\d{2}/g, (d) => date(d))].filter(Boolean).join(" · ");
  };
  return (
    <div>
      <PageHeader
        crumbs={[{ label: "Overview" }, { label: "Pipelines" }]}
        icon={LayoutGrid}
        title="Order pipeline"
        description="Orders by stage. A card moves when its step is done."
        actions={
          <ButtonLink href={mine ? "/orders?mine=1" : "/orders"}>
            <ListIcon aria-hidden /> List
          </ButtonLink>
        }
      />
      <LinkTabs
        label="Pipelines"
        className="mb-4"
        tabs={[
          {
            href: "/inquiries/board",
            active: false,
            label: (
              <>
                <MessageSquare aria-hidden /> Inquiries
              </>
            ),
          },
          {
            href: "/orders/board",
            active: true,
            label: (
              <>
                <Package aria-hidden /> Orders
              </>
            ),
          },
        ]}
      />
      <FilterCard
        search="Search…"
        value={sp.q}
        keep={{ mine: mine ? "1" : undefined }}
        clearHref={mine ? "/orders/board?mine=1" : "/orders/board"}
        selects={[{ name: "customer", label: "Customer", value: sp.customer, options: (customers?.rows ?? []).map((c) => ({ value: c.id, label: c.name })) }]}
      />
      <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
        {cols.map((c) => {
          const v = valueOf(c.rows);
          return (
            <section key={c.stage} aria-label={ORDER_STAGE_LABEL[c.stage]} className="flex w-[296px] min-w-[260px] flex-none flex-col gap-2.5 rounded-2xl bg-surface-3/60 p-3 lg:w-auto lg:flex-1">
              <h2 className="flex items-baseline justify-between gap-2 px-1 text-sm">
                <span className="font-bold">
                  {c.stage === "done" ? "Done" : ORDER_STAGE_LABEL[c.stage]} <span className="font-normal text-muted">{c.rows.length}</span>
                </span>
                {v && <span className="text-xs text-muted">{v}</span>}
              </h2>
              {c.rows.slice(0, 40).map((o) => {
                const [word, meaning] = pill(o);
                return (
                  <Link key={o.id} href={`/orders/${o.id}`} className="block rounded-xl border border-line bg-surface px-3 py-2.5 transition-shadow hover:shadow-card">
                    <span className="flex items-center justify-between gap-2">
                      <RefCode>{o.refNo}</RefCode>
                      <StatusBadge meaning={meaning}>{word}</StatusBadge>
                    </span>
                    <strong className="mt-1.5 block truncate text-sm">{o.inquiry.title}</strong>
                    <span className="block truncate text-xs text-muted">{line(o)}</span>
                  </Link>
                );
              })}
              {c.rows.length > 40 && (
                <Link href={buildHref("/orders", {}, { stage: c.stage === "done" ? undefined : c.stage, status: c.stage === "done" ? "closed" : undefined })} className="px-1 text-xs font-semibold text-primary hover:underline">
                  {c.rows.length - 40} more in the list →
                </Link>
              )}
              {c.rows.length === 0 && <p className="rounded-xl border-2 border-dashed border-line-strong px-3 py-6 text-center text-xs text-muted">Nothing here</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
