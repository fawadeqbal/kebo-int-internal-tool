import type { ReactNode } from "react";
import { Badge, RefCode, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { date, dateTime, dayMonth, money } from "@/lib/format";

/** One payment in an order's list of payments received or made. */
export interface PaymentLine {
  id: string;
  paidOn: string;
  /** The parts of the plan it paid ("Deposit 30%"); null: none. */
  for: ReactNode;
  how: string;
  /** Our account it went into or came from. */
  account: string | null;
  reference: string | null;
  recordedBy: string | null;
  recordedAt: string;
  amount: string;
  currency: string;
  /** Under the amount: what it counts for in the order's currency. */
  note?: string | null;
  voided: { reason: string | null } | null;
  /** Receipt and Change. */
  actions: ReactNode;
}

/**
 * An order's payments, the same list on both sides (design "payment plans that match"): Payments received
 * on the Payment tab and Payments made on Factory order. A table on a laptop; on a phone each payment is a
 * card with what it was for, its amount, when and how, and its Receipt and Change.
 */
export function PaymentsList({ name, account, total, rows }: { name: string; account: "Into" | "From"; total: { label: string; amount: ReactNode }; rows: PaymentLine[] }) {
  const none = <span className="font-normal text-muted">—</span>;
  return (
    <>
      <ul aria-label={name} className="flex flex-col divide-y divide-line sm:hidden">
        {rows.map((x) => (
          <li key={x.id} className={x.voided ? "flex flex-col gap-1.5 px-4 sm:px-5 py-3 text-muted" : "flex flex-col gap-1.5 px-4 sm:px-5 py-3"}>
            <span className="flex items-baseline justify-between gap-3">
              <span className="font-semibold">{x.for ?? "Payment"}</span>
              <span className={x.voided ? "tabular line-through" : "font-semibold tabular"}>{money(x.amount, x.currency)}</span>
            </span>
            <span className="text-sm text-text-2">{[date(x.paidOn), x.how, x.account, x.reference].filter(Boolean).join(" · ")}</span>
            {x.note && !x.voided && <span className="text-xs text-muted">{x.note}</span>}
            {x.voided?.reason && <span className="text-xs">{x.voided.reason}</span>}
            <span className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted">
                {x.recordedBy ?? "—"} · {dateTime(x.recordedAt)}
              </span>
              {x.voided ? <Badge tone="neutral">Removed</Badge> : x.actions}
            </span>
          </li>
        ))}
        <li className="flex items-baseline justify-between gap-3 px-4 sm:px-5 py-3 font-bold">
          <span>{total.label}</span>
          <span className="tabular">{total.amount}</span>
        </li>
      </ul>
      <div className="hidden sm:block">
        {/* Snug cells and who recorded it in two short lines: Receipt and Change fit beside the amount. */}
        <Table className="[&_td]:px-3 [&_th]:px-3">
          <THead>
            <tr>
              <Th>Date</Th>
              <Th>For</Th>
              <Th>How</Th>
              <Th>{account}</Th>
              <Th>Reference</Th>
              <Th>Recorded by</Th>
              <Th className="text-right">Amount</Th>
              <Th>
                <span className="sr-only">Receipt and change</span>
              </Th>
            </tr>
          </THead>
          <tbody>
            {rows.map((x) => (
              <Tr key={x.id} className={x.voided ? "text-muted" : undefined}>
                <Td className={`whitespace-nowrap tabular ${x.voided ? "line-through" : ""}`}>{date(x.paidOn)}</Td>
                <Td className="font-medium">{x.voided ? <span className="font-normal">{x.voided.reason ?? ""}</span> : (x.for ?? none)}</Td>
                <Td>{x.how}</Td>
                <Td>{x.account ?? <span className="text-muted">—</span>}</Td>
                <Td>{x.reference ? <RefCode>{x.reference}</RefCode> : <span className="text-muted">—</span>}</Td>
                <Td className="text-xs text-text-2" title={dateTime(x.recordedAt)}>
                  {x.recordedBy ?? "—"}
                  <span className="block whitespace-nowrap text-muted">{dayMonth(x.recordedAt)}</span>
                </Td>
                <Td className="text-right whitespace-nowrap tabular">
                  {x.voided ? (
                    <span className="line-through">{money(x.amount, x.currency)}</span>
                  ) : (
                    <>
                      <span className="font-semibold">{money(x.amount, x.currency)}</span>
                      {x.note && <span className="block text-xs text-muted">{x.note}</span>}
                    </>
                  )}
                </Td>
                <Td className="text-right">{x.voided ? <Badge tone="neutral">Removed</Badge> : <span className="flex items-center justify-end gap-3">{x.actions}</span>}</Td>
              </Tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line-strong font-bold">
              <td className="px-3.5 py-3" colSpan={6}>
                {total.label}
              </td>
              <td className="px-3.5 py-3 text-right whitespace-nowrap tabular">{total.amount}</td>
              <td />
            </tr>
          </tfoot>
        </Table>
      </div>
    </>
  );
}
