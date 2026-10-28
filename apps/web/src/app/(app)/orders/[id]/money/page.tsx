import Link from "next/link";
import { Paperclip } from "lucide-react";
import { can, PAYMENT_KIND_LABEL, PAYMENT_METHOD_LABEL } from "@kebo/shared";
import { Badge, cn } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { orderMoneyOf, orderOf, orderPaymentsOf } from "@/lib/order-data";
import { date, dateTime, money } from "@/lib/format";
import type { Person } from "@/lib/types";
import type { PaymentStatus } from "@/lib/types-orders";
import { today } from "@/components/orders/today";
import { EditCustomerPayment, NewExpense, NewFactoryPayment, PaymentPlan } from "@/components/money/forms";
import { RecordTable } from "@/components/money/payment-record";
import { AttachedFile } from "@/components/money/attachment";
import { editPaymentAction, expenseAction, factoryPaymentAction, removePaymentFileAction, savePlanAction } from "../../../money/actions";
import { paymentAction, voidPaymentAction } from "../../actions";
import { PaymentForm, VoidPayment } from "../forms";
import { FactoriesView, ProfitView } from "../money-cards";

export const metadata = { title: "Order payments" };

const PAY_STATUS: Record<PaymentStatus, { label: string; tone: "neutral" | "warn" | "info" | "ok" }> = {
  unpaid: { label: "Nothing received", tone: "warn" },
  partly_paid: { label: "Part-paid", tone: "warn" },
  deposit_paid: { label: "Deposit received", tone: "info" },
  paid: { label: "Paid in full", tone: "ok" },
  overpaid: { label: "Overpaid", tone: "warn" },
};

type View = "customer" | "factories" | "profit";

/**
 * The order's payments in one tab with three views, one at a time: the
 * customer's (for everyone: the total, the schedule and the payments
 * received), the factories' (people who see costs: what we owe and what we
 * paid) and the profit (managers: earned, cash and expenses). Each view has
 * its own address (?view=…) and its main button at the top right.
 */
export default async function OrderPaymentsTab({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const me = await requireUser();
  const o = await orderOf(id);
  const [p, m, people, settings] = await Promise.all([
    orderPaymentsOf(id),
    orderMoneyOf(id),
    api.get<Person[]>("/users/people"),
    api.get<{ sales: { currency: string; exchangeRates: Record<string, number> } }>("/settings"),
  ]);
  const open = o.status !== "cancelled";
  const canPay = can(me, "payments.record") && open;
  const canManage = can(me, "orders.manage");
  const now = today();
  const fx = { main: settings.sales.currency, rates: settings.sales.exchangeRates };
  const c = o.currency;
  const base = `/orders/${o.id}/money`;

  const views: { key: View; label: string; hint?: string; tone?: string }[] = [
    { key: "customer", label: "Customer", hint: Number(o.money.due) > 0.005 ? `${money(o.money.due, c)} due` : "paid", tone: Number(o.money.due) > 0.005 ? "text-warn" : "text-ok" },
  ];
  if (m.factories) {
    const owing = m.factories.rows.filter((r) => Number(r.toPay) > 0);
    const currencies = [...new Set(owing.map((r) => r.currency))];
    views.push({
      key: "factories",
      label: "Factories",
      hint: owing.length === 0 ? (m.factories.rows.length ? "paid" : undefined) : currencies.length === 1 ? `${money(owing.reduce((t, r) => t + Number(r.toPay), 0), currencies[0]!)} to pay` : `${owing.length} to pay`,
    });
  }
  if (m.expenses) views.push({ key: "profit", label: "Profit" });
  const view: View = views.some((v) => v.key === sp.view) ? (sp.view as View) : "customer";

  const action =
    view === "customer" ? (
      canPay && <PaymentForm action={paymentAction.bind(null, o.id, c)} currency={c} depositDue={p.depositDue} due={p.due} today={now} />
    ) : view === "factories" && m.factories ? (
      m.factories.canRecord && m.factories.rows.some((r) => Number(r.toPay) > 0) ? (
        <NewFactoryPayment
          action={factoryPaymentAction.bind(null, m.orderId, null)}
          factories={m.factories.rows.filter((r) => Number(r.toPay) > 0)}
          people={people}
          orderCurrency={c}
          fx={fx}
          today={now}
        />
      ) : null
    ) : view === "profit" && !m.cancelled ? (
      <NewExpense action={expenseAction.bind(null, m.orderId, null)} people={people} mainCurrency={settings.sales.currency} fx={fx} today={now} />
    ) : null;

  return (
    <div className="flex flex-col gap-5">
      {/* The view switch, and the view's main button (its form opens full width under them). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {views.length > 1 ? (
          <nav aria-label="Payments of" className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-xl bg-surface-3 p-1">
            {views.map((v) => (
              <Link
                key={v.key}
                href={v.key === "customer" ? base : `${base}?view=${v.key}`}
                scroll={false}
                aria-current={v.key === view ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm whitespace-nowrap transition-colors",
                  v.key === view ? "bg-surface font-semibold text-text shadow-sm" : "text-text-2 hover:text-text",
                )}
              >
                {v.label}
                {v.hint && <span className={cn("hidden text-xs font-medium sm:inline", v.tone ?? "text-muted")}>{v.hint}</span>}
              </Link>
            ))}
          </nav>
        ) : (
          <h2 className="text-base font-semibold">From the customer</h2>
        )}
        {action && <div className="has-[form]:basis-full">{action}</div>}
      </div>

      {view === "customer" && (
        <>
          <CustomerSummary o={o} />
          <PaymentPlan plan={m.plan} currency={c} total={m.total} terms={m.terms} action={savePlanAction.bind(null, o.id)} />
          <section aria-label="Payments received" className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">
              Payments received <span className="font-normal text-muted">· in {c}; bank charges the banks kept count as paid</span>
            </h3>
            {p.payments.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-4 text-sm text-muted">
                No payments yet. {canPay ? "Record the deposit when it reaches the bank." : "Accounts records payments when they reach the bank."}
              </p>
            ) : (
              <RecordTable
                label="Payments from the customer"
                columns={[
                  { label: "Date", width: "w-28" },
                  { label: "For" },
                  { label: "Method · reference", hideBelow: "md" },
                  { label: "Amount", align: "right" },
                  { label: "Bank charges", align: "right", hideBelow: "sm" },
                  { label: "Proof", hideBelow: "sm", width: "w-16" },
                ]}
                rows={p.payments.map((x) => ({
                  key: x.id,
                  label: `Payment of ${money(x.amount, x.currency)} on ${date(x.paidOn)}`,
                  removed: !!x.voided,
                  cells: [
                    <span key="d" className="whitespace-nowrap">{date(x.paidOn)}</span>,
                    <span key="k">
                      {PAYMENT_KIND_LABEL[x.kind]} {x.voided && <Badge tone="bad">Removed</Badge>}
                    </span>,
                    <span key="m" className="text-text-2">
                      {PAYMENT_METHOD_LABEL[x.method]}
                      {x.reference && ` · ${x.reference}`}
                    </span>,
                    <span key="a" className="font-semibold whitespace-nowrap">{money(x.amount, x.currency)}</span>,
                    <span key="b" className={Number(x.bankCharges) > 0 ? "text-text-2" : "text-muted"}>{Number(x.bankCharges) > 0 ? money(x.bankCharges, x.currency) : "—"}</span>,
                    x.file ? <Paperclip key="f" className="size-4 text-text-2" aria-label="Bank slip kept" /> : <span key="f" className="text-muted">—</span>,
                  ],
                  fields: [
                    { label: "Amount received", value: <span className="tabular">{money(x.amount, x.currency)}</span> },
                    { label: "Bank charges", value: Number(x.bankCharges) > 0 ? <span className="tabular">{money(x.bankCharges, x.currency)}</span> : "None" },
                    { label: "Counts as paid", value: <span className="font-medium tabular">{money(x.counts, x.currency)}</span> },
                    { label: "What for", value: PAYMENT_KIND_LABEL[x.kind] },
                    { label: "Paid on", value: date(x.paidOn) },
                    { label: "Method", value: PAYMENT_METHOD_LABEL[x.method] },
                    { label: "Bank reference", value: x.reference ?? "—" },
                    { label: "Account", value: x.account?.name ?? <span className="text-muted">Not said</span> },
                    { label: "Recorded by", value: `${x.recordedBy?.name ?? "Someone"} · ${dateTime(x.recordedAt)}` },
                    {
                      label: "After this payment",
                      value: x.after ? (
                        <span className="tabular">
                          {money(x.after.received, x.currency)} received · {Number(x.after.due) > 0 ? `${money(x.after.due, x.currency)} still due` : "paid in full"}
                        </span>
                      ) : (
                        "Not counted"
                      ),
                    },
                    ...(x.note ? [{ label: "Note", value: <span className="whitespace-pre-line">{x.note}</span>, wide: true }] : []),
                    {
                      label: "Proof of payment",
                      value: (
                        <AttachedFile
                          src={`/files/payments/${x.id}`}
                          file={x.file}
                          what="Proof of payment"
                          canChange={can(me, "payments.record") && !x.voided}
                          remove={removePaymentFileAction.bind(null, "in", x.id, o.id)}
                          empty="No bank slip kept"
                        />
                      ),
                      wide: true,
                    },
                    ...(x.voided
                      ? [{ label: "Removed", value: <span className="text-bad">{`${dateTime(x.voided.at)}${x.voided.reason ? `: ${x.voided.reason}` : ""}`}</span>, wide: true }]
                      : []),
                  ],
                  actions:
                    (canManage || canPay) && !x.voided ? (
                      <>
                        {canPay && <EditCustomerPayment action={editPaymentAction.bind(null, o.id, x.id, c)} payment={x} currency={c} today={now} />}
                        {canManage && <VoidPayment action={voidPaymentAction.bind(null, o.id, x.id)} />}
                      </>
                    ) : undefined,
                }))}
                foot={(() => {
                  const kept = p.payments.filter((x) => !x.voided);
                  const amount = kept.reduce((t, x) => t + Number(x.amount), 0);
                  const charges = kept.reduce((t, x) => t + Number(x.bankCharges), 0);
                  return [
                    "Total",
                    "",
                    "",
                    <span key="a" className="whitespace-nowrap">{money(amount, c)}</span>,
                    charges > 0 ? money(charges, c) : "—",
                    "",
                  ];
                })()}
              />
            )}
          </section>
        </>
      )}
      {view === "factories" && m.factories && <FactoriesView m={m} people={people} today={now} fx={fx} />}
      {view === "profit" && m.expenses && <ProfitView m={m} people={people} today={now} mainCurrency={settings.sales.currency} fx={fx} />}
    </div>
  );
}

/** The three numbers, how much is in (with the deposit marked), and where the money stands. */
function CustomerSummary({ o }: { o: Awaited<ReturnType<typeof orderOf>> }) {
  const c = o.currency;
  const st = PAY_STATUS[o.money.status] ?? { label: o.money.status, tone: "neutral" as const };
  const total = Number(o.money.total);
  const pct = total > 0 ? Math.min(100, Math.round((Number(o.money.received) / total) * 100)) : 0;
  const due = Number(o.money.due);
  return (
    <section aria-label="Customer money" className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <dl className="grid flex-1 grid-cols-3 gap-3 sm:flex sm:flex-none sm:gap-10">
          <div className="min-w-0">
            <dt className="text-xs text-muted">Order total</dt>
            <dd className="truncate text-base font-bold tabular sm:text-xl">{money(o.money.total, c)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted">Received</dt>
            <dd className="truncate text-base font-bold text-ok tabular sm:text-xl">{money(o.money.received, c)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted">Still due</dt>
            <dd className={cn("truncate text-base font-bold tabular sm:text-xl", due > 0.005 ? "text-warn" : "text-ok")}>{money(o.money.due, c)}</dd>
          </div>
        </dl>
        <Badge tone={st.tone} dot>
          {st.label}
        </Badge>
      </div>
      <div className="flex flex-col gap-1.5">
        <div
          className="relative h-2.5 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={`${pct}% of the order received`}
        >
          <div className="h-full rounded-full bg-ok" style={{ width: `${pct}%` }} />
          {o.depositPercent > 0 && o.depositPercent < 100 && (
            <span aria-hidden className="absolute top-0 bottom-0 w-0.5 bg-surface" style={{ left: `${o.depositPercent}%` }} title={`Deposit ${o.depositPercent}%`} />
          )}
        </div>
        <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted">
          <span>
            {pct}% received
            {o.depositPercent > 0 &&
              (Number(o.money.depositDue) > 0 ? (
                <span className="text-warn">
                  {" "}
                  · deposit ({o.depositPercent}%): {money(o.money.depositDue, c)} still missing
                </span>
              ) : (
                <span className="text-ok"> · deposit ({o.depositPercent}%) received</span>
              ))}
          </span>
          {Number(o.money.bankCharges) > 0 && <span>received includes {money(o.money.bankCharges, c)} bank charges</span>}
        </p>
      </div>
    </section>
  );
}
