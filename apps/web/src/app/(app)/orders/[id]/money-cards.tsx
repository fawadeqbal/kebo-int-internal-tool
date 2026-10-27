import Link from "next/link";
import { EXPENSE_CATEGORY_LABEL, PAYMENT_KIND_LABEL, PAYMENT_METHOD_LABEL } from "@kebo/shared";
import { Badge, Card, CardBody, CardHeader, cn } from "@kebo/ui";
import { date, dateTime, money } from "@/lib/format";
import type { Person } from "@/lib/types";
import type { OrderMoney } from "@/lib/types-money";
import { EditExpense, EditFactoryPayment, NewExpense, NewFactoryPayment, VoidForm } from "@/components/money/forms";
import type { Fx } from "@/lib/fx";
import { CheckCircle2 } from "lucide-react";
import { PaymentRecord } from "@/components/money/payment-record";
import { expenseAction, factoryPaymentAction, voidExpenseAction, voidFactoryPaymentAction } from "../../money/actions";

/**
 * What we owe each factory for this order (their prices plus tax × the
 * quantities ordered) and what we paid them. For people who see costs.
 */
export function FactoriesCard({ m, people, today, fx }: { m: OrderMoney; people: Person[]; today: string; fx: Fx }) {
  const f = m.factories!;
  return (
    <Card>
      <CardHeader title="Factories" description="What we owe each factory for this order, and what we paid. Internal." />
      <CardBody className="flex flex-col gap-4">
        {f.rows.length === 0 ? (
          <p className="text-sm text-muted">
            No line on this order was quoted from a factory price, so there is nothing to work out what we owe.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {f.rows.map((r) => {
              const pct = Number(r.owed) > 0 ? Math.min(100, Math.round((Number(r.paid) / Number(r.owed)) * 100)) : 0;
              return (
                <li key={`${r.factory.id}:${r.currency}`} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="min-w-0">
                      <Link href={`/factories/${r.factory.id}`} className="text-sm font-medium hover:text-primary">
                        {r.factory.name}
                      </Link>
                      <span className="block text-xs text-muted">
                        {r.lookedAfterBy ? `Looked after by ${r.lookedAfterBy.name}` : "Nobody looks after it yet"}
                      </span>
                    </span>
                    <span className="text-right text-sm tabular">
                      {Number(r.toPay) > 0 ? (
                        <span className="font-semibold">{money(r.toPay, r.currency)} to pay</span>
                      ) : (
                        <Badge tone="ok">Paid</Badge>
                      )}
                      <span className="block text-xs text-muted">
                        {money(r.paid, r.currency)} of {money(r.owed, r.currency)} paid
                      </span>
                    </span>
                  </div>
                  <div
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${r.factory.name}: ${pct}% paid`}
                  >
                    <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                  {r.overpaid && (
                    <p className="mt-1 text-xs text-warn">Paid {money(r.overpaid, r.currency)} more than its prices add up to.</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {f.payments.length > 0 && (
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line" aria-label="Payments to factories">
            {f.payments.map((p) => {
              const owedRow = f.rows.find((r) => r.factory.id === p.factory.id && r.currency === p.currency);
              return (
                <PaymentRecord
                  key={p.id}
                  label={`Payment of ${money(p.amount, p.currency)} to ${p.factory.name} on ${date(p.paidOn)}`}
                  removed={!!p.voided}
                  summary={
                    <>
                      <span className={cn("font-medium tabular", p.voided && "line-through")}>{money(p.amount, p.currency)}</span>{" "}
                      <span className="text-text-2">to {p.factory.name}</span> · {PAYMENT_KIND_LABEL[p.kind]}{" "}
                      {p.voided && <Badge tone="bad">Removed</Badge>}
                    </>
                  }
                  sub={
                    <>
                      {date(p.paidOn)} · {PAYMENT_METHOD_LABEL[p.method]}
                      {p.paidBy && ` · paid by ${p.paidBy.name}`}
                      {p.reference && ` · ${p.reference}`}
                    </>
                  }
                  fields={[
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
                    ...(p.voided
                      ? [{ label: "Removed", value: <span className="text-bad">{`${dateTime(p.voided.at)}${p.voided.reason ? `: ${p.voided.reason}` : ""}`}</span>, wide: true }]
                      : []),
                  ]}
                  actions={
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
                    ) : undefined
                  }
                />
              );
            })}
          </ul>
        )}
        {f.canRecord &&
          f.rows.length > 0 &&
          (f.rows.some((r) => Number(r.toPay) > 0) ? (
            <NewFactoryPayment
              action={factoryPaymentAction.bind(null, m.orderId, null)}
              factories={f.rows.filter((r) => Number(r.toPay) > 0)}
              people={people}
              orderCurrency={m.currency}
              fx={fx}
              today={today}
            />
          ) : (
            <p className="flex items-center gap-1.5 text-sm text-ok">
              <CheckCircle2 className="size-4" aria-hidden /> Every factory is paid in full for this order.
            </p>
          ))}
      </CardBody>
    </Card>
  );
}

/** The order's expenses and its profit, earned and cash. Managers and the super admin only. */
export function ProfitCard({ m, people, today, mainCurrency, fx }: { m: OrderMoney; people: Person[]; today: string; mainCurrency: string; fx: Fx }) {
  const p = m.profit;
  const c = m.currency;
  return (
    <Card>
      <CardHeader
        title="Expenses and profit"
        description="Managers only. Expenses are freight, inspection and other costs of this order."
      />
      <CardBody className="flex flex-col gap-4">
        {m.missingRate && (
          <p className="rounded-md bg-warn-soft px-2.5 py-1.5 text-xs">
            There is no exchange rate for {m.missingRate} in Settings, so expenses cannot be turned into it.
          </p>
        )}
        {p && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-line p-3 text-sm">
              <p className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">Earned</p>
              <dl>
                <Line label="Order value" value={money(p.revenue, c)} />
                <Line label="Goods from the factories" value={`− ${money(p.goodsCost, c)}`} />
                <Line label="Expenses" value={`− ${money(p.expenses, c)}`} />
                <Line
                  label="Profit"
                  value={money(p.earned, c)}
                  strong
                  tone={Number(p.earned) < 0 ? "bad" : undefined}
                  hint={p.marginPercent === null ? undefined : `${p.marginPercent}% of the order`}
                />
              </dl>
              {p.coveragePercent !== null && p.coveragePercent < 100 && (
                <p className="mt-1 text-xs text-warn">
                  {money(p.uncostedRevenue, c)} of the order has no factory cost recorded, so this profit is too high by that much at most.
                </p>
              )}
            </div>
            <div className="rounded-lg border border-line p-3 text-sm">
              <p className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">Cash so far</p>
              <dl>
                <Line label="From the customer" value={money(p.received, c)} />
                <Line label="Paid to factories" value={`− ${money(p.factoryPaid, c)}`} />
                <Line label="Expenses" value={`− ${money(p.expenses, c)}`} />
                <Line label="In hand" value={money(p.cash, c)} strong tone={Number(p.cash) < 0 ? "bad" : undefined} />
              </dl>
            </div>
          </div>
        )}
        {m.expenses && m.expenses.length > 0 && (
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line" aria-label="Expenses">
            {m.expenses.map((e) => (
              <li
                key={e.id}
                className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-3 py-2.5 text-sm", e.voided && "text-muted")}
              >
                <div className="min-w-0">
                  <p>
                    <span className={cn("font-medium tabular", e.voided && "line-through")}>{money(e.amount, e.currency)}</span>{" "}
                    <span className="text-text-2">{e.description}</span>
                  </p>
                  <p className="text-xs text-muted">
                    {EXPENSE_CATEGORY_LABEL[e.category]} · {date(e.spentOn)}
                    {e.currency !== mainCurrency && ` · ≈ ${money(e.inMain, mainCurrency)}`}
                    {e.paidBy && ` · paid by ${e.paidBy.name}`}
                    {e.reference && ` · ${e.reference}`}
                  </p>
                  {e.voided && (
                    <p className="text-xs">
                      <Badge tone="bad">Removed</Badge> {e.voided.reason}
                    </p>
                  )}
                </div>
                {!e.voided && !m.cancelled && (
                  <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto">
                    <EditExpense
                      action={expenseAction.bind(null, m.orderId, e.id)}
                      people={people}
                      mainCurrency={mainCurrency}
                      fx={fx}
                      today={today}
                      expense={e}
                    />
                    <VoidForm action={voidExpenseAction.bind(null, m.orderId, e.id)} label="the expense" />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {!m.cancelled && (
          <NewExpense action={expenseAction.bind(null, m.orderId, null)} people={people} mainCurrency={mainCurrency} fx={fx} today={today} />
        )}
      </CardBody>
    </Card>
  );
}

function Line({ label, value, strong, tone, hint }: { label: string; value: string; strong?: boolean; tone?: "bad"; hint?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-0.5", strong && "mt-1 border-t border-line pt-1.5 font-semibold")}>
      <dt className="text-text-2">{label}</dt>
      <dd className={cn("text-right whitespace-nowrap tabular", tone === "bad" && "text-bad")}>
        {value}
        {hint && <span className="block text-xs font-normal text-muted">{hint}</span>}
      </dd>
    </div>
  );
}
