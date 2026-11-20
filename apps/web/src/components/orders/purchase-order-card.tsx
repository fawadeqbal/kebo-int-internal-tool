"use client";

import { Mail } from "lucide-react";
import { Field, Input, Select, Textarea, Notice } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PanelBody, useClosePanel, WindowFooter } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";
import type { Incoterm, LeadFrom, WarrantyFrom } from "@kebo/shared";

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
  /** The factory's offer its lines were bought on (design "terms that travel"). */
  offer?: { id: string; reference: string | null; receivedOn: string; basis: string | null; basisPlace: string | null } | null;
  /** Agreed with the factory: its own copy once sent, else its offer's. */
  agreed?: FactoryAgreedView;
}

/** What was agreed with a factory, in the four groups (the payment's parts are its plan's). */
export interface FactoryTermsView {
  basis: Incoterm | null;
  basisPlace: string | null;
  leadDays: number | null;
  leadFrom: LeadFrom | null;
  leadTime: string | null;
  warrantyMonths: number | null;
  warrantyFrom: WarrantyFrom | null;
  warranty: string | null;
  paymentNote: string | null;
  moq: string | null;
  notes: string | null;
  warrantyLine: string | null;
}
export interface FactoryAgreedView extends FactoryTermsView {
  /** Its own copy (false: not sent yet, or sent before it was kept — its offer's). */
  copied: boolean;
  offered: FactoryTermsView;
  /** The ready date worked out from the lead time (the factory's own date is on Production). */
  readyBy: { by: "advance" | "order"; on: string | null; readyOn: string | null } | { by: "drawings" } | null;
  changes: number;
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
              <Notice tone="todo">
                <strong>Deposit not verified.</strong> {deposit.text}
              </Notice>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Sent on" htmlFor="po-sent" required error={s.errors?.sentOn}>
                <Input id="po-sent" name="sentOn" type="date" max={today} defaultValue={s.values?.sentOn ?? today} />
              </Field>
              <Field label="Their order no." htmlFor="po-ref" error={s.errors?.supplierRef}>
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
                error={s.errors?.reason}
              >
                <Textarea id="po-reason" name="reason" rows={3} maxLength={300} defaultValue={s.values?.reason ?? ""} />
              </Field>
            )}
          </PanelBody>
          <WindowFooter className="static mx-0 mb-0">
            <SubmitButton pendingText="Saving…">
              <Mail aria-hidden /> Send purchase order
            </SubmitButton>
          </WindowFooter>
        </>
      )}
    </ActionForm>
  );
}
