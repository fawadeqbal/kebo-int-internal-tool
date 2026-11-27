"use client";

import { Check } from "lucide-react";
import { Field, Input, RULES, Select, Textarea, Notice, linkClass } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PanelBody, useClosePanel, WhatHappens, WindowFooter } from "@/components/common/panel";
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
  /** The supplier's offer its lines were bought on (design "terms that travel"). */
  offer?: { id: string; reference: string | null; receivedOn: string; basis: string | null; basisPlace: string | null } | null;
  /** Agreed with the supplier: its own copy once sent, else its offer's. */
  agreed?: SupplierAgreedView;
}

/** What was agreed with a supplier, in the four groups (the payment's parts are its plan's). */
export interface SupplierTermsView {
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
export interface SupplierAgreedView extends SupplierTermsView {
  /** Its own copy (false: not sent yet, or sent before it was kept — its offer's). */
  copied: boolean;
  offered: SupplierTermsView;
  /** The ready date worked out from the lead time (the supplier's own date is on Production). */
  readyBy: { by: "advance" | "order"; on: string | null; readyOn: string | null } | { by: "drawings" } | null;
  changes: number;
}

const HOW = ["Email", "WeChat", "WhatsApp", "By hand"];

/** "Send PO-2026-0044 to …" (board POSendEarly): the day, their order no., how; before the deposit is verified, why. */
export function SendForm({
  action,
  deposit,
  today,
  supplierRef,
  paper,
}: {
  action: Action;
  deposit: { verified: boolean; text: string };
  today: string;
  supplierRef: string | null;
  /** The PO the app prints: sent from here as the quotation is, with its PDF to hand (e2e 24 Nov: none in the window). */
  paper?: { viewHref: string; pdfHref: string; fileName: string };
}) {
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
            {/* The same fields, in the same order, as "I sent it myself" on a quotation: How, Sent on. */}
            <div className={RULES.form.fields}>
              <Field label="How" htmlFor="po-how">
                <Select id="po-how" name="how" defaultValue={s.values?.how ?? HOW[0]}>
                  {HOW.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Sent on" htmlFor="po-sent" required error={s.errors?.sentOn}>
                <Input id="po-sent" name="sentOn" type="date" max={today} defaultValue={s.values?.sentOn ?? today} />
              </Field>
              <Field label="Their order no." htmlFor="po-ref" optional error={s.errors?.supplierRef}>
                <Input id="po-ref" name="supplierRef" maxLength={60} defaultValue={s.values?.supplierRef ?? supplierRef ?? ""} />
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
            {paper && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3.5 py-2.5 text-md">
                <span className="font-semibold">{paper.fileName}</span>
                <span className="flex gap-4">
                  <a href={paper.viewHref} className={linkClass}>
                    View
                  </a>
                  <a href={paper.pdfHref} download={paper.fileName} className={linkClass}>
                    Download PDF
                  </a>
                </span>
              </div>
            )}
            <WhatHappens lines={["Nothing is sent by the system: send the PO yourself, then mark it here.", "The purchase order becomes Sent and is kept exactly as sent."]} />
          </PanelBody>
          <WindowFooter outside>
            <SubmitButton pendingText="Saving…">
              <Check aria-hidden /> Mark the PO as sent
            </SubmitButton>
          </WindowFooter>
        </>
      )}
    </ActionForm>
  );
}
