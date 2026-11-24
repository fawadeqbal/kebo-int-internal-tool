import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonClass, Card, CardHeader, cn, StatRow, StatTile, Table, Td, Th, THead, Tr, EmptyLine, RULES } from "@kebo/ui";
import { date, plural, whole, num0 as n0 } from "@/lib/format";
import { bigMoney, change, monthShortOf, percent } from "@/lib/insights-period";
import type { HomeFigures, HomeStage, Receivables, Reminders } from "@/lib/types-insights";
import { Delta } from "@/components/insights/frame";
import { SalesProfitChart } from "@/components/insights/facts-charts";
import { readableDates } from "@/components/insights/readable-dates";
import { homeSpan, how } from "@/lib/figures";

/*
 * Home (design "money, simple", board Home). Every card answers one question and opens the page behind it.
 * The figures come from GET /insights/home; "Needs you today" is the reminders list; "Customers owe us" is
 * the same list as Finance › Receivables & payables.
 */

const MORE = "inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-primary underline-offset-2 hover:underline";
const DOT: Record<string, string> = { bad: "bg-bad", warn: "bg-warn", ok: "bg-ok", info: "bg-info" };
const short = (iso: string) => `${Number(iso.slice(8, 10))} ${monthShortOf(iso)}`;
/** "20 – 26 Nov", "27 Nov – 3 Dec". */
const weekLabel = (from: string, to: string) => (from.slice(0, 7) === to.slice(0, 7) ? `${Number(from.slice(8, 10))} – ${short(to)}` : `${short(from)} – ${short(to)}`);
/** Four columns in a third of the page: less air between them, the card's own edge kept. */
const CELL = "px-2 first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";
const signed = (v: number, c: string) => (v < 0 ? `− ${whole(-v, c)}` : whole(v, c));

function More({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={MORE}>
      {children} <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}

/** Four figures for this month, each against last month. */
export function MonthFigures({ h }: { h: HomeFigures }) {
  const c = h.currency;
  const m = h.month;
  const vs = `the same days of ${m.before}`;
  const profit = Number(m.profit.now);
  // What each figure counts, behind its ⓘ (lib/figures.ts): this month so far, against the same days of last month.
  const span = homeSpan(h.today, m.name, m.before);
  return (
    <StatRow>
      <StatTile
        label="Sold this month"
        value={bigMoney(Number(m.sold.now), c)}
        delta={<Delta value={change(Number(m.sold.now), Number(m.sold.before))} vs={vs} />}
        sub={`${plural(m.sold.orders, "order")} · against ${m.before} by this day`}
        href="/reports/profit?period=month"
        how={how.sold(span, c)}
      />
      {m.collected && (
        <StatTile
          label="Collected this month"
          value={bigMoney(Number(m.collected.now), c)}
          delta={<Delta value={change(Number(m.collected.now), Number(m.collected.before))} vs={vs} />}
          sub={plural(m.collected.payments, "payment")}
          href="/reports/cash?period=month"
          how={how.collected(span, c)}
        />
      )}
      <StatTile
        label={m.profit.afterCompanyCosts ? "Profit this month" : "Gross profit this month"}
        value={profit < 0 ? `− ${bigMoney(-profit, c)}` : bigMoney(profit, c)}
        tone={profit < 0 ? "bad" : profit > 0 ? "ok" : undefined}
        sub={`${percent(m.profit.margin)}${m.profit.marginBefore !== null ? ` · ${m.before} ${percent(m.profit.marginBefore)}` : ""}`}
        href={h.seeProfit ? "/reports/profit?period=month" : undefined}
        how={m.profit.afterCompanyCosts ? how.profit(span, c, m.before) : how.grossProfit(span, c, m.before)}
      />
      {m.cash && (
        <StatTile
          label="Cash now"
          value={bigMoney(Number(m.cash.total), c)}
          sub={m.cash.byCurrency.length ? m.cash.byCurrency.map((x) => bigMoney(Number(x.amount), x.currency)).join(" · ") : "no account yet"}
          href="/finance/cash-book"
          how={how.cashNow(c)}
        />
      )}
    </StatRow>
  );
}

/** The five most urgent things, each with its button; the rest behind one link. */
export function NeedsYou({ r }: { r: Reminders }) {
  const top = r.items.slice(0, 5);
  const rest = r.counts.total - top.length;
  return (
    <Card>
      <CardHeader
        title="Needs you today"
        actions={r.counts.total > 0 ? <span className="grid h-6 min-w-6 place-items-center rounded-md bg-warn-soft px-1.5 text-xs font-bold text-warn tabular">{r.counts.total}</span> : undefined}
      />
      {top.length === 0 ? (
        <EmptyLine inset>Nothing needs you right now.</EmptyLine>
      ) : (
        <ul className="divide-y divide-line">
          {top.map((i) => (
            <li key={i.key} className={cn(RULES.box.inset, "flex items-center gap-3 py-3")}>
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[i.level] ?? "bg-info")} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{readableDates(i.title)}</span>
                {i.detail && <span className="block truncate text-xs text-text-2">{readableDates(i.detail)}</span>}
              </span>
              <Link href={i.href} className={cn(buttonClass("secondary", "sm"), "shrink-0")}>
                {i.action}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {rest > 0 && (
        <p className={cn(RULES.box.inset, "border-t border-line py-3")}>
          <More href="/notifications">{rest} more</More>
        </p>
      )}
    </Card>
  );
}

/** Up to five sentences worked out from the numbers; none when no rule fires. */
export function StandsOut({ h }: { h: HomeFigures }) {
  return (
    <Card>
      <CardHeader title="What stands out" description="worked out from the numbers, not typed" how={how.standsOut} />
      {h.standout.length === 0 ? (
        <EmptyLine inset>Nothing unusual: sales are level, nobody is late, no cost is growing, no supplier keeps slipping.</EmptyLine>
      ) : (
        <ul className="divide-y divide-line">
          {h.standout.map((s) => (
            <li key={s.key} className={cn(RULES.box.inset, "flex items-start gap-3 py-3.5")}>
              <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[s.level])} />
              <p className="min-w-0 flex-1 text-sm">
                <strong className="font-semibold">{s.lead}</strong> {s.text}
              </p>
              <More href={s.href}>{s.link}</More>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** What should come in and go out by its date, week by week, and the cash that leaves. */
export function NextWeeks({ h }: { h: HomeFigures }) {
  if (!h.weeks) return null;
  const c = h.currency;
  const lowest = h.weeks.reduce((a, b) => (Number(b.after) < Number(a.after) ? b : a));
  const at = h.weeks.indexOf(lowest);
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Cash in the next four weeks" description={`${c} · what is due to come in and to go out`} how={how.nextWeeks(c)} />
      <Table data-fit>
        <THead>
          <tr>
            {/* The box is a third of the page: its heads wrap (two words a line) so every column shows. */}
            <Th className={cn(CELL, "whitespace-normal")}>Week</Th>
            <Th className={cn(CELL, "text-right whitespace-normal")}>Coming in</Th>
            <Th className={cn(CELL, "text-right whitespace-normal")}>Going out</Th>
            <Th className={cn(CELL, "text-right whitespace-normal")}>Cash after</Th>
          </tr>
        </THead>
        <tbody>
          {h.weeks.map((w) => (
            <Tr key={w.from}>
              <Td className={cn(CELL, "font-semibold whitespace-nowrap")}>{weekLabel(w.from, w.to)}</Td>
              <Td className={cn(CELL, "text-right whitespace-nowrap tabular", Number(w.in) > 0 && "font-semibold text-ok")}>{n0(w.in)}</Td>
              <Td className={cn(CELL, "text-right whitespace-nowrap tabular")}>{n0(w.out)}</Td>
              <Td className={cn(CELL, "text-right whitespace-nowrap tabular", Number(w.after) < 0 && "font-semibold text-bad")}>{Number(w.after) < 0 ? `− ${n0(-Number(w.after))}` : n0(w.after)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <p className={cn(RULES.box.inset, "border-t border-line py-3 text-xs text-text-2 [&_a]:text-xs")}>
        If everyone pays on their date. Lowest: <strong className={cn("font-semibold", Number(lowest.after) < 0 ? "text-bad" : "text-text")}>{signed(Number(lowest.after), c)}</strong>{" "}
        {at === 0 ? "this week" : `in the week of ${short(lowest.from)}`}. <More href="/money/due">Receivables</More>
      </p>
    </Card>
  );
}

export function SoldByMonth({ h }: { h: HomeFigures }) {
  const name = h.seeProfit ? "Profit" : "Gross profit";
  return (
    <Card>
      <CardHeader
        title={`Sold and ${name.toLowerCase()}, by month`}
        description={h.currency}
        actions={<More href="/reports">Reports</More>}
        how={how.byMonth(h.currency, h.seeProfit)}
      />
      <div className="p-4 sm:p-5">
        <SalesProfitChart rows={h.months.map((m) => ({ month: m.month, sales: Number(m.sold), profit: Number(m.profit), orders: m.orders }))} currency={h.currency} names={["Sold", name]} />
      </div>
    </Card>
  );
}

/** A stage per line: how many, what to know, what they are worth. */
function Stages({ rows, currency, href }: { rows: HomeStage[]; currency: string; href: (key: string) => string }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((s) => (
        <li key={s.key}>
          <Link href={href(s.key)} className={cn(RULES.box.inset, "flex items-center gap-3 py-3 hover:bg-surface-2/60")}>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-semibold">
                {s.label}
                <span className="grid h-5 min-w-6 place-items-center rounded-md bg-surface-2 px-1.5 text-xs font-semibold tabular">{s.count}</span>
              </span>
              <span className={cn("block truncate text-xs", s.count === 0 ? "text-muted" : s.level === "bad" ? "font-semibold text-bad" : s.level === "warn" ? "font-semibold text-warn" : "text-text-2")}>
                {s.count === 0 ? "none" : s.note}
              </span>
            </span>
            {s.value !== null && s.count > 0 && <span className="shrink-0 text-sm font-semibold tabular">{whole(s.value, currency)}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function OrdersNow({ h }: { h: HomeFigures }) {
  return (
    <Card>
      <CardHeader
        title="Orders now"
        description={`${h.orders.open} open · ${whole(h.orders.value, h.currency)}`}
        actions={<More href="/orders/board">Order board</More>}
        how={how.ordersNow(h.currency)}
      />
      {/* Each row opens the list at that column: the same count as the list's tab and the board's column. */}
      <Stages rows={h.orders.stages} currency={h.currency} href={(k) => `/orders?stage=${k}`} />
    </Card>
  );
}

export function InquiriesNow({ h }: { h: HomeFigures }) {
  const w = h.inquiries.won;
  return (
    <Card>
      <CardHeader title="Inquiries now" description={`${h.inquiries.open} open`} actions={<More href="/inquiries">Inquiries</More>} how={how.inquiriesNow} />
      <Stages rows={h.inquiries.stages} currency={h.currency} href={(k) => `/inquiries?stage=${k}`} />
      <p className={cn(RULES.box.inset, "border-t border-line py-3 text-xs text-text-2")}>
        {w.answered === 0 ? (
          "No inquiry was answered in the last three months."
        ) : (
          <>
            Won in the last three months: <strong className="font-semibold text-text">{w.won} of {w.answered}</strong> answered · {percent(w.rate)}
            {w.rateBefore !== null && `, was ${percent(w.rateBefore)}`}.
          </>
        )}
      </p>
    </Card>
  );
}

/** A short list of at most four lines, each opening its record. */
function Lines({ rows, empty }: { rows: { key: string; href: string; name: string; sub: string; value: string; tone?: "bad" | "warn" }[]; empty: string }) {
  if (rows.length === 0) return <p className={cn(RULES.box.body, "text-sm text-muted")}>{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.key}>
          <Link href={r.href} className={cn(RULES.box.inset, "flex items-center justify-between gap-3 py-3 hover:bg-surface-2/60")}>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{r.name}</span>
              <span className="block truncate text-xs text-text-2">{r.sub}</span>
            </span>
            <span className={cn("shrink-0 text-sm font-semibold tabular", r.tone === "bad" && "text-bad", r.tone === "warn" && "text-warn")}>{r.value}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Who owes us: late first (the oldest first), then by the next date. In each order's own currency. */
export function CustomersOwe({ r }: { r: Receivables }) {
  const rows = r.rows
    .filter((x) => Number(x.due) > 0)
    .sort((x, y) => y.daysLate - x.daysLate || (x.next?.dueOn ?? "9999").localeCompare(y.next?.dueOn ?? "9999"));
  const totals = r.totals.filter((t) => Number(t.due) > 0).map((t) => whole(t.due, t.currency));
  return (
    <Card>
      <CardHeader
        title="Customers owe us"
        description={totals.join(" + ") || undefined}
        actions={rows.length > 0 ? <More href="/money/due">All {rows.length}</More> : undefined}
        how={how.customersOwe}
      />
      <Lines
        empty={r.scope === "mine" ? "Nothing is owed on the orders you handle." : "No customer owes anything."}
        rows={rows.slice(0, 4).map((x) => ({
          key: x.id,
          href: `/orders/${x.id}/payment`,
          name: x.customer.name,
          sub: `${x.refNo} · ${x.daysLate > 0 ? `${plural(x.daysLate, "day")} late` : x.next?.dueOn ? `due ${date(x.next.dueOn)}` : "no date yet"}`,
          value: whole(x.due, x.currency),
          tone: x.daysLate > 0 ? ("bad" as const) : undefined,
        }))}
      />
    </Card>
  );
}

/** Open orders that make under 10% of what was sold; each opens its Costs tab. */
export function ThinProfit({ h }: { h: HomeFigures }) {
  const t = h.thin;
  if (!t) return null;
  const c = h.currency;
  return (
    <Card>
      <CardHeader title="Thin or no profit" description="open orders under 10%" actions={<More href="/reports/profit">Profit by order</More>} how={how.thinProfit} />
      <Lines
        empty="Every open order makes 10% or more."
        rows={t.rows.map((x) => ({
          key: x.orderId,
          href: `/orders/${x.orderId}/costs`,
          name: `${x.refNo} · ${x.customer}`,
          sub: Number(x.profit) < 0 ? `costs ${whole(x.costs, c)} on ${whole(x.sold, c)}` : `profit ${percent(x.margin)} of the order`,
          value: signed(Number(x.profit), c),
          tone: Number(x.profit) < 0 ? ("bad" as const) : ("warn" as const),
        }))}
      />
      {t.count > 0 && (
        <p className={cn(RULES.box.inset, "border-t border-line py-3 text-xs text-text-2")}>
          {t.count > t.rows.length && `${t.count - t.rows.length} more under 10%. `}
          {t.others > 0 ? `The other ${plural(t.others, "open order")} ${t.others === 1 ? "makes" : "make"} 10% or more.` : "No other open order has a cost yet."}
        </p>
      )}
    </Card>
  );
}
