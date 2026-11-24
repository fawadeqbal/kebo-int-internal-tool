import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Check, FileText } from "lucide-react";
import { can, PAYMENT_RECORD_KINDS, PAYMENT_RECORD_LABEL, PAYMENT_STATUS_LABEL, type PaymentRecordKind, type PaymentView } from "@kebo/shared";
import { Avatar, ButtonLink, Card, CardBody, CardHeader, DetailList, RefCode, StatusBadge, Table, Td, Th, THead, Tr, EmptyLine, Notice, linkClass, cn } from "@kebo/ui";
import { api } from "@/lib/api";
import { date, dateTime, companyToday } from "@/lib/format";
import { crumbsFor } from "@/lib/nav";
import { requireUser } from "@/lib/session";
import { UUID } from "@/lib/ids";
import type { ReactNode } from "react";
import { VoidWindow } from "@/components/money/forms";
import { MoreMenu } from "@/components/common/more-menu";
import { AttachedFile } from "@/components/money/attachment";
import { MoneyHero } from "@/components/money/money-hero";
import { ChangeCustomerPayment, ChangeExpense, ChangeSupplierPayment } from "@/components/money/payment-change";
import type { ExpenseView } from "@/lib/types-money";
import { orderMoneyOf, orderOf, orderPaymentsOf } from "@/lib/order-data";
import { getPeople, getSettings } from "@/lib/loaders";
import type { Me } from "@/lib/session";
import { fieldLabel, hiddenChange, shown } from "@/components/common/history-words";
import { editPaymentAction, factoryPaymentAction } from "../../../money/actions";
import { removeRecordFileAction, voidPaymentAction } from "../../actions";
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

/** Which way the money went, as the amount's title says it. */
const HERO_KIND: Partial<Record<PaymentRecordKind, string>> = {
  customer: "Payment received",
  credit: "Paid from credit",
  refund: "Refund paid",
  supplier: "Payment made",
  expense: "Expense",
  transfer: "Moved between accounts",
  submission: "Sent for verification",
};
/** The paper a payment prints: the customer's receipt (kept as recorded on the order), else its voucher. */
function paperOf(p: PaymentView): { label: string; href: string } | null {
  if (p.kind === "customer") return p.orderId && p.partId ? { label: "Print receipt", href: `/print/orders/${p.orderId}/payment-receipt?ref=${p.partId}` } : null;
  if (p.kind === "supplier" || p.kind === "expense") return { label: "Print voucher", href: `/print/payments/${p.kind}/${p.id}` };
  return null;
}
const amountText = (v: string, currency: string) => `${currency} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * One payment, the same page for every kind (received, paid to a supplier, an expense…): the amount first, then the
 * same details in the same order, what it paid, its file, and who recorded it. Only the colour, the sign and the
 * kind's own rows (rate, bank charges, category, who bears it) differ.
 */
export default async function PaymentPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const me = await requireUser();
  if (!opensPayments(me)) redirect("/forbidden");
  const { kind, id } = await params;
  if (!(PAYMENT_RECORD_KINDS as readonly string[]).includes(kind) || !UUID.test(id)) notFound();
  const p = await paymentOf(kind as PaymentRecordKind, id);
  if (!p) notFound();
  const order = p.for.find((f) => f.href?.startsWith("/orders/"));
  const change = await changeOf(me, p);
  const paper = paperOf(p);
  const fileKind = p.kind === "customer" || p.kind === "supplier" || p.kind === "expense" ? p.kind : null;
  // The customer's file is kept on the payment on the order (one order paid in full); the others on the record.
  const fileId = p.kind === "customer" ? p.partId : p.id;
  const canAttach =
    !p.voided && fileKind !== null && !!fileId && can(me, fileKind === "expense" ? "expenses.manage" : "payments.record");

  const title = titleOf(p);
  const partyLabel = p.direction === "in" ? "From" : "To";
  const partyValue = p.party ? (
    p.party.href ? (
      <Link href={p.party.href} className={linkClass}>
        {p.party.label}
      </Link>
    ) : (
      p.party.label
    )
  ) : (
    "—"
  );
  const fieldItems = [
    ...(p.number ? [{ label: "Number", value: <RefCode>{p.number}</RefCode> }] : []),
    { label: "Date", value: date(p.on) },
    ...(p.kind === "transfer" ? [] : [{ label: partyLabel, value: partyValue }]),
    { label: "Method", value: p.method ?? "—" },
    { label: "Account", value: p.account ?? <span className="text-warn">Not chosen</span> },
    { label: "Reference", value: p.reference ?? "—" },
    ...p.fields.map((f) => {
      const value = ISO_DATE.test(f.value) ? date(f.value) : f.value;
      return {
        label: f.label,
        value: f.href ? (
          <Link href={f.href} className={linkClass}>
            {value}
          </Link>
        ) : (
          value
        ),
      };
    }),
    ...(p.kind === "transfer" ? [] : [{ label: p.direction === "in" ? "Paid by" : "Paid by", value: p.paidBy ?? "—" }]),
    { label: p.kind === "submission" ? "Sent by" : "Recorded by", value: `${p.recordedBy ?? "someone"} · ${dateTime(p.recordedAt)}` },
  ];
  const parts = p.parts ?? [];
  const partsTotal = parts.filter((x) => !x.released).reduce((t, x) => t + Number(x.amount), 0);
  const heroLine = [
    `${p.direction === "in" ? "Received" : p.direction === "out" ? "Paid" : "Moved"} ${date(p.on)}`,
    p.method,
    p.account ? `${p.direction === "in" ? "into" : "from"} ${p.account}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

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
              summary: [amountText(p.amount, p.currency), p.party?.label, p.for.map((f) => f.label).join(", ") || null, date(p.on)].filter(Boolean).join(" · "),
              actions: (
                <>
                  {paper && (
                    <ButtonLink href={`${paper.href}${paper.href.includes("?") ? "&" : "?"}back=${encodeURIComponent(`/payments/${p.kind}/${p.id}`)}`} variant="secondary">
                      <FileText aria-hidden /> {paper.label}
                    </ButtonLink>
                  )}
                  {order?.href && (
                    <ButtonLink href={order.href} variant="secondary">
                      Open {order.label}
                    </ButtonLink>
                  )}
                </>
              ),
              more:
                p.voidPath || change ? (
                  <MoreMenu
                    label={`More for ${p.number ?? "this payment"}`}
                    items={[...(change ? [{ label: "Change", panel: "change" }] : []), ...(p.voidPath ? [{ label: "Remove this payment", panel: "remove", danger: true as const }] : [])]}
                  />
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
                    Check that {amountText(p.amount, p.currency)} reached{p.account ? ` ${p.account}` : " the account"} on {date(p.on)}.
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
        panelLabel="Activity beside the payment"
        panel={
          <Card>
            <CardHeader title="Activity" />
            <CardBody className="flex flex-col gap-3 text-sm">
              <HistoryLine who={p.recordedBy} what={p.kind === "submission" ? "Sent for verification" : "Recorded"} at={p.recordedAt} />
              {(p.changes ?? []).map((c) => (
                <HistoryLine
                  key={c.at}
                  who={c.by}
                  what={`Changed${c.what.length ? `: ${c.what.filter((x) => !hiddenChange(x)).map((x) => `${fieldLabel(x.field)} ${shown(x.from)} → ${shown(x.to)}`).join(" · ")}` : ""}`}
                  reason={c.reason}
                  at={c.at}
                />
              ))}
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
        <MoneyHero
          kind={HERO_KIND[p.kind] ?? kindOf(p)}
          direction={p.direction}
          amount={p.amount}
          currency={p.currency}
          inMain={p.inMain}
          line={heroLine}
          party={p.party ? { label: partyLabel, value: p.party.label } : null}
          className={p.voided ? "opacity-60" : undefined}
        />
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DetailList columns={2} items={fieldItems} />
          </CardBody>
        </Card>
        {parts.length > 0 && (
          <Card>
            <CardHeader title="Applied to" />
            <Table>
              <THead>
                <tr>
                  <Th>Record</Th>
                  <Th>For</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </THead>
              <tbody>
                {parts.map((x, i) => (
                  <Tr key={i} href={x.href} className={x.released ? "text-muted line-through" : undefined}>
                    <Td>
                      <Link href={x.href}>
                        <RefCode>{x.order}</RefCode>
                      </Link>
                    </Td>
                    <Td>{x.part}</Td>
                    <Td className="text-right tabular">{amountText(x.amount, x.currency)}</Td>
                  </Tr>
                ))}
                {parts.length > 1 && (
                  <Tr className="border-t-2 border-line font-semibold">
                    <Td />
                    <Td>Total</Td>
                    <Td className="text-right tabular">{amountText(String(partsTotal), parts[0]!.currency)}</Td>
                  </Tr>
                )}
              </tbody>
            </Table>
          </Card>
        )}
        <Card>
          <CardHeader title="Attachments" />
          <CardBody>
            {fileKind && fileId ? (
              <AttachedFile
                src={`/files/${fileKind === "customer" ? "payments" : fileKind === "supplier" ? "factory-payments" : "expenses"}/${fileId}`}
                file={p.file}
                what={fileKind === "expense" ? "Receipt" : "Bank slip"}
                canChange={canAttach}
                remove={removeRecordFileAction.bind(null, fileKind, fileId)}
                empty="No file yet"
              />
            ) : p.file ? (
              <a href={p.file.href} className={cn(linkClass, "inline-flex items-center gap-2 text-sm")}>
                <FileText className="size-4" aria-hidden /> {p.file.name}
              </a>
            ) : (
              <EmptyLine>No file yet</EmptyLine>
            )}
          </CardBody>
        </Card>
        {change}
        {p.voidPath && <VoidWindow action={voidPaymentAction.bind(null, p.voidPath)} label="this payment" />}
      </RecordShell>
    </div>
  );
}

/** One line of a payment's history: who (initials), what, when. */
function HistoryLine({ who, what, at, reason }: { who: string | null; what: string; at: string; reason?: string | null }) {
  return (
    <div className="flex items-start gap-3">
      <Avatar name={who ?? "System"} size={28} />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <span className="block">{what}</span>
        {reason && <span className="block text-xs text-text-2">Why: {reason}</span>}
        <span className="block text-xs text-muted">
          {who ? `${who} · ` : ""}
          {dateTime(at)}
        </span>
      </span>
    </div>
  );
}

/**
 * The Change window of a payment, opened from ⋯: the same window the order (or the costs list) uses, with the same
 * data, so a payment is changed in one place whatever page it was recorded from.
 */
async function changeOf(me: Me, p: PaymentView): Promise<ReactNode> {
  if (p.voided) return null;
  const today = companyToday();
  if (p.kind === "customer" && p.orderId) {
    const [pays, o] = await Promise.all([orderPaymentsOf(p.orderId), orderOf(p.orderId)]);
    // The payment on the order this entry is (it pays that one order in full).
    const x = pays.payments.find((y) => y.id === p.partId);
    if (!x || x.receiptId || !can(me, "payments.record")) return null;
    return <ChangeCustomerPayment action={editPaymentAction.bind(null, p.orderId, x.id, o.currency, x.updatedAt)} payment={x} currency={o.currency} today={today} />;
  }
  if (p.kind === "supplier" && p.orderId) {
    const [m, people, settings] = await Promise.all([orderMoneyOf(p.orderId), getPeople(), getSettings()]);
    const f = m.factories;
    const x = f?.payments.find((y) => y.id === p.id);
    if (!f || !x || !f.canRecord) return null;
    return (
      <ChangeSupplierPayment
        action={factoryPaymentAction.bind(null, m.orderId, x.id, x.updatedAt)}
        factories={f.rows}
        people={people}
        orderCurrency={m.currency}
        fx={{ main: settings.sales.currency, rates: settings.sales.exchangeRates }}
        today={today}
        payment={x}
      />
    );
  }
  if (p.kind === "expense" && can(me, "expenses.manage")) {
    const [e, people, settings] = await Promise.all([api.get<ExpenseView>(`/expenses/${p.id}`).catch(() => null), getPeople(), getSettings()]);
    if (!e) return null;
    return <ChangeExpense e={e} people={people} fx={{ main: settings.sales.currency, rates: settings.sales.exchangeRates }} today={today} />;
  }
  return null;
}
