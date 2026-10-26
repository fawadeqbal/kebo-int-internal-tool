"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Pencil } from "lucide-react";
import { PAYMENT_KIND_LABEL, PAYMENT_KINDS, PAYMENT_METHOD_LABEL, PAYMENT_METHODS, type PaymentKind } from "@kebo/shared";
import { Button, DetailList, Field, Input, Select, Textarea } from "@kebo/ui";
import { ConfirmSubmit, SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { OrderNext } from "@/lib/types-orders";

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
}: {
  next: OrderNext | null;
  back: { to: string; label: string } | null;
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
      <ConfirmSubmit variant="ghost" size="sm" pendingText="Moving…" message={`${back.label}? Use this only if the order was moved by mistake.`} className="text-muted">
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
                <Field label="When will the goods be ready?" htmlFor="move-readyOn" optional hint="The factory's expected ready date, if you know it" error={s.errors?.readyOn}>
                  <Input id="move-readyOn" name="readyOn" type="date" className="w-44" defaultValue={s.values?.readyOn ?? readyOn ?? ""} />
                </Field>
              )}
              {next.to === "shipped" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Shipped on" htmlFor="move-shippedOn" error={s.errors?.shippedOn}>
                    <Input id="move-shippedOn" name="shippedOn" type="date" max={today} defaultValue={s.values?.shippedOn ?? shippedOn ?? today} />
                  </Field>
                  <Field label="B/L number" htmlFor="move-blNo" optional hint="Bill of lading, if you have it" error={s.errors?.blNo}>
                    <Input id="move-blNo" name="blNo" maxLength={60} defaultValue={s.values?.blNo ?? blNo ?? ""} />
                  </Field>
                </div>
              )}
              {warn && (
                <div role="alert" className="flex flex-col gap-2 rounded-lg border border-warn/30 bg-warn-soft p-3 text-sm">
                  <p className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                    <span>
                      <span className="block font-medium">Check before you go ahead</span>
                      {s.message}
                    </span>
                  </p>
                  <input type="hidden" name="confirm" value="true" />
                  <Field label="Note" htmlFor="move-note" optional hint="Why you are going ahead; it is kept in the order's history" error={s.errors?.note}>
                    <Textarea id="move-note" name="note" rows={2} className="min-h-0" defaultValue={s.values?.note} />
                  </Field>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <SubmitButton pendingText="Moving…">
                  {warn ? "Go ahead anyway" : next.label}
                  {!warn && <ArrowRight aria-hidden />}
                </SubmitButton>
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

/* ---------------------------------------------------------------- details */

export function DetailsForm({
  action,
  canEdit,
  today,
  fixed,
  values,
  shown,
}: {
  action: Action;
  canEdit: boolean;
  today: string;
  /** Read-only rows (incoterm, payment terms, ordered on). */
  fixed: { label: string; value: ReactNode }[];
  values: { shipBy: string | null; readyOn: string | null; shippedOn: string | null; blNo: string | null };
  /** The same values, formatted for reading. */
  shown: { shipBy: string; readyOn: string; shippedOn: string; blNo: string };
}) {
  const [editing, setEditing] = useState(false);
  if (!editing)
    return (
      <div className="flex flex-col gap-3">
        <DetailList
          columns={1}
          items={[
            ...fixed,
            { label: "Ship by", value: shown.shipBy },
            { label: "Ready on", value: shown.readyOn },
            { label: "Shipped on", value: shown.shippedOn },
            { label: "B/L number", value: shown.blNo },
          ]}
        />
        {canEdit && (
          <div>
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              <Pencil aria-hidden /> Edit details
            </Button>
          </div>
        )}
      </div>
    );
  return (
    <ActionForm action={action} onDone={() => setEditing(false)} className="flex flex-col gap-3">
      {(s) => (
        <>
          <DetailList columns={1} items={fixed} />
          <Field label="Ship by" htmlFor="d-shipBy" optional hint="Promised to the customer" error={s.errors?.shipBy}>
            <Input id="d-shipBy" name="shipBy" type="date" defaultValue={s.values?.shipBy ?? values.shipBy ?? ""} />
          </Field>
          <Field label="Ready on" htmlFor="d-readyOn" optional hint="When the factory expects the goods ready" error={s.errors?.readyOn}>
            <Input id="d-readyOn" name="readyOn" type="date" defaultValue={s.values?.readyOn ?? values.readyOn ?? ""} />
          </Field>
          <Field label="Shipped on" htmlFor="d-shippedOn" optional error={s.errors?.shippedOn}>
            <Input id="d-shippedOn" name="shippedOn" type="date" max={today} defaultValue={s.values?.shippedOn ?? values.shippedOn ?? ""} />
          </Field>
          <Field label="B/L number" htmlFor="d-blNo" optional error={s.errors?.blNo}>
            <Input id="d-blNo" name="blNo" maxLength={60} defaultValue={s.values?.blNo ?? values.blNo ?? ""} />
          </Field>
          <div className="flex gap-2">
            <SubmitButton size="sm" pendingText="Saving…">
              Save details
            </SubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/* ---------------------------------------------------------------- payments */

/** "Record a payment" (managers): suggests the deposit still missing, else what is still due. */
export function PaymentForm({ action, currency, depositDue, due, today }: { action: Action; currency: string; depositDue: string; due: string; today: string }) {
  const first: PaymentKind = Number(depositDue) > 0 ? "deposit" : "balance";
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<PaymentKind>(first);
  if (Number(due) <= 0) return <p className="text-sm text-muted">Paid in full: nothing more to record.</p>;
  if (!open)
    return (
      <div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setKind(first);
            setOpen(true);
          }}
        >
          Record a payment
        </Button>
      </div>
    );
  const amount = kind === "deposit" && Number(depositDue) > 0 ? depositDue : kind === "other" ? "" : due;
  return (
    <ActionForm action={action} onDone={() => setOpen(false)} className={framed}>
      {(s) => (
        <>
          <p className="text-sm font-medium">Payment from the customer, in {currency}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="What for" htmlFor="p-kind" error={s.errors?.kind}>
              <Select id="p-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as PaymentKind)}>
                {PAYMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {PAYMENT_KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`Amount received (${currency})`} htmlFor="p-amount" hint="What reached our bank" error={s.errors?.amount}>
              <Input key={kind} id="p-amount" name="amount" inputMode="decimal" className="tabular" defaultValue={s.values?.amount ?? amount} />
            </Field>
            <Field label="Bank charges" htmlFor="p-charges" optional hint="Deducted by the banks; counts as paid" error={s.errors?.bankCharges}>
              <Input id="p-charges" name="bankCharges" inputMode="decimal" placeholder="0.00" className="tabular" defaultValue={s.values?.bankCharges ?? ""} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Paid on" htmlFor="p-paidOn" error={s.errors?.paidOn}>
              <Input id="p-paidOn" name="paidOn" type="date" max={today} defaultValue={s.values?.paidOn ?? today} />
            </Field>
            <Field label="Method" htmlFor="p-method" error={s.errors?.method}>
              <Select id="p-method" name="method" defaultValue={s.values?.method ?? "bank_transfer"}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Bank reference" htmlFor="p-reference" optional hint="e.g. the T/T or SWIFT reference" error={s.errors?.reference}>
              <Input id="p-reference" name="reference" maxLength={120} defaultValue={s.values?.reference ?? ""} />
            </Field>
          </div>
          <Field label="Note" htmlFor="p-note" optional error={s.errors?.note}>
            <Textarea id="p-note" name="note" rows={2} className="min-h-0" defaultValue={s.values?.note} />
          </Field>
          <div className="flex gap-2">
            <SubmitButton size="sm" pendingText="Recording…">
              Record the payment
            </SubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Remove a payment recorded by mistake (managers), with a reason. */
export function VoidPayment({ action }: { action: Action }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button size="xs" variant="danger-ghost" onClick={() => setOpen(true)}>
        Remove
      </Button>
    );
  return (
    <ActionForm action={action} onDone={() => setOpen(false)} className={`${framed} mt-2 w-full`}>
      {(s) => (
        <>
          <Field label="Why remove it?" htmlFor="void-reason" error={s.errors?.reason} hint="It stays listed, crossed out">
            <Textarea id="void-reason" name="reason" rows={2} className="min-h-0" placeholder="e.g. recorded twice" defaultValue={s.values?.reason} />
          </Field>
          <div className="flex gap-2">
            <SubmitButton size="sm" variant="danger" pendingText="Removing…">
              Remove the payment
            </SubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Keep it
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/* ---------------------------------------------------------------- cancelling */

export function CancelOrderForm({ action }: { action: Action }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <div>
        <Button size="sm" variant="danger-ghost" onClick={() => setOpen(true)}>
          Cancel this order
        </Button>
      </div>
    );
  return (
    <ActionForm action={action} onDone={() => setOpen(false)} className="flex flex-col gap-3">
      {(s) => (
        <>
          <Field label="Why is it cancelled?" htmlFor="cancel-reason" error={s.errors?.reason}>
            <Textarea id="cancel-reason" name="reason" rows={2} className="min-h-0" defaultValue={s.values?.reason} />
          </Field>
          <div className="flex gap-2">
            <SubmitButton size="sm" variant="danger" pendingText="Cancelling…">
              Cancel the order
            </SubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Keep it
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}
