import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, CircleDot, Package, ReceiptText, Ship, Trophy, XCircle } from "lucide-react";
import { INQUIRY_STAGE_LABEL, INQUIRY_STAGE_TONE, LOST_REASON_LABEL, type LostReason } from "@kebo/shared";
import { Badge, Card, CardBody, CardHeader, cn, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { date, money } from "@/lib/format";
import type { Person } from "@/lib/types";
import type { CustomerAccount, ExpenseList, ExpenseTargets } from "@/lib/types-money";
import { expenseAction } from "@/app/(app)/money/actions";
import { NewExpense } from "./forms";
import { ExpenseRecord } from "./expense-record";

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";

export const lostReasonLabel = (r: LostReason | "not_said") => (r === "not_said" ? "No reason given" : LOST_REASON_LABEL[r]);

const EVENT_ICON = { deal: CircleDot, won: Trophy, lost: XCircle, order: Package, shipped: Ship, payment: ArrowDownLeft, expense: ArrowUpRight } as const;

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "ok" | "bad" }) {
  return (
    <div className="min-w-0 rounded-lg border border-line p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn("mt-0.5 truncate text-lg font-semibold tabular", tone === "bad" && "text-bad", tone === "ok" && "text-ok")} title={value}>
        {value}
      </p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

/**
 * The customer's account, for managers: what their orders earned, everything
 * spent to win and keep them (lost deals too), the net result, every deal with
 * what it cost, the latest expenses, and a timeline.
 */
export async function CustomerAccountCard({ customerId, customerName }: { customerId: string; customerName: string }) {
  const today = todayIn(TZ);
  const [a, list, targets, people, settings] = await Promise.all([
    api.get<CustomerAccount>(`/customers/${customerId}/account`),
    api.get<ExpenseList>("/expenses", { customerId }),
    api.get<ExpenseTargets>("/expenses/targets"),
    api.get<Person[]>("/users/people"),
    api.get<{ sales: { currency: string; exchangeRates: Record<string, number> } }>("/settings"),
  ]);
  const c = a.currency;
  const t = a.totals;
  const fx = { main: settings.sales.currency, rates: settings.sales.exchangeRates };
  const choices = {
    ...targets,
    customers: [{ id: customerId, name: customerName }],
    deals: targets.deals.filter((d) => d.customerId === customerId),
    orders: targets.orders.filter((o) => o.customerId === customerId),
    customerId,
  };
  const winning = Number(t.beforeSale) + Number(t.lostDeals) + Number(t.openDeals) + Number(t.otherCosts);
  const shown = list.rows.slice(0, 6);

  return (
    <Card>
      <CardHeader
        title="Account with this customer"
        description={`Managers only. Everything earned from them and spent on them since ${date(a.customer.since)}, in ${c}.`}
      />
      <CardBody className="flex flex-col gap-5">
        {a.missingRates.length > 0 && (
          <p className="rounded-md bg-warn-soft px-2.5 py-1.5 text-xs">
            There is no exchange rate for {a.missingRates.join(", ")} in Settings, so some amounts are left out.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Figure label="Their orders" value={money(t.sales, c)} hint={`${a.deals.won} order${a.deals.won === 1 ? "" : "s"} won`} />
          <Figure label="Profit from the orders" value={money(t.profit, c)} hint="Less goods and order costs" tone={Number(t.profit) < 0 ? "bad" : undefined} />
          <Figure label="Spent to win and keep them" value={money(winning, c)} hint="Before sales, lost deals, visits" />
          <Figure label="Net result" value={money(t.net, c)} hint={Number(t.net) < 0 ? "They have cost us so far" : "What they are worth so far"} tone={Number(t.net) < 0 ? "bad" : "ok"} />
        </div>

        <dl className="grid gap-y-1.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-text-2">Deals</dt>
            <dd className="tabular">
              {a.deals.total} · {a.deals.won} won · {a.deals.lost} lost · {a.deals.open} open
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-text-2">Win rate</dt>
            <dd className="tabular">{a.winRate === null ? "—" : `${a.winRate}%`}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-text-2">Spent on deals we lost</dt>
            <dd className={cn("tabular", Number(t.lostDeals) > 0 && "text-bad")}>{money(t.lostDeals, c)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-text-2">Selling cost for each order won</dt>
            <dd className="tabular">{t.sellingCostPerWin === null ? "—" : money(t.sellingCostPerWin, c)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-text-2">Spent on deals still open</dt>
            <dd className="tabular">{money(t.openDeals, c)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-text-2">Cash so far (in − factories − spent)</dt>
            <dd className={cn("tabular", Number(t.cash) < 0 && "text-bad")}>{money(t.cash, c)}</dd>
          </div>
        </dl>

        {a.lostReasons.length > 0 && (
          <div className="rounded-lg border border-bad/30 bg-bad-soft/40 px-3 py-2.5 text-sm">
            <p className="font-medium">Why we lost their deals</p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {a.lostReasons.map((r) => (
                <li key={r.reason} className="flex justify-between gap-3">
                  <span>
                    {lostReasonLabel(r.reason)} <span className="text-xs text-muted">· {r.deals} deal{r.deals === 1 ? "" : "s"}</span>
                  </span>
                  <span className="tabular">{money(r.spent, c)} spent</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {a.rows.length > 0 && (
          <div className="-mx-4 overflow-x-auto">
            <Table>
              <THead>
                <tr>
                  <Th>Deal</Th>
                  <Th>Result</Th>
                  <Th className="text-right">Spent on it</Th>
                  <Th className="text-right">Order profit</Th>
                  <Th className="text-right">Net</Th>
                </tr>
              </THead>
              <tbody>
                {a.rows.map((d) => (
                  <Tr key={d.id} className="hover:bg-surface-2/50">
                    <Td>
                      <Link href={`/deals/${d.id}`} className="font-medium hover:text-primary">
                        {d.refNo}
                      </Link>
                      <span className="block max-w-56 truncate text-xs text-muted">{d.title}</span>
                    </Td>
                    <Td>
                      {d.order ? (
                        <Link href={`/orders/${d.order.id}/money`} className="text-sm whitespace-nowrap hover:text-primary">
                          <Badge tone="ok">Won</Badge>
                          <span className="block text-xs text-muted">{d.order.refNo}</span>
                        </Link>
                      ) : (
                        <Badge tone={INQUIRY_STAGE_TONE[d.stage]}>{INQUIRY_STAGE_LABEL[d.stage]}</Badge>
                      )}
                      {d.lostReason && <span className="block text-xs text-muted">{lostReasonLabel(d.lostReason)}</span>}
                    </Td>
                    <Td className="text-right whitespace-nowrap tabular">{Number(d.spent) > 0 ? money(d.spent, c) : <span className="text-muted">—</span>}</Td>
                    <Td className="text-right whitespace-nowrap tabular">{d.order ? money(d.order.profit, c) : <span className="text-muted">—</span>}</Td>
                    <Td
                      className={cn(
                        "text-right font-medium whitespace-nowrap tabular",
                        (d.order ? Number(d.order.net) : -Number(d.spent)) < 0 && "text-bad",
                      )}
                    >
                      {d.order ? money(d.order.net, c) : Number(d.spent) > 0 ? money(-Number(d.spent), c) : <span className="text-muted">—</span>}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        {Number(t.uncostedRevenue) > 0 && (
          <p className="text-xs text-warn">
            {money(t.uncostedRevenue, c)} of their orders has no factory cost recorded, so the profit may be too high by that much at most.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Latest expenses</p>
          {shown.length > 0 ? (
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line" aria-label="Latest expenses">
              {shown.map((e) => (
                <ExpenseRecord key={e.id} e={e} mainCurrency={c} people={people} fx={fx} today={today} choices={choices} showFor={Boolean(e.order || e.deal)} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nothing spent on them yet.</p>
          )}
          {list.rows.length > shown.length && (
            <Link href={`/money?tab=expenses&p=${today.slice(0, 4)}&customer=${customerId}`} className="text-sm text-primary hover:underline">
              See all {list.rows.length} on the Money page
            </Link>
          )}
          <NewExpense action={expenseAction.bind(null, null, null)} people={people} mainCurrency={c} fx={fx} today={today} choices={choices} label="Add an expense for them" />
        </div>

        {a.timeline.length > 0 && (
          <details className="group rounded-lg border border-line">
            <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium select-none">Timeline · {a.timeline.length} events</summary>
            <ol className="flex flex-col border-t border-line">
              {a.timeline.map((e, i) => {
                const Icon = EVENT_ICON[e.kind];
                const body = (
                  <span className="flex items-start gap-2.5 px-3 py-2 text-sm">
                    <Icon
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        e.kind === "lost" ? "text-bad" : e.kind === "payment" || e.kind === "order" ? "text-ok" : e.kind === "expense" ? "text-warn" : "text-muted",
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      {e.text}
                      <span className="block text-xs text-muted">{date(e.on)}</span>
                    </span>
                    {e.amount && (
                      <span className={cn("shrink-0 tabular", e.kind === "expense" && "text-text-2")}>
                        {e.kind === "expense" ? "− " : e.kind === "payment" ? "+ " : ""}
                        {money(e.amount, e.currency ?? c)}
                      </span>
                    )}
                  </span>
                );
                return (
                  <li key={i} className="border-b border-line last:border-0">
                    {e.href ? (
                      <Link href={e.href} className="block hover:bg-surface-2/60">
                        {body}
                      </Link>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ol>
          </details>
        )}
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <ReceiptText className="size-3.5" aria-hidden /> Orders count at their value; costs at the rates used when paid.
        </p>
      </CardBody>
    </Card>
  );
}

/**
 * A short note on a deal from a customer who has been here before: their
 * other deals, why we lost them, what we spent, and what they are worth.
 */
export async function CustomerHistoryNote({ customerId, dealId }: { customerId: string; dealId: string }) {
  const a = await api.get<CustomerAccount>(`/customers/${customerId}/account`).catch(() => null);
  if (!a) return null;
  const others = a.rows.filter((r) => r.id !== dealId);
  if (others.length === 0 && Number(a.totals.otherCosts) === 0) return null;
  const won = others.filter((r) => r.order).length;
  const lost = others.filter((r) => !r.order && r.stage === "lost");
  const c = a.currency;
  const net = Number(a.totals.net);
  return (
    <aside
      aria-label="This customer's history"
      className={cn("mb-4 rounded-xl border px-4 py-3 text-sm", net < 0 ? "border-bad/30 bg-bad-soft/40" : "border-info/30 bg-info-soft/40")}
    >
      <p className="font-medium">
        {a.customer.name} has been here before: {others.length} other deal{others.length === 1 ? "" : "s"} · {won} won · {lost.length} lost
        {a.winRate !== null && ` · ${a.winRate}% won`}
      </p>
      <p className="mt-0.5 text-text-2">
        Spent on them so far {money(a.totals.spent, c)}
        {Number(a.totals.lostDeals) > 0 && <>, of it {money(a.totals.lostDeals, c)} on deals we lost</>}. Net result{" "}
        <span className={cn("font-medium tabular", net < 0 ? "text-bad" : "text-ok")}>{money(a.totals.net, c)}</span>.
      </p>
      {lost.length > 0 && (
        <p className="mt-0.5 text-xs text-muted">
          Lost before: {lost.map((d) => `${d.refNo} (${d.lostReason ? lostReasonLabel(d.lostReason) : "no reason"})`).join(", ")}
        </p>
      )}
      <Link href={`/customers/${customerId}`} className="mt-1 inline-block text-xs text-primary hover:underline">
        Open their account
      </Link>
    </aside>
  );
}
