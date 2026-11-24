import Link from "next/link";
import { Board as BoardColumns } from "@/components/lists/board";
import { Factory, FileText, LayoutGrid, List as ListIcon, Package, PieChart, Ship } from "lucide-react";
import { ORDER_STAGE_LABEL, ORDER_STAGE_TONE, ORDER_WORD_TONE, orderWordColumn, STAGE_FLOW, UNKNOWN_COUNTRY, type FlowStep, type OrderStage } from "@kebo/shared";
import { ButtonLink, Card, DataRow, EmptyState, LinkTabs, PageHeader, Pager, PhoneList, PhoneRow, RefCode, Segmented, StatRow, StatTile, StatusBadge, THead, Td, Th, buildHref, cn, toPage, toPageSize, Stack } from "@kebo/ui";
import { ExportCsv } from "@/components/sheets/export-link";
import { api } from "@/lib/api";
import { DataTable } from "@/components/common/data-table";
import { RowMenu, type MenuEntry } from "@/components/common/more-menu";
import { optional } from "@/components/print/data";
import { crumbsFor } from "@/lib/nav";
import { date, money, short, countOf } from "@/lib/format";
import { FilterCard } from "@/components/common/filter-card";
import { getPeople, getSettings } from "@/lib/loaders";
import type { Paged } from "@/lib/types";
import type { OrderRow } from "@/lib/types-orders";

/** Orders is one page with two views: the list and the board. The same switch on both (one item in the menu). */
function ViewSwitch({ view, mine }: { view: "list" | "board"; mine: boolean }) {
  const q = mine ? "?mine=1" : "";
  return (
    <Segmented
      label="View"
      options={[
        {
          href: `/orders${q}`,
          active: view === "list",
          label: (
            <span className="inline-flex items-center gap-1.5">
              <ListIcon className="size-4" aria-hidden /> List
            </span>
          ),
        },
        {
          href: `/orders/board${q}`,
          active: view === "board",
          label: (
            <span className="inline-flex items-center gap-1.5">
              <LayoutGrid className="size-4" aria-hidden /> Board
            </span>
          ),
        },
      ]}
    />
  );
}

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
  // The one word worked out from what is stored (orderWord): the same as on the order's own page.
  return <StatusBadge meaning={ORDER_WORD_TONE[o.word]}>{o.word}</StatusBadge>;
}

export async function List({ sp, mine }: { sp: Params; mine: boolean }) {
  const status: Status = STATUSES.includes(sp.status as Status) ? (sp.status as Status) : sp.view === "cancelled" ? "cancelled" : "open";
  const stage = (["confirmed", "in_production", "shipped"] as const).find((x) => x === sp.stage);
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
      pageSize: toPageSize(sp.size),
    }),
    optional(() => api.get<{ currency: string; rows: { total: string; overdue: string }[] }>("/insights/facts/owed", { side: "receivable" })),
    optional(() => api.get<{ currency: string; rows: { sales: string; profitExpected: string | null; margin: number | null }[] }>("/insights/facts/orders/groups", { from: `${year}-01-01`, to: `${year}-12-31`, period: "all" })),
    optional(() => api.get<{ status: string; eta: string | null; arrivedOn: string | null }[]>("/operations/shipments", {})),
    // Every customer with an order (the first 100 left most of them out of the filter: review 24 Nov).
    api.get<{ id: string; name: string }[]>("/customers/names", { with: "orders" }).catch(() => null),
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
  // The counts follow the search and filters; what customers owe, the ships at sea and the year's profit are the
  // whole company's: said so while a filter is on (review 24 Nov, O-25).
  const filtered = !!(sp.q || sp.customer || sp.assignee || mine);
  const allOrders = (sub?: string) => (filtered ? [sub, "all orders"].filter(Boolean).join(" · ") : sub);
  const nextEta = atSea.map((x) => x.eta).filter((x): x is string => !!x).sort()[0];

  const chips = [
    { key: "open", label: "Open", n: c.open, href: href({ status: undefined, stage: undefined }), active: status === "open" && !stage },
    { key: "confirmed", label: "Confirmed", n: c.confirmed, href: href({ status: undefined, stage: "confirmed" }), active: stage === "confirmed" },
    { key: "in_production", label: "In production", n: c.in_production, href: href({ status: undefined, stage: "in_production" }), active: stage === "in_production" },
    { key: "shipped", label: "Shipped", n: c.shipped, href: href({ status: undefined, stage: "shipped" }), active: stage === "shipped" },
    // No "Done" tab: an open order is never Done (orderWordColumn), a finished one is Closed (review 24 Nov: always 0).
    { key: "late", label: "Late", n: c.late, href: href({ status: "late", stage: undefined }), active: status === "late" },
    { key: "closed", label: "Closed", n: c.closed ?? 0, href: href({ status: "closed", stage: undefined }), active: status === "closed" },
    { key: "cancelled", label: "Cancelled", n: c.cancelled ?? 0, href: href({ status: "cancelled", stage: undefined }), active: status === "cancelled" },
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
    <Stack>
      <PageHeader
        kind="list"
        crumbs={crumbsFor("/orders")}
        title="Sales orders"
        views={<ViewSwitch view="list" mine={mine} />}
        more={<ExportCsv what="orders" query={{ status, stage, customer: sp.customer, assignee: mine ? undefined : sp.assignee, mine: keep.mine, q: sp.q }} />}
      />

      <StatRow facts>
        <StatTile icon={Package} iconColor={1} label="Open orders" value={c.open} href={href({ status: undefined, stage: undefined })} />
        <StatTile
          icon={FileText}
          iconColor={2}
          label="Customers owe"
          value={short(owedTotal, main)}
          tone={owedLate > 0 ? "bad" : undefined}
          sub={allOrders(owedLate > 0 ? `${short(owedLate, main)} late` : "nothing late")}
          href="/money/due"
        />
        <StatTile
          icon={Factory}
          iconColor={3}
          label="In production"
          value={c.in_production}
          sub={c.lateInProduction ? `${c.lateInProduction} late` : undefined}
          href={href({ status: undefined, stage: "in_production" })}
        />
        <StatTile icon={Ship} iconColor={4} label="At sea" value={atSea.length} sub={allOrders(nextEta ? `next ETA ${date(nextEta)}` : undefined)} href={href({ status: undefined, stage: "shipped" })} />
        {yearRow && (
          <StatTile
            icon={PieChart}
            iconColor={5}
            label="Profit this year"
            value={short(yearRow.profitExpected ?? "0", facts!.currency)}
            tone="ok"
            sub={allOrders(yearRow.margin !== null ? `margin ${yearRow.margin.toFixed(1)}%` : undefined)}
          />
        )}
      </StatRow>

      <LinkTabs
        label="Which orders"
        tabs={chips.map((x) => {
          return {
            href: x.href,
            active: x.active,
            count: x.n ?? 0,
            alert: x.key === "late" && x.n > 0,
            label: x.label,
          };
        })}
      />

      <FilterCard
        count={countOf(data.total, "order")}
        search="Search SO, PO, customer, container…"
        value={sp.q}
        keep={{ status: keep.status, stage: keep.stage, mine: keep.mine }}
        clearHref={href({ q: undefined })}
        selects={[
          { name: "customer", label: "Customer", value: sp.customer, options: (customers ?? []).map((x) => ({ value: x.id, label: x.name })) },
          ...(mine ? [] : [{ name: "assignee", label: "Handles", value: sp.assignee, options: people.map((p) => ({ value: p.id, label: p.name })) }]),
        ]}
      />

      <Card className="overflow-clip">
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
                // The same search finds orders under another tab: offered first (review 24 Nov: a closed order was not
                // found from Open, and Clear filters landed on a hidden "All" view with no tab lit).
                (() => {
                  const elsewhere = (["closed", "cancelled"] as const).find((k) => status !== k && (c[k] ?? 0) > 0);
                  return elsewhere && sp.q ? (
                    <ButtonLink href={href({ status: elsewhere, stage: undefined })} size="sm">
                      Show {c[elsewhere]} under {elsewhere === "closed" ? "Closed" : "Cancelled"}
                    </ButtonLink>
                  ) : (
                    <ButtonLink href="/orders" size="sm">
                      Clear filters
                    </ButtonLink>
                  );
                })()
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
                  {/* Shown only where the page has room (roomy): the list fits beside the open menu without it. */}
                  <Th className="hidden roomy:table-cell">Purchase order</Th>
                  <Th>Date</Th>
                  <Th className="text-right">Total</Th>
                  <Th className="text-right">They owe</Th>
                  <Th>Now</Th>
                  <Th>Status</Th>
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
                    <Td className="hidden roomy:table-cell">
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
                          {/* Two lines before it is cut, so an amount is never cut in half (review 24 Nov, O-40: "USD 33,1…"). */}
                          <span className="line-clamp-2 block max-w-56 text-sm" title={o.needs.title}>
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
    </Stack>
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
    // Every customer with an order (the first 100 left most of them out of the filter: review 24 Nov).
    api.get<{ id: string; name: string }[]>("/customers/names", { with: "orders" }).catch(() => null),
    optional(() => api.get<{ items: { id: string; current: { key: FlowStep; label: string; sub: string } | null }[] }>("/order-board", { mine: q.mine })),
  ]);
  const at = new Map((flow?.items ?? []).map((i) => [i.id, i.current]));
  const cols = STAGE_FLOW.map((stage) => ({ stage, rows: stage === "done" ? recentDone : openRows.filter((r) => orderWordColumn(r.word) === stage) }));
  const valueOf = (rows: OrderRow[]) => {
    const cur = rows[0]?.currency;
    return cur && rows.every((r) => r.currency === cur) ? short(rows.reduce((t, r) => t + Number(r.total), 0), cur) : null;
  };
  // Each card's pill and line (board): where it stands now, in a word or two.
  const pill = (o: OrderRow): [string, "warn" | "info" | "bad" | "ok" | "neutral"] => {
    if (o.needs?.late) return ["Late", "bad"];
    if (o.word === "Done") return Number(o.due) > 0 ? ["To collect", "warn"] : ["Paid", "ok"];
    if (o.word === "Shipped") return ["At sea", "info"];
    if (o.word === "Arrived" || o.word === "Delivered") return [o.word, "info"];
    const cur = at.get(o.id);
    if (o.word === "Confirmed") return cur?.key === "payment" ? ["Deposit", Number(o.received) > 0 ? "warn" : "neutral"] : ["Purchase order", "warn"];
    return [cur?.label ?? "Production", "info"];
  };
  const line = (o: OrderRow) => {
    // The customer's whole name, and what is needed with its capitals kept ("collect USD 33,100", not "usd"):
    // review 24 Nov, O-33.
    const who = o.customer.name;
    const need = o.needs?.title ?? "";
    const sub = o.needs ? (o.needs.late ? `was ${date(o.needs.due)}` : `${need.charAt(0).toLowerCase()}${need.slice(1)}`) : (at.get(o.id)?.sub ?? "");
    return [who, sub.replace(/\d{4}-\d{2}-\d{2}/g, (d) => date(d))].filter(Boolean).join(" · ");
  };
  return (
    <Stack>
      <PageHeader
        kind="list"
        crumbs={crumbsFor("/orders")}
        title="Sales orders"
        views={<ViewSwitch view="board" mine={mine} />}
      />
      <FilterCard
        search="Search…"
        value={sp.q}
        keep={{ mine: mine ? "1" : undefined }}
        clearHref={mine ? "/orders/board?mine=1" : "/orders/board"}
        selects={[{ name: "customer", label: "Customer", value: sp.customer, options: (customers ?? []).map((c) => ({ value: c.id, label: c.name })) }]}
      />
      <BoardColumns
        columns={cols.map((c) => ({
          key: c.stage,
          label: c.stage === "done" ? "Done" : ORDER_STAGE_LABEL[c.stage],
          tone: ORDER_STAGE_TONE[c.stage],
          total: c.rows.length,
          rows: c.rows.slice(0, 40),
          value: valueOf(c.rows),
          empty: c.stage === "done" ? "Nothing done lately." : `No orders ${ORDER_STAGE_LABEL[c.stage].toLowerCase()}.`,
          moreHref: buildHref("/orders", {}, { stage: c.stage === "done" ? undefined : c.stage, status: c.stage === "done" ? "closed" : undefined }),
        }))}
        rowKey={(o) => o.id}
        phoneKey={cols.some((c) => c.stage === sp.stage) ? String(sp.stage) : cols[0]!.stage}
        phoneHref={(key) => buildHref("/orders/board", { mine: mine ? "1" : undefined, q: sp.q, customer: sp.customer }, { stage: key })}
        card={(o) => {
          const [word, meaning] = pill(o);
          return (
            <li>
              <Link href={`/orders/${o.id}`} className="block rounded-[10px] border border-line bg-surface px-3 py-2.5 text-md leading-[18px] transition-colors hover:border-primary-line">
                <span className="flex items-center justify-between gap-2">
                  <RefCode>{o.refNo}</RefCode>
                  <StatusBadge meaning={meaning}>{word}</StatusBadge>
                </span>
                <span className="mt-1.5 block truncate text-md font-semibold text-text">{o.inquiry.title}</span>
                <span className="block truncate text-xs text-text-2">{line(o)}</span>
              </Link>
            </li>
          );
        }}
      />
    </Stack>
  );
}
