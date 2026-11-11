import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { can, PAYMENT_RECORD_KINDS, PAYMENT_STATUS_LABEL, type PaymentRecordKind, type PaymentView } from "@kebo/shared";
import { ButtonLink, Card, CardBody, CardHeader, DetailList, PageHeader, StatusBadge } from "@kebo/ui";
import { api } from "@/lib/api";
import { date, dateTime, TZ } from "@/lib/format";
import { crumbsFor } from "@/lib/nav";
import { requireUser } from "@/lib/session";
import { UUID } from "@/lib/ids";
import type { ReactNode } from "react";
import { todayIn } from "@kebo/utils";
import { EditCustomerPayment, EditFactoryPayment, VoidForm } from "@/components/money/forms";
import { AttachedFile } from "@/components/money/attachment";
import { orderMoneyOf, orderOf, orderPaymentsOf } from "@/lib/order-data";
import { getPeople, getSettings } from "@/lib/loaders";
import type { Me } from "@/lib/session";
import { editPaymentAction, factoryPaymentAction, removePaymentFileAction } from "../../../money/actions";
import { voidPaymentAction } from "../../actions";
import { opensPayments } from "../../shared";

export const metadata = { title: "Payment" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const STATUS_MEANING = { to_verify: "warn", sent_back: "bad", recorded: "ok", void: "neutral" } as const;

/** One payment: what it was, who it was from or to, what it paid, its proof, who recorded it, and its ledger posting. */
export default async function PaymentPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const me = await requireUser();
  if (!opensPayments(me)) redirect("/forbidden");
  const { kind, id } = await params;
  if (!(PAYMENT_RECORD_KINDS as readonly string[]).includes(kind) || !UUID.test(id)) notFound();
  const p = await api.get<PaymentView>(`/treasury/payments/${kind as PaymentRecordKind}/${id}`).catch(() => null);
  if (!p) notFound();
  const order = p.for.find((f) => f.href?.startsWith("/orders/"));
  const { change, proof } = await recordTools(me, p);

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader
        crumbs={[...crumbsFor("/payments").slice(0, 1), { label: "Payments", href: "/payments" }, { label: p.number ?? p.title }]}
        title={p.title}
        badge={<StatusBadge meaning={STATUS_MEANING[p.status]}>{PAYMENT_STATUS_LABEL[p.status]}</StatusBadge>}
        summary={
          <>
            {p.party ? (
              p.party.href ? (
                <Link href={p.party.href} className="font-medium text-primary hover:underline">
                  {p.party.label}
                </Link>
              ) : (
                p.party.label
              )
            ) : null}
            {p.party && " · "}
            {date(p.on)}
            {p.number && ` · ${p.number}`}
          </>
        }
        primary={
          order?.href ? (
            <ButtonLink href={order.href} size="sm">
              Open {order.label}
            </ButtonLink>
          ) : undefined
        }
      />
      {p.voided && (
        <p className="rounded-lg bg-surface-2 px-4 py-3 text-sm">
          Removed {dateTime(p.voided.at)}
          {p.voided.reason && <>: {p.voided.reason}</>}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3">
          <Card>
            <CardHeader title={p.what} />
            <CardBody>
              <DetailList
                items={[
                  ...(p.party
                    ? [
                        {
                          label: p.direction === "in" ? "From" : "To",
                          value: p.party.href ? (
                            <Link href={p.party.href} className="text-primary hover:underline">
                              {p.party.label}
                            </Link>
                          ) : (
                            p.party.label
                          ),
                        },
                      ]
                    : []),
                  ...p.fields
                    .map((f) => ({ ...f, value: ISO_DATE.test(f.value) ? date(f.value) : f.value }))
                    .map((f) => ({
                      label: f.label,
                      value: f.href ? (
                        <Link href={f.href} className="text-primary hover:underline">
                          {f.value}
                        </Link>
                      ) : (
                        f.value
                      ),
                    })),
                  { label: "Account", value: p.account ?? "Not on an account yet" },
                  ...(p.reference ? [{ label: "Bank reference", value: p.reference }] : []),
                ]}
              />
            </CardBody>
          </Card>
          {(change || p.voidPath) && (
            <div className="flex flex-wrap items-start gap-2">
              {change}
              {p.voidPath && <VoidForm action={voidPaymentAction.bind(null, p.voidPath)} label="this payment" />}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Proof" />
            <CardBody>
              {proof ? (
                proof
              ) : p.file ? (
                <a href={p.file.href} className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
                  <FileText className="size-4" aria-hidden /> {p.file.name}
                </a>
              ) : (
                <p className="text-sm text-muted">No file attached.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Record" />
            <CardBody className="flex flex-col gap-2 text-sm">
              <p>
                {p.kind === "submission" ? "Sent" : "Recorded"} by {p.recordedBy ?? "someone"}, {dateTime(p.recordedAt)}
              </p>
              {p.ledgerHref && (
                <Link href={p.ledgerHref} className="font-medium text-primary hover:underline">
                  View in the general ledger
                </Link>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * Change and Proof for a customer or supplier payment: the same forms the order used, with the
 * same data, so a payment is changed in one place (here) whatever page it was recorded from.
 */
async function recordTools(me: Me, p: PaymentView): Promise<{ change: ReactNode; proof: ReactNode }> {
  const none = { change: null, proof: null };
  if (!p.orderId || p.voided) return none;
  const today = todayIn(TZ);
  if (p.kind === "customer") {
    const [pays, o] = await Promise.all([orderPaymentsOf(p.orderId), orderOf(p.orderId)]);
    // The payment on the order this entry is (it pays that one order in full).
    const x = pays.payments.find((y) => y.id === p.partId);
    if (!x) return none;
    const records = can(me, "payments.record");
    return {
      change:
        records && !x.receiptId ? (
          <EditCustomerPayment
            action={editPaymentAction.bind(null, p.orderId, x.id, o.currency)}
            payment={x}
            currency={o.currency}
            today={today}
          />
        ) : null,
      proof: (
        <AttachedFile
          src={`/files/payments/${x.id}`}
          file={x.file}
          what="Bank slip"
          canChange={records}
          remove={removePaymentFileAction.bind(null, "in", x.id, p.orderId)}
          empty="No bank slip"
        />
      ),
    };
  }
  if (p.kind === "supplier") {
    const [m, people, settings] = await Promise.all([orderMoneyOf(p.orderId), getPeople(), getSettings()]);
    const f = m.factories;
    const x = f?.payments.find((y) => y.id === p.id);
    if (!f || !x) return none;
    return {
      change: f.canRecord ? (
        <EditFactoryPayment
          action={factoryPaymentAction.bind(null, m.orderId, x.id)}
          factories={f.rows}
          people={people}
          orderCurrency={m.currency}
          fx={{ main: settings.sales.currency, rates: settings.sales.exchangeRates }}
          today={today}
          payment={x}
        />
      ) : null,
      proof: (
        <AttachedFile
          src={`/files/factory-payments/${x.id}`}
          file={x.file}
          what="Bank slip"
          canChange={f.canRecord}
          remove={removePaymentFileAction.bind(null, "out", x.id, m.orderId)}
          empty="No bank slip"
        />
      ),
    };
  }
  return none;
}
