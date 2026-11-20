import type { ReactNode } from "react";
import Link from "next/link";
import { PAYMENT_METHOD_LABEL, type CustomerMoneyState, type FactoryDueRule, type PaymentRoute, type Tone } from "@kebo/shared";
import { Badge, cn, Table, Td, Th, THead, Tr, EmptyLine } from "@kebo/ui";
import { date, dayMonth, dueText, money, num2 as grouped } from "@/lib/format";
import type { FactoryPaymentView, FactoryPlanView } from "@/lib/types-money";
import { ROW_LINK } from "./section-window";
import { BoxNote } from "@/components/common/record-box";

type Row = FactoryPlanView["rows"][number];


/** When a part of a supplier's plan falls due, in the words the customer's plan uses (a fixed date: none, its date says it). */
export function supplierRule(r: { dueRule: FactoryDueRule; dueDays?: number | null }): string | null {
  if (r.dueRule === "on_order") return "when we order";
  if (r.dueRule === "on_ready") return "when they say ready";
  if (r.dueRule === "on_ship_plus_days") return `${r.dueDays ?? 0} days after shipping`;
  return null;
}

/** "Advance" of "Advance 30%": the part's name without its share. */
export const partName = (r: Pick<Row, "label">) => r.label.replace(/\s+\d+(?:\.\d+)?%$/, "") || r.label;

/** The plan in a few words: "Advance 30% when we order · Balance 70% when they say ready". */
export const supplierPlanWords = (plan: FactoryPlanView) =>
  plan.rows.map((r) => `${r.label} ${supplierRule(r) ?? (r.due ? `on ${date(r.due)}` : "on a date")}`).join(" · ");

/** The invoices the factory sent, each with the part it is for: "JP-INV-301 (advance)". */
export const theirInvoices = (plan: FactoryPlanView) => plan.rows.filter((r) => r.supplierRef).map((r) => `${r.supplierRef} (${partName(r).toLowerCase()})`);

const TONE: Record<Row["status"], Tone> = { paid: "ok", part: "warn", due: "warn", late: "bad", later: "neutral" };

/** Where a part stands, as the customer's parts show it: a badge, and how late it is in red. */
function Stand({ r, paidOn }: { r: Row; paidOn: string | null }) {
  const late = r.status === "late" && r.inDays !== null && r.inDays < 0 ? -r.inDays : 0;
  const word =
    r.status === "paid"
      ? `Paid${paidOn ? ` ${dayMonth(paidOn)}` : ""}`
      : r.status === "part"
        ? "Part paid"
        : r.status === "late"
          ? "Late"
          : r.status === "due"
            ? r.inDays === 0
              ? "Due today"
              : r.inDays !== null && r.inDays > 0
                ? `Due in ${r.inDays} day${r.inDays === 1 ? "" : "s"}`
                : "Due"
            : "Not due yet";
  return (
    <span className="flex flex-col items-start gap-1">
      <Badge tone={TONE[r.status]}>{word}</Badge>
      {late > 0 && (
        <span className="text-xs font-medium text-bad">
          {late} day{late === 1 ? "" : "s"} late
        </span>
      )}
    </span>
  );
}

/**
 * What we pay one supplier on an order (Order › Factory order, and the purchase order's page), drawn as the
 * customer's payment plan is: one row per part (a card on a phone) with where it stands and what to do on
 * it — Pay on the part that is next, Receipt beside a paid one — then We owe · Paid · Still to pay. Money
 * pays the parts in order, so only the first open part offers Pay.
 */
export function SupplierPlanTable({
  plan,
  payments,
  pay,
  orderCurrency,
  paidInOrder,
  overpaid,
  after,
}: {
  plan: FactoryPlanView;
  /** The order's payments to its factories, by id: how a part was paid, and when. */
  payments: Map<string, FactoryPaymentView>;
  /** "Pay" for the next open part (the payment form filled in), when this person may record it. */
  pay: (row: Row) => ReactNode;
  orderCurrency: string;
  /** What was paid so far in the order's currency, at the rates used. */
  paidInOrder: string | null;
  /** Paid beyond what its prices add up to. */
  overpaid: string | null;
  /** Under the totals (the customer's money). */
  after?: ReactNode;
}) {
  const c = plan.currency;
  if (!plan.rows.length) return <EmptyLine className="px-4 sm:px-5">No plan yet.</EmptyLine>;
  const next = plan.rows.find((r) => r.status !== "paid");
  const paidBy = (r: Row) => r.payments.map((x) => payments.get(x.id)).filter((x): x is FactoryPaymentView => !!x);
  /** Under a part's name: their invoice for it, and how it was paid. */
  const under = (r: Row) => {
    const how = [...new Set(paidBy(r).map((x) => PAYMENT_METHOD_LABEL[x.method]))];
    return (
      <span className="block text-xs text-muted">
        {r.supplierRef ? `Their invoice ${r.supplierRef}` : "No invoice yet"}
        {how.length > 0 && ` · ${how.join(", ")}`}
      </span>
    );
  };
  const due = (r: Row) => dueText({ dueOn: r.due, rule: supplierRule(r) });
  const lastPaid = (r: Row) => paidBy(r).at(-1)?.paidOn ?? null;
  /** What can be done on a part, in the row: its receipts, and Pay on the next one. */
  const actions = (r: Row) => {
    const paid = paidBy(r);
    return (
      <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
        {paid.map((x, n) => (
          <Link key={x.id} href={`/payments/supplier/${x.id}`} className={ROW_LINK}>
            {paid.length > 1 ? `Receipt ${n + 1}` : "Receipt"}
          </Link>
        ))}
        {r === next && Number(r.open) > 0 && pay(r)}
      </span>
    );
  };
  const late = (r: Row) => r.status === "late";

  return (
    <div className="flex flex-col gap-3">
      {/* Phones: one block per part, so where it stands and what to do are never off the screen. */}
      <ul className="flex flex-col divide-y divide-line border-b border-line sm:hidden" aria-label={`Parts to pay ${plan.factory.name}`}>
        {plan.rows.map((r, i) => (
          <li key={r.id ?? i} className="flex flex-col gap-1.5 px-4 py-3">
            <span className="flex items-baseline justify-between gap-3">
              <span className="font-semibold">{r.label}</span>
              <span className="font-semibold tabular">{grouped(r.amount)}</span>
            </span>
            {under(r)}
            <span className={cn("text-sm text-text-2", late(r) && "font-medium text-bad")}>
              {due(r)}
              {Number(r.paid) > 0 && r.status !== "paid" ? ` · ${grouped(r.paid)} paid` : ""}
            </span>
            <span className="flex flex-wrap items-center justify-between gap-3">
              <Stand r={r} paidOn={lastPaid(r)} />
              {actions(r)}
            </span>
          </li>
        ))}
      </ul>
      <div className="hidden sm:block">
        <Table>
          <THead>
            <tr>
              <Th>Part</Th>
              <Th>Due</Th>
              <Th className="text-right">Amount {c}</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">What to do</span>
              </Th>
            </tr>
          </THead>
          <tbody>
            {plan.rows.map((r, i) => (
              <Tr key={r.id ?? i} data-target={r.dueRule === "on_order" ? "factory.plan.advance" : "factory.plan.balance"}>
                <Td className="min-w-[10rem]">
                  <span className="font-semibold">{r.label}</span>
                  {under(r)}
                </Td>
                <Td className={cn("min-w-[7.5rem] text-sm", late(r) && "font-medium text-bad")}>{due(r)}</Td>
                <Td className="text-right whitespace-nowrap tabular">
                  {grouped(r.amount)}
                  {Number(r.paid) > 0 && r.status !== "paid" && <span className="block text-xs text-muted">{grouped(r.paid)} paid</span>}
                </Td>
                <Td>
                  <Stand r={r} paidOn={lastPaid(r)} />
                </Td>
                <Td className="text-right">{actions(r)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
      <div data-target="factory.payments" className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 px-4 text-sm sm:px-3.5">
        <span className="text-muted">
          We owe <span className="font-semibold text-text tabular">{money(plan.owed, c)}</span>
        </span>
        <span className="text-muted">
          Paid <span className="font-semibold text-text tabular">{money(plan.paid, c)}</span>
          {paidInOrder && c !== orderCurrency && Number(plan.paid) > 0 && <span className="tabular"> = {money(paidInOrder, orderCurrency)}</span>}
        </span>
        <span className="text-muted">
          Still to pay <span className="font-semibold text-text tabular">{money(plan.toPay, c)}</span>
        </span>
      </div>
      {(Number(plan.takenOff ?? 0) > 0 || overpaid) && (
        <div className="flex flex-col gap-1 px-4 text-xs sm:px-3.5">
          {Number(plan.takenOff ?? 0) > 0 && <p className="text-muted">Paid counts {money(plan.takenOff!, c)} of costs this supplier bears, taken off what we owe it.</p>}
          {overpaid && <p className="text-warn">Paid {money(overpaid, c)} more than its prices add up to.</p>}
        </div>
      )}
      {after}
    </div>
  );
}

/**
 * Under a supplier's plan: what the customer has paid on the order, so the other side is in view before a
 * factory is paid. "The customer has paid USD 2,881.80 of USD 9,606.00 (the deposit is in)."
 */
export function CustomerMoneyLine({
  orderId,
  state,
  warn,
  route,
  deposit,
  received,
  owed,
  currency,
}: {
  orderId: string;
  state: CustomerMoneyState;
  warn: boolean;
  route: PaymentRoute | null;
  /** The order asks a deposit. */
  deposit: boolean;
  received: string;
  owed: string;
  currency: string;
}) {
  const bank = route === "letter_of_credit" ? "by LC" : route === "bank_contract" ? "through the bank" : null;
  const of = (
    <b className="font-semibold tabular">
      {money(received, currency)} of {money(owed, currency)}
    </b>
  );
  const text =
    state === "paid" ? (
      <>
        The customer has paid in full: <b className="font-semibold tabular">{money(received, currency)}</b>.
      </>
    ) : state === "nothing" ? (
      deposit ? (
        "The customer has paid nothing yet: their deposit is not in."
      ) : bank ? (
        `Nothing from the customer yet: they pay ${bank}.`
      ) : (
        "The customer has not paid yet."
      )
    ) : state === "part_deposit" ? (
      <>The customer has paid {of}: only part of the deposit is in.</>
    ) : state === "deposit" ? (
      <>
        The customer has paid {of} (the deposit is in{bank ? `; the balance comes ${bank}` : ""}).
      </>
    ) : (
      <>
        The customer has paid {of}
        {bank ? `; the rest comes ${bank}` : ""}.
      </>
    );
  return (
    <BoxNote data-target="factory.customer" tone={warn ? "warn" : "neutral"} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className={warn ? "font-medium" : "text-text-2"}>{text}</span>
      <Link href={`/orders/${orderId}/payment`} className={ROW_LINK}>
        Payment tab
      </Link>
    </BoxNote>
  );
}
