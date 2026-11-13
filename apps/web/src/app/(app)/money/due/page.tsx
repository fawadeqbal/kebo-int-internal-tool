import Link from "next/link";
import { redirect } from "next/navigation";
import { Fragment, Suspense } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { can, EXPENSE_CATEGORY_LABEL, expenseShort, FACTORY_DUE_RULE_LABEL } from "@kebo/shared";
import { buildHref, buttonClass, Card, cn, EmptyState, LinkTabs, PageHeader, Pager, Segmented, StatRow, StatTile, Table, Td, Th, THead, toPage, Tr } from "@kebo/ui";
import { addDays, daysBetween, todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { date, money, TZ, whole } from "@/lib/format";
import { crumbsFor } from "@/lib/nav";
import { getPeople, getSettings } from "@/lib/loaders";
import { orderMoneyOf, orderOf, orderPaymentsOf } from "@/lib/order-data";
import { hasFeature, requireUser, type Me } from "@/lib/session";
import type { Receivables } from "@/lib/types-insights";
import type { OpenBills, ToPayList } from "@/lib/types-money";
import { optional } from "@/components/print/data";
import { FilterCard } from "@/components/common/filter-card";
import { PayCostWindow, RepayWindow } from "@/components/order-sections/costs-windows";
import { PayFactoryInList, PlanInList } from "@/components/money/due-windows";
import { factoryPaymentAction, sendRequestAction } from "../actions";
import { paymentAction } from "../../orders/actions";

export const metadata = { title: "To receive and to pay" };

const HERE = "/money/due";
const PAGE = 20;
type Search = { side?: string; show?: string; q?: string; who?: string; page?: string; open?: string; do?: string; pay?: string };

const n2 = (v: string | number) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
const SMALL = "h-8 px-2.5 text-[13px]";

/** Amounts in several currencies as one tile value: the largest, and how many more there are. */
function top(sums: Map<string, number>) {
  const list = [...sums].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const first = list[0];
  return first ? `${whole(first[1], first[0])}${list.length > 1 ? ` +${list.length - 1}` : ""}` : "—";
}
const add = (m: Map<string, number>, currency: string, v: string | number) => m.set(currency, (m.get(currency) ?? 0) + Number(v));

/**
 * Money › To receive and to pay (design "money, simple", boards MRecv and MPayb): what customers owe us,
 * one row per order, and what we owe suppliers and on bills, one row per part or bill. The work is done
 * on the row: an order opens to its parts with Send request and Record payment; a part or a bill is
 * paid in a window. It replaces Payment requests, Invoices, To receive and the two To pay lists.
 */
export default async function DuePage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const seesSuppliers = can(me, "sourcing.manage");
  const suppliers = seesSuppliers && sp.side === "suppliers";
  const today = todayIn(TZ);
  return (
    <div>
      <PageHeader crumbs={crumbsFor(HERE)} title="To receive and to pay" summary="What customers owe us and what we owe" />
      {seesSuppliers && (
        <Segmented
          label="Which side"
          className="mb-4"
          options={[
            { href: HERE, label: "Customers owe us", active: !suppliers },
            { href: `${HERE}?side=suppliers`, label: "We owe suppliers and bills", active: suppliers },
          ]}
        />
      )}
      {suppliers ? <WeOwe sp={sp} me={me} today={today} /> : <CustomersOwe sp={sp} me={me} today={today} />}
    </div>
  );
}

/* ---------------------------------------------------------------- customers owe us */

type Order = Receivables["rows"][number];
const CUSTOMER_CHIPS = [
  { key: "all", label: "All open" },
  { key: "late", label: "Late" },
  { key: "week", label: "Due this week" },
] as const;
type CustomerChip = (typeof CUSTOMER_CHIPS)[number]["key"];

async function CustomersOwe({ sp, me, today }: { sp: Search; me: Me; today: string }) {
  const r = await api.get<Receivables>("/money/receivables");
  const week = addDays(today, 7);
  const soon = (o: Order) => o.daysLate === 0 && !!o.next?.dueOn && o.next.dueOn >= today && o.next.dueOn <= week;
  const inChip = (o: Order, c: CustomerChip) => (c === "late" ? o.daysLate > 0 : c === "week" ? soon(o) : true);
  const chip: CustomerChip = CUSTOMER_CHIPS.some((c) => c.key === sp.show) ? (sp.show as CustomerChip) : "all";
  const q = sp.q?.trim().toLowerCase() ?? "";
  const people = [...new Map(r.rows.flatMap((o) => (o.handledBy ? [[o.handledBy.id, o.handledBy.name] as const] : []))).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const rows = r.rows
    .filter((o) => inChip(o, chip))
    .filter((o) => !sp.who || o.handledBy?.id === sp.who)
    .filter((o) => !q || `${o.refNo} ${o.customer.name}`.toLowerCase().includes(q));
  const page = toPage(sp.page);
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const keep = { show: chip === "all" ? undefined : chip, q: sp.q, who: sp.who, page: page > 1 ? String(page) : undefined };
  const href = (change: Record<string, string | undefined>) => buildHref(HERE, keep, change);
  const here = href({ open: sp.open });

  const owed = new Map<string, number>();
  const late = new Map<string, number>();
  const dueSoon = new Map<string, number>();
  for (const o of r.rows) {
    add(owed, o.currency, o.due);
    if (Number(o.overdue) > 0) add(late, o.currency, o.overdue);
    if (soon(o) && o.next) add(dueSoon, o.currency, o.next.open);
  }
  const lateRows = r.rows.filter((o) => o.daysLate > 0);
  const soonRows = r.rows.filter(soon);
  const held = new Map((r.held ?? []).map((h) => [h.currency, Number(h.amount)]));

  return (
    <>
      <StatRow className="mb-4">
        <StatTile label="Customers owe us" value={top(owed)} sub={`${r.rows.length} order${r.rows.length === 1 ? "" : "s"}`} />
        <StatTile
          label="Late"
          value={top(late)}
          sub={lateRows.length ? `${lateRows.length} order${lateRows.length === 1 ? "" : "s"} · oldest ${days(Math.max(...lateRows.map((o) => o.daysLate)))}` : "nothing late"}
          tone={lateRows.length ? "bad" : undefined}
          href={lateRows.length ? href({ show: "late", page: undefined, open: undefined }) : undefined}
        />
        <StatTile
          label="Due in the next 7 days"
          value={top(dueSoon)}
          sub={`${soonRows.length} order${soonRows.length === 1 ? "" : "s"}`}
          tone={soonRows.length ? "warn" : undefined}
          href={soonRows.length ? href({ show: "week", page: undefined, open: undefined }) : undefined}
        />
        {held.size > 0 && <StatTile label="Held for customers" value={top(held)} sub="their credit, to use or pay back" />}
      </StatRow>
      <LinkTabs
        label="Which orders"
        className="mb-4"
        tabs={CUSTOMER_CHIPS.map((c) => ({
          href: href({ show: c.key === "all" ? undefined : c.key, page: undefined, open: undefined }),
          label: c.label,
          count: r.rows.filter((o) => inChip(o, c.key)).length || undefined,
          alert: c.key === "late",
          active: chip === c.key,
        }))}
      />
      <FilterCard
        search="Search customer or order…"
        value={sp.q}
        keep={{ show: keep.show }}
        clearHref={href({ q: undefined, page: undefined })}
        selects={people.length > 1 ? [{ name: "who", label: "Whose orders", value: sp.who, options: people.map(([id, name]) => ({ value: id, label: name })), all: "Everyone’s orders" }] : []}
      />
      <Card className="overflow-clip p-0">
        {shown.length === 0 ? (
          <EmptyState framed title={r.rows.length ? "No order matches" : "Nothing to receive"} description={r.rows.length ? "Clear the search or choose All open." : "Every customer has paid what they owe."} />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[860px]">
              <THead>
                <tr>
                  <Th className="w-8">
                    <span className="sr-only">Open</span>
                  </Th>
                  <Th>Customer · order</Th>
                  <Th className="text-right">Order total</Th>
                  <Th className="text-right">Received</Th>
                  <Th className="text-right">Still due</Th>
                  <Th>Next part</Th>
                  <Th>Due</Th>
                  <Th>
                    <span className="sr-only">What to do</span>
                  </Th>
                </tr>
              </THead>
              <tbody>
                {shown.map((o) => {
                  const open = sp.open === o.id;
                  const toggle = href({ open: open ? undefined : o.id, do: undefined });
                  return (
                    <Fragment key={o.id}>
                      <Tr id={`o-${o.id}`} className={open ? "bg-primary-soft/40" : undefined}>
                        <Td className="pr-0">
                          <Link href={toggle} scroll={false} aria-expanded={open} aria-label={`${open ? "Close" : "Open"} the parts of ${o.refNo}`} className="flex size-7 items-center justify-center rounded-md text-text-2 hover:bg-surface-2 hover:text-text">
                            {open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
                          </Link>
                        </Td>
                        <Td>
                          <Link href={toggle} scroll={false} className="font-semibold hover:text-primary">
                            {o.customer.name}
                          </Link>
                          <span className="block text-xs text-text-2">
                            {o.refNo}
                            {o.handledBy ? ` · ${o.handledBy.name}` : ""}
                            {o.closed ? " · closed" : ""}
                          </span>
                        </Td>
                        <Td className="text-right whitespace-nowrap tabular">{n2(o.total)}</Td>
                        <Td className="text-right whitespace-nowrap tabular">{n2(o.received)}</Td>
                        <Td className="text-right font-semibold whitespace-nowrap tabular">
                          {n2(o.due)}
                          <span className="block text-xs font-normal text-text-2">{o.currency}</span>
                        </Td>
                        <Td className="text-sm">{o.next ? `${o.next.label}${Number(o.next.open) !== Number(o.due) ? ` · ${n2(o.next.open)}` : ""}` : <span className="text-muted">—</span>}</Td>
                        <Td className={cn("text-sm", o.daysLate > 0 ? "font-semibold text-bad" : soon(o) ? "font-medium text-warn" : "text-text")}>
                          {o.daysLate > 0 ? `${days(o.daysLate)} late` : o.next?.dueOn ? `${date(o.next.dueOn)}${o.next.dueOn >= today ? ` · in ${days(daysBetween(today, o.next.dueOn))}` : ""}` : (o.next?.when ?? "No date yet")}
                        </Td>
                        <Td className="text-right">
                          {can(me, "payments.record") && !open && (
                            <Link href={href({ open: o.id, do: "pay" })} scroll={false} className={buttonClass("secondary", "sm", SMALL)}>
                              Record payment
                            </Link>
                          )}
                        </Td>
                      </Tr>
                      {open && (
                        <tr className="bg-primary-soft/20">
                          <td colSpan={8} className="border-b border-line px-3.5 pt-1 pb-4 sm:pl-12">
                            <Suspense fallback={<p className="py-3 text-sm text-text-2">Opening the parts…</p>}>
                              <OrderParts id={o.id} me={me} today={today} back={here} auto={sp.do === "pay" ? "pay" : undefined} />
                            </Suspense>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
        <Pager base={HERE} params={{ ...keep, page: undefined }} page={page} pageSize={PAGE} total={rows.length} />
      </Card>
    </>
  );
}

/** The parts of one order's plan, inside the list: the same table as on the order's Payment tab. */
async function OrderParts({ id, me, today, back, auto }: { id: string; me: Me; today: string; back: string; auto?: "pay" }) {
  const [o, m, p, settings] = await Promise.all([orderOf(id), orderMoneyOf(id), orderPaymentsOf(id), getSettings()]);
  const c = o.currency;
  const pay =
    can(me, "payments.record") && o.status !== "cancelled" && Number(p.due) > 0
      ? { action: paymentAction.bind(null, o.id, c), customer: o.customer.name, refNo: o.refNo, due: p.due, depositDue: p.depositDue, fx: { main: settings.sales.currency, rates: settings.sales.exchangeRates }, today }
      : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-lg border border-line bg-surface pt-1 pb-3">
        <PlanInList orderId={o.id} plan={m.plan} currency={c} total={m.total} received={m.received} due={m.due} send={sendRequestAction.bind(null, o.id)} pay={pay} back={back} auto={auto} />
      </div>
      <Link href={`/orders/${o.id}/payment`} className="w-fit text-[13px] font-medium text-primary hover:underline">
        Open the order →
      </Link>
    </div>
  );
}

/* ---------------------------------------------------------------- we owe suppliers and bills */

interface Owed {
  key: string;
  kind: "factory" | "bill" | "repay";
  who: string;
  what: string;
  detail: string | null;
  order: { id: string; refNo: string } | null;
  currency: string;
  amount: string;
  paid: string;
  open: string;
  dueOn: string | null;
  /** Days past its due date (a bill has none). */
  late: number;
  dueWords: string;
  part?: ToPayList["rows"][number];
  bill?: OpenBills["rows"][number];
}
const OWE_CHIPS = [
  { key: "all", label: "All open" },
  { key: "late", label: "Late" },
  { key: "week", label: "Due this week" },
  { key: "factories", label: "Factories" },
  { key: "bills", label: "Freight and other bills" },
  { key: "repay", label: "To repay our people" },
] as const;
type OweChip = (typeof OWE_CHIPS)[number]["key"];

async function WeOwe({ sp, me, today }: { sp: Search; me: Me; today: string }) {
  const seesBills = can(me, "expenses.manage") && (await hasFeature("expenses"));
  const [parts, bills] = await Promise.all([api.get<ToPayList>("/billing/to-pay"), seesBills ? optional(() => api.get<OpenBills>("/money/bills")) : null]);
  const week = addDays(today, 7);
  const all: Owed[] = [
    ...parts.rows.map(
      (r): Owed => ({
        key: `f:${r.key}`,
        kind: "factory",
        who: r.supplier.name,
        what: `Goods · ${r.label.toLowerCase()}`,
        detail: r.supplierRef ? `their invoice ${r.supplierRef}` : null,
        order: r.order,
        currency: r.currency,
        amount: r.amount,
        paid: r.paid,
        open: r.open,
        dueOn: r.dueOn,
        late: r.late,
        dueWords: r.late > 0 ? `${days(r.late)} late` : r.dueOn ? `${date(r.dueOn)} · ${FACTORY_DUE_RULE_LABEL[r.dueRule].toLowerCase()}` : FACTORY_DUE_RULE_LABEL[r.dueRule],
        part: r,
      }),
    ),
    ...(bills?.rows ?? []).map(
      (b): Owed => ({
        key: `b:${b.id}`,
        kind: b.kind,
        who: b.kind === "repay" ? `${b.owedTo ?? "Someone"} · own money` : (b.owedTo ?? "Not said"),
        what: expenseShort(b.category) === b.description ? b.description : (EXPENSE_CATEGORY_LABEL[b.category] ?? b.category),
        detail: [expenseShort(b.category) === b.description ? null : b.description, b.reference ? `bill ${b.reference}` : null].filter(Boolean).join(" · ") || null,
        order: b.order,
        currency: b.currency,
        amount: b.amount,
        paid: "0.00",
        open: b.amount,
        dueOn: null,
        late: 0,
        dueWords: b.kind === "repay" ? "Repay when you can" : `Since ${date(b.on)}${b.days > 0 ? ` · ${days(b.days)}` : ""}`,
        bill: b,
      }),
    ),
  ].sort((a, b) => b.late - a.late || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || (b.bill?.days ?? 0) - (a.bill?.days ?? 0));
  const soon = (r: Owed) => r.late === 0 && !!r.dueOn && r.dueOn >= today && r.dueOn <= week;
  const inChip = (r: Owed, c: OweChip) => (c === "late" ? r.late > 0 : c === "week" ? soon(r) : c === "factories" ? r.kind === "factory" : c === "bills" ? r.kind === "bill" : c === "repay" ? r.kind === "repay" : true);
  const chip: OweChip = OWE_CHIPS.some((c) => c.key === sp.show) ? (sp.show as OweChip) : "all";
  const q = sp.q?.trim().toLowerCase() ?? "";
  const rows = all.filter((r) => inChip(r, chip)).filter((r) => !q || `${r.who} ${r.what} ${r.detail ?? ""} ${r.order?.refNo ?? ""}`.toLowerCase().includes(q));
  const page = toPage(sp.page);
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const keep = { side: "suppliers", show: chip === "all" ? undefined : chip, q: sp.q, page: page > 1 ? String(page) : undefined };
  const href = (change: Record<string, string | undefined>) => buildHref(HERE, keep, change);

  const owe = new Map<string, number>();
  const late = new Map<string, number>();
  const dueSoon = new Map<string, number>();
  for (const r of all) {
    add(owe, r.currency, r.open);
    if (r.late > 0) add(late, r.currency, r.open);
    if (soon(r)) add(dueSoon, r.currency, r.open);
  }
  // A window asked for on a part that is paid by now (or gone): the address goes back to the plain list.
  if (sp.pay && !all.some((r) => r.key === sp.pay)) redirect(href({ pay: undefined }));
  const lateCount = all.filter((r) => r.late > 0).length;
  const soonCount = all.filter(soon).length;

  return (
    <>
      <StatRow className="mb-4">
        <StatTile label="We owe" value={top(owe)} sub={`${all.length} to pay`} />
        <StatTile label="Late" value={top(late)} sub={lateCount ? `${lateCount} to pay` : "nothing late"} tone={lateCount ? "bad" : undefined} href={lateCount ? href({ show: "late", page: undefined }) : undefined} />
        <StatTile label="Due in the next 7 days" value={top(dueSoon)} sub={`${soonCount} to pay`} tone={soonCount ? "warn" : undefined} href={soonCount ? href({ show: "week", page: undefined }) : undefined} />
      </StatRow>
      <LinkTabs
        label="Which ones"
        className="mb-4"
        tabs={OWE_CHIPS.filter((c) => seesBills || (c.key !== "bills" && c.key !== "repay")).map((c) => ({
          href: href({ show: c.key === "all" ? undefined : c.key, page: undefined, pay: undefined }),
          label: c.label,
          count: all.filter((r) => inChip(r, c.key)).length || undefined,
          alert: c.key === "late",
          active: chip === c.key,
        }))}
      />
      <FilterCard search="Search supplier or order…" value={sp.q} keep={{ side: "suppliers", show: keep.show }} clearHref={href({ q: undefined, page: undefined })} />
      <Card className="overflow-clip p-0">
        {shown.length === 0 ? (
          <EmptyState framed title={all.length ? "Nothing matches" : "Nothing to pay"} description={all.length ? "Clear the search or choose All open." : "Every supplier and every bill is paid."} />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[860px]">
              <THead>
                <tr>
                  <Th>Who we owe</Th>
                  <Th>What for</Th>
                  <Th>Order</Th>
                  <Th className="text-right">Amount</Th>
                  <Th className="text-right">Paid</Th>
                  <Th className="text-right">Still to pay</Th>
                  <Th>Due</Th>
                  <Th>
                    <span className="sr-only">Pay</span>
                  </Th>
                </tr>
              </THead>
              <tbody>
                {shown.map((r) => (
                  <Tr key={r.key} id={r.key}>
                    <Td className="font-semibold">{r.who}</Td>
                    <Td>
                      {r.what}
                      {r.detail && <span className="block text-xs text-text-2">{r.detail}</span>}
                    </Td>
                    <Td>
                      {r.order ? (
                        <Link href={`/orders/${r.order.id}/${r.kind === "factory" ? "factory" : "costs"}`} className="font-medium text-primary hover:underline">
                          {r.order.refNo}
                        </Link>
                      ) : (
                        <span className="text-text-2">Company</span>
                      )}
                    </Td>
                    <Td className="text-right whitespace-nowrap tabular">{money(r.amount, r.currency)}</Td>
                    <Td className="text-right whitespace-nowrap tabular">{n2(r.paid)}</Td>
                    <Td className="text-right font-semibold whitespace-nowrap tabular">{money(r.open, r.currency)}</Td>
                    <Td className={cn("text-sm", r.late > 0 ? "font-semibold text-bad" : soon(r) ? "font-medium text-warn" : r.dueOn ? "text-text" : "text-text-2")}>{r.dueWords}</Td>
                    <Td className="text-right">
                      {r.part ? (
                        !parts.canPay ? (
                          <Link href={`/orders/${r.part.order.id}/factory`} className="text-[13px] font-medium text-primary hover:underline">
                            Open
                          </Link>
                        ) : sp.pay === r.key ? (
                          <Suspense fallback={<span className="text-sm text-text-2">Opening…</span>}>
                            <PayPart part={r.part} today={today} />
                          </Suspense>
                        ) : (
                          <Link href={href({ pay: r.key })} scroll={false} className={buttonClass("secondary", "sm", SMALL)}>
                            Pay
                          </Link>
                        )
                      ) : r.bill && r.kind === "bill" ? (
                        <PayCostWindow orderId={r.order?.id ?? null} id={r.bill.id} currency={r.currency} sub={[r.who, r.what, money(r.amount, r.currency)].join(" · ")} today={today} from={r.bill.on} canFiles={false} />
                      ) : r.bill ? (
                        <RepayWindow orderId={r.order?.id ?? null} ids={[r.bill.id]} currency={r.currency} name={r.bill.owedTo ?? "them"} amount={money(r.amount, r.currency)} today={today} canFiles={false} />
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        <Pager base={HERE} params={{ ...keep, page: undefined }} page={page} pageSize={PAGE} total={rows.length} />
      </Card>
    </>
  );
}

/** "Pay" on a factory's part: the order's own Pay the factory window, with the part filled in, open at once. */
async function PayPart({ part, today }: { part: ToPayList["rows"][number]; today: string }) {
  const [m, people, settings] = await Promise.all([orderMoneyOf(part.order.id), optional(getPeople), getSettings()]);
  const owing = m.factories?.rows.filter((r) => Number(r.toPay) > 0) ?? [];
  if (!m.factories?.canRecord || !owing.length) return null;
  return (
    <PayFactoryInList
      label="Pay"
      sub={`${part.order.refNo} · ${part.supplier.name}`}
      action={factoryPaymentAction.bind(null, part.order.id, null)}
      factories={owing}
      people={people ?? []}
      orderCurrency={m.currency}
      fx={{ main: settings.sales.currency, rates: settings.sales.exchangeRates }}
      today={today}
      prefill={{ factoryId: part.supplier.id, amount: part.open, kind: part.part }}
    />
  );
}
