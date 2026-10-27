import { can, PAYMENT_KIND_LABEL, PAYMENT_METHOD_LABEL } from "@kebo/shared";
import { Badge, Card, CardBody, CardHeader, cn } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { orderMoneyOf, orderOf, orderPaymentsOf } from "@/lib/order-data";
import { date, money } from "@/lib/format";
import type { Person } from "@/lib/types";
import type { PaymentStatus } from "@/lib/types-orders";
import { today } from "@/components/orders/today";
import { EditCustomerPayment, PaymentPlan } from "@/components/money/forms";
import { editPaymentAction, savePlanAction } from "../../../money/actions";
import { paymentAction, voidPaymentAction } from "../../actions";
import { PaymentForm, VoidPayment } from "../forms";
import { FactoriesCard, ProfitCard } from "../money-cards";

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
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line" aria-label="Payments">
              {p.payments.map((x) => (
                <li key={x.id} className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-3 py-2.5 text-sm", x.voided && "text-muted")}>
                  <div className="min-w-0">
                    <p>
                      <span className={cn("font-medium tabular", x.voided && "line-through")}>{money(x.amount, x.currency)}</span>{" "}
                      <span className="text-text-2">{PAYMENT_KIND_LABEL[x.kind]}</span>
                      {Number(x.bankCharges) > 0 && (
                        <span className={cn("text-xs text-muted", x.voided && "line-through")}> + {money(x.bankCharges, x.currency)} bank charges</span>
                      )}
                    </p>
                    <p className="text-xs text-muted">
                      {date(x.paidOn)} · {PAYMENT_METHOD_LABEL[x.method]}
                      {x.reference && ` · ${x.reference}`}
                    </p>
                    {x.note && <p className="text-xs text-text-2">{x.note}</p>}
                    {x.voided && (
                      <p className="text-xs">
                        <Badge tone="bad">Removed</Badge> {x.voided.reason}
                      </p>
                    )}
                  </div>
                  {(canManage || canPay) && !x.voided && (
                    <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto">
                      {canPay && <EditCustomerPayment action={editPaymentAction.bind(null, o.id, x.id, o.currency)} payment={x} currency={o.currency} today={now} />}
                      {canManage && <VoidPayment action={voidPaymentAction.bind(null, o.id, x.id)} />}
                    </div>
                  )}
                </li>
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
