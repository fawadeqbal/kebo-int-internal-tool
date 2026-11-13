"use client";

import { useState } from "react";
import type { PaymentRoute } from "@kebo/shared";
import { Alert } from "@kebo/ui";
import type { ActionState } from "@/lib/actions";
import type { OrderMoney } from "@/lib/types-money";
import type { BankContract } from "@/lib/types-flow";
import { BankContractForm, RouteForm, type RouteTermsValue } from "@/components/orders/flow-forms";
import { PaymentPlan } from "@/components/money/forms";
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
}) {
  const [fileError, setFileError] = useState<string | null>(null);
  return (
    <>
      <FormWindow button={{ label: "Record payment", kind: main ? "main" : "plain" }} title="Record a payment" sub={`${p.refNo} · from ${p.customer}`} size="lg">
        {(close) => <ReceivedFields {...p} bare onClose={close} onFileError={setFileError} />}
      </FormWindow>
      {fileError && <Alert tone="error">{fileError}</Alert>}
    </>
  );
}
