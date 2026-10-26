"use client";

import { useState } from "react";
import { PAYMENT_KIND_LABEL, PAYMENT_KINDS, PAYMENT_METHOD_LABEL, PAYMENT_METHODS, type PaymentKind } from "@kebo/shared";
import { Button, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import { GateHelp, InlineAction, NoteField, type Action } from "./gate";

export interface PayableFactoryOrder {
  id: string;
  label: string;
  currency: string;
  /** Still owed towards the deposit, and in all (plain numbers, e.g. "42600.00"). */
  depositDue: string;
  outstanding: string;
}

function PaymentFields({
  id,
  s,
  kind,
  setKind,
  amount,
  currency,
  today,
  currencyHint,
  direction,
}: {
  id: string;
  s: ActionState;
  kind: PaymentKind;
  setKind: (k: PaymentKind) => void;
  amount: string;
  currency: string;
  today: string;
  currencyHint: string;
  direction: "in" | "out";
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="What for" htmlFor={`${id}-kind`} error={s.errors?.kind}>
          <Select id={`${id}-kind`} name="kind" value={kind} onChange={(e) => setKind(e.target.value as PaymentKind)}>
            {PAYMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {PAYMENT_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={direction === "in" ? "Amount received" : "Amount paid"}
          htmlFor={`${id}-amount`}
          error={s.errors?.amount}
          hint={direction === "in" ? "What reached our bank" : "What left our bank"}
        >
          <Input
            key={`${kind}-${amount}`}
            id={`${id}-amount`}
            name="amount"
            inputMode="decimal"
            defaultValue={s.values?.amount ?? amount}
            className="tabular"
          />
        </Field>
        <Field
          label="Bank charges"
          htmlFor={`${id}-charges`}
          error={s.errors?.bankCharges}
          optional
          hint="Deducted by the banks; counts as paid"
        >
          <Input
            id={`${id}-charges`}
            name="bankCharges"
            inputMode="decimal"
            defaultValue={s.values?.bankCharges ?? ""}
            placeholder="0.00"
            className="tabular"
          />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Currency" htmlFor={`${id}-currency`} error={s.errors?.currency} hint={currencyHint}>
          <Input id={`${id}-currency`} name="currency" defaultValue={s.values?.currency ?? currency} maxLength={3} className="uppercase" />
        </Field>
        <Field label="Paid on" htmlFor={`${id}-paidOn`} error={s.errors?.paidOn}>
          <Input id={`${id}-paidOn`} name="paidOn" type="date" max={today} defaultValue={s.values?.paidOn ?? today} />
        </Field>
        <Field label="Method" htmlFor={`${id}-method`} error={s.errors?.method}>
          <Select id={`${id}-method`} name="method" defaultValue={s.values?.method ?? "bank_transfer"}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABEL[m]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Bank reference" htmlFor={`${id}-reference`} error={s.errors?.reference} optional hint="e.g. the T/T or SWIFT reference">
        <Input id={`${id}-reference`} name="reference" defaultValue={s.values?.reference ?? ""} />
      </Field>
    </>
  );
}

/** "Record a payment from the customer": suggests the deposit still missing, else the balance. */
export function PaymentInForm({
  action,
  currency,
  depositMissing,
  outstanding,
  today,
  defaultOpen,
  canOverride,
}: {
  action: Action;
  currency: string;
  depositMissing: string;
  outstanding: string;
  today: string;
  defaultOpen: boolean;
  canOverride: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [kind, setKind] = useState<PaymentKind>(Number(depositMissing) > 0 ? "deposit" : "balance");
  const amount = kind === "deposit" && Number(depositMissing) > 0 ? depositMissing : kind === "other" ? "" : outstanding;
  if (!open) {
    if (Number(outstanding) <= 0) return <p className="text-sm text-muted">Paid in full: nothing more to record.</p>;
    return (
      <Button
        variant="primary"
        size="sm"
        onClick={() => {
          setKind(Number(depositMissing) > 0 ? "deposit" : "balance");
          setOpen(true);
        }}
      >
        Record a payment from the customer
      </Button>
    );
  }
  return (
    <ActionForm
      action={action}
      onDone={() => setOpen(false)}
      className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-card"
    >
      {(s) => (
        <>
          <h3 className="text-sm font-semibold">Payment from the customer</h3>
          <GateHelp state={s} canOverride={canOverride} />
          <PaymentFields
            id="in"
            s={s}
            kind={kind}
            setKind={setKind}
            amount={amount}
            currency={currency}
            today={today}
            currencyHint={`The order is in ${currency}`}
            direction="in"
          />
          <Field label="Note" htmlFor="in-note" optional>
            <Textarea id="in-note" name="note" rows={2} className="min-h-0" defaultValue={s.values?.note} />
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

/**
 * "Record a payment to a factory". When the customer's deposit has not arrived
 * the API refuses (deposit_first / note_required): the form stays open and a
 * manager writes why to go ahead.
 */
export function PaymentOutForm({
  action,
  factoryOrders,
  today,
  defaultOpen,
  canOverride,
  gate,
  noneReason,
}: {
  action: Action;
  factoryOrders: PayableFactoryOrder[];
  /** Shown instead of the button when no factory order can be paid. */
  noneReason: string;
  today: string;
  defaultOpen: boolean;
  canOverride: boolean;
  /** Why paying the factory is not expected yet (from the checklist), if it is not. */
  gate: string | null;
}) {
  const [open, setOpen] = useState(defaultOpen && factoryOrders.length > 0);
  const [foId, setFoId] = useState(factoryOrders[0]?.id ?? "");
  const fo = factoryOrders.find((f) => f.id === foId) ?? factoryOrders[0];
  const [kind, setKind] = useState<PaymentKind>(fo && Number(fo.depositDue) > 0 ? "deposit" : "balance");
  if (!open) {
    if (!factoryOrders.length) return <p className="text-sm text-muted">{noneReason}</p>;
    return (
      <Button
        size="sm"
        variant="secondary"
        className="self-start"
        onClick={() => {
          const first = factoryOrders[0];
          setFoId(first.id);
          setKind(Number(first.depositDue) > 0 ? "deposit" : "balance");
          setOpen(true);
        }}
      >
        Record a payment to a factory
      </Button>
    );
  }
  const amount = !fo ? "" : kind === "deposit" && Number(fo.depositDue) > 0 ? fo.depositDue : kind === "other" ? "" : fo.outstanding;
  return (
    <ActionForm
      action={action}
      onDone={() => setOpen(false)}
      className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-card"
    >
      {(s) => (
        <>
          <h3 className="text-sm font-semibold">Payment to a factory</h3>
          {gate && !s.code && <p className="text-xs text-warn">{gate}</p>}
          <GateHelp state={s} canOverride={canOverride} reason={gate} />
          <Field label="Factory order" htmlFor="out-fo" error={s.errors?.factoryOrderId}>
            <Select
              id="out-fo"
              name="factoryOrderId"
              value={foId}
              onChange={(e) => {
                setFoId(e.target.value);
                const next = factoryOrders.find((f) => f.id === e.target.value);
                if (next) setKind(Number(next.depositDue) > 0 ? "deposit" : "balance");
              }}
            >
              {factoryOrders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </Select>
          </Field>
          <PaymentFields
            key={fo?.id}
            id="out"
            s={s}
            kind={kind}
            setKind={setKind}
            amount={amount}
            currency={fo?.currency ?? ""}
            today={today}
            currencyHint={fo ? `This factory order is in ${fo.currency}` : ""}
            direction="out"
          />
          <NoteField id="out-note" state={s} canOverride={canOverride} gated={!!gate} />
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

export function VoidPayment({ action }: { action: Action }) {
  return (
    <InlineAction label="Void" variant="danger-ghost" action={action} submitLabel="Void the payment" submitVariant="danger">
      {(s) => (
        <Field label="Why is it void?" htmlFor="void-reason" error={s.errors?.reason}>
          <Textarea
            id="void-reason"
            name="reason"
            rows={2}
            className="min-h-0"
            defaultValue={s.values?.reason}
            placeholder="e.g. recorded twice"
          />
        </Field>
      )}
    </InlineAction>
  );
}
