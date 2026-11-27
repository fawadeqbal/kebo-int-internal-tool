// The two lists of Finance: Receivables (what customers owe us) and Payables (what we owe), each its own page.
import Link from "next/link";
import { redirect } from "next/navigation";
import { Fragment, Suspense } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { can, EXPENSE_CATEGORY_LABEL, expenseShort, SUPPLIER_DUE_RULE_LABEL } from "@kebo/shared";
import {
  buildHref,
  buttonClass,
  Card,
  cn,
  EmptyState,
  LinkTabs,
  PAGE_SIZE,
  Pager,
  PhoneList,
  PhoneRow,
  StatRow,
  StatTile,
  Table,
  Td,
  Th,
  THead,
  toPage,
  Tr,
  linkClass,
  Dash,
} from "@kebo/ui";
import { addDays, daysBetween } from "@kebo/utils";
import { api } from "@/lib/api";
import { date, money, num2 as n2 } from "@/lib/format";

import { getPeople, getSettings } from "@/lib/loaders";
import { orderMoneyOf, orderOf, orderPaymentsOf } from "@/lib/order-data";
import { hasFeature, type Me } from "@/lib/session";
import type { Receivables } from "@/lib/types-insights";
import type { OpenBills, ToPayList } from "@/lib/types-money";
import { optional } from "@/components/print/data";
import { FilterCard } from "@/components/common/filter-card";
import { PayCostWindow, RepayWindow } from "@/components/order-sections/costs-windows";
import { PaySupplierInList, PlanInList } from "@/components/money/due-windows";
import { supplierPaymentAction, sendRequestAction } from "../actions";
import { paymentAction, submitPaymentAction } from "../../orders/actions";
import { moneyTile } from "@/lib/money-tile";

const HERE = "/money/due";
/** Payables: its own page since 22 Nov 2026 (it was a side of this one). */
export const PAYABLES = "/money/payables";
const PAGE = PAGE_SIZE;
export type Search = { side?: string; show?: string; q?: string; who?: string; page?: string; open?: string; do?: string; pay?: string };

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

const add = (m: Map<string, number>, currency: string, v: string | number) => m.set(currency, (m.get(currency) ?? 0) + Number(v));

/* ---------------------------------------------------------------- customers owe us */

type Order = Receivables["rows"][number];
const CUSTOMER_CHIPS = [
  { key: "all", label: "All open" },
  // Money late, not work late: the orders list's "Late" counts orders behind on their next step (review 24 Nov,
  // O-47: "Late 76" here and "Late 63" there).
  { key: "late", label: "Payment late" },
  { key: "week", label: "Due this week" },
] as const;
type CustomerChip = (typeof CUSTOMER_CHIPS)[number]["key"];

export async function CustomersOwe({ sp, me, today }: { sp: Search; me: Me; today: string }) {
  const main = (await getSettings()).sales.currency;
  const r = await api.get<Receivables>("/money/receivables");
  const week = addDays(today, 7);
  const soon = (o: Order) => o.daysLate === 0 && !!o.next?.dueOn && o.next.dueOn >= today && o.next.dueOn <= week;
  const inChip = (o: Order, c: CustomerChip) => (c === "late" ? o.daysLate > 0 : c === "week" ? soon(o) : true);
  const chip: CustomerChip = CUSTOMER_CHIPS.some((c) => c.key === sp.show) ? (sp.show as CustomerChip) : "all";
  const q = sp.q?.trim().toLowerCase() ?? "";
  const people = [...new Map(r.rows.flatMap((o) => (o.handledBy ? [[o.handledBy.id, o.handledBy.name] as const] : []))).entries()].sort(
    (a, b) => a[1].localeCompare(b[1]),
  );
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
      <StatRow facts>
        <StatTile label="Customers owe us" {...moneyTile(owed, main)} sub={`${r.rows.length} order${r.rows.length === 1 ? "" : "s"}`} />
        <StatTile
          label="Payment late"
          {...moneyTile(late, main)}
          sub={
            lateRows.length
              ? `${lateRows.length} order${lateRows.length === 1 ? "" : "s"} · oldest ${days(Math.max(...lateRows.map((o) => o.daysLate)))}`
              : "nothing late"
          }
          tone={lateRows.length ? "bad" : undefined}
          href={lateRows.length ? href({ show: "late", page: undefined, open: undefined }) : undefined}
          how="Orders with a part of their payment plan past its date and not paid. The orders list's Late counts orders whose next step is past its date, money or goods, so the two can differ."
        />
        <StatTile
          label="Due in the next 7 days"
          {...moneyTile(dueSoon, main)}
          sub={`${soonRows.length} order${soonRows.length === 1 ? "" : "s"}`}
          tone={soonRows.length ? "warn" : undefined}
          href={soonRows.length ? href({ show: "week", page: undefined, open: undefined }) : undefined}
        />
        {held.size > 0 && <StatTile label="Held for customers" {...moneyTile(held, main)} sub="their credit, to use or pay back" />}
      </StatRow>
      <LinkTabs
        label="Which orders"
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
        selects={
          people.length > 1
            ? [
                {
                  name: "who",
                  label: "Whose orders",
                  value: sp.who,
                  options: people.map(([id, name]) => ({ value: id, label: name })),
                  all: "Everyone’s orders",
                },
              ]
            : []
        }
      />
      <Card className="overflow-clip">
        {shown.length === 0 ? (
          <EmptyState
            framed
            title={r.rows.length ? "No order matches" : "Nothing to receive"}
            description={r.rows.length ? "Clear the search or choose All open." : r.scope === "mine" ? "Nothing is owed on the orders you handle." : "Every customer has paid what they owe."}
          />
        ) : (
          <div>
            {/* A phone: the shared two-line rows; a tap opens the order's parts under it (the same as the laptop's ›). */}
            <PhoneList label="Orders customers still owe on">
              {shown.map((o) => {
                const open = sp.open === o.id;
                return (
                  <PhoneRow
                    key={o.id}
                    href={href({ open: open ? undefined : o.id, do: undefined })}
                    prefetch={false}
                    title={o.customer.name}
                    figure={money(o.due, o.currency)}
                    line={[o.refNo, o.handledBy?.name, o.closed ? "closed" : null].filter(Boolean).join(" · ")}
                    status={
                      <span className={o.daysLate > 0 ? "font-semibold text-bad" : soon(o) ? "font-medium text-warn" : "text-text-2"}>
                        {o.daysLate > 0
                          ? `${days(o.daysLate)} late`
                          : o.next?.dueOn
                            ? `due ${date(o.next.dueOn)}`
                            : (o.next?.when ?? "No date yet")}
                      </span>
                    }
                    flash={open}
                    extra={
                      open ? (
                        // The order's parts on a card of their own under the row, its rows edge to edge in it.
                        <div className="mx-3 mb-3 overflow-hidden rounded-xl border border-line bg-surface pb-3 [&>div>a]:mx-4">
                          <Suspense fallback={<p className="px-4 py-3 text-sm text-text-2">Opening the parts…</p>}>
                            <OrderParts id={o.id} me={me} today={today} back={here} auto={sp.do === "pay" ? "pay" : undefined} />
                          </Suspense>
                        </div>
                      ) : undefined
                    }
                  />
                );
              })}
            </PhoneList>
            <div className="max-sm:hidden">
              <Table>
                <THead>
                  <tr>
                    <Th className="w-8">
                      <span className="sr-only">Open</span>
                    </Th>
                    <Th>Customer · order</Th>
                    {/* A phone keeps the customer (with when it is due under it) and what is still due; the rest is in
                      the parts, a tap away. */}
                    <Th className="text-right max-sm:hidden">Order total</Th>
                    <Th className="text-right max-sm:hidden">Received</Th>
                    <Th className="text-right">Still due</Th>
                    <Th className="max-sm:hidden">Next part</Th>
                    <Th className="max-sm:hidden">Due</Th>
                    <Th className="max-sm:hidden">
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
                        <Tr id={`o-${o.id}`} href={toggle} stay className={open ? "bg-primary-soft/40" : undefined}>
                          <Td className="pr-0">
                            <Link
                              href={toggle}
                              scroll={false}
                              aria-expanded={open}
                              aria-label={`${open ? "Close" : "Open"} the parts of ${o.refNo}`}
                              className="flex size-7 items-center justify-center rounded-md text-text-2 hover:bg-surface-2 hover:text-text"
                            >
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
                            <span className={cn("block text-xs sm:hidden", o.daysLate > 0 ? "font-semibold text-bad" : "text-text-2")}>
                              {o.daysLate > 0
                                ? `${days(o.daysLate)} late`
                                : o.next?.dueOn
                                  ? `due ${date(o.next.dueOn)}`
                                  : (o.next?.when ?? "No date yet")}
                            </span>
                          </Td>
                          <Td className="text-right whitespace-nowrap tabular max-sm:hidden">{n2(o.total)}</Td>
                          <Td className="text-right whitespace-nowrap tabular max-sm:hidden">{n2(o.received)}</Td>
                          <Td className="text-right font-semibold whitespace-nowrap tabular">
                            {n2(o.due)}
                            <span className="block text-xs font-normal text-text-2">{o.currency}</span>
                          </Td>
                          <Td className="text-sm max-sm:hidden">
                            {o.next ? `${o.next.label}${Number(o.next.open) !== Number(o.due) ? ` · ${n2(o.next.open)}` : ""}` : <Dash />}
                          </Td>
                          <Td
                            className={cn(
                              "text-sm max-sm:hidden",
                              o.daysLate > 0 ? "font-semibold text-bad" : soon(o) ? "font-medium text-warn" : "text-text",
                            )}
                          >
                            {o.daysLate > 0
                              ? `${days(o.daysLate)} late`
                              : o.next?.dueOn
                                ? `${date(o.next.dueOn)}${o.next.dueOn >= today ? ` · in ${days(daysBetween(today, o.next.dueOn))}` : ""}`
                                : (o.next?.when ?? "No date yet")}
                          </Td>
                          <Td className="text-right max-sm:hidden">
                            {(can(me, "payments.record") || can(me, "money.submit")) && !open && (
                              <Link href={href({ open: o.id, do: "pay" })} scroll={false} className={buttonClass("secondary", "sm")}>
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
          </div>
        )}
      </Card>
      <Pager base={HERE} params={{ ...keep, page: undefined }} page={page} pageSize={PAGE} total={rows.length} bare />
    </>
  );
}

/** The parts of one order's plan, inside the list: the same table as on the order's Payment tab. */
async function OrderParts({ id, me, today, back, auto }: { id: string; me: Me; today: string; back: string; auto?: "pay" }) {
  const [o, m, p, settings] = await Promise.all([orderOf(id), orderMoneyOf(id), orderPaymentsOf(id), getSettings()]);
  const c = o.currency;
  // Someone who records money records it; Staff send it for a manager to verify (the same window).
  const records = can(me, "payments.record");
  const pay =
    (records || can(me, "money.submit")) && o.status !== "cancelled" && Number(p.due) > 0
      ? {
          action: (records ? paymentAction : submitPaymentAction).bind(null, o.id, c),
          customer: o.customer.name,
          refNo: o.refNo,
          due: p.due,
          depositDue: p.depositDue,
          fx: { main: settings.sales.currency, rates: settings.sales.exchangeRates },
          today,
          verify: !records,
        }
      : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="pb-1">
        <PlanInList
          orderId={o.id}
          plan={m.plan}
          currency={c}
          total={m.total}
          received={m.received}
          due={m.due}
          send={sendRequestAction.bind(null, o.id)}
          pay={pay}
          back={back}
          auto={auto}
        />
      </div>
      <Link href={`/orders/${o.id}/payment`} className={cn(linkClass, "w-fit text-md")}>
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
  { key: "factories", label: "Suppliers" },
  { key: "bills", label: "Freight and other bills" },
  { key: "repay", label: "To repay our people" },
] as const;
type OweChip = (typeof OWE_CHIPS)[number]["key"];

export async function WeOwe({ sp, me, today }: { sp: Search; me: Me; today: string }) {
  const main = (await getSettings()).sales.currency;
  const seesBills = can(me, "expenses.manage") && (await hasFeature("expenses"));
  const [parts, bills] = await Promise.all([
    api.get<ToPayList>("/billing/to-pay"),
    seesBills ? optional(() => api.get<OpenBills>("/money/bills")) : null,
  ]);
  const week = addDays(today, 7);
  const all: Owed[] = [
    ...parts.rows.map((r): Owed => ({
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
      dueWords:
        r.late > 0
          ? `${days(r.late)} late`
          : r.dueOn
            ? `${date(r.dueOn)} · ${SUPPLIER_DUE_RULE_LABEL[r.dueRule].toLowerCase()}`
            : SUPPLIER_DUE_RULE_LABEL[r.dueRule],
      part: r,
    })),
    ...(bills?.rows ?? []).map((b): Owed => ({
      key: `b:${b.id}`,
      kind: b.kind,
      who: b.kind === "repay" ? `${b.owedTo ?? "Someone"} · own money` : (b.owedTo ?? "Not said"),
      what: expenseShort(b.category) === b.description ? b.description : (EXPENSE_CATEGORY_LABEL[b.category] ?? b.category),
      detail:
        [expenseShort(b.category) === b.description ? null : b.description, b.reference ? `bill ${b.reference}` : null]
          .filter(Boolean)
          .join(" · ") || null,
      order: b.order,
      currency: b.currency,
      amount: b.amount,
      paid: "0.00",
      open: b.amount,
      dueOn: null,
      late: 0,
      dueWords: b.kind === "repay" ? "Repay when you can" : `Since ${date(b.on)}${b.days > 0 ? ` · ${days(b.days)}` : ""}`,
      bill: b,
    })),
  ].sort((a, b) => b.late - a.late || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || (b.bill?.days ?? 0) - (a.bill?.days ?? 0));
  const soon = (r: Owed) => r.late === 0 && !!r.dueOn && r.dueOn >= today && r.dueOn <= week;
  const inChip = (r: Owed, c: OweChip) =>
    c === "late"
      ? r.late > 0
      : c === "week"
        ? soon(r)
        : c === "factories"
          ? r.kind === "factory"
          : c === "bills"
            ? r.kind === "bill"
            : c === "repay"
              ? r.kind === "repay"
              : true;
  const chip: OweChip = OWE_CHIPS.some((c) => c.key === sp.show) ? (sp.show as OweChip) : "all";
  const q = sp.q?.trim().toLowerCase() ?? "";
  const rows = all
    .filter((r) => inChip(r, chip))
    .filter((r) => !q || `${r.who} ${r.what} ${r.detail ?? ""} ${r.order?.refNo ?? ""}`.toLowerCase().includes(q));
  const page = toPage(sp.page);
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const keep = { show: chip === "all" ? undefined : chip, q: sp.q, page: page > 1 ? String(page) : undefined };
  const href = (change: Record<string, string | undefined>) => buildHref(PAYABLES, keep, change);

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
  // The figures count everything we owe, not only what a search finds: said so while one is on (review 24 Nov, O-25).
  const whole = (sub: string) => (q ? `${sub} · whole list` : sub);

  /** Pay on a row (the laptop's last column, under the row on a phone). */
  const payOf = (r: Owed) =>
    r.part ? (
      !parts.canPay ? (
        <Link href={`/orders/${r.part.order.id}/factory`} className={cn(linkClass, "text-md")}>
          Open
        </Link>
      ) : sp.pay === r.key ? (
        <Suspense fallback={<span className="text-sm text-text-2">Opening…</span>}>
          <PayPart part={r.part} today={today} />
        </Suspense>
      ) : (
        <Link href={href({ pay: r.key })} scroll={false} className={buttonClass("secondary", "sm")}>
          Pay
        </Link>
      )
    ) : r.bill && r.kind === "bill" ? (
      <PayCostWindow
        orderId={r.order?.id ?? null}
        id={r.bill.id}
        currency={r.currency}
        sub={[r.who, r.what, money(r.amount, r.currency)].join(" · ")}
        today={today}
        from={r.bill.on}
        canFiles={false}
      />
    ) : r.bill ? (
      <RepayWindow
        orderId={r.order?.id ?? null}
        ids={[r.bill.id]}
        currency={r.currency}
        name={r.bill.owedTo ?? "them"}
        amount={money(r.amount, r.currency)}
        today={today}
        canFiles={false}
      />
    ) : null;

  return (
    <>
      <StatRow facts>
        <StatTile label="We owe" {...moneyTile(owe, main)} sub={whole(`${all.length} to pay`)} />
        <StatTile
          label="Late"
          {...moneyTile(late, main)}
          sub={whole(lateCount ? `${lateCount} to pay` : "nothing late")}
          tone={lateCount ? "bad" : undefined}
          href={lateCount ? href({ show: "late", page: undefined }) : undefined}
        />
        <StatTile
          label="Due in the next 7 days"
          {...moneyTile(dueSoon, main)}
          sub={whole(`${soonCount} to pay`)}
          tone={soonCount ? "warn" : undefined}
          href={soonCount ? href({ show: "week", page: undefined }) : undefined}
        />
      </StatRow>
      <LinkTabs
        label="Which ones"
        tabs={OWE_CHIPS.filter((c) => seesBills || (c.key !== "bills" && c.key !== "repay")).map((c) => ({
          href: href({ show: c.key === "all" ? undefined : c.key, page: undefined, pay: undefined }),
          label: c.label,
          count: all.filter((r) => inChip(r, c.key)).length || undefined,
          alert: c.key === "late",
          active: chip === c.key,
        }))}
      />
      <FilterCard
        search="Search supplier or order…"
        value={sp.q}
        keep={{ show: keep.show }}
        clearHref={href({ q: undefined, page: undefined })}
      />
      <Card className="overflow-clip">
        {shown.length === 0 ? (
          <EmptyState
            framed
            title={all.length ? "Nothing matches" : "Nothing to pay"}
            description={all.length ? "Clear the search or choose All open." : "Every supplier and every bill is paid."}
          />
        ) : (
          <div>
            {/* A phone: the shared two-line rows, Pay under the row. */}
            <PhoneList label="What we owe">
              {shown.map((r) => (
                <PhoneRow
                  key={r.key}
                  href={r.order ? `/orders/${r.order.id}/${r.kind === "factory" ? "factory" : "costs"}` : undefined}
                  title={r.who}
                  figure={money(r.open, r.currency)}
                  line={[r.what, r.order?.refNo ?? "Company"].join(" · ")}
                  status={
                    <span className={r.late > 0 ? "font-semibold text-bad" : soon(r) ? "font-medium text-warn" : "text-text-2"}>
                      {r.dueWords}
                    </span>
                  }
                  extra={<div className="flex justify-end px-4 pb-3 empty:hidden">{payOf(r)}</div>}
                />
              ))}
            </PhoneList>
            <div className="max-sm:hidden">
              <Table>
                <THead>
                  <tr>
                    <Th>Payable to</Th>
                    <Th className="max-sm:hidden">What for</Th>
                    <Th className="max-sm:hidden">Order</Th>
                    <Th className="text-right max-sm:hidden">Amount</Th>
                    <Th className="text-right max-sm:hidden">Paid</Th>
                    <Th className="text-right">Still to pay</Th>
                    <Th className="max-sm:hidden">Due</Th>
                    <Th>
                      <span className="sr-only">Pay</span>
                    </Th>
                  </tr>
                </THead>
                <tbody>
                  {shown.map((r) => (
                    <Tr
                      key={r.key}
                      id={r.key}
                      href={r.order ? `/orders/${r.order.id}/${r.kind === "factory" ? "factory" : "costs"}` : undefined}
                    >
                      <Td className="font-semibold">
                        {r.who}
                        {/* A phone: what for, the order and when, under the name (their columns are a laptop's). */}
                        <span className="block text-xs font-normal text-text-2 sm:hidden">
                          {[r.what, r.order?.refNo ?? "Company"].join(" · ")}
                        </span>
                        <span className={cn("block text-xs font-normal sm:hidden", r.late > 0 ? "font-semibold text-bad" : "text-text-2")}>
                          {r.dueWords}
                        </span>
                      </Td>
                      <Td className="max-sm:hidden">
                        {r.what}
                        {r.detail && <span className="block text-xs text-text-2">{r.detail}</span>}
                      </Td>
                      <Td className="max-sm:hidden">
                        {r.order ? (
                          <Link href={`/orders/${r.order.id}/${r.kind === "factory" ? "factory" : "costs"}`} className={linkClass}>
                            {r.order.refNo}
                          </Link>
                        ) : (
                          <span className="text-text-2">Company</span>
                        )}
                      </Td>
                      <Td className="text-right whitespace-nowrap tabular max-sm:hidden">{money(r.amount, r.currency)}</Td>
                      <Td className="text-right whitespace-nowrap tabular max-sm:hidden">{n2(r.paid)}</Td>
                      <Td className="text-right font-semibold whitespace-nowrap tabular">{money(r.open, r.currency)}</Td>
                      <Td
                        className={cn(
                          "text-sm max-sm:hidden",
                          r.late > 0 ? "font-semibold text-bad" : soon(r) ? "font-medium text-warn" : r.dueOn ? "text-text" : "text-text-2",
                        )}
                      >
                        {r.dueWords}
                      </Td>
                      <Td className="text-right">{payOf(r)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>
        )}
      </Card>
      <Pager base={PAYABLES} params={{ ...keep, page: undefined }} page={page} pageSize={PAGE} total={rows.length} bare />
    </>
  );
}

/** "Pay" on a supplier's part: the order's own Pay the supplier window, with the part filled in, open at once. */
async function PayPart({ part, today }: { part: ToPayList["rows"][number]; today: string }) {
  const [m, people, settings] = await Promise.all([orderMoneyOf(part.order.id), optional(getPeople), getSettings()]);
  const owing = m.factories?.rows.filter((r) => Number(r.toPay) > 0) ?? [];
  if (!m.factories?.canRecord || !owing.length) return null;
  return (
    <PaySupplierInList
      label="Pay"
      sub={`${part.order.refNo} · ${part.supplier.name}`}
      action={supplierPaymentAction.bind(null, part.order.id, null, null)}
      factories={owing}
      people={people ?? []}
      orderCurrency={m.currency}
      fx={{ main: settings.sales.currency, rates: settings.sales.exchangeRates }}
      today={today}
      prefill={{ supplierId: part.supplier.id, amount: part.open, kind: part.part }}
    />
  );
}
