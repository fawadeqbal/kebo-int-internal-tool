import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { FACTORY_DUE_RULE_LABEL, FACTORY_PLAN_STATUS_LABEL, PAYMENT_ROUTE_SHORT, type PaymentRoute } from "@kebo/shared";
import { cn, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { date, money } from "@/lib/format";
import type { FactoryPlanView } from "@/lib/types-money";

type Row = FactoryPlanView["rows"][number];

/** "Paid", "Late 4 days", "Due today", "Due in 3 days", "Part paid", "Not due yet". */
function statusWords(r: Row) {
  const d = r.inDays;
  if (r.status === "paid") return "Paid";
  if (r.status === "late") return d !== null ? `Late ${-d} ${-d === 1 ? "day" : "days"}` : "Late";
  if (d === 0) return "Due today";
  if (d !== null && d > 0 && (r.status === "due" || r.status === "later")) return `Due in ${d} ${d === 1 ? "day" : "days"}`;
  return FACTORY_PLAN_STATUS_LABEL[r.status];
}
const statusClass = (r: Row) =>
  r.status === "paid" ? "text-ok" : r.status === "late" ? "text-bad" : r.status === "due" ? "text-warn" : "text-text";
const dueText = (r: Row) => (r.due ? date(r.due) : "No date yet");

/** The plan in a few words for the card's heading: "Advance 30% when ordered · Balance 70% ready date". */
export const supplierPlanWords = (plan: FactoryPlanView) =>
  plan.rows.map((r) => `${r.label} ${FACTORY_DUE_RULE_LABEL[r.dueRule]}`).join(" · ");

/**
 * What we pay one supplier on an order (Order › Factory order): the parts of its plan with what is paid on
 * each and where it stands, Pay on the next open part, the totals at the foot, and under them the order's
 * route and the customer's money, so the other side is in view before a factory is paid. The plan itself is
 * changed in the card's Edit panel; the payments are on Treasury › Payments (one link).
 */
export function SupplierParts({
  orderId,
  plan,
  pay,
  paidInOrder,
  orderCurrency,
  overpaid,
  customer,
}: {
  orderId: string;
  plan: FactoryPlanView;
  /** "Pay" for a part (the payment form filled in), when this person may record it. */
  pay: (row: Row) => ReactNode;
  /** What was paid so far in the order's currency, at the rates used. */
  paidInOrder: string | null;
  orderCurrency: string;
  /** Paid beyond what its prices add up to. */
  overpaid: string | null;
  /** The order's route and what the customer has paid on it. */
  customer: { route: PaymentRoute | null; words: string; warn: boolean; received: string; owed: string } | null;
}) {
  const next = plan.rows.find((r) => r.status !== "paid");
  const c = plan.currency;
  return (
    <div className="flex flex-col gap-3 p-4">
      {plan.differs && (
        <p className="flex items-center gap-2 rounded-md bg-warn-soft px-2.5 py-1.5 text-xs">
          <AlertTriangle className="size-3.5 shrink-0 text-warn" aria-hidden /> The parts do not add up to what we owe ({c} {plan.differs}):
          prices changed since. Open Edit and save the plan again.
        </p>
      )}
      {/* Phones: one block per part, so the status and Pay are never off the screen. */}
      <ul
        className="flex flex-col divide-y divide-line rounded-lg border border-line sm:hidden"
        aria-label={`Parts to pay ${plan.factory.name}`}
      >
        {plan.rows.map((r, i) => (
          <li key={i} className="flex flex-col gap-1.5 px-3 py-3">
            <span className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{r.label}</span>
              <span className="font-semibold tabular">{money(r.amount, c)}</span>
            </span>
            <span className="text-sm text-text-2">
              {dueText(r)} · {FACTORY_DUE_RULE_LABEL[r.dueRule]}
              {Number(r.paid) > 0 && r.status !== "paid" ? ` · ${money(r.paid, c)} paid` : ""}
              {r.supplierRef ? ` · inv. ${r.supplierRef}` : ""}
            </span>
            <span className="flex items-center justify-between gap-3">
              <span className={cn("text-sm font-medium", statusClass(r))}>{statusWords(r)}</span>
              {r === next && pay(r)}
            </span>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-lg border border-line sm:block">
        <Table>
          <THead>
            <tr>
              <Th>Part</Th>
              <Th>Due</Th>
              <Th className="text-right">Amount {c}</Th>
              <Th className="text-right">Paid</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Next</span>
              </Th>
            </tr>
          </THead>
          <tbody>
            {plan.rows.map((r, i) => (
              <Tr key={i} data-target={r.dueRule === "on_order" ? "factory.plan.advance" : "factory.plan.balance"}>
                <Td>
                  <span className="font-medium">{r.label}</span>
                  {r.supplierRef && <span className="block text-xs text-muted">Their invoice {r.supplierRef}</span>}
                </Td>
                <Td className="whitespace-nowrap">
                  {r.due ? date(r.due) : <span className="text-muted">No date yet</span>}
                  <span className="block text-xs text-muted">{FACTORY_DUE_RULE_LABEL[r.dueRule]}</span>
                </Td>
                <Td className="text-right whitespace-nowrap tabular">{money(r.amount, c).replace(`${c} `, "")}</Td>
                <Td className="text-right whitespace-nowrap tabular">
                  {Number(r.paid) > 0 ? money(r.paid, c).replace(`${c} `, "") : <span className="text-muted">—</span>}
                </Td>
                <Td className={cn("font-medium whitespace-nowrap", statusClass(r))}>{statusWords(r)}</Td>
                <Td className="text-right">{r === next && pay(r)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
      <div className="flex flex-wrap items-baseline justify-end gap-x-6 gap-y-2 text-sm" data-target="factory.payments">
        <dl className="flex flex-wrap gap-x-6 gap-y-1">
          <div className="flex gap-1.5">
            <dt className="text-muted">We owe</dt>
            <dd className="font-semibold tabular">{money(plan.owed, c)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted">Paid</dt>
            <dd className="font-semibold text-ok tabular">
              {money(plan.paid, c)}
              {paidInOrder && c !== orderCurrency && Number(plan.paid) > 0 && (
                <span className="font-normal text-muted"> = {money(paidInOrder, orderCurrency)}</span>
              )}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted">Still to pay</dt>
            <dd className={cn("font-semibold tabular", Number(plan.toPay) > 0 && "text-warn")}>{money(plan.toPay, c)}</dd>
          </div>
        </dl>
      </div>
      {Number(plan.takenOff ?? 0) > 0 && (
        <p className="text-xs text-muted">Paid counts {money(plan.takenOff!, c)} of costs this supplier bears, taken off what we owe it.</p>
      )}
      {overpaid && <p className="text-xs text-warn">Paid {money(overpaid, c)} more than its prices add up to.</p>}
      {customer && (
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-line pt-3 text-sm" data-target="factory.customer">
          <span className="text-muted">Customer&apos;s money{customer.route ? ` · ${PAYMENT_ROUTE_SHORT[customer.route]}` : ""}</span>
          <span className={customer.warn ? "font-medium text-warn" : "font-medium"}>{customer.words}</span>
          <span className="text-text-2 tabular">
            {money(customer.received, orderCurrency)} of {money(customer.owed, orderCurrency)} in
          </span>
          <Link href={`/orders/${orderId}/payment`} className="ml-auto font-medium text-primary hover:underline">
            Payment
          </Link>
        </p>
      )}
    </div>
  );
}
