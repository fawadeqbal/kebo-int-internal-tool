import { ArrowDownLeft, ArrowUpRight, ChartLine, Paperclip } from "lucide-react";
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
import { termsOf } from "../shared";

export const metadata = { title: "Order payments" };

const PAY_STATUS: Record<PaymentStatus, { label: string; tone: "neutral" | "warn" | "info" | "ok" }> = {
  unpaid: { label: "Nothing received", tone: "warn" },
  partly_paid: { label: "Part-paid", tone: "warn" },
  deposit_paid: { label: "Deposit received", tone: "info" },
  paid: { label: "Paid in full", tone: "ok" },
  overpaid: { label: "Overpaid", tone: "warn" },
};

/**
 * The order's money on one page, in three sections, each with its own
 * button: from the customer (everyone), to the factory (people who see
 * costs) and costs and profit (managers). The cards at the top jump to them.
 */
export default async function OrderPaymentsTab({ params }: { params: Promise<{ id: string }> }) {
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
  const c = o.currency;
  const due = Number(o.money.due);

  const owing = m.factories?.rows.filter((r) => Number(r.toPay) > 0) ?? [];
  const owingIn = [...new Set(owing.map((r) => r.currency))];
  const factoryNames = [...new Set(m.factories?.rows.map((r) => r.factory.name) ?? [])];
  const glance: { href: string; label: string; value: string; tone?: string }[] = [
    { href: "#customer", label: "The customer still owes", value: due > 0.005 ? money(o.money.due, c) : "Nothing", tone: due > 0.005 ? "text-warn" : "text-ok" },
  ];
  if (m.factories)
    glance.push({
      href: "#factory",
      label: "We still pay the factory",
      value:
        owing.length === 0
          ? m.factories.rows.length
            ? "Nothing"
            : "No factory cost"
          : owingIn.length === 1
            ? money(owing.reduce((t, r) => t + Number(r.toPay), 0), owingIn[0]!)
            : `${owing.length} factories`,
      tone: owing.length ? undefined : "text-ok",
    });
  if (m.expenses && m.profit)
    glance.push({ href: "#costs", label: "Expected profit", value: money(m.profit.earned, c), tone: Number(m.profit.earned) < 0 ? "text-bad" : "text-ok" });

  return (
    <div className="flex flex-col gap-5">
      {glance.length > 1 && (
        <nav aria-label="On this tab" className="grid gap-3 sm:grid-cols-3">
          {glance.map((g) => (
            <a key={g.href} href={g.href} className="rounded-xl border border-line bg-surface px-4 py-3 hover:border-line-strong">
              <span className="block text-xs text-muted">{g.label}</span>
              <span className={cn("block text-lg font-bold tabular", g.tone)}>{g.value}</span>
            </a>
          ))}
        </nav>
      )}

      <MoneySection
        id="customer"
        icon={<ArrowDownLeft aria-hidden />}
        title="From the customer"
        sub={`${o.customer.name} pays us · ${termsOf(o)}`}
        action={
          canPay && <PaymentForm quiet label="Money received from customer" action={paymentAction.bind(null, o.id, c)} currency={c} depositDue={p.depositDue} due={p.due} today={now} />
        }
      >
        <CustomerSummary o={o} />
        <PaymentPlan plan={m.plan} currency={c} total={m.total} terms={m.terms} action={savePlanAction.bind(null, o.id)} />
        <section aria-label="Payments received" className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            Payments received <span className="font-normal text-muted">· bank charges the banks kept count as paid</span>
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
                { label: "Bank slip", hideBelow: "sm", width: "w-20" },
              ]}
              rows={p.payments.map((x) => ({
                key: x.id,
                label: `Payment of ${money(x.amount, x.currency)} on ${date(x.paidOn)}`,
                removed: !!x.voided,
                cells: [
                  <span key="d" className="whitespace-nowrap">
                    {date(x.paidOn)}
                  </span>,
                  <span key="k">
                    {PAYMENT_KIND_LABEL[x.kind]} {x.voided && <Badge tone="bad">Removed</Badge>}
                  </span>,
                  <span key="m" className="text-text-2">
                    {PAYMENT_METHOD_LABEL[x.method]}
                    {x.reference && ` · ${x.reference}`}
                  </span>,
                  <span key="a" className="font-semibold whitespace-nowrap">
                    {money(x.amount, x.currency)}
                  </span>,
                  <span key="b" className={Number(x.bankCharges) > 0 ? "text-text-2" : "text-muted"}>
                    {Number(x.bankCharges) > 0 ? money(x.bankCharges, x.currency) : "—"}
                  </span>,
                  x.file ? <Paperclip key="f" className="size-4 text-text-2" aria-label="Bank slip" /> : <span key="f" className="text-muted">—</span>,
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
                    label: "Bank slip",
                    value: (
                      <AttachedFile
                        src={`/files/payments/${x.id}`}
                        file={x.file}
                        what="Bank slip"
                        canChange={can(me, "payments.record") && !x.voided}
                        remove={removePaymentFileAction.bind(null, "in", x.id, o.id)}
                        empty="No bank slip"
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
                  <span key="a" className="whitespace-nowrap">
                    {money(amount, c)}
                  </span>,
                  charges > 0 ? money(charges, c) : "—",
                  "",
                ];
              })()}
            />
          )}
        </section>
      </MoneySection>

      {m.factories && (
        <MoneySection
          id="factory"
          icon={<ArrowUpRight aria-hidden />}
          title="To the factory"
          tag="Internal"
          sub={factoryNames.length ? `We pay ${factoryNames.join(", ")} for the goods` : "What we owe the factories for this order"}
          action={
            m.factories.canRecord &&
            owing.length > 0 && (
              <NewFactoryPayment quiet label="Money paid to factory" action={factoryPaymentAction.bind(null, m.orderId, null)} factories={owing} people={people} orderCurrency={c} fx={fx} today={now} />
            )
          }
        >
          <FactoriesView m={m} people={people} today={now} fx={fx} />
        </MoneySection>
      )}

      {m.expenses && (
        <MoneySection
          id="costs"
          icon={<ChartLine aria-hidden />}
          title="Costs and profit"
          tag="Managers"
          sub="Freight, inspection, tickets and other costs, and what the order earns"
          action={
            !m.cancelled && (
              <NewExpense quiet label="Cost on this order" action={expenseAction.bind(null, m.orderId, null)} people={people} mainCurrency={settings.sales.currency} fx={fx} today={now} />
            )
          }
        >
          <ProfitView m={m} people={people} today={now} mainCurrency={settings.sales.currency} fx={fx} />
        </MoneySection>
      )}
    </div>
  );
}

/** One part of the tab: what it is and whose money, its one button, then its tables. */
function MoneySection({
  id,
  icon,
  title,
  sub,
  tag,
  action,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  sub: string;
  tag?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-2 [&_svg]:size-4">{icon}</span>
          <span className="min-w-0">
            <h2 id={`${id}-title`} className="flex flex-wrap items-center gap-2 text-base font-semibold">
              {title} {tag && <Badge tone="neutral">{tag}</Badge>}
            </h2>
            <span className="block text-sm text-text-2">{sub}</span>
          </span>
        </div>
        {action && <div className="has-[form]:basis-full">{action}</div>}
      </div>
      <div className="flex flex-col gap-5 p-4">{children}</div>
    </section>
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
    <section aria-label="Money from the customer" className="flex flex-col gap-4 rounded-lg bg-surface-2/60 p-4">
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
