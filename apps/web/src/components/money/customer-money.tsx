import Link from "next/link";
import { Plus } from "lucide-react";
import { Card, cn } from "@kebo/ui";
import { InfoTip } from "@kebo/ui/client";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import type { Person } from "@/lib/types";
import type { CustomerAccount, CustomerPayments, ExpenseList, ExpenseTargets } from "@/lib/types-money";
import { expenseAction } from "@/app/(app)/money/actions";
import { PanelButton } from "@/components/orders/step-view";
import { PanelBody } from "@/components/common/panel";
import { NewExpense } from "./forms";
import { ExpenseRecord } from "./expense-record";
import { CustomerCredit, ReceiptForm } from "./money-v2";
import { customerReceiptAction, refundCreditAction, useCreditAction, voidCreditAction } from "@/app/(app)/orders/actions";

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";
const SHOWN = 10;

const th = "px-3 py-2 text-xs font-medium whitespace-nowrap text-text-2";
const td = "px-3 py-2.5 align-top";

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

/**
 * The customer's Profit tab (managers): per sales order what the quotation promised (quoted profit), what is
 * left after unplanned costs and bank charges (gross profit, as on the order's Costing tab) and after what we
 * spent on the inquiry before the order (net contribution); then what we spent on them not tied to a sales
 * order, and their expenses.
 */
export async function CustomerProfit({ a, customerId, customerName }: { a: CustomerAccount; customerId: string; customerName: string }) {
  const { list, people, fx, today, choices } = await profitData(customerId, customerName);
  const c = a.currency;
  const t = a.totals;
  const orders = a.rows.filter((r) => r.order);
  const away = Number(t.lostDeals) + Number(t.openDeals) + Number(t.otherCosts);
  const quoted = orders.reduce((s, r) => s + Number(r.order!.quotedProfit), 0);
  const signed = (v: number) => (v < 0 ? `−${money(-v, c)}` : money(v, c));
  const shown = list.rows.slice(0, SHOWN);
  return (
    <div className="flex flex-col gap-5">
      {a.missingRates.length > 0 && (
        <p className="rounded-md bg-warn-soft px-2.5 py-1.5 text-xs">No exchange rate for {a.missingRates.join(", ")}. Add it in Settings › Sales &amp; quotations.</p>
      )}
      <Card className="overflow-clip">
        <div className="flex min-h-12 items-center gap-1 border-b border-line px-4 py-2.5">
          <h2 className="text-[15px] font-semibold">Profit by sales order · {orders.length}</h2>
          <InfoTip label="About profit by sales order">In {c}, at each sales order&rsquo;s exchange rate.</InfoTip>
        </div>
        {orders.length === 0 && away === 0 ? (
          <p className="px-4 py-3.5 text-sm text-text-2">No sales orders yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="bg-surface-2 text-left">
                  <th scope="col" className={th}>
                    Sales order
                  </th>
                  <th scope="col" className={cn(th, "text-right")}>
                    Total ({c})
                  </th>
                  <th scope="col" className={cn(th, "text-right")}>
                    <span className="inline-flex items-center gap-1">
                      Quoted profit <InfoTip label="About quoted profit">What the quotation promised, before any extra costs.</InfoTip>
                    </span>
                  </th>
                  <th scope="col" className={cn(th, "text-right")}>
                    <span className="inline-flex items-center gap-1">
                      Gross profit <InfoTip label="About gross profit">Quoted profit, less unplanned costs and bank charges.</InfoTip>
                    </span>
                  </th>
                  <th scope="col" className={cn(th, "text-right")}>
                    <span className="inline-flex items-center gap-1">
                      Net contribution <InfoTip label="About net contribution" align="end">Gross profit, less what we spent on the inquiry before it.</InfoTip>
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {orders.map((r) => {
                  const o = r.order!;
                  return (
                    <tr key={o.id} className="border-t border-line">
                      <td className={td}>
                        <Link href={`/orders/${o.id}/costs`} className="font-medium tabular hover:text-primary">
                          {o.refNo}
                        </Link>
                        <span className="block max-w-72 truncate text-xs text-text-2">{r.title}</span>
                      </td>
                      <td className={cn(td, "text-right whitespace-nowrap tabular")}>{money(o.revenue, c)}</td>
                      <td className={cn(td, "text-right whitespace-nowrap tabular")}>{signed(Number(o.quotedProfit))}</td>
                      <td className={cn(td, "text-right whitespace-nowrap tabular", Number(o.profit) < 0 && "text-bad")}>{signed(Number(o.profit))}</td>
                      <td className={cn(td, "text-right font-semibold whitespace-nowrap tabular", Number(o.net) < 0 && "text-bad")}>{signed(Number(o.net))}</td>
                    </tr>
                  );
                })}
                {away > 0 && (
                  <tr className="border-t border-line">
                    <td className={td}>
                      <span className="inline-flex items-center gap-1 font-medium">
                        Expenses not on a sales order
                        <InfoTip label="About expenses not on a sales order">Visits, samples and inquiries we lost or that are still open.</InfoTip>
                      </span>
                    </td>
                    <td className={td} />
                    <td className={td} />
                    <td className={td} />
                    <td className={cn(td, "text-right font-semibold whitespace-nowrap text-bad tabular")}>{signed(-away)}</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-strong bg-surface-2 font-semibold">
                  <td className={td}>Total</td>
                  <td className={cn(td, "text-right whitespace-nowrap tabular")}>{money(t.sales, c)}</td>
                  <td className={cn(td, "text-right whitespace-nowrap tabular")}>{signed(quoted)}</td>
                  <td className={cn(td, "text-right whitespace-nowrap tabular")}>{signed(Number(t.profit))}</td>
                  <td className={cn(td, "text-right whitespace-nowrap tabular", Number(t.net) < 0 ? "text-bad" : "text-ok")}>{signed(Number(t.net))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {Number(t.uncostedRevenue) > 0 && (
          <p className="border-t border-line px-4 py-2 text-xs text-warn">{money(t.uncostedRevenue, c)} of their sales orders has no goods cost yet and is left out of profit.</p>
        )}
      </Card>

      <Card className="overflow-clip">
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-[15px] font-semibold">Expenses · {list.rows.length}</h2>
          <NewExpense action={expenseAction.bind(null, null, null)} people={people} mainCurrency={c} fx={fx} today={today} choices={choices} label="Add expense" quiet />
        </div>
        {shown.length > 0 ? (
          <ul className="flex flex-col divide-y divide-line" aria-label="Expenses">
            {shown.map((e) => (
              <ExpenseRecord key={e.id} e={e} mainCurrency={c} people={people} fx={fx} today={today} choices={choices} showFor={Boolean(e.order || e.deal)} />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3.5 text-sm text-text-2">No expenses yet.</p>
        )}
        {list.rows.length > shown.length && (
          <Link href={`/finance/expenses?p=${today.slice(0, 4)}&customer=${customerId}`} className="block border-t border-line px-4 py-2.5 text-[13px] font-medium text-primary hover:underline">
            All {list.rows.length} →
          </Link>
        )}
      </Card>
    </div>
  );
}

/** "Record payment": one transfer over several of their sales orders, the oldest balance due filled first; the rest kept as advance / credit. */
export async function RecordPaymentButton({ customerId, customerName, pay }: { customerId: string; customerName: string; pay: CustomerPayments }) {
  if (!pay.credit.canRecord) return null;
  const settings = await api.get<{ sales: { currency: string; exchangeRates: Record<string, number> } }>("/settings");
  const open = pay.orders.filter((o) => o.status !== "cancelled" && Number(o.due) > 0);
  if (!open.length) return null;
  return (
    <PanelButton
      size="sm"
      variant="secondary"
      icon={<Plus aria-hidden />}
      label="Record payment"
      title={`Record payment · ${customerName}`}
      body={
        <PanelBody>
          <ReceiptForm
            action={customerReceiptAction.bind(null, customerId)}
            customer={customerName}
            orders={open.map((o) => ({ id: o.id, refNo: o.refNo, currency: o.currency, orderedOn: o.orderedOn, due: o.due, next: o.next }))}
            fx={{ main: settings.sales.currency, rates: settings.sales.exchangeRates }}
            today={todayIn(TZ)}
          />
        </PanelBody>
      }
    />
  );
}

/** "Apply credit": the advance / credit we hold for them, used on a sales order or refunded (side panel). */
export function ApplyCreditButton({ customerId, customerName, pay }: { customerId: string; customerName: string; pay: CustomerPayments }) {
  const open = pay.orders.filter((o) => o.status !== "cancelled" && Number(o.due) > 0);
  return (
    <PanelButton
      size="sm"
      variant="secondary"
      label="Apply credit"
      title={`Advance / credit · ${customerName}`}
      body={
        <PanelBody>
          <CustomerCredit
            customer={customerName}
            credit={pay.credit}
            orders={open.map((o) => ({ id: o.id, refNo: o.refNo, currency: o.currency, due: o.due }))}
            useActions={Object.fromEntries(open.map((o) => [o.id, useCreditAction.bind(null, o.id)]))}
            refundAction={refundCreditAction.bind(null, customerId)}
            voidActions={Object.fromEntries(pay.credit.entries.filter((e) => e.kind === "refund").map((e) => [e.id, voidCreditAction.bind(null, customerId, "credit", e.id)]))}
            canManage={pay.credit.canRecord}
            today={todayIn(TZ)}
          />
        </PanelBody>
      }
    />
  );
}
