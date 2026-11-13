"use client";

import { useState } from "react";
import type { PaymentRoute } from "@kebo/shared";
import { Alert } from "@kebo/ui";
import type { ActionState } from "@/lib/actions";
import type { OrderMoney } from "@/lib/types-money";
import type { BankContract } from "@/lib/types-flow";
import { BankContractForm, RouteForm, type RouteTermsValue } from "@/components/orders/flow-forms";
import { EditCustomerPayment, PaymentPlan, VoidForm } from "@/components/money/forms";
import { AttachedFile } from "@/components/money/attachment";
import { ReceivedFields } from "@/components/money/money-v2";
import { FormWindow } from "./form-window";
import { WindowFiles } from "./section-files";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;
type Fx = Parameters<typeof ReceivedFields>[0]["fx"];

/** "How they pay": the route and its terms. Changing it rebuilds the plan; paid parts stay. */
export function RouteWindow(props: { sub: string; action: Action; route: PaymentRoute | null; bankRoutes: boolean; terms?: RouteTermsValue; fromQuotation?: boolean; suggest?: PaymentRoute | null }) {
  const { sub, ...form } = props;
  return (
    <FormWindow button={{ label: props.route ? "Change" : "Choose", kind: props.route ? "plain" : "main" }} title="How they pay" sub={sub} size="md">
      {(close) => <RouteForm {...form} onDone={close} />}
    </FormWindow>
  );
}

/** The bank's paper for the route: the letter of credit, or the bank contract. Its file is the copy received. */
export function ContractWindow({ sub, action, contract, lc, currency, orderId, canFiles }: { sub: string; action: Action; contract: BankContract | null; lc: boolean; currency: string; orderId: string; canFiles: boolean }) {
  return (
    <FormWindow button={{ label: contract ? "Edit" : "Add", kind: contract ? "edit" : "main" }} title={lc ? "The letter of credit" : "The bank contract"} sub={sub} size="md">
      {(close) => (
        <>
          <BankContractForm action={action} contract={contract} lc={lc} currency={currency} onDone={close} />
          {canFiles && <WindowFiles orderId={orderId} section={lc ? "lc" : "bank_contract"} hint={lc ? "the LC as received" : "the registered contract"} />}
        </>
      )}
    </FormWindow>
  );
}

/** "Payment plan": the parts the customer pays, which must add up to the order's total. */
export function PlanWindow({ sub, action, plan, currency, total, terms }: { sub: string; action: Action; plan: OrderMoney["plan"]; currency: string; total: string; terms: string }) {
  return (
    <FormWindow button={{ label: "Edit plan", kind: "plain" }} title="Payment plan" sub={sub} size="lg">
      {(close) => <PaymentPlan plan={plan} currency={currency} total={total} terms={terms} action={action} buttonOnly startOpen onDone={close} />}
    </FormWindow>
  );
}

/** "Record a payment": money received from the customer on this order, with its bank slip. */
export function RecordPaymentWindow({
  main,
  ...p
}: {
  main: boolean;
  action: Action;
  currency: string;
  customer: string;
  refNo: string;
  due: string;
  depositDue: string;
  forWhat: string | null;
  fx: Fx;
  today: string;
  /** Opened from a part of the plan: what is still to come on it, filled in. */
  amount?: string;
  /** Open at once (a list's row asked for it), and what to do once it closes. */
  startOpen?: boolean;
  onClosed?: () => void;
  /** The person sends money for a manager to verify (it does not count until then). */
  verify?: boolean;
}) {
  const [fileError, setFileError] = useState<string | null>(null);
  const { startOpen, onClosed, ...fields } = p;
  return (
    <>
      <FormWindow
        button={{ label: "Record payment", kind: main ? "main" : "plain" }}
        title="Record a payment"
        sub={`${p.refNo} · from ${p.customer}${p.forWhat ? ` · ${p.forWhat}` : ""}`}
        size="lg"
        startOpen={startOpen}
        onClosed={onClosed}
      >
        {(close) => <ReceivedFields {...fields} bare onClose={close} onFileError={setFileError} />}
      </FormWindow>
      {fileError && <Alert tone="error">{fileError}</Alert>}
    </>
  );
}

type Payment = Parameters<typeof EditCustomerPayment>[0]["payment"] & { id: string; receiptId: string | null; file: Parameters<typeof AttachedFile>[0]["file"] };

/**
 * "Change" on a payment received: its fields with why it changes, its bank slip, and "Remove this payment".
 * A payment that came from the customer's credit, or that is part of one transfer over several orders, has
 * no fields of its own to change: the window says so and offers what can be done.
 */
export function ChangePaymentWindow({
  sub,
  payment,
  currency,
  today,
  save,
  remove,
  removeFile,
  customerId,
}: {
  sub: string;
  payment: Payment;
  currency: string;
  today: string;
  /** Null: this person may not change payments. */
  save: Action | null;
  /** Null: this person may not remove payments. */
  remove: Action | null;
  removeFile: () => Promise<ActionState>;
  customerId: string;
}) {
  const fromCredit = payment.method === "credit";
  const transfer = !!payment.receiptId;
  return (
    <FormWindow button={{ label: "Change", kind: "link" }} title="Change a payment" sub={sub} size="lg">
      {(close) => (
        <>
          {transfer ? (
            <p className="text-sm text-text-2">
              This payment is part of one transfer over several orders. To change it, remove the transfer on{" "}
              <a href={`/customers/${customerId}/money`} className="font-medium text-primary hover:underline">
                the customer&apos;s money
              </a>{" "}
              and record it again.
            </p>
          ) : fromCredit ? (
            <p className="text-sm text-text-2">This payment came from the customer&apos;s credit. Removing it puts the credit back.</p>
          ) : (
            save && <EditCustomerPayment action={save} payment={payment} currency={currency} today={today} onClose={close} />
          )}
          {!fromCredit && (
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <p className="text-[13px] font-semibold">Bank slip</p>
              <AttachedFile src={`/files/payments/${payment.id}`} file={payment.file} what="Bank slip" canChange={!!save} remove={removeFile} empty="No bank slip" />
            </div>
          )}
          {remove && !transfer && (
            <div className="border-t border-line pt-4">
              <VoidForm action={remove} label="this payment" button="Remove this payment" />
            </div>
          )}
        </>
      )}
    </FormWindow>
  );
}
