"use client";

import { useState, type ReactNode } from "react";
import { isLeadFrom, isWarrantyFrom, type LeadFrom, type WarrantyFrom } from "@kebo/shared";
import { ButtonLink, Field, Input, Textarea } from "@kebo/ui";
import { PanelSection } from "@/components/common/panel";
import { LeadField, WarrantyFields } from "@/components/deals/terms-fields";
import type { ActionState } from "@/lib/actions";
import { FieldRow, SectionWindow } from "./section-window";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** "Their order": the customer's PO no. and date; its file is the customer's PO. */
export function OrderWindow({
  orderId,
  sub,
  action,
  today,
  canFiles,
  values,
}: {
  orderId: string;
  sub: string;
  action: Action;
  today: string;
  canFiles: boolean;
  values: Record<"customerRef" | "customerPoOn", string | null>;
}) {
  return (
    <SectionWindow button={{ label: "Edit" }} title="Their order" sub={sub} action={action} files={canFiles ? { orderId, section: "order" } : undefined}>
      {(s) => {
        const v = (k: keyof typeof values) => s.values?.[k] ?? values[k] ?? "";
        return (
          <FieldRow>
            <Field label="Their PO no." htmlFor="ord-po" optional error={s.errors?.customerRef}>
              <Input id="ord-po" name="customerRef" maxLength={80} defaultValue={v("customerRef")} />
            </Field>
            <Field label="PO date" htmlFor="ord-poOn" optional error={s.errors?.customerPoOn}>
              <Input id="ord-poOn" name="customerPoOn" type="date" max={today} defaultValue={v("customerPoOn")} />
            </Field>
          </FieldRow>
        );
      }}
    </SectionWindow>
  );
}

/** What the Change window starts from: what the order keeps as agreed now. */
export interface AgreedValues {
  incoterm: string;
  incotermPlace: string | null;
  portOfDischarge: string | null;
  leadDays: number | null;
  leadFrom: LeadFrom | null;
  shipBy: string | null;
  warrantyMonths: number | null;
  warrantyFrom: WarrantyFrom | null;
  warranty: string | null;
  deliveryConditions: string | null;
  paymentConditions: string | null;
  notes: string | null;
}

const text = (v: string | null | undefined) => v ?? "";
const whole = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

/** The fields kept in state (the lead time's and the warranty's boxes), sent as hidden fields. */
function AgreedFields({ state, values, shipHint, payment, paymentHref }: { state: ActionState; values: AgreedValues; shipHint: string; payment: ReactNode; paymentHref: string }) {
  // After "Why?" the form is drawn again from what was typed (state.values).
  const typed = state.values ?? {};
  const pick = (k: keyof AgreedValues, fallback: string) => (k in typed ? (typed[k] ?? "") : fallback);
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
  const [covers, setCovers] = useState(pick("warranty", text(values.warranty)));
  const e = state.errors ?? {};
  const v = (k: keyof AgreedValues) => pick(k, text(values[k] as string | null));
  return (
    <>
      <p className="rounded-md bg-info-soft px-3 py-2 text-xs text-text">
        The quotation stays exactly as it was sent. What you change here is what the order and its papers use from now on; a paper already made final keeps what it said.
      </p>
      <input type="hidden" name="leadDays" value={leadDays.trim()} />
      <input type="hidden" name="leadFrom" value={leadDays.trim() ? leadFrom : ""} />
      <input type="hidden" name="warrantyMonths" value={months.trim()} />
      <input type="hidden" name="warrantyFrom" value={months.trim() ? wFrom : ""} />
      <input type="hidden" name="warranty" value={covers} />

      <PanelSection title="Delivery" sub="where we hand the goods over, and when" className="md:grid-cols-3" first>
        <Field label="Delivery basis (Incoterm)" htmlFor="agr-incoterm">
          <Input id="agr-incoterm" value={values.incoterm} readOnly className="bg-surface-2 font-semibold" />
        </Field>
        <Field label="Place" htmlFor="agr-place" optional error={e.incotermPlace}>
          <Input id="agr-place" name="incotermPlace" maxLength={80} defaultValue={v("incotermPlace")} />
        </Field>
        <Field label="Port of discharge" htmlFor="agr-pod" optional error={e.portOfDischarge}>
          <Input id="agr-pod" name="portOfDischarge" maxLength={120} defaultValue={v("portOfDischarge")} />
        </Field>
        <LeadField
          id="agr-lead"
          side="customer"
          days={leadDays}
          from={leadFrom}
          onDays={setLeadDays}
          onFrom={setLeadFrom}
          error={e.leadDays ?? e.leadFrom}
          className="sm:col-span-2"
        />
        <Field label="Ship by" htmlFor="agr-shipBy" optional error={e.shipBy} hint={shipHint}>
          <Input id="agr-shipBy" name="shipBy" type="date" defaultValue={v("shipBy")} />
        </Field>
        <Field label="Delivery conditions" htmlFor="agr-delivery" optional error={e.deliveryConditions} className="sm:col-span-2 md:col-span-3">
          <Textarea id="agr-delivery" name="deliveryConditions" rows={2} className="min-h-0" maxLength={5000} defaultValue={v("deliveryConditions")} />
        </Field>
      </PanelSection>

      <PanelSection title="Payment" sub="changed in one place: its plan" className="sm:grid-cols-1">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface-2/40 px-3 py-2 text-[13px]">
          <span className="min-w-0">{payment}</span>
          <ButtonLink href={paymentHref} size="sm" variant="secondary">
            Open the payment plan
          </ButtonLink>
        </div>
        <Field label="Payment conditions" htmlFor="agr-payment" optional error={e.paymentConditions}>
          <Textarea id="agr-payment" name="paymentConditions" rows={2} className="min-h-0" maxLength={5000} defaultValue={v("paymentConditions")} />
        </Field>
      </PanelSection>

      <PanelSection title="Warranty" className="md:grid-cols-3">
        <WarrantyFields
          idPrefix="agr"
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
        <Field label="Notes" htmlFor="agr-notes" optional error={e.notes}>
          <Textarea id="agr-notes" name="notes" rows={3} className="min-h-0" maxLength={5000} defaultValue={v("notes")} />
        </Field>
      </PanelSection>
      <p className="text-xs text-text-2">Anything that differs from the quotation asks why when you save; the reason is kept in the order’s history.</p>
    </>
  );
}

/**
 * Change what we agreed with the customer (design "terms that travel"): Delivery, Warranty and Conditions in the
 * quotation's groups; the payment is its plan's (a link to it, not a copy). A change from the quotation asks why.
 */
export function AgreedWindow({
  title,
  sub,
  action,
  values,
  shipHint,
  payment,
  paymentHref,
}: {
  title: string;
  sub: string;
  action: Action;
  values: AgreedValues;
  shipHint: string;
  /** The plan in a line ("Bank transfer (T/T) · 30% paid · 60% before shipment · …"). */
  payment: ReactNode;
  paymentHref: string;
}) {
  return (
    <SectionWindow button={{ label: "Change" }} title={title} sub={sub} action={action} size="md">
      {(s) => <AgreedFields state={s} values={values} shipHint={shipHint} payment={payment} paymentHref={paymentHref} />}
    </SectionWindow>
  );
}
