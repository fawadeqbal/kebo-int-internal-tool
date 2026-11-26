import Link from "next/link";
import { PAYMENT_STATUS_LABEL } from "@kebo/shared";
import { Dash, DataRow, PhoneList, PhoneRow, RefCode, StatusBadge, Table, Td, Th, THead, cn } from "@kebo/ui";
import { date, money } from "@/lib/format";
import type { ExpenseView } from "@/lib/types-money";
import { companyKind } from "./company-kinds";

/*
 * The company's costs as a list (Finance › Expenses), built like every other list (review 26 Nov: "why it looks so
 * unfamiliar"): Payments' table on a laptop, the phone rows on a phone; each row opens the cost's own page
 * (/payments/expense/…: details, what it was for, the receipt, history; Change, Add again, Remove in its ⋯).
 */

/** The cost's page: the same page as every payment. */
export const expenseHref = (e: Pick<ExpenseView, "id">) => `/payments/expense/${e.id}`;

/** Who it was for, in a few words: an order and its customer, an inquiry, a customer, or the company. */
export const forWhom = (e: ExpenseView) =>
  e.order
    ? `${e.order.refNo} · ${e.customer?.name ?? ""}`
    : e.deal
      ? `${e.deal.refNo}${e.deal.stage === "lost" ? " (lost)" : ""} · ${e.customer?.name ?? ""}`
      : (e.customer?.name ?? "The company");

/**
 * Where it stands, in the cost page's words (Recorded, Removed: PAYMENT_STATUS_LABEL), and what is still to do when
 * there is something: owed back (paid from someone's own money), to pay (a bill known before it is paid).
 */
export function ExpenseStatus({ e }: { e: ExpenseView }) {
  if (e.voided) return <StatusBadge meaning="neutral">{PAYMENT_STATUS_LABEL.void}</StatusBadge>;
  if (e.ownMoney && !e.repaid) return <StatusBadge meaning="warn">Owed back</StatusBadge>;
  if (e.payLater && !e.repaid) return <StatusBadge meaning="warn">To pay</StatusBadge>;
  return <StatusBadge meaning="ok">{PAYMENT_STATUS_LABEL.recorded}</StatusBadge>;
}

/** Who paid it and from where: the account, or their own money. */
const paidFrom = (e: ExpenseView) => (e.ownMoney ? "Own money" : (e.account?.name ?? null));

/** What it was for and the kind, and that it comes back every month. */
const whatLine = (e: ExpenseView) => [companyKind(e.category), forWhom(e), e.repeats ? "every month" : null].filter(Boolean).join(" · ");

function Amount({ e, main }: { e: ExpenseView; main: string }) {
  return (
    <>
      <span className="tabular">{money(e.amount, e.currency)}</span>
      {e.currency !== main && <span className="block text-xs text-text-2 tabular">≈ {money(e.inMain, main)}</span>}
    </>
  );
}

export function ExpenseList({ rows, main, label = "Expenses" }: { rows: ExpenseView[]; main: string; label?: string }) {
  return (
    <>
      <PhoneList label={label}>
        {rows.map((e) => (
          <PhoneRow
            key={e.id}
            href={expenseHref(e)}
            muted={!!e.voided}
            title={e.description}
            // The day, the kind and who it was for: what a phone has room for (the number is on the cost's page).
            line={[date(e.spentOn), whatLine(e)].filter(Boolean).join(" · ")}
            status={<ExpenseStatus e={e} />}
            figure={<span className={cn(e.voided && "line-through")}>{money(e.amount, e.currency)}</span>}
          />
        ))}
      </PhoneList>
      <div className="hidden sm:block">
        <Table aria-label={label}>
          <THead>
            <tr>
              <Th>Number</Th>
              <Th>Date</Th>
              <Th>What · for</Th>
              <Th>Paid by · from</Th>
              <Th className="text-right">Amount</Th>
              <Th>Status</Th>
            </tr>
          </THead>
          <tbody>
            {rows.map((e) => (
              <DataRow key={e.id} href={expenseHref(e)} className={cn(e.voided && "text-muted line-through")}>
                <Td className="whitespace-nowrap">{e.number ? <RefCode>{e.number}</RefCode> : <Dash />}</Td>
                <Td className="text-sm whitespace-nowrap">{date(e.spentOn)}</Td>
                <Td className="min-w-56">
                  <Link href={expenseHref(e)} className="text-sm font-semibold hover:text-primary">
                    {e.description}
                  </Link>
                  <span className="block text-xs text-text-2">{whatLine(e)}</span>
                </Td>
                <Td className="text-sm">
                  <span className="block whitespace-nowrap">{e.paidBy?.name ?? <Dash />}</span>
                  {paidFrom(e) && <span className="block text-xs text-text-2">{paidFrom(e)}</span>}
                </Td>
                <Td className="text-right text-sm whitespace-nowrap">
                  <Amount e={e} main={main} />
                </Td>
                <Td>
                  <ExpenseStatus e={e} />
                </Td>
              </DataRow>
            ))}
          </tbody>
        </Table>
      </div>
    </>
  );
}
