"use client";

import Link from "next/link";
import { Paperclip } from "lucide-react";
import { EXPENSE_CATEGORY_LABEL, INQUIRY_STAGE_LABEL, INQUIRY_STAGE_TONE } from "@kebo/shared";
import { Badge, cn } from "@kebo/ui";
import { money } from "@/lib/format";
import { useTime } from "@/lib/time-client";
import type { Fx } from "@/lib/fx";
import type { Person } from "@/lib/types";
import type { ExpenseView } from "@/lib/types-money";
import { removeReceiptAction, voidExpenseAction } from "@/app/(app)/money/actions";
import { PaymentRecord } from "./payment-record";
import { AttachedFile } from "./attachment";
import { VoidForm } from "./forms";
import { AddCost, ChangeCost, type CostSetup, type ExpenseChoices } from "./cost-window";
import { costForOf } from "./cost-kinds";
import { StopRepeating } from "./company-costs";


/** Who an expense was for, in a few words. */
export const forWhom = (e: ExpenseView) =>
  e.order
    ? `${e.order.refNo} · ${e.customer?.name ?? ""}`
    : e.deal
      ? `${e.deal.refNo}${e.deal.stage === "lost" ? " (lost)" : ""} · ${e.customer?.name ?? ""}`
      : (e.customer?.name ?? "The company");

/** The receipt kept with an expense: a preview of a photo, a PDF link, and add / replace / remove. */
function Receipt({ e, canChange }: { e: ExpenseView; canChange: boolean }) {
  return <AttachedFile src={`/files/expenses/${e.id}`} file={e.receipt} what="Receipt" canChange={canChange} remove={() => removeReceiptAction(e.id, e.customer?.id ?? null, e.orderId)} />;
}

/**
 * One expense in a list: a line with the amount, what for and who for, that
 * opens into the full record with its receipt, and Change / Add again / Remove.
 * Change opens the one cost window; `choices` limits what it can be moved to
 * (a customer's page: only theirs).
 */
export function ExpenseRecord({
  e,
  mainCurrency,
  people,
  fx,
  today,
  choices,
  showFor = true,
  canChange = true,
}: {
  e: ExpenseView;
  mainCurrency: string;
  people: Person[];
  fx: Fx;
  today: string;
  choices?: ExpenseChoices;
  /** Say who it was for in the line (not on an order's own page). */
  showFor?: boolean;
  canChange?: boolean;
}) {
  const { date } = useTime();
  const removed = Boolean(e.voided);
  const setup: CostSetup = { mainCurrency, fx, today, people, for: costForOf(e), choices };
  return (
    <PaymentRecord
      removed={removed}
      label={`Expense of ${money(e.amount, e.currency)} on ${date(e.spentOn)}`}
      summary={
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className={cn("font-medium tabular", removed && "line-through")}>{money(e.amount, e.currency)}</span>
          <span className="min-w-0 text-text-2">{e.description}</span>
          {e.repeats && <span className="text-xs text-muted">· repeats</span>}
          {e.receipt && <Paperclip className="size-3.5 self-center text-muted" aria-label="Receipt kept" />}
          {removed && <Badge tone="bad">Removed</Badge>}
        </span>
      }
      sub={
        <>
          {EXPENSE_CATEGORY_LABEL[e.category]} · {date(e.spentOn)}
          {showFor && ` · ${forWhom(e)}`}
          {e.paidBy && ` · paid by ${e.paidBy.name}${e.ownMoney ? (e.repaid ? " (own money, paid back)" : " (own money, owed back)") : ""}`}
          {e.currency !== mainCurrency && ` · ≈ ${money(e.inMain, mainCurrency)}`}
        </>
      }
      fields={[
        { label: "Kind", value: EXPENSE_CATEGORY_LABEL[e.category] },
        { label: "Spent on", value: date(e.spentOn) },
        {
          label: "Amount",
          value: (
            <span className="tabular">
              {money(e.amount, e.currency)}
              {e.currency !== mainCurrency && (
                <span className="block text-xs text-muted">
                  ≈ {money(e.inMain, mainCurrency)} at {e.rate} {e.currency} per {mainCurrency}
                </span>
              )}
            </span>
          ),
        },
        {
          label: "For",
          value: e.order ? (
            <>
              <Link href={`/orders/${e.order.id}/payment`} className="-my-1 inline-block py-1 font-medium hover:text-primary">
                Order {e.order.refNo}
              </Link>
              {e.customer && (
                <Link href={`/customers/${e.customer.id}`} className="block text-xs text-muted hover:text-primary">
                  {e.customer.name}
                </Link>
              )}
            </>
          ) : e.deal ? (
            <>
              <Link href={`/inquiries/${e.deal.id}`} className="-my-1 inline-block py-1 font-medium hover:text-primary">
                Inquiry {e.deal.refNo}
              </Link>{" "}
              <Badge tone={INQUIRY_STAGE_TONE[e.deal.stage]}>{INQUIRY_STAGE_LABEL[e.deal.stage]}</Badge>
              <span className="block truncate text-xs text-muted">{e.deal.title}</span>
              {e.customer && (
                <Link href={`/customers/${e.customer.id}`} className="block text-xs text-muted hover:text-primary">
                  {e.customer.name}
                </Link>
              )}
            </>
          ) : e.customer ? (
            <Link href={`/customers/${e.customer.id}`} className="-my-1 inline-block py-1 font-medium hover:text-primary">
              {e.customer.name}
            </Link>
          ) : (
            "The company"
          ),
        },
        { label: "Paid by", value: e.paidBy?.name ?? <span className="text-muted">Not said</span> },
        ...(e.factory
          ? [
              {
                label: "Supplier visited",
                value: (
                  <Link href={`/suppliers/${e.factory.id}`} className="hover:text-primary">
                    {e.factory.name}
                  </Link>
                ),
              },
            ]
          : []),
        { label: "Bill / ticket number", value: e.reference ?? <span className="text-muted">None</span> },
        { label: "Paid from account", value: e.account?.name ?? <span className="text-muted">Not said</span> },
        ...(e.note ? [{ label: "Note", value: <span className="whitespace-pre-line">{e.note}</span>, wide: true }] : []),
        ...(e.voided ? [{ label: "Removed because", value: e.voided.reason ?? "—", wide: true }] : []),
        { label: "Receipt or ticket", value: <Receipt e={e} canChange={canChange && !removed} />, wide: true },
      ]}
      actions={
        canChange && !removed ? (
          <>
            <ChangeCost setup={setup} expense={e} removeOrderId={e.orderId} />
            <AddCost setup={setup} template={{ ...e, for: setup.for ?? undefined }} label="Add again" variant="ghost" size="xs" icon="copy" />
            {e.repeats && e.repeatKey && <StopRepeating repeatKey={e.repeatKey} />}
            <VoidForm action={voidExpenseAction.bind(null, e.orderId, e.id)} label="the expense" />
          </>
        ) : undefined
      }
    />
  );
}
