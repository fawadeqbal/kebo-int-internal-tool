import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { can, PAYMENT_KIND_LABEL, PAYMENT_METHOD_LABEL } from "@kebo/shared";
import { Badge, Card, CardBody, CardHeader, EmptyState, Table, Td, Th, THead, Tr, cn } from "@kebo/ui";
import { toMinor, fromMinor } from "@kebo/money";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { date, money } from "@/lib/format";
import type { OrderView } from "@/lib/types";
import type { FactoryOrder, PaymentsView } from "@/lib/types-orders";
import { PaymentInForm, PaymentOutForm, VoidPayment, type PayableFactoryOrder } from "@/components/orders/payment-forms";
import { today } from "@/components/orders/today";
import { paymentInAction, paymentOutAction, voidPaymentAction } from "./actions";

export const metadata = { title: "Payments" };

const STATUS: Record<string, { label: string; tone: "neutral" | "warn" | "info" | "ok" }> = {
  unpaid: { label: "Nothing received", tone: "warn" },
  partly_paid: { label: "Part-paid", tone: "warn" },
  deposit_paid: { label: "Deposit received", tone: "info" },
  paid: { label: "Paid in full", tone: "ok" },
  overpaid: { label: "Overpaid", tone: "warn" },
};

export default async function PaymentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const me = await requireUser();
  const [o, p, fos] = await Promise.all([
    api.get<OrderView>(`/orders/${id}`),
    api.get<PaymentsView>(`/orders/${id}/payments`),
    api.get<FactoryOrder[]>(`/orders/${id}/factory-orders`),
  ]);
  const canPay = can(me.role, "payments.record") && o.status !== "cancelled";
  const canVoid = can(me.role, "orders.manage");
  const canOverride = can(me.role, "milestones.override");
  const c = p.customer;
  const st = STATUS[c.status] ?? { label: c.status, tone: "neutral" as const };
  const payable: PayableFactoryOrder[] = fos
    .filter((f) => f.status === "sent" || f.status === "confirmed")
    .filter((f) => Number(f.outstanding) > 0)
    .map((f) => ({
      id: f.id,
      label: `${f.refNo} · ${f.factory.name} · ${money(f.outstanding, f.currency)} owed`,
      currency: f.currency,
      depositDue: fromMinor(Math.max(0, toMinor(f.deposit) - toMinor(f.paid))),
      outstanding: f.outstanding,
    }));
  const sent = fos.filter((f) => f.status === "sent" || f.status === "confirmed");
  const factoryGate = o.plan.steps.find((s) => s.key === "factory_deposit" && s.status === "todo")?.blockedBy?.message ?? null;

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title="The customer's payments"
          description={`In ${p.currency}. Bank charges the banks deducted count as paid.`}
          actions={<Badge tone={st.tone}>{st.label}</Badge>}
        />
        <CardBody>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {[
              { label: "Due in all", value: money(c.due, p.currency) },
              { label: "Received", value: money(c.received, p.currency) },
              { label: "Bank charges", value: money(c.bankCharges, p.currency) },
              { label: "Still to come", value: money(c.outstanding, p.currency), strong: Number(c.outstanding) > 0 },
              { label: "Deposit still missing", value: money(c.depositOutstanding, p.currency), warn: Number(c.depositOutstanding) > 0 },
            ].map((x) => (
              <div key={x.label} className="rounded-lg border border-line p-3">
                <dt className="text-xs text-muted">{x.label}</dt>
                <dd className={cn("mt-0.5 font-semibold tabular", x.warn && "text-warn")}>{x.value}</dd>
              </div>
            ))}
          </dl>
          {canPay && (
            <div className="mt-4 flex flex-col items-start gap-3 [&>form]:w-full">
              <PaymentInForm
                action={paymentInAction.bind(null, o.id)}
                currency={p.currency}
                depositMissing={c.depositOutstanding}
                outstanding={c.outstanding}
                today={today()}
                defaultOpen={sp.new === "in"}
                canOverride={canOverride}
              />
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Paying the factories" description="Against each factory order, in its currency." />
        <CardBody className="flex flex-col gap-3">
          {sent.length === 0 ? (
            <p className="text-sm text-muted">
              No factory order has been sent yet. Payments to a factory are made against its order, once sent.
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {sent.map((f) => (
                <li key={f.id} className="rounded-lg border border-line p-3 text-sm">
                  <p className="font-medium">
                    {f.refNo} · {f.factory.name}
                  </p>
                  <p className="mt-0.5 text-xs text-muted tabular">
                    {money(f.total, f.currency)} · deposit {money(f.deposit, f.currency)} · paid {money(f.paid, f.currency)} ·{" "}
                    <span className={Number(f.outstanding) > 0 ? "font-medium text-text" : ""}>
                      {money(f.outstanding, f.currency)} owed
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          )}
          {canPay && sent.length > 0 && (
            <PaymentOutForm
              action={paymentOutAction.bind(null, o.id)}
              factoryOrders={payable}
              today={today()}
              defaultOpen={sp.new === "out"}
              canOverride={canOverride}
              gate={factoryGate}
              noneReason="Every factory order is paid in full."
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Every payment" description="Money in and out on this order. Voided payments stay listed, crossed out." />
        {p.payments.length === 0 ? (
          <EmptyState
            title="No payments yet"
            description={
              canPay ? "Record the customer's deposit when it reaches the bank." : "Accounts records payments when they reach the bank."
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Date</Th>
                <Th>In / out</Th>
                <Th>For</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">Bank charges</Th>
                <Th>Method · reference</Th>
                <Th>Note</Th>
                {canVoid && (
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                )}
              </tr>
            </THead>
            <tbody>
              {p.payments.map((x) => (
                <Tr key={x.id} className={cn(x.voided && "text-muted")}>
                  <Td className="whitespace-nowrap">{date(x.paidOn)}</Td>
                  <Td className="whitespace-nowrap">
                    {x.direction === "in" ? (
                      <span className="inline-flex items-center gap-1 text-ok">
                        <ArrowDownLeft className="size-4" aria-hidden /> From the customer
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-text-2">
                        <ArrowUpRight className="size-4" aria-hidden /> To {x.factory?.name ?? "a factory"}
                      </span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {PAYMENT_KIND_LABEL[x.kind]}
                    {x.factoryOrder && <span className="text-xs text-muted"> · {x.factoryOrder.refNo}</span>}
                  </Td>
                  <Td className={cn("text-right font-medium whitespace-nowrap tabular", x.voided && "line-through")}>
                    {money(x.amount, x.currency)}
                  </Td>
                  <Td className={cn("text-right whitespace-nowrap tabular", x.voided && "line-through")}>
                    {Number(x.bankCharges) ? money(x.bankCharges, x.currency) : "—"}
                  </Td>
                  <Td className="text-xs">
                    {PAYMENT_METHOD_LABEL[x.method]}
                    {x.reference && <span className="block text-muted">{x.reference}</span>}
                  </Td>
                  <Td className="max-w-64 text-xs">
                    {x.voided ? (
                      <span>
                        <Badge tone="bad">Void</Badge> {x.voided.reason}
                      </span>
                    ) : (
                      (x.note ?? "")
                    )}
                  </Td>
                  {canVoid && (
                    <Td className="text-right">{!x.voided && <VoidPayment action={voidPaymentAction.bind(null, o.id, x.id)} />}</Td>
                  )}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
