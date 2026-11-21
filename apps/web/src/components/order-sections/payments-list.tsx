import type { ReactNode } from "react";
import { Badge, PhoneList, PhoneRow, Table, Td, Th, THead, Tr, Dash, RULES, cn } from "@kebo/ui";
import { date, dateTime, money } from "@/lib/format";

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
  const none = <Dash />;
  return (
    <>
      {/* A phone: a row per payment — what for and the amount; when, how and who under it; its buttons below. */}
      <PhoneList label={name}>
        {rows.map((x) => (
          <PhoneRow
            key={x.id}
            muted={!!x.voided}
            title={x.for ?? "Payment"}
            figure={<span className={x.voided ? "line-through" : undefined}>{money(x.amount, x.currency)}</span>}
            line={[date(x.paidOn), x.how, x.account, x.reference].filter(Boolean).join(" · ")}
            status={x.voided ? <Badge tone="neutral">Removed</Badge> : undefined}
            extra={
              <span className="flex flex-col gap-1.5">
                {x.note && !x.voided && <span className="text-xs text-muted">{x.note}</span>}
                {x.voided?.reason && <span className="text-xs">{x.voided.reason}</span>}
                <span className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-muted">
                    {x.recordedBy ?? "—"} · {dateTime(x.recordedAt)}
                  </span>
                  {!x.voided && x.actions}
                </span>
              </span>
            }
          />
        ))}
        <li className={cn(RULES.box.inset, "flex items-baseline justify-between gap-3 py-2.5 text-sm font-bold")}>
          <span>{total.label}</span>
          <span className="tabular">{total.amount}</span>
        </li>
      </PhoneList>
      <div className="hidden sm:block">
        {/* Five columns, so Receipt and Change always fit beside the amount (e2e 20 Nov: with eight, "Bank transfer
            (T/T)" took three lines and Change was cut off): when and who, what for, how (method, account, reference). */}
        <Table>
          <THead>
            <tr>
              <Th>Date</Th>
              <Th>For</Th>
              <Th>How</Th>
              <Th className="text-right">Amount</Th>
              <Th>
                <span className="sr-only">Receipt and change</span>
              </Th>
            </tr>
          </THead>
          <tbody>
            {rows.map((x) => (
              <Tr key={x.id} className={x.voided ? "text-muted" : undefined}>
                <Td className="whitespace-nowrap" title={`Recorded by ${x.recordedBy ?? "—"} · ${dateTime(x.recordedAt)}`}>
                  <span className={cn("tabular", x.voided && "line-through")}>{date(x.paidOn)}</span>
                  <span className="block text-xs text-muted">{x.recordedBy ?? "—"}</span>
                </Td>
                <Td className="font-medium">{x.voided ? <span className="font-normal">{x.voided.reason ?? ""}</span> : (x.for ?? none)}</Td>
                <Td>
                  <span className="whitespace-nowrap">{x.how}</span>
                  <span className="block text-xs text-text-2">
                    {x.account ? `${account} ${x.account}` : "No account"}
                    {x.reference && <> · {x.reference}</>}
                  </span>
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
                <Td className="text-right whitespace-nowrap">{x.voided ? <Badge tone="neutral">Removed</Badge> : <span className="flex items-center justify-end gap-3">{x.actions}</span>}</Td>
              </Tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line-strong font-bold">
              <Td colSpan={3}>{total.label}</Td>
              <Td className="text-right whitespace-nowrap tabular">{total.amount}</Td>
              <Td />
            </tr>
          </tfoot>
        </Table>
      </div>
    </>
  );
}
