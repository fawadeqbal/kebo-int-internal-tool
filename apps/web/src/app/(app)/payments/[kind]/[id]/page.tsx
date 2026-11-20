import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Check, FileText } from "lucide-react";
import { can, PAYMENT_RECORD_KINDS, PAYMENT_RECORD_LABEL, PAYMENT_STATUS_LABEL, type PaymentRecordKind, type PaymentView } from "@kebo/shared";
import { Avatar, ButtonLink, Card, CardBody, CardHeader, DetailList, RefCode, StatusBadge, Table, Td, Th, THead, Tr, EmptyLine, Notice, linkClass, cn } from "@kebo/ui";
import { api } from "@/lib/api";
import { date, dateTime, companyToday, money } from "@/lib/format";
import { crumbsFor } from "@/lib/nav";
import { requireUser } from "@/lib/session";
import { UUID } from "@/lib/ids";
import type { ReactNode } from "react";
import { EditCustomerPayment, EditFactoryPayment, VoidWindow } from "@/components/money/forms";
import { MoreMenu } from "@/components/common/more-menu";
import { AttachedFile } from "@/components/money/attachment";
import { orderMoneyOf, orderOf, orderPaymentsOf } from "@/lib/order-data";
import { getPeople, getSettings } from "@/lib/loaders";
import type { Me } from "@/lib/session";
import { editPaymentAction, factoryPaymentAction, removePaymentFileAction } from "../../../money/actions";
import { voidPaymentAction } from "../../actions";
import { opensPayments } from "../../shared";
import { cache } from "react";
import { RecordShell } from "@/components/records/record-frame";
import { RecordTop } from "@/components/records/record-page";

/** One payment, read once per request (the page and its tab title). */
const paymentOf = cache((kind: PaymentRecordKind, id: string) => api.get<PaymentView>(`/treasury/payments/${kind}/${id}`).catch(() => null));
const NOUN: Partial<Record<PaymentRecordKind, string>> = { customer: "Receipt", supplier: "Supplier payment", expense: "Expense", transfer: "Transfer", refund: "Refund", credit: "From credit" };
/** Its title is its name in words (design rule 3: never its number); what it is and its number go under it. */
const titleOf = (p: PaymentView) => p.title;
const kindOf = (p: PaymentView) => NOUN[p.kind] ?? PAYMENT_RECORD_LABEL[p.kind];

export async function generateMetadata({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const p = (PAYMENT_RECORD_KINDS as readonly string[]).includes(kind) && UUID.test(id) ? await paymentOf(kind as PaymentRecordKind, id) : null;
  return { title: p ? titleOf(p) : "Payment" };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const STATUS_MEANING = { to_verify: "warn", sent_back: "bad", recorded: "ok", void: "neutral" } as const;

/** One payment: what it was, who it was from or to, what it paid, its proof, who recorded it, and its ledger posting. */
export default async function PaymentPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const me = await requireUser();
  if (!opensPayments(me)) redirect("/forbidden");
  const { kind, id } = await params;
  if (!(PAYMENT_RECORD_KINDS as readonly string[]).includes(kind) || !UUID.test(id)) notFound();
  const p = await paymentOf(kind as PaymentRecordKind, id);
  if (!p) notFound();
  const order = p.for.find((f) => f.href?.startsWith("/orders/"));
  const { change, proof } = await recordTools(me, p);

  const title = titleOf(p);
  const fieldItems = [
    ...(p.number ? [{ label: NOUN[p.kind] ?? "Number", value: <RefCode>{p.number}</RefCode> }] : []),
    ...(p.party
      ? [
          {
            label: p.kind === "customer" ? "Customer" : p.direction === "in" ? "From" : "To",
            value: p.party.href ? (
              <Link href={p.party.href} className="text-primary underline underline-offset-2 hover:opacity-80">
                {p.party.label}
              </Link>
            ) : (
              p.party.label
            ),
          },
        ]
      : []),
    ...p.fields
      .filter((f) => !p.parts?.length || !f.href?.startsWith("/orders/"))
      .map((f) => ({ ...f, value: ISO_DATE.test(f.value) ? date(f.value) : f.value }))
      .map((f) => ({
        label: f.label,
        value: f.href ? (
          <Link href={f.href} className={linkClass}>
            {f.value}
          </Link>
        ) : (
          f.value
        ),
      })),
    { label: p.direction === "in" ? "Reached account" : "Account", value: p.account ?? "Not on an account yet" },
    ...(p.reference ? [{ label: "Bank reference", value: p.reference }] : []),
    { label: p.kind === "submission" ? "Sent by" : "Recorded by", value: `${p.recordedBy ?? "someone"} · ${dateTime(p.recordedAt)}` },
  ];
  const partsTotal = (p.parts ?? []).filter((x) => !x.released).reduce((t, x) => t + Number(x.amount), 0);

  return (
    <div className="flex flex-col gap-4">
      <RecordShell
        top={
          <RecordTop
            header={{
              crumbs: [...crumbsFor("/payments").slice(0, 1), { label: "Payments", href: "/payments" }, { label: p.number ?? p.title }],
              title: title,
              record: { kind: kindOf(p), number: p.number },
              badge: <StatusBadge meaning={STATUS_MEANING[p.status]}>{PAYMENT_STATUS_LABEL[p.status]}</StatusBadge>,
              summary: [money(p.amount, p.currency), p.party?.label, p.for.map((f) => f.label).join(", ") || null, date(p.on)].filter(Boolean).join(" · "),
              actions: (
                order?.href ? (
            <ButtonLink href={order.href} variant="secondary">
              Open {order.label}
            </ButtonLink>
          ) : undefined
              ),
              more: p.voidPath ? (
                <MoreMenu label={`More for ${p.number ?? "this payment"}`} items={[{ label: "Remove this payment", panel: "remove", danger: true }]} />
              ) : undefined,
            }}
            notice={
        <>
          {p.status === "to_verify" && (
            <Notice
              tone="todo"
              title="Waiting for verification."
              action={
                <ButtonLink href="/approvals" variant="primary">
                  <Check aria-hidden /> Verify
                </ButtonLink>
              }
            >
              Check that {p.currency} {Number(p.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })} reached{p.account ? ` ${p.account}` : " the account"} on {date(p.on)}.
            </Notice>
          )}
          {p.voided && (
            <Notice tone="neutral" title={`Removed ${dateTime(p.voided.at)}`}>
              {p.voided.reason}
            </Notice>
          )}
        </>
            }
          />
        }
        panelLabel="Beside the payment"
        panel={
          <Card>
          <CardHeader title="History" />
          <CardBody className="flex flex-col gap-3 text-sm">
            <HistoryLine who={p.recordedBy} what={p.kind === "submission" ? "Sent for verification" : "Recorded"} at={p.recordedAt} />
            {p.voided && <HistoryLine who={null} what={`Removed${p.voided.reason ? `: ${p.voided.reason}` : ""}`} at={p.voided.at} />}
            {p.ledgerHref && (
              <Link href={p.ledgerHref} className={linkClass}>
                View in the general ledger
              </Link>
            )}
          </CardBody>
        </Card>
        }
      >
          <Card>
            <CardHeader title="Payment" />
            <CardBody>
              <DetailList columns={3} items={fieldItems} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Proof" />
            <CardBody>
              {proof ? (
                proof
              ) : p.file ? (
                <a href={p.file.href} className={cn(linkClass, "inline-flex items-center gap-2 text-sm")}>
                  <FileText className="size-4" aria-hidden /> {p.file.name}
                </a>
              ) : (
                <EmptyLine>No file attached.</EmptyLine>
              )}
            </CardBody>
          </Card>
          {p.parts && p.parts.length > 0 && (
            <Card>
              <CardHeader title="Where it goes" />
              <Table>
                <THead>
                  <tr>
                    <Th>Order</Th>
                    <Th>Part</Th>
                    <Th className="text-right">Amount</Th>
                  </tr>
                </THead>
                <tbody>
                  {p.parts.map((x, i) => (
                    <Tr key={i} href={x.href} className={x.released ? "text-muted line-through" : undefined}>
                      <Td>
                        <Link href={x.href}>
                          <RefCode>{x.order}</RefCode>
                        </Link>
                      </Td>
                      <Td>{x.part}</Td>
                      <Td className="text-right tabular">{Number(x.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</Td>
                    </Tr>
                  ))}
                  <Tr className="border-t-2 border-line font-semibold">
                    <Td />
                    <Td>Total</Td>
                    <Td className="text-right tabular">{partsTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</Td>
                  </Tr>
                </tbody>
              </Table>
            </Card>
          )}
          {change && <div className="flex flex-wrap items-start gap-2">{change}</div>}
          {p.voidPath && <VoidWindow action={voidPaymentAction.bind(null, p.voidPath)} label="this payment" />}
      </RecordShell>
    </div>
  );
}

/** One line of a payment's history: who (initials), what, when. */
function HistoryLine({ who, what, at }: { who: string | null; what: string; at: string }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar name={who ?? "System"} size={28} />
      <span>
        <span className="block">{what}</span>
        <span className="block text-xs text-muted">{dateTime(at)}</span>
      </span>
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
  const today = companyToday();
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
            action={editPaymentAction.bind(null, p.orderId, x.id, o.currency, x.updatedAt)}
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
          action={factoryPaymentAction.bind(null, m.orderId, x.id, x.updatedAt)}
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
