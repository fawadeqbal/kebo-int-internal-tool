import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { buttonClass, Card, CardBody, CardHeader, PageHeader, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { api } from "@/lib/api";
import { UUID } from "@/lib/ids";
import { load, requireUser } from "@/lib/session";
import { crumbsFor } from "@/lib/nav";
import { date, money } from "@/lib/format";
import type { RequestPage } from "@/lib/types-money";
import { recordPaymentHref } from "@/components/money/pay-links";
import { RequestStatus, SendRequest } from "@/components/money/requests";
import { requestPdfHref, requestPrintHref, requestWords } from "@/lib/requests";
import { LinkedDocuments } from "@/components/orders/overview-record";
import { sendRequestAction } from "../../../../money/actions";

export const metadata = { title: "Payment request" };

/**
 * One payment request (claude/core-plan.md, phase 1): a row of an order's plan as a document of its own.
 * What it asks for, where it stands (worked out, never typed), the one thing to do next, every copy kept
 * when it was sent (R1, R2…) and the payments that paid it.
 */
export default async function PaymentRequestPage({ params }: { params: Promise<{ order: string; ref: string }> }) {
  const { order, ref } = await params;
  if (!UUID.test(order) || !UUID.test(ref)) notFound();
  await requireUser();
  const r = await load(() => api.get<RequestPage>(`/orders/${order}/requests/${ref}`));
  const here = `/operations/payment-requests/${order}/${ref}`;
  const q = r.request;
  const c = r.currency;
  const last = r.copies.at(-1) ?? null;
  const send = sendRequestAction.bind(null, order, ref);
  const sendProps = {
    action: send,
    orderId: order,
    refId: ref,
    number: r.number,
    label: r.label,
    amount: r.amount,
    currency: c,
    dueOn: r.dueOn,
  };
  const state = r.cancelled ? "cancelled" : q!.state;
  const status = r.cancelled
    ? { state: "cancelled" as const, with: "request" as const, sentOn: last?.sentOn ?? null, revision: last?.revision ?? null }
    : { state: q!.state, with: q!.with, sentOn: q!.sentOn, revision: q!.revision, changed: q!.changed, through: q!.through };
  const payHref = recordPaymentHref({ kind: "in", order, amount: r.open, back: here });

  // The one thing to do next, in words, and the one button for it.
  const next: { title: string; meta: string; late?: boolean; button: React.ReactNode } | null = r.cancelled
    ? null
    : state === "paid"
      ? null
      : q!.changed && r.canSend
        ? {
            title: "Send it again: it no longer says what was sent",
            meta: `Sent ${last?.amount ? money(last.amount, c) : ""}${last?.dueOn ? `, due ${date(last.dueOn)}` : ""}; the plan now says ${money(r.amount, c)}${r.dueOn ? `, due ${date(r.dueOn)}` : ""}.`,
            button: <SendRequest {...sendProps} again primary size="md" />,
          }
        : state === "not_sent" && r.canSend
          ? {
              title: "Send it to the customer",
              meta: `${money(r.amount, c)}${r.dueOn ? ` · due ${date(r.dueOn)}` : ""}. It is kept exactly as it prints when you send it.`,
              button: <SendRequest {...sendProps} primary size="md" />,
            }
          : state === "not_sent" && q!.through === "bank"
            ? {
                title: "Send the papers to our bank",
                meta: "This part is paid through the banks: it is asked for with the shipping papers, not with a request.",
                button: (
                  <Link href={`/orders/${order}/documents`} className={buttonClass("primary", "md", "max-sm:w-full")}>
                    Open Documents & bank
                  </Link>
                ),
              }
            : r.canPay
              ? {
                  title:
                    r.late > 0 ? `Chase the payment: ${r.late} day${r.late === 1 ? "" : "s"} late` : "Record the payment when it arrives",
                  meta: `${money(r.open, c)} still to come${r.dueOn ? ` · due ${date(r.dueOn)}` : ""}.`,
                  late: r.late > 0,
                  button: (
                    <Link href={payHref} className={buttonClass("primary", "md", "max-sm:w-full")}>
                      Record payment
                    </Link>
                  ),
                }
              : null;

  const facts: { label: string; value: React.ReactNode }[] = [
    { label: "Amount", value: <span className="tabular">{money(r.amount, c)}</span> },
    {
      label: "Due",
      value: r.dueOn ? date(r.dueOn) : r.rule ? `${r.rule.charAt(0).toUpperCase()}${r.rule.slice(1)} · not known yet` : "No date yet",
    },
    { label: "Received", value: <span className="tabular">{money(r.paid, c)}</span> },
    { label: "Still due", value: <span className="tabular">{money(r.open, c)}</span> },
    {
      label: "Customer",
      value: (
        <Link href={`/customers/${r.customer.id}`} className="hover:text-primary">
          {r.customer.name}
        </Link>
      ),
    },
    {
      label: "Sales order",
      value: (
        <Link href={`/orders/${order}/payment`} className="hover:text-primary">
          {r.refNo}
        </Link>
      ),
    },
    ...(q?.sentOn
      ? [
          {
            label: "Sent",
            value: `${date(q.sentOn)}${q.sentBy ? ` by ${q.sentBy.name}` : ""}${q.with === "proforma" ? ` with proforma ${q.proformaNo ?? ""}` : q.with === "bank" ? " to our bank" : ""}`,
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        crumbs={[
          ...crumbsFor("/operations/payment-requests").map((x, i) => (i === 1 ? { ...x, href: "/operations/payment-requests" } : x)),
          { label: r.number },
        ]}
        icon={FileText}
        title={r.number}
        summary={`${r.label} · ${r.refNo} · ${r.customer.name}`}
        badge={<RequestStatus r={status} late={r.late} className="text-right" />}
        actions={
          !r.cancelled || last ? (
            <>
              <a href={requestPrintHref(order, ref, { back: here })} className={buttonClass("secondary", "sm")}>
                View / Print
              </a>
              <a href={requestPdfHref(order, ref)} className={buttonClass("ghost", "sm")}>
                PDF
              </a>
            </>
          ) : undefined
        }
      />

      {next && (
        <section
          aria-label="Do next"
          className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-line bg-surface px-4 py-3.5 sm:px-5"
        >
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
            <span className={next.late ? "text-xs font-semibold text-bad" : "text-xs font-semibold text-action"}>Do next</span>
            <span className="text-[17px] leading-snug font-bold">{next.title}</span>
            <span className="text-[13px] text-text-2">{next.meta}</span>
          </div>
          {next.button}
        </section>
      )}
      {r.cancelled && (
        <p className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-text-2">
          This request was sent and its part was then taken out of the order&rsquo;s plan. It is kept as it was sent; nothing is due on it.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="The request"
            description={state === "not_sent" ? "Not sent yet: it prints from the order as it is now." : undefined}
          />
          <CardBody>
            <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
              {facts.map((f) => (
                <div key={f.label} className="contents">
                  <dt className="text-muted">{f.label}</dt>
                  <dd className="font-medium">{f.value}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="overflow-hidden">
            <CardHeader title="Copies sent" description="Each stays exactly as it was sent." />
            {r.copies.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">
                {q?.with === "proforma"
                  ? `Asked for with proforma ${q.proformaNo ?? ""}. No separate request was sent.`
                  : q?.with === "bank"
                    ? "Asked for through the bank papers. No separate request was sent."
                    : "None yet."}
              </p>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Copy</Th>
                    <Th>Sent</Th>
                    <Th className="text-right">Amount</Th>
                    <Th className="hidden sm:table-cell">Due</Th>
                    <Th>
                      <span className="sr-only">Open</span>
                    </Th>
                  </tr>
                </THead>
                <tbody>
                  {[...r.copies].reverse().map((x) => (
                    <Tr key={x.paperId}>
                      <Td className="font-medium whitespace-nowrap">
                        R{x.revision}
                        {x.revision !== last?.revision && <span className="ml-1.5 text-xs font-normal text-muted">replaced</span>}
                      </Td>
                      <Td className="text-sm whitespace-nowrap">
                        {date(x.sentOn)}
                        {x.sentBy && <span className="block text-xs text-muted">{x.sentBy.name}</span>}
                      </Td>
                      <Td className="text-right whitespace-nowrap tabular">{x.amount ? money(x.amount, c) : "—"}</Td>
                      <Td className="hidden text-sm whitespace-nowrap sm:table-cell">{x.dueOn ? date(x.dueOn) : "On receipt"}</Td>
                      <Td className="text-right">
                        <a
                          href={requestPrintHref(order, ref, { v: x.revision, back: here })}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          View
                        </a>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title="Payments" description="Money pays the earliest request first." />
            {!q?.receipts.length ? (
              <p className="px-5 py-4 text-sm text-muted">Nothing received on it yet.</p>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Receipt</Th>
                    <Th>Paid on</Th>
                    <Th className="text-right">To this request</Th>
                    <Th>
                      <span className="sr-only">Open</span>
                    </Th>
                  </tr>
                </THead>
                <tbody>
                  {q.receipts.map((x) => (
                    <Tr key={x.id}>
                      <Td className="font-medium whitespace-nowrap">{x.number}</Td>
                      <Td className="text-sm whitespace-nowrap">{date(x.paidOn)}</Td>
                      <Td className="text-right whitespace-nowrap tabular">{money(x.amount, c)}</Td>
                      <Td className="text-right">
                        <a
                          href={`/print/orders/${order}/payment-receipt?${new URLSearchParams({ ref: x.id, back: here })}`}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          View
                        </a>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-4">
        <LinkedDocuments
          links={[
            { kind: "Sales order", label: r.refNo, href: `/orders/${order}` },
            ...(q?.with === "proforma" && q.proformaNo
              ? [
                  {
                    kind: "Proforma invoice",
                    label: q.proformaNo,
                    href: `/print/orders/${order}/proforma?back=${encodeURIComponent(here)}`,
                  },
                ]
              : []),
            { kind: "Customer", label: r.customer.name, href: `/customers/${r.customer.id}` },
          ]}
        />
      </div>
      <p className="sr-only">{requestWords(status)}</p>
    </div>
  );
}
