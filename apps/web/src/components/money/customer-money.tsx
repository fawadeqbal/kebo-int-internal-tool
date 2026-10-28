import Link from "next/link";
import { INQUIRY_STAGE_LABEL, INQUIRY_STAGE_TONE } from "@kebo/shared";
import { Badge, cn } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import type { Person } from "@/lib/types";
import type { CustomerAccount, CustomerPayments, ExpenseList, ExpenseTargets } from "@/lib/types-money";
import { expenseAction } from "@/app/(app)/money/actions";
import { ViewSwitch } from "@/components/common/view-switch";
import { NewExpense } from "./forms";
import { ExpenseRecord } from "./expense-record";
import { CustomerPaymentsBody } from "./customer-payments";
import { lostReasonLabel } from "./customer-account";

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";

export type CustomerMoneyView = "payments" | "profit";

/**
 * A customer's money in one tab, as on an order: Payments (everyone who sees
 * their orders) and Profit (managers), one at a time, with a switch. Payments
 * are recorded on each order; expenses for the customer are added here.
 */
export async function CustomerMoney({
  customerId,
  customerName,
  view,
  managers,
}: {
  customerId: string;
  customerName: string;
  view: CustomerMoneyView;
  managers: boolean;
}) {
  const shown: CustomerMoneyView = managers ? view : "payments";
  const [pay, a] = await Promise.all([
    api.get<CustomerPayments>("/payments", { customerId }),
    managers ? api.get<CustomerAccount>(`/customers/${customerId}/account`) : Promise.resolve(null),
  ]);
  const base = `/customers/${customerId}?tab=money`;
  const one = pay.totals.length === 1 ? pay.totals[0]! : null;
  const due = one ? Number(one.due) > 0.005 : false;
  const net = a ? Number(a.totals.net) : 0;

  const profit = shown === "profit" && a ? await profitData(customerId, customerName) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {managers ? (
          <ViewSwitch
            label="Money"
            current={shown}
            views={[
              {
                key: "payments",
                label: "Payments",
                href: base,
                hint: one ? (due ? `${money(one.due, one.currency)} due` : "paid") : undefined,
                tone: due ? "text-warn" : "text-ok",
              },
              {
                key: "profit",
                label: "Profit",
                href: `${base}&view=profit`,
                hint: a ? `${net >= 0 ? "+ " : ""}${money(a.totals.net, a.currency)}` : undefined,
                tone: net < 0 ? "text-bad" : "text-ok",
              },
            ]}
          />
        ) : (
          <h2 className="text-base font-semibold">Payments</h2>
        )}
        {shown === "payments" ? (
          <span className="text-xs text-muted">Payments are recorded on each order.</span>
        ) : (
          profit && (
            <div className="has-[form]:basis-full">
              <NewExpense
                action={expenseAction.bind(null, null, null)}
                people={profit.people}
                mainCurrency={a!.currency}
                fx={profit.fx}
                today={profit.today}
                choices={profit.choices}
                label="Add an expense for them"
              />
            </div>
          )
        )}
      </div>
      {shown === "payments" ? <CustomerPaymentsBody d={pay} /> : a && profit && <ProfitBody a={a} {...profit} customerId={customerId} />}
    </div>
  );
}

async function profitData(customerId: string, customerName: string) {
  const today = todayIn(TZ);
  const [list, targets, people, settings] = await Promise.all([
    api.get<ExpenseList>("/expenses", { customerId }),
    api.get<ExpenseTargets>("/expenses/targets"),
    api.get<Person[]>("/users/people"),
    api.get<{ sales: { currency: string; exchangeRates: Record<string, number> } }>("/settings"),
  ]);
  return {
    today,
    list,
    people,
    fx: { main: settings.sales.currency, rates: settings.sales.exchangeRates },
    choices: {
      ...targets,
      customers: [{ id: customerId, name: customerName }],
      deals: targets.deals.filter((d) => d.customerId === customerId),
      orders: targets.orders.filter((o) => o.customerId === customerId),
      customerId,
    },
  };
}

const th = "px-3 py-2 font-medium whitespace-nowrap";
const td = "px-3 py-2.5 align-top";
const SHOWN = 10;

/**
 * What the customer is worth: earned from their orders, minus what was spent
 * on them, equals the net result; then deal by deal (with what was not tied
 * to a deal) adding up to it, and the expenses.
 */
function ProfitBody({
  a,
  list,
  people,
  fx,
  today,
  choices,
  customerId,
}: Awaited<ReturnType<typeof profitData>> & { a: CustomerAccount; customerId: string }) {
  const c = a.currency;
  const t = a.totals;
  const spent = Number(t.beforeSale) + Number(t.lostDeals) + Number(t.openDeals) + Number(t.otherCosts);
  const net = Number(t.net);
  const shown = list.rows.slice(0, SHOWN);
  const orders = a.rows.filter((r) => r.order).length;
  const signed = (v: number) => (v < 0 ? `− ${money(-v, c)}` : money(v, c));

  return (
    <div className="flex flex-col gap-5">
      {a.missingRates.length > 0 && (
        <p className="rounded-md bg-warn-soft px-2.5 py-1.5 text-xs">
          There is no exchange rate for {a.missingRates.join(", ")} in Settings, so some amounts are left out.
        </p>
      )}
      <section aria-label="What they are worth" className="grid gap-3 sm:grid-cols-3">
        <div className="min-w-0 rounded-xl border border-line bg-surface p-4">
          <p className="text-xs text-muted">Earned from their orders</p>
          <p className={cn("truncate text-xl font-bold tabular", Number(t.profit) < 0 && "text-bad")}>{money(t.profit, c)}</p>
          <p className="text-xs text-text-2">
            profit on {orders} order{orders === 1 ? "" : "s"} worth {money(t.sales, c)}
          </p>
        </div>
        <div className="min-w-0 rounded-xl border border-line bg-surface p-4">
          <p className="text-xs text-muted">Spent on them</p>
          <p className="truncate text-xl font-bold tabular">{spent > 0 ? `− ${money(spent, c)}` : money(0, c)}</p>
          <p className="text-xs text-text-2">trips, meals, inquiries we lost</p>
        </div>
        <div
          className={cn(
            "min-w-0 rounded-xl border p-4",
            net < 0 ? "border-bad/30 bg-bad-soft text-bad" : "border-ok/30 bg-ok-soft text-ok",
          )}
        >
          <p className="text-xs font-semibold">Net result</p>
          <p className="truncate text-xl font-bold tabular">
            {net > 0 ? "+ " : ""}
            {money(t.net, c)}
          </p>
          <p className="text-xs">{net < 0 ? "they have cost us so far" : "what they are worth so far"}</p>
        </div>
      </section>

      <p className="text-sm text-text-2">
        {a.deals.total} {a.deals.total === 1 ? "inquiry" : "inquiries"} · {a.deals.won} won · {a.deals.lost} lost · {a.deals.open} open
        {a.winRate !== null && (
          <>
            {" "}
            · <span className="font-semibold text-text">{a.winRate}% won</span>
          </>
        )}
        {t.sellingCostPerWin !== null && <> · selling cost per order won {money(t.sellingCostPerWin, c)}</>}
      </p>

      <section aria-label="Inquiry by inquiry" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Inquiry by inquiry</h2>
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <table data-fit="" className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-surface-2 text-left text-xs text-text-2">
                <th scope="col" className={th}>
                  Inquiry
                </th>
                <th scope="col" className={cn(th, "hidden sm:table-cell")}>
                  Result
                </th>
                <th scope="col" className={cn(th, "hidden text-right md:table-cell")}>
                  Order value
                </th>
                <th scope="col" className={cn(th, "hidden text-right sm:table-cell")}>
                  Order profit
                </th>
                <th scope="col" className={cn(th, "hidden text-right sm:table-cell")}>
                  Spent on it
                </th>
                <th scope="col" className={cn(th, "text-right")}>
                  Net
                </th>
              </tr>
            </thead>
            <tbody>
              {a.rows.map((d) => {
                // Spent on a won deal before the sale (what was spent on the order is inside its profit); on any other deal, all of it.
                const away = d.order ? Number(d.beforeSale) : Number(d.spent);
                const rowNet = d.order ? Number(d.order.net) : -away;
                const result = d.order ? (
                  <Link href={`/orders/${d.order.id}`} className="whitespace-nowrap hover:text-primary">
                    <Badge tone="ok">Won · {d.order.refNo}</Badge>
                  </Link>
                ) : (
                  <>
                    <Badge tone={INQUIRY_STAGE_TONE[d.stage]}>{INQUIRY_STAGE_LABEL[d.stage]}</Badge>
                    {d.lostReason && <span className="block text-xs text-muted">{lostReasonLabel(d.lostReason)}</span>}
                  </>
                );
                return (
                  <tr key={d.id} className="border-t border-line">
                    <td className={td}>
                      <Link href={`/inquiries/${d.id}`} className="font-medium hover:text-primary">
                        {d.refNo}
                      </Link>
                      <span className="block max-w-72 truncate text-xs text-muted">{d.title}</span>
                      <span className="mt-1 block sm:hidden">{result}</span>
                    </td>
                    <td className={cn(td, "hidden sm:table-cell")}>{result}</td>
                    <td className={cn(td, "hidden text-right whitespace-nowrap tabular md:table-cell")}>
                      {d.order ? money(d.order.revenue, c) : <span className="text-muted">—</span>}
                    </td>
                    <td className={cn(td, "hidden text-right whitespace-nowrap tabular sm:table-cell")}>
                      {d.order ? money(d.order.profit, c) : <span className="text-muted">—</span>}
                    </td>
                    <td
                      className={cn(
                        td,
                        "hidden text-right whitespace-nowrap tabular sm:table-cell",
                        away > 0 && !d.order && d.stage === "lost" && "text-bad",
                      )}
                    >
                      {away > 0 ? `− ${money(away, c)}` : <span className="text-muted">—</span>}
                    </td>
                    <td
                      className={cn(
                        td,
                        "text-right font-semibold whitespace-nowrap tabular",
                        rowNet < 0 ? "text-bad" : rowNet > 0 ? "text-ok" : "text-muted",
                      )}
                    >
                      {rowNet === 0 ? "—" : signed(rowNet)}
                    </td>
                  </tr>
                );
              })}
              {Number(t.otherCosts) > 0 && (
                <tr className="border-t border-line">
                  <td className={td}>
                    <span className="font-medium">Not tied to an inquiry</span>
                    <span className="block text-xs text-muted">visits, meals, gifts for them</span>
                  </td>
                  <td className={cn(td, "hidden sm:table-cell")} />
                  <td className={cn(td, "hidden md:table-cell")} />
                  <td className={cn(td, "hidden sm:table-cell")} />
                  <td className={cn(td, "hidden text-right whitespace-nowrap tabular sm:table-cell")}>− {money(t.otherCosts, c)}</td>
                  <td className={cn(td, "text-right font-semibold whitespace-nowrap text-bad tabular")}>
                    {signed(-Number(t.otherCosts))}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-line-strong bg-surface-2 font-semibold">
                <td className={td}>Total</td>
                <td className={cn(td, "hidden sm:table-cell")} />
                <td className={cn(td, "hidden text-right whitespace-nowrap tabular md:table-cell")}>{money(t.sales, c)}</td>
                <td className={cn(td, "hidden text-right whitespace-nowrap tabular sm:table-cell")}>{money(t.profit, c)}</td>
                <td className={cn(td, "hidden text-right whitespace-nowrap tabular sm:table-cell")}>
                  {spent > 0 ? `− ${money(spent, c)}` : "—"}
                </td>
                <td className={cn(td, "text-right whitespace-nowrap tabular", net < 0 ? "text-bad" : "text-ok")}>{signed(net)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {Number(t.uncostedRevenue) > 0 && (
          <p className="text-xs text-warn">
            {money(t.uncostedRevenue, c)} of their orders has no factory cost yet, so the profit may be too high by up to that much.
          </p>
        )}
      </section>

      <section aria-label="Spent on them" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">
          Spent on them <span className="font-normal text-muted">· newest first</span>
        </h2>
        {shown.length > 0 ? (
          <ul
            className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface"
            aria-label="Spent on them"
          >
            {shown.map((e) => (
              <ExpenseRecord
                key={e.id}
                e={e}
                mainCurrency={c}
                people={people}
                fx={fx}
                today={today}
                choices={choices}
                showFor={Boolean(e.order || e.deal)}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-sm text-muted">Nothing spent on them yet.</p>
        )}
        {list.rows.length > shown.length && (
          <Link href={`/money?tab=expenses&p=${today.slice(0, 4)}&customer=${customerId}`} className="text-sm text-primary hover:underline">
            See all {list.rows.length} on the Money page
          </Link>
        )}
      </section>
    </div>
  );
}
