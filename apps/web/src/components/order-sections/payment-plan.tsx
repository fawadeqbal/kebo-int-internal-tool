"use client";

import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { Badge, Button, cn, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { date, dueText, money } from "@/lib/format";
import type { ActionState } from "@/lib/actions";
import type { OrderMoney } from "@/lib/types-money";
import { requestPrintHref, requestWords } from "@/lib/requests";
import { SendDialog } from "@/components/money/requests";
import { RecordPaymentWindow } from "./payment-windows";
import { ROW_LINK } from "./section-window";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;
type Send = (ref: string, prev: ActionState, form: FormData) => Promise<ActionState>;
type Item = OrderMoney["plan"]["items"][number];
type Sending = Parameters<typeof SendDialog>[0]["what"];

const grouped = (v: string) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayMonth = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Where a part stands, as a badge: paid (and when), part paid, sent (how), not sent. */
function Stand({ i }: { i: Item }) {
  const r = i.request;
  const last = r.receipts.at(-1);
  return (
    <span className="flex flex-col items-start gap-1">
      {r.state === "paid" ? (
        <Badge tone="ok">Paid{last ? ` ${dayMonth(last.paidOn)}` : ""}</Badge>
      ) : (
        <Badge tone={r.state === "part_paid" ? "warn" : r.state === "sent" ? "info" : "neutral"}>{requestWords(r)}</Badge>
      )}
      {r.changed && <span className="text-xs font-medium text-warn">Changed since it was sent</span>}
      {i.late > 0 && r.state !== "paid" && (
        <span className="text-xs font-medium text-bad">
          {i.late} day{i.late === 1 ? "" : "s"} late
        </span>
      )}
    </span>
  );
}

/**
 * The order's payment plan (design "money, simple", board OPay): one row per part with where it stands and
 * what to do on it, without leaving the order. "Send request" keeps the request as it prints and marks it
 * sent; "Record payment" opens the payment window with what is still to come on the part; a paid part shows
 * its receipt. Money pays the parts in order, so only the first open part offers "Record payment".
 */
export function PaymentPlanTable({
  orderId,
  plan,
  currency,
  total,
  received,
  due,
  send,
  pay,
  back = `/orders/${orderId}/payment`,
  auto,
  onAutoClosed,
}: {
  /** Where a paper opened from here goes back to (the page the plan is shown on). */
  back?: string;
  /** Open the payment window of the first open part at once (a list's row asked for it). */
  auto?: "pay";
  onAutoClosed?: () => void;
  orderId: string;
  plan: OrderMoney["plan"];
  currency: string;
  total: string;
  received: string;
  due: string;
  send: Send;
  /** Null: this person may not record payments, or the order takes none. */
  pay: { action: Action; customer: string; refNo: string; due: string; depositDue: string; fx: Parameters<typeof RecordPaymentWindow>[0]["fx"]; today: string } | null;
}) {
  // The dialog lives here, not in the row: once sent, the row's button changes and the dialog still says what to do next.
  const [sending, setSending] = useState<Sending | null>(null);
  const close = useCallback(() => setSending(null), []);
  if (!plan.items.length && !plan.cancelled.length) return <p className="text-sm text-muted">No plan yet.</p>;
  const next = plan.items.find((i) => i.request.state !== "paid");

  /** Under a part's name: its request's number (the kept copy, once sent) and how it is paid. */
  const under = (i: Item) => (
    <span className="block text-xs text-muted">
      {i.request.with === "request" ? (
        <a href={requestPrintHref(orderId, i.id, { back })} className="hover:text-primary hover:underline">
          {i.number}
        </a>
      ) : (
        i.number
      )}{" "}
      · {i.how}
    </span>
  );
  const receipts = (i: Item): ReactNode =>
    i.request.receipts.map((x, n) => (
      <a key={x.id} href={`/print/orders/${orderId}/payment-receipt?${new URLSearchParams({ ref: x.id, back })}`} title={x.number} className={ROW_LINK}>
        {i.request.receipts.length > 1 ? `Receipt ${n + 1}` : "Receipt"}
      </a>
    ));
  /** What can be done on a part, in the row. */
  const actions = (i: Item) => {
    const r = i.request;
    const open = r.state !== "paid";
    return (
      <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
        {receipts(i)}
        {open && r.through === "bank" && r.state === "not_sent" ? (
          <Link href={`/orders/${orderId}/documents`} className={ROW_LINK}>
            Bank papers
          </Link>
        ) : (
          open &&
          plan.canSend &&
          (r.state === "not_sent" || r.changed) && (
            <Button
              size="sm"
              variant="secondary"
              className="h-8 px-2.5 text-[13px]"
              onClick={() => setSending({ action: send.bind(null, i.id), orderId, refId: i.id, number: i.number, label: i.label, amount: i.amount, currency, dueOn: i.dueOn, again: r.with === "request" })}
            >
              {r.with === "request" ? "Send again" : "Send request"}
            </Button>
          )
        )}
        {pay && i === next && <RecordPaymentWindow main {...pay} currency={currency} forWhat={i.label} amount={i.open} />}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Phones: one block per part, so where it stands and what to do are never off the screen. */}
      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line sm:hidden" aria-label="Payment plan">
        {plan.items.map((i) => (
          <li key={i.id} className="flex flex-col gap-1.5 px-3 py-3">
            <span className="flex items-baseline justify-between gap-3">
              <span className="font-semibold">{i.label}</span>
              <span className="font-semibold tabular">{grouped(i.amount)}</span>
            </span>
            {under(i)}
            <span className="text-sm text-text-2">
              {dueText(i)}
              {Number(i.paid) > 0 && i.request.state !== "paid" ? ` · ${grouped(i.paid)} received` : ""}
            </span>
            <span className="flex flex-wrap items-center justify-between gap-3">
              <Stand i={i} />
              {actions(i)}
            </span>
          </li>
        ))}
        {plan.cancelled.map((c) => (
          <li key={c.paperId} className="flex items-center justify-between gap-3 px-3 py-3 text-sm text-muted">
            <span>
              {c.number} · {c.label ?? "Payment request"} · cancelled
            </span>
            <a href={requestPrintHref(orderId, c.ref, { v: c.revision, back })} className={ROW_LINK}>
              View
            </a>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto sm:block">
        <Table>
          <THead>
            <tr>
              <Th>Part</Th>
              <Th>Due</Th>
              <Th className="text-right">Amount {currency}</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">What to do</span>
              </Th>
            </tr>
          </THead>
          <tbody>
            {plan.items.map((i) => (
              <Tr key={i.id}>
                <Td className="min-w-[10rem]">
                  <span className="font-semibold">{i.label}</span>
                  {under(i)}
                </Td>
                <Td className={cn("min-w-[7.5rem] text-sm", i.late > 0 && i.request.state !== "paid" && "font-medium text-bad")}>{dueText(i)}</Td>
                <Td className="text-right whitespace-nowrap tabular">
                  {grouped(i.amount)}
                  {Number(i.paid) > 0 && i.request.state !== "paid" && <span className="block text-xs text-muted">{grouped(i.paid)} received</span>}
                </Td>
                <Td>
                  <Stand i={i} />
                </Td>
                <Td className="text-right">{actions(i)}</Td>
              </Tr>
            ))}
            {plan.cancelled.map((c) => (
              <Tr key={c.paperId} className="text-muted">
                <Td>
                  {c.label ?? "Payment request"}
                  <span className="block text-xs">
                    {c.number} · sent {date(c.sentOn)}
                  </span>
                </Td>
                <Td />
                <Td className="text-right whitespace-nowrap tabular line-through">{c.amount ? grouped(c.amount) : ""}</Td>
                <Td>
                  <Badge tone="neutral">Cancelled</Badge>
                </Td>
                <Td className="text-right">
                  <a href={requestPrintHref(orderId, c.ref, { v: c.revision, back })} className={ROW_LINK}>
                    View
                  </a>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
      {sending && <SendDialog key={sending.refId} what={sending} onClose={close} />}
      {/* Asked for from a list's row: one window, open at once (the rows' own buttons are drawn twice, for phone and desk). */}
      {auto === "pay" && pay && next && (
        <span className="hidden">
          <RecordPaymentWindow main {...pay} currency={currency} forWhat={next.label} amount={next.open} startOpen onClosed={onAutoClosed} />
        </span>
      )}
      <div data-target="payments.received" className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 px-[18px] text-sm sm:px-3.5">
        <span className="text-muted">
          Order total <span className="font-semibold text-text tabular">{money(total, currency)}</span>
        </span>
        <span className="text-muted">
          Received <span className="font-semibold text-text tabular">{money(received, currency)}</span>
        </span>
        <span className="text-muted">
          Still due <span className="font-semibold text-text tabular">{money(due, currency)}</span>
        </span>
      </div>
    </div>
  );
}
