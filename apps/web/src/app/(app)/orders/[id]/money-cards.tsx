import Link from "next/link";
import { PAYMENT_KIND_LABEL, PAYMENT_METHOD_LABEL } from "@kebo/shared";
import { Badge, cn } from "@kebo/ui";
import { date, dateTime, money } from "@/lib/format";
import type { Person } from "@/lib/types";
import type { OrderMoney } from "@/lib/types-money";
import { EditFactoryPayment, VoidForm } from "@/components/money/forms";
import { ExpenseRecord } from "@/components/money/expense-record";
import type { Fx } from "@/lib/fx";
import { CheckCircle2, Lock, Paperclip } from "lucide-react";
import { RecordTable } from "@/components/money/payment-record";
import { factoryPaymentAction, removePaymentFileAction, voidFactoryPaymentAction } from "../../money/actions";
import { AttachedFile } from "@/components/money/attachment";

/**
 * What we owe each factory for this order (their prices plus tax × the
 * quantities ordered) and what we paid them, as two tables. For people who
 * see costs; "Pay a factory" is at the top of the tab.
 */
export function FactoriesView({ m, people, today, fx }: { m: OrderMoney; people: Person[]; today: string; fx: Fx }) {
  const f = m.factories!;
  const currencies = [...new Set(f.payments.filter((p) => !p.voided).map((p) => p.currency))];
  const paidTotal = f.payments.filter((p) => !p.voided).reduce((t, p) => t + Number(p.amount), 0);
  return (
    <div className="flex flex-col gap-5">
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Lock className="size-3.5" aria-hidden /> Internal: never on the customer&apos;s documents.
      </p>
      <section aria-label="What we owe each factory" className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">What we owe</h3>
        {f.rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-sm text-muted">
            No line on this order was quoted from a factory price, so there is nothing to work out what we owe.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <table data-fit="" className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-surface-2 text-left text-xs text-text-2">
                  <th scope="col" className="px-3 py-2 font-medium">Factory</th>
                  <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">Looked after by</th>
                  <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">Order cost</th>
                  <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">Paid</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Left to pay</th>
                  <th scope="col" className="hidden w-44 px-3 py-2 font-medium lg:table-cell">Progress</th>
                </tr>
              </thead>
              <tbody>
                {f.rows.map((r) => {
                  const pct = Number(r.owed) > 0 ? Math.min(100, Math.round((Number(r.paid) / Number(r.owed)) * 100)) : 0;
                  return (
                    <tr key={`${r.factory.id}:${r.currency}`} className="border-t border-line">
                      <td className="px-3 py-2.5 align-top">
                        <Link href={`/factories/${r.factory.id}`} className="font-medium hover:text-primary">
                          {r.factory.name}
                        </Link>
                        <span className="block text-xs text-muted sm:hidden tabular">
                          {money(r.paid, r.currency)} of {money(r.owed, r.currency)} paid
                        </span>
                        {r.overpaid && <span className="block text-xs text-warn">Paid {money(r.overpaid, r.currency)} more than its prices add up to.</span>}
                      </td>
                      <td className={cn("hidden px-3 py-2.5 align-top md:table-cell", r.lookedAfterBy ? "text-text-2" : "text-warn")}>{r.lookedAfterBy?.name ?? "Nobody yet"}</td>
                      <td className="hidden px-3 py-2.5 text-right align-top whitespace-nowrap tabular sm:table-cell">{money(r.owed, r.currency)}</td>
                      <td className="hidden px-3 py-2.5 text-right align-top whitespace-nowrap text-ok tabular sm:table-cell">{money(r.paid, r.currency)}</td>
                      <td className="px-3 py-2.5 text-right align-top whitespace-nowrap tabular">
                        {Number(r.toPay) > 0 ? <span className="font-semibold text-warn">{money(r.toPay, r.currency)}</span> : <Badge tone="ok">Paid</Badge>}
                      </td>
                      <td className="hidden px-3 py-2.5 align-top lg:table-cell">
                        <div className="h-2 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.factory.name}: ${pct}% paid`}>
                          <div className="h-full rounded-full bg-ok" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-muted">{pct}% paid</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {f.rows.length > 0 && f.rows.every((r) => Number(r.toPay) <= 0) && (
          <p className="flex items-center gap-1.5 text-sm text-ok">
            <CheckCircle2 className="size-4" aria-hidden /> Every factory is paid in full for this order.
          </p>
        )}
      </section>

      <section aria-label="Payments to factories" className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Payments to factories</h3>
        {f.payments.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-sm text-muted">Nothing paid to a factory for this order yet.</p>
        ) : (
          <RecordTable
            label="Payments to factories"
            columns={[
              { label: "Date", width: "w-28" },
              { label: "Factory" },
              { label: "For", hideBelow: "sm" },
              { label: "Method · reference", hideBelow: "md" },
              { label: "Paid by", hideBelow: "md" },
              { label: "Amount", align: "right" },
              { label: "Proof", hideBelow: "sm", width: "w-16" },
            ]}
            rows={f.payments.map((p) => {
              const owedRow = f.rows.find((r) => r.factory.id === p.factory.id && r.currency === p.currency);
              return {
                key: p.id,
                label: `Payment of ${money(p.amount, p.currency)} to ${p.factory.name} on ${date(p.paidOn)}`,
                removed: !!p.voided,
                cells: [
                  <span key="d" className="whitespace-nowrap">{date(p.paidOn)}</span>,
                  <span key="f">
                    {p.factory.name} {p.voided && <Badge tone="bad">Removed</Badge>}
                  </span>,
                  PAYMENT_KIND_LABEL[p.kind],
                  <span key="m" className="text-text-2">
                    {PAYMENT_METHOD_LABEL[p.method]}
                    {p.reference && ` · ${p.reference}`}
                  </span>,
                  <span key="b" className={p.paidBy ? "text-text-2" : "text-muted"}>{p.paidBy?.name ?? "—"}</span>,
                  <span key="a" className="font-semibold whitespace-nowrap">{money(p.amount, p.currency)}</span>,
                  p.file ? <Paperclip key="p" className="size-4 text-text-2" aria-label="Proof kept" /> : <span key="p" className="text-muted">—</span>,
                ],
                fields: [
                  { label: "Factory", value: <Link href={`/factories/${p.factory.id}`} className="hover:text-primary">{p.factory.name}</Link> },
                  { label: "Amount paid", value: <span className="font-medium tabular">{money(p.amount, p.currency)}</span> },
                  {
                    label: `In the order's currency (${m.currency})`,
                    value:
                      p.currency === m.currency ? (
                        "Same currency"
                      ) : (
                        <span className="tabular">
                          ≈ {money(p.inOrderCurrency, m.currency)} <span className="text-xs text-muted">at {p.rate} {p.currency} per {m.currency}</span>
                        </span>
                      ),
                  },
                  { label: "What for", value: PAYMENT_KIND_LABEL[p.kind] },
                  { label: "Paid on", value: date(p.paidOn) },
                  { label: "Method", value: PAYMENT_METHOD_LABEL[p.method] },
                  { label: "Paid by", value: p.paidBy?.name ?? "Not said" },
                  { label: "Bank reference", value: p.reference ?? "—" },
                  { label: "Account", value: p.account?.name ?? <span className="text-muted">Not said</span> },
                  {
                    label: "Recorded by",
                    value: `${p.recordedBy?.name ?? "Someone"} · ${dateTime(p.recordedAt)}${p.changedAt ? ` (changed ${dateTime(p.changedAt)})` : ""}`,
                  },
                  {
                    label: "After this payment",
                    value: p.after ? (
                      <span className="tabular">
                        {money(p.after.paid, p.currency)} paid{owedRow ? ` of ${money(owedRow.owed, p.currency)}` : ""} ·{" "}
                        {Number(p.after.toPay) > 0 ? `${money(p.after.toPay, p.currency)} left to pay` : "paid in full"}
                      </span>
                    ) : (
                      "Not counted"
                    ),
                    wide: true,
                  },
                  ...(p.note ? [{ label: "Note", value: <span className="whitespace-pre-line">{p.note}</span>, wide: true }] : []),
                  {
                    label: "Proof of payment",
                    value: (
                      <AttachedFile
                        src={`/files/factory-payments/${p.id}`}
                        file={p.file}
                        what="Proof of payment"
                        canChange={f.canRecord && !p.voided}
                        remove={removePaymentFileAction.bind(null, "out", p.id, m.orderId)}
                        empty="No bank slip kept"
                      />
                    ),
                    wide: true,
                  },
                  ...(p.voided
                    ? [{ label: "Removed", value: <span className="text-bad">{`${dateTime(p.voided.at)}${p.voided.reason ? `: ${p.voided.reason}` : ""}`}</span>, wide: true }]
                    : []),
                ],
                actions:
                  f.canRecord && !p.voided ? (
                    <>
                      <EditFactoryPayment
                        action={factoryPaymentAction.bind(null, m.orderId, p.id)}
                        factories={f.rows}
                        people={people}
                        orderCurrency={m.currency}
                        fx={fx}
                        today={today}
                        payment={p}
                      />
                      <VoidForm action={voidFactoryPaymentAction.bind(null, m.orderId, p.id)} label="the payment" />
                    </>
                  ) : undefined,
              };
            })}
            foot={["Total paid", "", "", "", "", currencies.length === 1 ? <span key="t" className="whitespace-nowrap">{money(paidTotal, currencies[0]!)}</span> : "", ""]}
          />
        )}
      </section>
    </div>
  );
}

/** The order's profit (earned and cash) and its expenses. Managers and the super admin only; "Add an expense" is at the top of the tab. */
export function ProfitView({ m, people, today, mainCurrency, fx }: { m: OrderMoney; people: Person[]; today: string; mainCurrency: string; fx: Fx }) {
  const p = m.profit;
  const c = m.currency;
  return (
    <div className="flex flex-col gap-5">
      {m.missingRate && (
        <p className="rounded-md bg-warn-soft px-2.5 py-1.5 text-xs">
          There is no exchange rate for {m.missingRate} in Settings, so expenses cannot be turned into it.
        </p>
      )}
      {p && (
        <>
          <section aria-label="Profit at a glance" className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-line bg-surface p-4">
              <p className="text-xs text-muted">Profit on this order</p>
              <p className={cn("text-xl font-bold tabular", Number(p.earned) < 0 ? "text-bad" : "text-ok")}>{money(p.earned, c)}</p>
              {p.marginPercent !== null && <p className="text-xs text-text-2">{p.marginPercent}% of the order value</p>}
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <p className="text-xs text-muted">Cash in hand so far</p>
              <p className={cn("text-xl font-bold tabular", Number(p.cash) < 0 && "text-bad")}>{money(p.cash, c)}</p>
              <p className="text-xs text-text-2">received minus what was paid out</p>
            </div>
            {p.coveragePercent !== null && p.coveragePercent < 100 ? (
              <div className="rounded-xl border border-warn/30 bg-warn-soft p-4 text-warn">
                <p className="text-xs font-semibold">Check this</p>
                <p className="mt-1 text-sm">
                  {money(p.uncostedRevenue, c)} of the order has no factory cost recorded, so the profit may be too high by up to that much.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-line bg-surface p-4">
                <p className="text-xs text-muted">Expenses</p>
                <p className="text-xl font-bold tabular">{money(p.expenses, c)}</p>
                <p className="text-xs text-text-2">freight, inspection, tickets…</p>
              </div>
            )}
          </section>
          <div className="grid gap-3 sm:grid-cols-2">
            <SumTable
              title="Earned (the whole order)"
              rows={[
                ["Order value", money(p.revenue, c)],
                ["Goods from the factories", `− ${money(p.goodsCost, c)}`],
                ["Expenses", `− ${money(p.expenses, c)}`],
                ...(Number(p.beforeSale) > 0 ? ([["Spent on the deal before the sale", `− ${money(p.beforeSale, c)}`]] as [string, string][]) : []),
              ]}
              total={Number(p.beforeSale) > 0 ? ["Profit after everything", money(p.net, c), Number(p.net) < 0] : ["Profit", money(p.earned, c), Number(p.earned) < 0]}
            />
            <SumTable
              title="Cash so far"
              rows={[
                ["From the customer", money(p.received, c)],
                ["Paid to factories", `− ${money(p.factoryPaid, c)}`],
                ["Expenses", `− ${money(p.expenses, c)}`],
              ]}
              total={["In hand", money(p.cash, c), Number(p.cash) < 0]}
            />
          </div>
        </>
      )}
      <section aria-label="Expenses" className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">
          Expenses <span className="font-normal text-muted">· freight, inspection, tickets and other costs of this order; they also count on the customer</span>
        </h3>
        {m.expenses && m.expenses.length > 0 ? (
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface" aria-label="Expenses">
            {m.expenses.map((e) => (
              <ExpenseRecord key={e.id} e={e} mainCurrency={mainCurrency} people={people} fx={fx} today={today} showFor={false} canChange={!m.cancelled} />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-sm text-muted">No expenses yet. Add one when you pay for freight, an inspection or a ticket.</p>
        )}
      </section>
      {m.dealExpenses && m.dealExpenses.length > 0 && (
        <section aria-label="Spent on the deal before the order" className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            Spent on the deal before the order ·{" "}
            <Link href={`/deals/${m.deal.id}`} className="font-normal text-primary hover:underline">
              open the deal
            </Link>
          </h3>
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {m.dealExpenses.map((e) => (
              <ExpenseRecord key={e.id} e={e} mainCurrency={mainCurrency} people={people} fx={fx} today={today} showFor={false} canChange={!m.cancelled} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** A small sum: lines, then the total in bold. */
function SumTable({ title, rows, total }: { title: string; rows: [string, string][]; total: [string, string, boolean] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-surface-2 text-left text-xs text-text-2">
            <th scope="colgroup" colSpan={2} className="px-3 py-2 font-medium">
              {title}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([l, v]) => (
            <tr key={l} className="border-t border-line">
              <td className="px-3 py-2 text-text-2">{l}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap tabular">{v}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line bg-surface-2 font-semibold">
            <td className="px-3 py-2">{total[0]}</td>
            <td className={cn("px-3 py-2 text-right whitespace-nowrap tabular", total[2] && "text-bad")}>{total[1]}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
