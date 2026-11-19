"use client";

import { useState, type ReactNode } from "react";
import { INCOTERMS, isLeadFrom, isWarrantyFrom, type LeadFrom, type WarrantyFrom } from "@kebo/shared";
import { Alert, Field, Input, Select, Textarea } from "@kebo/ui";
import { PanelSection } from "@/components/common/panel";
import { LeadField, WarrantyFields } from "@/components/deals/terms-fields";
import type { ActionState } from "@/lib/actions";
import type { FactoryOwed, FactoryPaymentView } from "@/lib/types-money";
import type { Person } from "@/lib/types";
import { FactoryPaymentForm, VoidForm } from "@/components/money/forms";
import { AttachedFile } from "@/components/money/attachment";
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
    <SectionWindow button={{ label: "Edit" }} title="Purchase order" sub={sub} action={action} files={canFiles ? { orderId, section: "purchase_order" } : undefined}>
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
  label = "Pay the supplier",
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
  prefill?: { factoryId: string; amount: string; kind: "deposit" | "balance"; reference?: string | null };
  /** Open at once (a list's row asked for it), and what to do once it closes. */
  startOpen?: boolean;
  onClosed?: () => void;
}) {
  const [fileError, setFileError] = useState<string | null>(null);
  const { startOpen, onClosed, ...fields } = p;
  return (
    <>
      <FormWindow button={{ label, kind: main ? "main" : "plain" }} title="Pay the supplier" sub={sub} size="lg" disabled={!p.factories.length} startOpen={startOpen} onClosed={onClosed}>
        {(close) => <FactoryPaymentForm {...fields} bare onClose={close} onFileError={setFileError} />}
      </FormWindow>
      {fileError && <Alert tone="error">{fileError}</Alert>}
    </>
  );
}

/** "Change" on a payment to a factory: its fields with why it changes, its bank slip, and "Remove this payment". */
export function ChangeFactoryPaymentWindow({
  sub,
  payment,
  save,
  remove,
  removeFile,
  ...p
}: {
  sub: string;
  payment: FactoryPaymentView;
  save: Action;
  remove: Action;
  removeFile: () => Promise<ActionState>;
  factories: FactoryOwed[];
  people: Person[];
  orderCurrency: string;
  fx: Fx;
  today: string;
}) {
  return (
    <FormWindow button={{ label: "Change", kind: "link" }} title="Change a payment" sub={sub} size="lg">
      {(close) => (
        <>
          <FactoryPaymentForm {...p} action={save} payment={payment} bare onClose={close} />
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <p className="text-md font-semibold">Bank slip</p>
            <AttachedFile src={`/files/factory-payments/${payment.id}`} file={payment.file} what="Bank slip" canChange remove={removeFile} empty="No bank slip" />
          </div>
          <div className="border-t border-line pt-4">
            <VoidForm action={remove} label="this payment" button="Remove this payment" />
          </div>
        </>
      )}
    </FormWindow>
  );
}

/** What the factory Change window starts from: what the purchase order keeps as agreed now. */
export interface FactoryAgreedValues {
  basis: string | null;
  basisPlace: string | null;
  leadDays: number | null;
  leadFrom: LeadFrom | null;
  warrantyMonths: number | null;
  warrantyFrom: WarrantyFrom | null;
  warranty: string | null;
  paymentNote: string | null;
  moq: string | null;
  notes: string | null;
}

function FactoryAgreedFields({ state, values, payment, sent }: { state: ActionState; values: FactoryAgreedValues; payment: ReactNode; sent: boolean }) {
  // After "Why?" the form is drawn again from what was typed (state.values).
  const typed = state.values ?? {};
  const pick = (k: keyof FactoryAgreedValues, fallback: string) => (k in typed ? (typed[k] ?? "") : fallback);
  const whole = (n: number | null) => (n === null ? "" : String(n));
  const [leadDays, setLeadDays] = useState(pick("leadDays", whole(values.leadDays)));
  const [leadFrom, setLeadFrom] = useState<LeadFrom>(() => {
    const f = pick("leadFrom", values.leadFrom ?? "after_payment");
    return isLeadFrom(f) ? f : "after_payment";
  });
  const [months, setMonths] = useState(pick("warrantyMonths", whole(values.warrantyMonths)));
  const [wFrom, setWFrom] = useState<WarrantyFrom>(() => {
    const f = pick("warrantyFrom", values.warrantyFrom ?? "shipment");
    return isWarrantyFrom(f) ? f : "shipment";
  });
  const [covers, setCovers] = useState(pick("warranty", values.warranty ?? ""));
  const e = state.errors ?? {};
  const v = (k: "basis" | "basisPlace" | "paymentNote" | "moq" | "notes") => pick(k, values[k] ?? "");
  return (
    <>
      <p className="rounded-md bg-info-soft px-3 py-2 text-xs text-text">
        {sent
          ? "Their offer stays as they sent it. What you change here is what this purchase order and its document use from now on; a document already made final keeps what it said."
          : "Not sent yet: it goes to the supplier with what you set here."}
      </p>
      <input type="hidden" name="leadDays" value={leadDays.trim()} />
      <input type="hidden" name="leadFrom" value={leadDays.trim() ? leadFrom : ""} />
      <input type="hidden" name="warrantyMonths" value={months.trim()} />
      <input type="hidden" name="warrantyFrom" value={months.trim() ? wFrom : ""} />
      <input type="hidden" name="warranty" value={covers} />

      <PanelSection title="Delivery" sub="where they hand the goods over, and how long they need" first>
        <Field label="Incoterm" htmlFor="fac-basis" optional error={e.basis}>
          <Select id="fac-basis" name="basis" defaultValue={v("basis")}>
            <option value="">Not said</option>
            {INCOTERMS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Place" htmlFor="fac-place" optional error={e.basisPlace}>
          <Input id="fac-place" name="basisPlace" maxLength={60} defaultValue={v("basisPlace")} />
        </Field>
        <LeadField id="fac-lead" side="factory" days={leadDays} from={leadFrom} onDays={setLeadDays} onFrom={setLeadFrom} error={e.leadDays ?? e.leadFrom} className="sm:col-span-2" />
      </PanelSection>

      <PanelSection title="Payment" sub="its parts are its plan's" className="sm:grid-cols-1">
        <div className="rounded-md border border-line bg-surface-2/40 px-3 py-2 text-md">{payment}</div>
        <Field label="Payment note" htmlFor="fac-note" optional error={e.paymentNote}>
          <Textarea id="fac-note" name="paymentNote" rows={2} className="min-h-0" maxLength={2000} defaultValue={v("paymentNote")} />
        </Field>
      </PanelSection>

      <PanelSection title="Warranty" className="md:grid-cols-3">
        <WarrantyFields
          idPrefix="fac"
          months={months}
          from={wFrom}
          covers={covers}
          onMonths={setMonths}
          onFrom={setWFrom}
          onCovers={setCovers}
          errors={{ months: e.warrantyMonths, from: e.warrantyFrom, covers: e.warranty }}
        />
      </PanelSection>

      <PanelSection title="Conditions" className="sm:grid-cols-1">
        <Field label="Minimum order" htmlFor="fac-moq" optional error={e.moq}>
          <Input id="fac-moq" name="moq" maxLength={60} defaultValue={v("moq")} />
        </Field>
        <Field label="Notes to the supplier" htmlFor="fac-notes" optional error={e.notes}>
          <Textarea id="fac-notes" name="notes" rows={3} className="min-h-0" maxLength={5000} defaultValue={v("notes")} />
        </Field>
      </PanelSection>
      {sent && <p className="text-xs text-text-2">Anything that differs from their offer asks why when you save; the reason is kept in the order’s history.</p>}
    </>
  );
}

/**
 * Change what we agreed with the factory (design "terms that travel", step 3b): Delivery, the payment's note,
 * Warranty and Conditions on its purchase order; the parts are changed in its plan. Once sent, a change from
 * their offer asks why.
 */
export function FactoryAgreedWindow({
  title,
  sub,
  action,
  values,
  payment,
  sent,
}: {
  title: string;
  sub: string;
  action: Action;
  values: FactoryAgreedValues;
  /** The plan in a line. */
  payment: ReactNode;
  sent: boolean;
}) {
  return (
    <SectionWindow button={{ label: "Change" }} title={title} sub={sub} action={action} size="md">
      {(s) => <FactoryAgreedFields state={s} values={values} payment={payment} sent={sent} />}
    </SectionWindow>
  );
}
