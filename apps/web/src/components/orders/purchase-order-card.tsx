"use client";

import { Mail } from "lucide-react";
import { Alert, Button, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PanelActions, PanelBody, useClosePanel } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export interface PurchaseOrderView {
  id: string;
  number: string;
  supplier: { id: string; name: string };
  lines: number;
  currency: string | null;
  total: string | null;
  readyOn: string | null;
  sentOn: string | null;
  sentBy: { id: string; name: string } | null;
  supplierRef: string | null;
  sentEarlyReason: string | null;
}

const HOW = ["Email", "WeChat", "WhatsApp", "By hand"];

/** "Send PO-2026-0044 to …" (board POSendEarly): the day, their order no., how; before the deposit is verified, why. */
export function SendForm({ action, deposit, today, supplierRef }: { action: Action; deposit: { verified: boolean; text: string }; today: string; supplierRef: string | null }) {
  const close = useClosePanel();
  return (
    <ActionForm action={action} onDone={close} className="flex min-h-0 flex-1 flex-col">
      {(s) => (
        <>
          <PanelBody className="flex flex-col gap-4">
            {!deposit.verified && (
              <Alert tone="warning">
                <strong>Deposit not verified.</strong> {deposit.text}
              </Alert>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Sent on" htmlFor="po-sent" required error={s.errors?.sentOn}>
                <Input id="po-sent" name="sentOn" type="date" max={today} defaultValue={s.values?.sentOn ?? today} />
              </Field>
              <Field label="Their order no." htmlFor="po-ref" hint="if the factory gives one" error={s.errors?.supplierRef}>
                <Input id="po-ref" name="supplierRef" maxLength={60} defaultValue={s.values?.supplierRef ?? supplierRef ?? ""} />
              </Field>
              <Field label="Send by" htmlFor="po-how">
                <Select id="po-how" name="how" defaultValue={s.values?.how ?? HOW[0]}>
                  {HOW.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {!deposit.verified && (
              <Field
                label="Why send it before the deposit is verified?"
                htmlFor="po-reason"
                required
                hint="The reason is kept on the purchase order and in the audit log."
                error={s.errors?.reason}
              >
                <Textarea id="po-reason" name="reason" rows={3} maxLength={300} defaultValue={s.values?.reason ?? ""} />
              </Field>
            )}
          </PanelBody>
          <PanelActions className="static mx-0 mb-0 justify-end">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <SubmitButton pendingText="Saving…">
              <Mail aria-hidden /> Send purchase order
            </SubmitButton>
          </PanelActions>
        </>
      )}
    </ActionForm>
  );
}
