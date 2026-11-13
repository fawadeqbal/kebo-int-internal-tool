"use client";

import { Field, Input, Textarea } from "@kebo/ui";
import type { ActionState } from "@/lib/actions";
import { FieldRow, SectionWindow } from "./section-window";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** "The order": the customer's PO, who the goods go to, our ship-by and the port; its file is the customer's PO. */
export function OrderWindow({
  orderId,
  sub,
  action,
  today,
  customer,
  heading,
  canFiles,
  values,
}: {
  orderId: string;
  sub: string;
  action: Action;
  today: string;
  customer: string;
  /** The inquiry's title: what the papers are headed with while no heading is typed. */
  heading: string;
  canFiles: boolean;
  values: Record<"customerRef" | "customerPoOn" | "consignee" | "notifyParty" | "deliveryAddress" | "shipBy" | "portOfDischarge" | "documentTitle", string | null>;
}) {
  return (
    <SectionWindow button={{ label: "Edit" }} title="The order" sub={sub} action={action} files={canFiles ? { orderId, section: "order", hint: "the customer’s PO" } : undefined}>
      {(s) => {
        const v = (k: keyof typeof values) => s.values?.[k] ?? values[k] ?? "";
        return (
          <>
            <FieldRow>
              <Field label="Their PO no." htmlFor="ord-po" optional error={s.errors?.customerRef}>
                <Input id="ord-po" name="customerRef" maxLength={80} defaultValue={v("customerRef")} />
              </Field>
              <Field label="PO date" htmlFor="ord-poOn" optional error={s.errors?.customerPoOn}>
                <Input id="ord-poOn" name="customerPoOn" type="date" max={today} defaultValue={v("customerPoOn")} />
              </Field>
            </FieldRow>
            <Field label="Consignee" htmlFor="ord-consignee" optional error={s.errors?.consignee}>
              <Textarea id="ord-consignee" name="consignee" rows={2} className="min-h-0" maxLength={500} placeholder={customer} defaultValue={v("consignee")} />
            </Field>
            <Field label="Notify party" htmlFor="ord-notify" optional error={s.errors?.notifyParty}>
              <Textarea id="ord-notify" name="notifyParty" rows={2} className="min-h-0" maxLength={500} placeholder="Same as consignee" defaultValue={v("notifyParty")} />
            </Field>
            <Field label="Delivery address" htmlFor="ord-deliver" optional error={s.errors?.deliveryAddress}>
              <Textarea id="ord-deliver" name="deliveryAddress" rows={2} className="min-h-0" maxLength={500} defaultValue={v("deliveryAddress")} />
            </Field>
            <FieldRow>
              <Field label="Ship by" htmlFor="ord-shipBy" optional error={s.errors?.shipBy}>
                <Input id="ord-shipBy" name="shipBy" type="date" defaultValue={v("shipBy")} />
              </Field>
              <Field label="Port of discharge" htmlFor="ord-pod" optional error={s.errors?.portOfDischarge}>
                <Input id="ord-pod" name="portOfDischarge" maxLength={120} defaultValue={v("portOfDischarge")} />
              </Field>
            </FieldRow>
            <Field label="Heading on the papers" htmlFor="ord-title" optional error={s.errors?.documentTitle}>
              <Input id="ord-title" name="documentTitle" maxLength={200} placeholder={heading} defaultValue={v("documentTitle")} />
            </Field>
          </>
        );
      }}
    </SectionWindow>
  );
}
