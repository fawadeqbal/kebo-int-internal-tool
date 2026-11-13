"use client";

import { useState } from "react";
import { Alert, Field, Input } from "@kebo/ui";
import type { ActionState } from "@/lib/actions";
import type { FactoryOwed } from "@/lib/types-money";
import type { Person } from "@/lib/types";
import { FactoryPaymentForm } from "@/components/money/forms";
import { FormWindow } from "./form-window";
import { FieldRow, SectionWindow } from "./section-window";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;
type Fx = Parameters<typeof FactoryPaymentForm>[0]["fx"];

/** "Purchase order": the factory's own number for our order and the day we ordered; its files are their proforma and our signed PO. */
export function FactoryOrderWindow({
  orderId,
  sub,
  action,
  today,
  orderNo,
  orderedOn,
  canFiles,
}: {
  orderId: string;
  sub: string;
  action: Action;
  today: string;
  orderNo: string | null;
  orderedOn: string | null;
  canFiles: boolean;
}) {
  return (
    <SectionWindow button={{ label: "Edit" }} title="Purchase order" sub={sub} action={action} files={canFiles ? { orderId, section: "purchase_order", hint: "their proforma, our signed PO" } : undefined}>
      {(s) => (
        <FieldRow>
          <Field label="Their order no." htmlFor="fo-no" optional error={s.errors?.factoryOrderNo}>
            <Input id="fo-no" name="factoryOrderNo" maxLength={60} defaultValue={s.values?.factoryOrderNo ?? orderNo ?? ""} />
          </Field>
          <Field label="Ordered on" htmlFor="fo-on" optional error={s.errors?.factoryOrderedOn}>
            <Input id="fo-on" name="factoryOrderedOn" type="date" max={today} defaultValue={s.values?.factoryOrderedOn ?? orderedOn ?? ""} />
          </Field>
        </FieldRow>
      )}
    </SectionWindow>
  );
}

/** "Pay the factory": money sent to a factory on this order, with its slip. */
export function PayFactoryWindow({
  label = "Pay the factory",
  main,
  sub,
  ...p
}: {
  label?: string;
  main?: boolean;
  sub: string;
  action: Action;
  factories: FactoryOwed[];
  people: Person[];
  orderCurrency: string;
  fx: Fx;
  today: string;
  prefill?: { factoryId: string; amount: string; kind: "deposit" | "balance" };
}) {
  const [fileError, setFileError] = useState<string | null>(null);
  return (
    <>
      <FormWindow button={{ label, kind: main ? "main" : "plain" }} title="Pay the factory" sub={sub} size="lg" disabled={!p.factories.length}>
        {(close) => <FactoryPaymentForm {...p} bare onClose={close} onFileError={setFileError} />}
      </FormWindow>
      {fileError && <Alert tone="error">{fileError}</Alert>}
    </>
  );
}
