import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "@kebo/shared";
import { buttonClass, Card, CardHeader, cn, PageHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { UUID } from "@/lib/ids";
import { load, requireUser } from "@/lib/session";
import { crumbsFor } from "@/lib/nav";
import { date, money } from "@/lib/format";
import type { RequestPage } from "@/lib/types-money";
import { recordPaymentHref } from "@/components/money/pay-links";
import { RequestStatus, SendRequest } from "@/components/money/requests";
import { invoiceHref, requestPrintHref } from "@/lib/requests";
import { sendRequestAction } from "../../../../money/actions";

export const metadata = { title: "Payment request" };

const quiet = "text-sm font-medium text-primary hover:underline";

/** One step of the request's story: a dot, what happened, a line or two about it, and its links. */
function Step({ state, title, lines, links, last }: { state: "done" | "wait"; title: ReactNode; lines: ReactNode[]; links?: ReactNode; last?: boolean }) {
  return (
    <li className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-3.5">
      <span className="flex flex-col items-center">
        <span className={cn("mt-[5px] size-2.5 shrink-0 rounded-full", state === "done" ? "bg-primary" : "border-[1.5px] border-line-strong")} aria-hidden />
        {!last && <span className="mt-1 w-px flex-1 bg-line" aria-hidden />}
      </span>
      <div className={cn("flex min-w-0 flex-col gap-0.5 text-sm", !last && "pb-5")}>
        <span className="font-semibold">{title}</span>
        {lines.map((l, i) => (
          <span key={i} className="text-text-2">
            {l}
          </span>
        ))}
        {links && <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1">{links}</span>}
      </div>
    </li>
  );
}

/**
 * One payment request, with its payments and their receipts in one view (claude/payments-design.md): the
 * one thing to do next, then the story in order: sent, each payment received, its receipt, what is still to
 * come. Nothing here is typed: it is read from the copies kept and the payments recorded.
 */
export default async function PaymentRequestPage({ params }: { params: Promise<{ order: string; ref: string }> }) {
  const { order, ref } = await params;
  if (!UUID.test(order) || !UUID.test(ref)) notFound();
  await requireUser();
  const r = await load(() => api.get<RequestPage>(`/orders/${order}/requests/${ref}`));
  const here = `/payments/requests/${order}/${ref}`;
  const q = r.request;
  const c = r.currency;
  const last = r.copies.at(-1) ?? null;
  const sendProps = { action: sendRequestAction.bind(null, order, ref), orderId: order, refId: ref, number: r.number, label: r.label, amount: r.amount, currency: c, dueOn: r.dueOn };
  const state = r.cancelled ? "cancelled" : q!.state;
  const status = r.cancelled
    ? { state: "cancelled" as const, with: "request" as const, sentOn: last?.sentOn ?? null, revision: last?.revision ?? null }
    : { state: q!.state, with: q!.with, sentOn: q!.sentOn, revision: q!.revision, changed: q!.changed, through: q!.through };
  const dueWords = r.dueOn ? `due ${date(r.dueOn)}` : r.rule ? `due ${r.rule}` : "no due date yet";

  // The one thing to do next, in words, with the page's one orange button.
  const next: { title: string; meta: string; late?: boolean; button: ReactNode } | null =
    r.cancelled || state === "paid"
      ? null
      : q!.changed && r.canSend
        ? {
            title: "Send it again: it no longer says what was sent",
            meta: `Sent ${last?.amount ? money(last.amount, c) : ""}${last?.dueOn ? `, due ${date(last.dueOn)}` : ""}; the plan now says ${money(r.amount, c)}, ${dueWords}.`,
            button: <SendRequest {...sendProps} again primary size="md" />,
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
          : state === "not_sent" && r.canSend
            ? {
                title: "Send it to the customer",
                meta: `${money(r.amount, c)} · ${dueWords}. It is kept exactly as it prints when you send it.`,
                button: <SendRequest {...sendProps} primary size="md" />,
              }
            : r.canPay
              ? {
                  title: r.late > 0 ? `Chase the payment: ${r.late} day${r.late === 1 ? "" : "s"} late` : Number(r.paid) > 0 ? "Record the rest when it arrives" : "Record the payment when it arrives",
                  meta: `${money(r.open, c)} still to come · ${dueWords}`,
                  late: r.late > 0,
                  button: (
                    <Link href={recordPaymentHref({ kind: "in", order, amount: r.open, back: here })} className={buttonClass("primary", "md", "max-sm:w-full")}>
                      Record payment
                    </Link>
                  ),
                }
              : null;

  // The story, in order.
  const steps: { key: string; node: (last: boolean) => ReactNode }[] = [];
  if (q?.with === "proforma")
    steps.push({
      key: "pi",
      node: (l) => (
        <Step
          state="done"
          title="Asked for with the proforma invoice"
          lines={[`${q.sentOn ? date(q.sentOn) : ""} · proforma ${q.proformaNo ?? ""}`]}
          links={
            <Link href={invoiceHref(order)} className={quiet}>
              Open the invoice
            </Link>
          }
          last={l}
        />
      ),
    });
  if (q?.with === "bank")
    steps.push({ key: "bank", node: (l) => <Step state="done" title="Asked for through the banks" lines={[`The papers went to our bank${q.sentOn ? ` on ${date(q.sentOn)}` : ""}.`]} last={l} /> });
  for (const x of r.copies)
    steps.push({
      key: x.paperId,
      node: (l) => (
        <Step
          state="done"
          title={x.revision > 1 ? `Request sent again (R${x.revision})` : "Request sent to the customer"}
          lines={[
            `${date(x.sentOn)}${x.sentBy ? ` by ${x.sentBy.name}` : ""}${x.amount ? ` · ${money(x.amount, c)}` : ""}${x.dueOn ? `, due ${date(x.dueOn)}` : ""}`,
            x.revision !== last?.revision ? "Replaced by a later one; kept as it was sent." : "Kept exactly as it was sent.",
          ]}
          links={
            <a href={requestPrintHref(order, ref, { v: x.revision, back: here })} className={quiet}>
              View the request
            </a>
          }
          last={l}
        />
      ),
    });
  for (const p of q?.receipts ?? []) {
    const how = [
      date(p.paidOn),
      `${(PAYMENT_METHOD_LABEL[p.method as PaymentMethod] ?? p.method).replace(/ \(.*\)$/, "").toLowerCase()}${p.reference ? ` ${p.reference}` : ""}`,
      p.account ? `into ${p.account}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    steps.push({
      key: `pay:${p.id}`,
      node: (l) => (
        <Step
          state="done"
          title={`Payment received · ${money(p.amount, c)}`}
          lines={[how, ...(p.whole !== p.amount ? [`Part of a payment of ${money(p.whole, c)}; the rest paid another part.`] : []), ...(p.recordedBy ? [`Recorded by ${p.recordedBy}`] : [])]}
          links={
            p.entryId ? (
              <Link href={`/payments/customer/${p.entryId}`} className="text-sm text-primary hover:underline">
                {p.hasProof ? "Open the payment · bank slip" : "Open the payment"}
              </Link>
            ) : undefined
          }
          last={l}
        />
      ),
    });
    steps.push({
      key: `rc:${p.id}`,
      node: (l) => (
        <Step
          state="done"
          title={`Receipt ${p.number}`}
          lines={["Kept as it was when the payment was recorded."]}
          links={
            <a href={`/print/orders/${order}/payment-receipt?${new URLSearchParams({ ref: p.id, back: here })}`} className={quiet}>
              View the receipt
            </a>
          }
          last={l}
        />
      ),
    });
  }
  if (!r.cancelled && state !== "paid")
    steps.push({
      key: "open",
      node: (l) => (
        <Step
          state="wait"
          title={`${Number(r.paid) > 0 ? "Still to come" : state === "not_sent" ? "Not asked for yet" : "Waiting for the payment"} · ${money(r.open, c)}`}
          lines={[`${dueWords.charAt(0).toUpperCase()}${dueWords.slice(1)}${r.late > 0 ? `, ${r.late} day${r.late === 1 ? "" : "s"} late` : ""}.`]}
          last={l}
        />
      ),
    });
  if (r.cancelled)
    steps.push({ key: "x", node: (l) => <Step state="wait" title="Cancelled" lines={["Its part was taken out of the order's plan. Nothing is due on it."]} last={l} /> });

  const kv = (label: string, value: ReactNode, tone?: string) => (
    <div className="flex justify-between gap-3 text-sm">
      <dt className="text-text-2">{label}</dt>
      <dd className={cn("text-right font-semibold tabular", tone)}>{value}</dd>
    </div>
  );
  const sec = "flex flex-col gap-2 border-t border-line px-5 py-4 first:border-t-0";

  return (
    <div>
      <PageHeader
        crumbs={[...crumbsFor("/payments").map((x, i) => (i === 1 ? { ...x, href: "/payments?tab=requests" } : x)), { label: r.number }]}
        title={`${r.number} · ${r.label}`}
        summary={
          <>
            <Link href={`/customers/${r.customer.id}`} className="hover:text-primary">
              {r.customer.name}
            </Link>{" "}
            ·{" "}
            <Link href={`/orders/${order}/payment`} className="hover:text-primary">
              {r.refNo}
            </Link>{" "}
            · {money(r.amount, c)} · {dueWords}
          </>
        }
        badge={<RequestStatus r={status} late={r.late} />}
        actions={
          last || !r.cancelled ? (
            <a href={requestPrintHref(order, ref, { back: here })} className={buttonClass("secondary", "sm")}>
              View / Print
            </a>
          ) : undefined
        }
      />

      {next && (
        <section aria-label="Do next" className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-line bg-surface px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
            <span className={cn("text-xs font-semibold", next.late ? "text-bad" : "text-action")}>Do next</span>
            <span className="text-[17px] leading-snug font-bold">{next.title}</span>
            <span className="text-[13px] text-text-2">{next.meta}</span>
          </div>
          {next.button}
        </section>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader title="Request, payment and receipt" />
          <ol className="px-5 pt-1 pb-5">
            {steps.map((s, i) => (
              <Fragment key={s.key}>{s.node(i === steps.length - 1)}</Fragment>
            ))}
          </ol>
        </Card>
        <Card aria-label="Beside the request">
          <dl className={sec}>
            <dt className="mb-0.5 text-sm font-bold">Amounts</dt>
            {kv("Asked for", money(r.amount, c))}
            {kv("Received", money(r.paid, c), Number(r.paid) > 0 ? "text-ok" : undefined)}
            {kv("Still due", money(r.open, c))}
          </dl>
          <dl className={sec}>
            <dt className="mb-0.5 text-sm font-bold">Linked</dt>
            {kv(
              "Invoice",
              <Link href={invoiceHref(order)} className="text-primary hover:underline">
                Open
              </Link>,
            )}
            {kv(
              "Sales order",
              <Link href={`/orders/${order}/payment`} className="text-primary hover:underline">
                {r.refNo}
              </Link>,
            )}
            {kv(
              "Customer",
              <Link href={`/customers/${r.customer.id}`} className="text-primary hover:underline">
                {r.customer.name}
              </Link>,
            )}
          </dl>
        </Card>
      </div>
    </div>
  );
}
