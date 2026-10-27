import { can, PAYMENT_KIND_LABEL, PAYMENT_METHOD_LABEL } from "@kebo/shared";
import { Badge, Card, CardBody, CardHeader, cn } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { orderMoneyOf, orderOf, orderPaymentsOf } from "@/lib/order-data";
import { date, dateTime, money } from "@/lib/format";
import type { Person } from "@/lib/types";
import type { PaymentStatus } from "@/lib/types-orders";
import { today } from "@/components/orders/today";
import { EditCustomerPayment, PaymentPlan } from "@/components/money/forms";
import { editPaymentAction, removePaymentFileAction, savePlanAction } from "../../../money/actions";
import { paymentAction, voidPaymentAction } from "../../actions";
import { PaymentForm, VoidPayment } from "../forms";
import { FactoriesCard, ProfitCard } from "../money-cards";
import { PaymentRecord } from "@/components/money/payment-record";
import { AttachedFile } from "@/components/money/attachment";
import { Paperclip } from "lucide-react";

export const metadata = { title: "Order money" };

const PAY_STATUS: Record<PaymentStatus, { label: string; tone: "neutral" | "warn" | "info" | "ok" }> = {
  unpaid: { label: "Nothing received", tone: "warn" },
  partly_paid: { label: "Part-paid", tone: "warn" },
  deposit_paid: { label: "Deposit received", tone: "info" },
  paid: { label: "Paid in full", tone: "ok" },
  overpaid: { label: "Overpaid", tone: "warn" },
};

/**
 * Money on the order: what the customer pays (plan and payments, for
 * everyone), what we pay the factories (people who see costs), and expenses
 * and profit (managers).
 */
export default async function OrderMoneyTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
  const st = PAY_STATUS[o.money.status] ?? { label: o.money.status, tone: "neutral" as const };

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title="From the customer"
          description={`In ${o.currency}. Bank charges the banks deducted count as paid.`}
          actions={<Badge tone={st.tone}>{st.label}</Badge>}
        />
        <CardBody className="flex flex-col gap-4">
          {o.depositPercent > 0 && (
            <p className="text-sm text-text-2">
              Deposit ({o.depositPercent}%): <span className="font-medium text-text tabular">{money(o.money.deposit, o.currency)}</span>
              {Number(o.money.depositDue) > 0 ? <span className="text-warn"> · {money(o.money.depositDue, o.currency)} still missing</span> : <span className="text-ok"> · received</span>}
              {Number(o.money.bankCharges) > 0 && <span className="text-muted"> · received includes {money(o.money.bankCharges, o.currency)} bank charges</span>}
            </p>
          )}
          <PaymentPlan plan={m.plan} currency={o.currency} total={m.total} terms={m.terms} action={savePlanAction.bind(null, o.id)} />
          {p.payments.length === 0 ? (
            <p className="text-sm text-muted">
              No payments yet. {canPay ? "Record the deposit when it reaches the bank." : "Accounts records payments when they reach the bank."}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line" aria-label="Payments from the customer">
              {p.payments.map((x) => (
                <PaymentRecord
                  key={x.id}
                  label={`Payment of ${money(x.amount, x.currency)} on ${date(x.paidOn)}`}
                  removed={!!x.voided}
                  summary={
                    <>
                      <span className={cn("font-medium tabular", x.voided && "line-through")}>{money(x.amount, x.currency)}</span>{" "}
                      <span className="text-text-2">{PAYMENT_KIND_LABEL[x.kind]}</span>
                      {Number(x.bankCharges) > 0 && <span className="text-xs text-muted"> + {money(x.bankCharges, x.currency)} bank charges</span>}{" "}
                      {x.file && <Paperclip className="inline size-3.5 align-[-2px] text-muted" aria-label="Proof kept" />} {x.voided && <Badge tone="bad">Removed</Badge>}
                    </>
                  }
                  sub={
                    <>
                      {date(x.paidOn)} · {PAYMENT_METHOD_LABEL[x.method]}
                      {x.reference && ` · ${x.reference}`}
                    </>
                  }
                  fields={[
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
                  ]}
                  actions={
                    (canManage || canPay) && !x.voided ? (
                      <>
                        {canPay && <EditCustomerPayment action={editPaymentAction.bind(null, o.id, x.id, o.currency)} payment={x} currency={o.currency} today={now} />}
                        {canManage && <VoidPayment action={voidPaymentAction.bind(null, o.id, x.id)} />}
                      </>
                    ) : undefined
                  }
                />
              ))}
            </ul>
          )}
          {canPay && <PaymentForm action={paymentAction.bind(null, o.id, o.currency)} currency={o.currency} depositDue={p.depositDue} due={p.due} today={now} />}
        </CardBody>
      </Card>
      {m.factories && <FactoriesCard m={m} people={people} today={now} fx={fx} />}
      {m.expenses && <ProfitCard m={m} people={people} today={now} mainCurrency={settings.sales.currency} fx={fx} />}
    </div>
  );
}
