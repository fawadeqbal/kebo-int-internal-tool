import { Paperclip } from "lucide-react";
import { can, PAYMENT_KIND_LABEL, PAYMENT_METHOD_LABEL } from "@kebo/shared";
import { Badge, cn } from "@kebo/ui";
import type { orderOf, orderPaymentsOf } from "@/lib/order-data";
import { date, dateTime, money } from "@/lib/format";
import type { Me } from "@/lib/session";
import type { PaymentStatus } from "@/lib/types-orders";
import { EditCustomerPayment } from "@/components/money/forms";
import { RecordTable } from "@/components/money/payment-record";
import { AttachedFile } from "@/components/money/attachment";
import { editPaymentAction, removePaymentFileAction } from "../../money/actions";
import { voidPaymentAction } from "../actions";
import { VoidPayment } from "./forms";

/** The money parts of the Payment and Factory order steps (moved from the old Payments tab, unchanged). */

const PAY_STATUS: Record<PaymentStatus, { label: string; tone: "neutral" | "warn" | "info" | "ok" }> = {
  unpaid: { label: "Nothing received", tone: "warn" },
  partly_paid: { label: "Part-paid", tone: "warn" },
  deposit_paid: { label: "Deposit received", tone: "info" },
  paid: { label: "Paid in full", tone: "ok" },
  overpaid: { label: "Overpaid", tone: "warn" },
};

/** The payments received from the customer, each with its slip, change and remove. */
export function PaymentsReceived({
  o,
  p,
  me,
  now,
}: {
  o: Awaited<ReturnType<typeof orderOf>>;
  p: Awaited<ReturnType<typeof orderPaymentsOf>>;
  me: Me;
  now: string;
}) {
  const c = o.currency;
  const canPay = can(me, "payments.record") && o.status !== "cancelled";
  const canManage = can(me, "orders.manage");
  return (
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
            { label: "Amount", align: "right", hideBelow: "sm" },
            { label: "Counts as", align: "right" },
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
                {x.paidByName && <span className="block text-xs text-muted">paid by {x.paidByName}</span>}
              </span>,
              <span key="r" className="whitespace-nowrap text-text-2">
                {money(x.receivedAmount ?? x.amount, x.receivedCurrency ?? x.currency)}
              </span>,
              <span key="a" className="font-semibold whitespace-nowrap">
                {money(x.amount, x.currency)}
              </span>,
              <span key="b" className={Number(x.bankCharges) > 0 ? "text-text-2" : "text-muted"}>
                {Number(x.bankCharges) > 0 ? money(x.bankCharges, x.currency) : "—"}
              </span>,
              x.file ? (
                <Paperclip key="f" className="size-4 text-text-2" aria-label="Bank slip" />
              ) : (
                <span key="f" className="text-muted">
                  —
                </span>
              ),
            ],
            fields: [
              { label: "Amount received", value: <span className="tabular">{money(x.receivedAmount ?? x.amount, x.receivedCurrency ?? x.currency)}</span> },
              ...(x.receivedCurrency && x.receivedCurrency !== x.currency
                ? [
                    {
                      label: "Rate",
                      value: (
                        <span className="tabular">
                          1 {x.currency} = {x.rate} {x.receivedCurrency} · {money(x.amount, x.currency)} off the order
                        </span>
                      ),
                    },
                  ]
                : []),
              ...(x.paidByName ? [{ label: "Paid by", value: x.paidByName }] : []),
              ...(x.receiptId ? [{ label: "One transfer", value: "Paid several orders (and maybe credit): changed or removed on the customer's page" }] : []),
              {
                label: "Bank charges",
                value: Number(x.bankCharges) > 0 ? <span className="tabular">{money(x.bankCharges, x.currency)}</span> : "None",
              },
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
                    {money(x.after.received, x.currency)} received ·{" "}
                    {Number(x.after.due) > 0 ? `${money(x.after.due, x.currency)} still due` : "paid in full"}
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
                ? [
                    {
                      label: "Removed",
                      value: <span className="text-bad">{`${dateTime(x.voided.at)}${x.voided.reason ? `: ${x.voided.reason}` : ""}`}</span>,
                      wide: true,
                    },
                  ]
                : []),
            ],
            actions:
              (canManage || canPay) && !x.voided && !x.receiptId ? (
                <>
                  {canPay && (
                    <EditCustomerPayment action={editPaymentAction.bind(null, o.id, x.id, c)} payment={x} currency={c} today={now} />
                  )}
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
  );
}

/** One part of the tab: what it is and whose money, its one button, then its tables. */
export function MoneySection({
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
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-2 [&_svg]:size-4">
            {icon}
          </span>
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
export function CustomerSummary({ o }: { o: Awaited<ReturnType<typeof orderOf>> }) {
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
            <dd className={cn("truncate text-base font-bold tabular sm:text-xl", due > 0.005 ? "text-warn" : "text-ok")}>
              {money(o.money.due, c)}
            </dd>
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
            <span
              aria-hidden
              className="absolute top-0 bottom-0 w-0.5 bg-surface"
              style={{ left: `${o.depositPercent}%` }}
              title={`Deposit ${o.depositPercent}%`}
            />
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
