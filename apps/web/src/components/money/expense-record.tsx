"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { EXPENSE_CATEGORY_LABEL, INQUIRY_STAGE_LABEL, INQUIRY_STAGE_TONE } from "@kebo/shared";
import { Alert, Badge, Button, buttonClass, cn } from "@kebo/ui";
import { date, money } from "@/lib/format";
import type { Fx } from "@/lib/fx";
import type { Person } from "@/lib/types";
import type { ExpenseView } from "@/lib/types-money";
import { expenseAction, removeReceiptAction, voidExpenseAction } from "@/app/(app)/money/actions";
import { PaymentRecord } from "./payment-record";
import { EditExpense, NewExpense, uploadReceipt, VoidForm, type ExpenseChoices } from "./forms";

const VIEWABLE = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/;
const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

/** Who an expense was for, in a few words. */
export const forWhom = (e: ExpenseView) =>
  e.order
    ? `${e.order.refNo} · ${e.customer?.name ?? ""}`
    : e.deal
      ? `${e.deal.refNo}${e.deal.stage === "lost" ? " (lost)" : ""} · ${e.customer?.name ?? ""}`
      : (e.customer?.name ?? "The company");

/** The receipt kept with an expense: a preview of a photo, a PDF link, and add / replace / remove. */
function Receipt({ e, canChange }: { e: ExpenseView; canChange: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, startRemove] = useTransition();
  const send = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const err = await uploadReceipt(e.id, file);
    setBusy(false);
    if (err) setError(err);
    else router.refresh();
    if (input.current) input.current.value = "";
  };
  const r = e.receipt;
  return (
    <div className="flex flex-col gap-2">
      {r ? (
        <div className="flex flex-wrap items-center gap-3">
          {r.type.startsWith("image/") && VIEWABLE.test(r.type) ? (
            <a href={`/files/expenses/${e.id}?view=1`} target="_blank" rel="noreferrer" className="block shrink-0" aria-label={`Open ${r.name}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a private file from our own route, not an optimisable image */}
              <img src={`/files/expenses/${e.id}?view=1`} alt={`Receipt: ${r.name}`} className="h-20 w-28 rounded-md border border-line object-cover" />
            </a>
          ) : (
            <span className="flex size-12 items-center justify-center rounded-md border border-line bg-surface">
              <FileText className="size-5 text-muted" aria-hidden />
            </span>
          )}
          <span className="min-w-0 text-sm">
            <a
              href={`/files/expenses/${e.id}${VIEWABLE.test(r.type) ? "?view=1" : ""}`}
              target={VIEWABLE.test(r.type) ? "_blank" : undefined}
              rel="noreferrer"
              className="block truncate font-medium hover:text-primary"
            >
              {r.name}
            </a>
            <span className="text-xs text-muted">{size(r.size)}</span>
          </span>
        </div>
      ) : (
        <span className="text-muted">None kept</span>
      )}
      {canChange && (
        <div className="flex flex-wrap gap-1">
          <input ref={input} type="file" accept="image/*,application/pdf" className="sr-only" id={`rc-${e.id}`} onChange={(ev) => send(ev.target.files?.[0])} />
          <label htmlFor={`rc-${e.id}`} className={cn(buttonClass("secondary", "xs"), "cursor-pointer", busy && "pointer-events-none opacity-60")}>
            <Upload aria-hidden /> {busy ? "Sending…" : r ? "Replace" : "Add a photo or PDF"}
          </label>
          {r && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={removing}
              onClick={() =>
                startRemove(async () => {
                  const res = await removeReceiptAction(e.id, e.customer?.id ?? null, e.orderId);
                  if (!res.ok) setError(res.message ?? "Could not remove it.");
                  router.refresh();
                })
              }
            >
              <Trash2 aria-hidden /> {removing ? "Removing…" : "Remove"}
            </Button>
          )}
        </div>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

/**
 * One expense in a list: a line with the amount, what for and who for, that
 * opens into the full record with its receipt, and Change / Add again / Remove.
 * With `choices` (Money page, a customer's page) its customer or order can be
 * changed; on an order's page it stays on that order.
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
  const removed = Boolean(e.voided);
  const orderId = choices ? null : e.orderId;
  return (
    <PaymentRecord
      removed={removed}
      label={`Expense of ${money(e.amount, e.currency)} on ${date(e.spentOn)}`}
      summary={
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className={cn("font-medium tabular", removed && "line-through")}>{money(e.amount, e.currency)}</span>
          <span className="min-w-0 text-text-2">{e.description}</span>
          {e.receipt && <Paperclip className="size-3.5 self-center text-muted" aria-label="Receipt kept" />}
          {removed && <Badge tone="bad">Removed</Badge>}
        </span>
      }
      sub={
        <>
          {EXPENSE_CATEGORY_LABEL[e.category]} · {date(e.spentOn)}
          {showFor && ` · ${forWhom(e)}`}
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
              <Link href={`/orders/${e.order.id}/money`} className="font-medium hover:text-primary">
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
              <Link href={`/deals/${e.deal.id}`} className="font-medium hover:text-primary">
                Deal {e.deal.refNo}
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
            <Link href={`/customers/${e.customer.id}`} className="font-medium hover:text-primary">
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
                label: "Factory visited",
                value: (
                  <Link href={`/factories/${e.factory.id}`} className="hover:text-primary">
                    {e.factory.name}
                  </Link>
                ),
              },
            ]
          : []),
        { label: "Bill / ticket number", value: e.reference ?? <span className="text-muted">None</span> },
        ...(e.note ? [{ label: "Note", value: <span className="whitespace-pre-line">{e.note}</span>, wide: true }] : []),
        ...(e.voided ? [{ label: "Removed because", value: e.voided.reason ?? "—", wide: true }] : []),
        { label: "Receipt or ticket", value: <Receipt e={e} canChange={canChange && !removed} />, wide: true },
      ]}
      actions={
        canChange && !removed ? (
          <>
            <EditExpense action={expenseAction.bind(null, orderId, e.id)} people={people} mainCurrency={mainCurrency} fx={fx} today={today} expense={e} choices={choices} />
            <NewExpense
              action={expenseAction.bind(null, orderId, null)}
              people={people}
              mainCurrency={mainCurrency}
              fx={fx}
              today={today}
              template={e}
              choices={choices}
              label="Add again"
            />
            <VoidForm action={voidExpenseAction.bind(null, e.orderId, e.id)} label="the expense" />
          </>
        ) : undefined
      }
    />
  );
}
