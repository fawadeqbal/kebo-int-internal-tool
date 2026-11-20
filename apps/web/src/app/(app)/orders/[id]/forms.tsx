"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button, cn, Field, Input, Textarea, Notice } from "@kebo/ui";
import { PanelBody, SidePanel, useSidePanel } from "@/components/common/panel";
import { SubmitButton } from "@kebo/ui/client";
import { ConfirmSubmit } from "@/components/common/dialog";

import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { OrderNext } from "@/lib/types-orders";
import { AccountSelect } from "@/components/money/accounts";
import { Modal } from "@/components/common/dialog";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const framed = "flex flex-col gap-3 rounded-lg border border-line bg-surface-2/60 p-3";

/* ---------------------------------------------------------------- the one button */

/**
 * The order's one button (and the small "Back to …" link). Moving to In
 * production asks for the ready date if known, to Shipped for the ship date and
 * B/L; to Done nothing. When the API warns (no deposit, money still due) the
 * warning shows with "Go ahead anyway", which sends the same move with confirm.
 */
export function StageActions({
  next,
  back,
  action,
  today,
  readyOn,
  shippedOn,
  blNo,
  closeCheck,
}: {
  next: OrderNext | null;
  back: { to: string; label: string } | null;
  /** Closing with something not done (papers not made): said first, and closed only on a yes. */
  closeCheck?: string | null;
  action: Action;
  today: string;
  readyOn: string | null;
  /** Kept when shipping again after a move back. */
  shippedOn: string | null;
  blNo: string | null;
}) {
  const [open, setOpen] = useState(false);
  // A new key remounts the form, which clears a warning that was not taken up.
  const [round, setRound] = useState(0);
  const close = () => {
    setOpen(false);
    setRound((r) => r + 1);
  };
  const asks = next?.to === "in_production" || next?.to === "shipped";
  const backLink = back && (
    <ActionForm action={action} showSuccess={false} className="inline-flex flex-col items-start">
      <input type="hidden" name="to" value={back.to} />
      <ConfirmSubmit confirmLabel={back.label} variant="ghost" size="sm" pendingText="Moving…" message={`${back.label}? Use this only if the order was moved by mistake.`} className="text-muted">
        <ArrowLeft aria-hidden /> {back.label}
      </ConfirmSubmit>
    </ActionForm>
  );
  if (!next) return backLink ? <div className="flex flex-wrap items-center gap-2">{backLink}</div> : null;
  if (asks && !open)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => setOpen(true)}>
          {next.label} <ArrowRight aria-hidden />
        </Button>
        {backLink}
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      <ActionForm key={round} action={action} quietCodes={["confirm"]} onDone={close} className={asks ? framed : "flex flex-col gap-3"}>
        {(s) => {
          const warn = s.code === "confirm";
          return (
            <>
              <input type="hidden" name="to" value={next.to} />
              {asks && <p className="text-sm font-medium">{next.label}</p>}
              {next.to === "in_production" && (
                <Field label="When will the goods be ready?" htmlFor="move-readyOn" optional error={s.errors?.readyOn}>
                  <Input id="move-readyOn" name="readyOn" type="date" className="w-44" defaultValue={s.values?.readyOn ?? readyOn ?? ""} />
                </Field>
              )}
              {next.to === "shipped" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Shipped on" htmlFor="move-shippedOn" error={s.errors?.shippedOn}>
                    <Input id="move-shippedOn" name="shippedOn" type="date" max={today} defaultValue={s.values?.shippedOn ?? shippedOn ?? today} />
                  </Field>
                  <Field label="B/L number" htmlFor="move-blNo" optional error={s.errors?.blNo}>
                    <Input id="move-blNo" name="blNo" maxLength={60} defaultValue={s.values?.blNo ?? blNo ?? ""} />
                  </Field>
                </div>
              )}
              {warn && (
                <>
                  <Notice tone="todo" title="Check before you go ahead">
                    <Warnings text={s.message ?? ""} />
                  </Notice>
                  <input type="hidden" name="confirm" value="true" />
                  <Field label="Note" htmlFor="move-note" optional error={s.errors?.note}>
                    <Textarea id="move-note" name="note" rows={2} className="min-h-0" defaultValue={s.values?.note} />
                  </Field>
                </>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {closeCheck && next.to === "done" && !warn ? (
                  <ConfirmSubmit confirmLabel="Close it anyway" pendingText="Moving…" message={closeCheck}>
                    {next.label} <ArrowRight aria-hidden />
                  </ConfirmSubmit>
                ) : (
                  <SubmitButton pendingText="Moving…">
                    {warn ? "Go ahead anyway" : next.label}
                    {!warn && <ArrowRight aria-hidden />}
                  </SubmitButton>
                )}
                {(asks || warn) && (
                  <Button type="button" variant="ghost" onClick={close}>
                    Cancel
                  </Button>
                )}
              </div>
            </>
          );
        }}
      </ActionForm>
      {backLink && <div>{backLink}</div>}
    </div>
  );
}

/** The API sends its warnings as sentences in one message; more than one reads better as a list. */
function Warnings({ text }: { text: string }) {
  const parts = text.split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean);
  if (parts.length < 2) return <>{text}</>;
  return (
    <ul className="mt-0.5 list-disc pl-4">
      {parts.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- payments */

/**
 * Cancel an order (MoneyV2Cancel). Money is never left hanging: with money
 * received it asks what happens to it (keep as credit, refund now or later,
 * keep as a fee); with money paid to the factory, a refund expected from the
 * factory or a loss on this order.
 */
export function CancelOrderForm({
  action,
  refNo,
  customer,
  received,
  currency,
  factoryPaid = [],
  today,
  total,
  voids,
}: {
  action: Action;
  refNo?: string;
  customer?: string;
  /** Money received on the order (its currency). */
  received?: string;
  currency?: string;
  /** Money paid to the factories ("CNY 30,000.00 to Wenzhou Works"). */
  factoryPaid?: string[];
  today?: string;
  /** The order total, for the dialog's title line. */
  total?: string;
  /** What else cancelling ends ("The quotation R2 becomes void and PO-2026-0044 is cancelled."). */
  voids?: string;
}) {
  // Opened from the order's ⋯ menu ("Cancel the order…"), kept in the URL so Back closes it.
  const { open, close } = useSidePanel("cancel-order");
  const [customerMoney, setCustomerMoney] = useState<"credit" | "refund" | "fee">("credit");
  const [refundNow, setRefundNow] = useState(true);
  const [factoryMoney, setFactoryMoney] = useState<"refund_due" | "loss">("refund_due");
  const moneyIn = Number(received ?? 0) > 0 && currency;
  const choice = (value: string, chosen: string, title: string, pick: () => void) => (
    <button
      key={value}
      type="button"
      role="radio"
      aria-checked={chosen === value}
      onClick={pick}
      className={cn(
        "flex items-center gap-3 rounded-[10px] border px-3.5 py-2.5 text-left text-sm",
        chosen === value ? "border-primary bg-primary-soft text-text ring-1 ring-primary" : "border-line bg-surface hover:border-line-strong",
      )}
    >
      <span className={cn("size-4 shrink-0 rounded-full border-2", chosen === value ? "border-primary bg-primary shadow-[inset_0_0_0_3px_var(--surface)]" : "border-line-strong")} aria-hidden />
      {title}
    </button>
  );
  const amount = (v: string) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (
    <>
      {open && (
      <Modal title={`Cancel ${refNo ?? "this order"}?`} sub={[customer, total && currency ? `${currency} ${amount(total)}` : null].filter(Boolean).join(" · ") || undefined} onClose={() => close()}>
        <ActionForm action={action} onDone={() => close()} keepFields className="flex flex-col gap-4">
          {(s) => (
            <>
              <p className="rounded-[10px] bg-bad-soft px-3.5 py-2.5 text-sm text-bad">
                <b>Cancel order.</b> This cannot be undone.{voids ? ` ${voids}` : ""}
              </p>
              <Field label="Why is it cancelled?" htmlFor="cancel-reason" required error={s.errors?.reason}>
                <Textarea id="cancel-reason" name="reason" rows={3} required defaultValue={s.values?.reason} />
              </Field>
              {moneyIn && (
                <div className="flex flex-col gap-2">
                  <input type="hidden" name="customerMoney" value={customerMoney} />
                  <p className="text-sm font-semibold">
                    Customer&rsquo;s {currency} {amount(received!)}
                  </p>
                  <div role="radiogroup" aria-label="Money received" className="grid gap-2 sm:grid-cols-3">
                    {choice("credit", customerMoney, "Kept as the customer\u2019s credit", () => setCustomerMoney("credit"))}
                    {choice("refund", customerMoney, "Refunded", () => setCustomerMoney("refund"))}
                    {choice("fee", customerMoney, "Kept as a cancellation fee", () => setCustomerMoney("fee"))}
                  </div>
                  {customerMoney === "refund" && (
                    <div className="mt-1 grid items-end gap-3 sm:grid-cols-3">
                      <input type="hidden" name="refundNow" value={refundNow ? "true" : "false"} />
                      <label className="flex h-11 items-center gap-2.5 text-sm">
                        <input type="checkbox" className="size-4 accent-[var(--primary-solid)]" checked={refundNow} onChange={(e) => setRefundNow(e.target.checked)} />
                        Refund now
                      </label>
                      {refundNow ? (
                        <>
                          <AccountSelect id="cx-account" label="From account" currency={currency} defaultValue={s.values?.refundAccountId} error={s.errors?.refundAccountId} />
                          <Field label="Refund on" htmlFor="cx-on" error={s.errors?.refundOn}>
                            <Input id="cx-on" name="refundOn" type="date" max={today} defaultValue={s.values?.refundOn ?? today} />
                          </Field>
                        </>
                      ) : (
                        <p className="text-xs text-muted sm:col-span-2">Kept as their credit until the refund is recorded.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
              {factoryPaid.length > 0 && (
                <div className="flex flex-col gap-2">
                  <input type="hidden" name="factoryMoney" value={factoryMoney} />
                  <p className="text-sm font-semibold">Supplier deposit {factoryPaid.join(", ")}</p>
                  <div role="radiogroup" aria-label="Money paid to the supplier" className="grid gap-2 sm:grid-cols-2">
                    {choice("refund_due", factoryMoney, "Refund expected from the supplier", () => setFactoryMoney("refund_due"))}
                    {choice("loss", factoryMoney, "A loss on this order", () => setFactoryMoney("loss"))}
                  </div>
                </div>
              )}
              {!moneyIn && !factoryPaid.length && <p className="text-xs text-muted">No money was received or paid on this order.</p>}
              <div className="-mx-5 -mb-4 mt-1 flex flex-wrap justify-end gap-2 border-t border-line bg-surface-2/60 px-5 py-3.5 sm:-mx-6 sm:px-6">
                <Button type="button" variant="secondary" onClick={() => close()}>
                  Keep the order
                </Button>
                <SubmitButton variant="danger" pendingText="Cancelling…">
                  Cancel order
                </SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Modal>
      )}
    </>
  );
}

/**
 * "Reopen the order…" in a closed order's ⋯ (not its main button: a finished order's first button never undoes
 * it): a window that says where it goes back to and asks why, as every move back does.
 */
export function ReopenOrderForm({ action, back, refNo }: { action: Action; back: { to: string; label: string }; refNo: string }) {
  const { open, close } = useSidePanel("reopen-order");
  if (!open) return null;
  return (
    <SidePanel title={`Reopen ${refNo}`} description={`It goes back to ${back.label.replace(/^Back to /, "")}.`} onClose={() => close()}>
      <PanelBody>
        <ActionForm action={action} onDone={() => close()} className="flex flex-col gap-4">
          {(s) => (
            <>
              <input type="hidden" name="to" value={back.to} />
              <Field label="Why does it open again?" htmlFor="reopen-why" error={s.errors?.reason}>
                <Textarea id="reopen-why" name="reason" rows={2} className="min-h-0" required defaultValue={s.values?.reason} />
              </Field>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => close()}>
                  Cancel
                </Button>
                <SubmitButton pendingText="Reopening…">Reopen the order</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </PanelBody>
    </SidePanel>
  );
}
