"use client";

import { useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  BANK_CONTRACT_STATUS_LABEL,
  BANK_CONTRACT_STATUSES,
  CLAIM_STATUS_LABEL,
  CLAIM_STATUSES,
  CURRENCIES,
  DELIVERY_CONDITION_LABEL,
  DELIVERY_CONDITIONS,
  ORDER_DOCUMENT_KINDS,
  appMakesDocument,
  ORDER_DOCUMENT_LABEL,
  ORDER_DOCUMENT_STATUS_LABEL,
  ORDER_DOCUMENT_STATUSES,
  PAYMENT_ROUTE_LABEL,
  SAT_RESULT_LABEL,
  SAT_RESULTS,
  SHIP_MODE_LABEL,
  SHIP_MODES,
  SHIPMENT_STATUS_LABEL,
  SHIPMENT_STATUSES,
  type BalanceWhen,
  type LcTerms,
  type OrderDocumentKind,
  type PaymentRoute,
  type SatResult,
} from "@kebo/shared";
import { Button, cn, Field, Input, Select, SelectCard, SelectCardList, Textarea } from "@kebo/ui";
import { ConfirmSubmit, SubmitButton } from "@kebo/ui/client";
import { EditButton } from "@/components/common/edit-button";
import { ActionForm } from "@/components/common/action-form";
import { MoneyInput } from "@/components/common/money-input";
import type { ActionState } from "@/lib/actions";
import type { BankContract, BankStepView, ClaimView, DeliveryView, FlowDocument, SatCheckView, ShipmentView } from "@/lib/types-flow";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export const framed = "flex flex-col gap-3 rounded-lg border border-line bg-surface-2/60 p-3";

/** A button that opens a form in place; the form closes itself when saved or cancelled. */
export function Opener({ label, children, variant = "secondary", icon }: { label: ReactNode; children: (close: () => void) => ReactNode; variant?: "primary" | "secondary" | "ghost"; icon?: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (open) return <div className="w-full">{children(() => setOpen(false))}</div>;
  return (
    <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
      {icon ?? <Plus aria-hidden />} {label}
    </Button>
  );
}

function Actions({ save, pending, onCancel }: { save: string; pending: string; onCancel?: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <SubmitButton size="sm" pendingText={pending}>
        {save}
      </SubmitButton>
      {onCancel && (
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- payment route */

const ROUTE_TEXT: Record<PaymentRoute, string> = {
  informal: "Cash in Pakistan, Alipay, WeChat or a personal account. Faster; we hold the documents until the balance is in.",
  bank_contract: "A contract through the banks: our bank sends the documents to the customer's bank, which pays when they arrive.",
  letter_of_credit: "The customer's bank opens an LC; it pays our bank against the shipping documents. Safest, slowest.",
};

/** The route's terms: informal balance before shipment or against the B/L copy; LC at sight or deferred N days. */
export interface RouteTermsValue {
  balanceWhen: BalanceWhen | null;
  lcTerms: LcTerms | null;
  lcDays: number | null;
}

/** Two or three choices side by side (a small segmented control inside a form). */
function Pills<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-fit rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("rounded-md px-3 py-1 text-sm", value === o.value ? "bg-surface font-medium shadow-xs" : "text-text-2 hover:text-text")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * How the customer pays: three cards, one choice (bank routes only when the
 * company has bank contracts), and the route's terms. The route builds the
 * plan: changing it rebuilds the parts not paid yet.
 */
export function RouteForm({
  action,
  route,
  bankRoutes,
  onDone,
  terms,
  suggest,
}: {
  action: Action;
  route: PaymentRoute | null;
  bankRoutes: boolean;
  onDone?: () => void;
  terms?: RouteTermsValue;
  /** Not chosen yet: the route the quote's terms point to, picked for the person to check. */
  suggest?: PaymentRoute | null;
}) {
  const [pick, setPick] = useState<PaymentRoute | null>(route ?? (suggest && (suggest === "informal" || bankRoutes) ? suggest : null));
  const [when, setWhen] = useState<BalanceWhen>(terms?.balanceWhen ?? "before_shipment");
  const [lcTerms, setLcTerms] = useState<LcTerms>(terms?.lcTerms ?? "at_sight");
  const [lcDays, setLcDays] = useState(terms?.lcDays ? String(terms.lcDays) : "90");
  const options = (["informal", "bank_contract", "letter_of_credit"] as const).filter((r) => r === "informal" || bankRoutes);
  const changed =
    pick !== route ||
    route === null ||
    (pick === "informal" && when !== (terms?.balanceWhen ?? "before_shipment")) ||
    (pick === "letter_of_credit" && (lcTerms !== (terms?.lcTerms ?? "at_sight") || (lcTerms === "deferred" && lcDays !== String(terms?.lcDays ?? ""))));
  return (
    <ActionForm action={action} onDone={onDone} keepFields className="flex flex-col gap-3">
      <input type="hidden" name="route" value={pick ?? ""} />
      {pick === "informal" && <input type="hidden" name="balanceWhen" value={when} />}
      {pick === "letter_of_credit" && <input type="hidden" name="lcTerms" value={lcTerms} />}
      {pick === "letter_of_credit" && lcTerms === "deferred" && <input type="hidden" name="lcDays" value={lcDays} />}
      <SelectCardList label="How the customer pays">
        {options.map((r) => (
          <SelectCard key={r} title={PAYMENT_ROUTE_LABEL[r].replace(/ \(.*\)$/, "")} meta={ROUTE_TEXT[r]} selected={pick === r} onSelect={() => setPick(r)} />
        ))}
      </SelectCardList>
      {pick === "informal" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-2">The balance</span>
          <Pills
            label="When the balance is paid"
            value={when}
            onChange={setWhen}
            options={[
              { value: "before_shipment", label: "Before shipment" },
              { value: "against_bl_copy", label: "Against the B/L copy" },
            ]}
          />
        </div>
      )}
      {pick === "letter_of_credit" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-2">The LC pays</span>
          <Pills
            label="LC terms"
            value={lcTerms}
            onChange={setLcTerms}
            options={[
              { value: "at_sight", label: "At sight" },
              { value: "deferred", label: "Deferred" },
            ]}
          />
          {lcTerms === "deferred" && (
            <span className="flex items-center gap-2 text-text-2">
              <Input aria-label="Days after the papers reach their bank" inputMode="numeric" className="w-20 tabular" value={lcDays} onChange={(e) => setLcDays(e.target.value.replace(/\D/g, ""))} />
              days after the papers reach their bank
            </span>
          )}
        </div>
      )}
      {route && <p className="text-xs text-muted">Change it and the plan is rebuilt (payments already recorded stay).</p>}
      <div className="flex flex-wrap gap-2">
        <SubmitButton size="sm" pendingText="Saving…" disabled={!pick || !changed || (pick === "letter_of_credit" && lcTerms === "deferred" && !Number(lcDays))}>
          Save the payment route
        </SubmitButton>
        {onDone && (
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </ActionForm>
  );
}

/** The bank contract or LC: number, banks, amount, dates, status. */
export function BankContractForm({ action, contract, lc, currency, onDone }: { action: Action; contract: BankContract | null; lc: boolean; currency: string; onDone: () => void }) {
  const c = contract;
  const what = lc ? "LC" : "contract";
  return (
    <ActionForm action={action} onDone={onDone} className={framed}>
      {(s) => {
        const v = (k: keyof BankContract, d = "") => s.values?.[k] ?? (c?.[k] === null || c?.[k] === undefined ? d : String(c[k]));
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={lc ? "LC number" : "Contract number"} htmlFor="bc-number" optional error={s.errors?.number}>
                <Input id="bc-number" name="number" maxLength={60} defaultValue={v("number")} />
              </Field>
              <Field label="Status" htmlFor="bc-status" error={s.errors?.status}>
                <Select id="bc-status" name="status" defaultValue={v("status", "draft")}>
                  {BANK_CONTRACT_STATUSES.map((x) => (
                    <option key={x} value={x}>
                      {BANK_CONTRACT_STATUS_LABEL[x]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Amount" htmlFor="bc-amount" optional error={s.errors?.amount}>
                <div className="flex gap-2">
                  <Select name="currency" aria-label="Currency" defaultValue={v("currency", currency)} className="w-24 shrink-0">
                    {CURRENCIES.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </Select>
                  <MoneyInput id="bc-amount" name="amount" currency={v("currency", currency)} defaultValue={v("amount")} />
                </div>
              </Field>
              <Field label="Customer's bank" htmlFor="bc-cbank" optional hint="Where the documents go" error={s.errors?.customerBank}>
                <Input id="bc-cbank" name="customerBank" maxLength={160} defaultValue={v("customerBank")} />
              </Field>
              <Field label="Our bank" htmlFor="bc-obank" optional hint="Where they start" error={s.errors?.ourBank}>
                <Input id="bc-obank" name="ourBank" maxLength={160} defaultValue={v("ourBank")} />
              </Field>
              <Field label="Opened on" htmlFor="bc-opened" optional error={s.errors?.openedOn}>
                <Input id="bc-opened" name="openedOn" type="date" defaultValue={v("openedOn")} />
              </Field>
              <Field label="Ship by (latest)" htmlFor="bc-ship" optional error={s.errors?.latestShipOn}>
                <Input id="bc-ship" name="latestShipOn" type="date" defaultValue={v("latestShipOn")} />
              </Field>
              <Field label={`${lc ? "LC" : "Contract"} expires`} htmlFor="bc-expires" optional error={s.errors?.expiresOn}>
                <Input id="bc-expires" name="expiresOn" type="date" defaultValue={v("expiresOn")} />
              </Field>
            </div>
            <Field label="Note" htmlFor="bc-note" optional error={s.errors?.note}>
              <Textarea id="bc-note" name="note" rows={2} className="min-h-0" defaultValue={v("note")} />
            </Field>
            <Actions save={`Save the ${what}`} pending="Saving…" onCancel={onDone} />
          </>
        );
      }}
    </ActionForm>
  );
}

/** One date: a single field with its button (factory ordered on). */
export function DateForm({ action, name, label, value, max, save, onDone, hint }: { action: Action; name: string; label: string; value: string | null; max?: string; save: string; onDone?: () => void; hint?: string }) {
  return (
    <ActionForm action={action} onDone={onDone} className="flex flex-wrap items-end gap-2">
      {(s) => (
        <>
          <Field label={label} htmlFor={`d-${name}`} hint={hint} error={s.errors?.[name]}>
            <Input id={`d-${name}`} name={name} type="date" max={max} defaultValue={s.values?.[name] ?? value ?? max ?? ""} className="w-44" />
          </Field>
          <Actions save={save} pending="Saving…" onCancel={onDone} />
        </>
      )}
    </ActionForm>
  );
}

let seq = 0;
const nextKey = () => `n${++seq}`;

/* ---------------------------------------------------------------- shipments */

/** Add or change a shipment: how, where from and to, who carries it, the numbers and the dates. */
export function ShipmentForm({ action, shipment, defaults, today, onDone }: { action: Action; shipment?: ShipmentView; defaults?: Partial<ShipmentView>; today: string; onDone: () => void }) {
  const base = { ...defaults, ...shipment };
  const [mode, setMode] = useState(base.mode ?? "sea");
  const air = mode === "air";
  return (
    <ActionForm action={action} onDone={onDone} className={framed}>
      {(s) => {
        const v = (k: keyof ShipmentView) => s.values?.[k] ?? (base[k] === null || base[k] === undefined ? "" : String(base[k]));
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Way" htmlFor="sh-mode" error={s.errors?.mode}>
                <Select id="sh-mode" name="mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                  {SHIP_MODES.map((m) => (
                    <option key={m} value={m}>
                      {SHIP_MODE_LABEL[m]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Status" htmlFor="sh-status" error={s.errors?.status}>
                <Select id="sh-status" name="status" defaultValue={v("status") || "planned"}>
                  {SHIPMENT_STATUSES.map((m) => (
                    <option key={m} value={m}>
                      {SHIPMENT_STATUS_LABEL[m]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Forwarder" htmlFor="sh-fwd" optional error={s.errors?.forwarder}>
                <Input id="sh-fwd" name="forwarder" maxLength={120} defaultValue={v("forwarder")} />
              </Field>
              <Field label={air ? "From (airport)" : "From (port)"} htmlFor="sh-pol" optional error={s.errors?.portOfLoading}>
                <Input id="sh-pol" name="portOfLoading" maxLength={120} defaultValue={v("portOfLoading")} placeholder={air ? "e.g. Shanghai PVG" : "e.g. Ningbo"} />
              </Field>
              <Field label={air ? "To (airport)" : "To (port)"} htmlFor="sh-pod" optional error={s.errors?.portOfDischarge}>
                <Input id="sh-pod" name="portOfDischarge" maxLength={120} defaultValue={v("portOfDischarge")} placeholder={air ? "e.g. Lahore LHE" : "e.g. Karachi"} />
              </Field>
              <Field label="Booking no." htmlFor="sh-booking" optional error={s.errors?.bookingNo}>
                <Input id="sh-booking" name="bookingNo" maxLength={60} defaultValue={v("bookingNo")} />
              </Field>
              {!air && (
                <>
                  <Field label="Container" htmlFor="sh-ctype" optional hint="20GP, 40HQ, LCL…" error={s.errors?.containerType}>
                    <Input id="sh-ctype" name="containerType" maxLength={20} defaultValue={v("containerType")} />
                  </Field>
                  <Field label="Container no." htmlFor="sh-cno" optional error={s.errors?.containerNo}>
                    <Input id="sh-cno" name="containerNo" maxLength={120} defaultValue={v("containerNo")} />
                  </Field>
                  <Field label="Vessel" htmlFor="sh-vessel" optional error={s.errors?.vessel}>
                    <Input id="sh-vessel" name="vessel" maxLength={120} defaultValue={v("vessel")} />
                  </Field>
                </>
              )}
              <Field label={air ? "Air waybill (AWB)" : "Bill of lading (B/L)"} htmlFor="sh-bl" optional error={s.errors?.blNo}>
                <Input id="sh-bl" name="blNo" maxLength={60} defaultValue={v("blNo")} />
              </Field>
              <Field label="Leaves (ETD)" htmlFor="sh-etd" optional error={s.errors?.etd}>
                <Input id="sh-etd" name="etd" type="date" defaultValue={v("etd")} />
              </Field>
              <Field label="Arrives (ETA)" htmlFor="sh-eta" optional error={s.errors?.eta}>
                <Input id="sh-eta" name="eta" type="date" defaultValue={v("eta")} />
              </Field>
              <Field label="Left on" htmlFor="sh-dep" optional error={s.errors?.departedOn}>
                <Input id="sh-dep" name="departedOn" type="date" max={today} defaultValue={v("departedOn")} />
              </Field>
              <Field label="Arrived on" htmlFor="sh-arr" optional error={s.errors?.arrivedOn}>
                <Input id="sh-arr" name="arrivedOn" type="date" max={today} defaultValue={v("arrivedOn")} />
              </Field>
            </div>
            <Field label="Note" htmlFor="sh-note" optional error={s.errors?.note}>
              <Textarea id="sh-note" name="note" rows={2} className="min-h-0" defaultValue={v("note")} />
            </Field>
            <Actions save={shipment ? "Save the shipment" : "Add the shipment"} pending="Saving…" onCancel={onDone} />
          </>
        );
      }}
    </ActionForm>
  );
}

/** Remove with a confirmation. */
export function RemoveButton({ action, what }: { action: Action; what: string }) {
  return (
    <ActionForm action={action} showSuccess={false} className="inline-flex">
      <ConfirmSubmit size="xs" variant="danger-ghost" pendingText="Removing…" message={`Remove ${what}?`}>
        <Trash2 aria-hidden /> Remove
      </ConfirmSubmit>
    </ActionForm>
  );
}

/* ---------------------------------------------------------------- the document set */

/** Record a paper (or change one): its status, number, date, and a file from the deal's files. */
export function DocumentForm({
  action,
  doc,
  kind,
  files,
  shipments,
  onDone,
}: {
  action: Action;
  doc?: FlowDocument;
  /** For a new paper the shipment needs: its kind is fixed. */
  kind?: OrderDocumentKind;
  files: { id: string; name: string }[];
  shipments: { id: string; label: string }[];
  onDone: () => void;
}) {
  const [k, setK] = useState<OrderDocumentKind>(doc?.kind ?? kind ?? "other");
  const fixed = !!doc || !!kind;
  return (
    <ActionForm action={action} onDone={onDone} className={framed}>
      {(s) => {
        const v = (key: keyof FlowDocument, d = "") => s.values?.[key] ?? (doc?.[key] === null || doc?.[key] === undefined ? d : String(doc[key]));
        return (
          <>
            {!doc && <input type="hidden" name="kind" value={k} />}
            <div className="grid gap-3 sm:grid-cols-3">
              {!fixed && (
                <Field label="Document" htmlFor="doc-kind" error={s.errors?.kind}>
                  <Select id="doc-kind" value={k} onChange={(e) => setK(e.target.value as OrderDocumentKind)}>
                    {/* The papers the app makes (proforma, packing list, sales contract, commercial invoice) are never recorded by hand. */}
                    {ORDER_DOCUMENT_KINDS.filter((x) => !appMakesDocument(x)).map((x) => (
                      <option key={x} value={x}>
                        {ORDER_DOCUMENT_LABEL[x]}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {k === "other" && (
                <Field label="What it is" htmlFor="doc-title" error={s.errors?.title}>
                  <Input id="doc-title" name="title" maxLength={120} defaultValue={s.values?.title ?? (doc?.kind === "other" ? doc.label : "")} placeholder="e.g. Fumigation certificate" />
                </Field>
              )}
              <Field label="Status" htmlFor="doc-status" error={s.errors?.status}>
                <Select id="doc-status" name="status" defaultValue={v("status", "ready")}>
                  {ORDER_DOCUMENT_STATUSES.map((x) => (
                    <option key={x} value={x}>
                      {ORDER_DOCUMENT_STATUS_LABEL[x]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Number" htmlFor="doc-number" optional error={s.errors?.number}>
                <Input id="doc-number" name="number" maxLength={60} defaultValue={v("number")} />
              </Field>
              <Field label="Issued on" htmlFor="doc-issued" optional error={s.errors?.issuedOn}>
                <Input id="doc-issued" name="issuedOn" type="date" defaultValue={v("issuedOn")} />
              </Field>
              <Field label="File" htmlFor="doc-file" optional hint={files.length ? "One of the deal's files" : "Upload it to the deal's files first"} error={s.errors?.attachmentId}>
                <Select id="doc-file" name="attachmentId" defaultValue={s.values?.attachmentId ?? doc?.file?.id ?? ""}>
                  <option value="">No file</option>
                  {files.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {shipments.length > 1 && (
                <Field label="Shipment" htmlFor="doc-ship" optional error={s.errors?.shipmentId}>
                  <Select id="doc-ship" name="shipmentId" defaultValue={v("shipmentId")}>
                    <option value="">All shipments</option>
                    {shipments.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            <Field label="Note" htmlFor="doc-note" optional error={s.errors?.note}>
              <Input id="doc-note" name="note" maxLength={500} defaultValue={v("note")} placeholder="e.g. original + 3 copies" />
            </Field>
            <Actions save={doc ? "Save" : "Record it"} pending="Saving…" onCancel={onDone} />
          </>
        );
      }}
    </ActionForm>
  );
}

/** Mark one step of the bank chain done: date, and for the courier the company and tracking number. */
export function BankStepForm({ action, step, today, onDone }: { action: Action; step: BankStepView; today: string; onDone: () => void }) {
  const courier = step.step === "couriered_to_customer_bank";
  return (
    <ActionForm action={action} onDone={onDone} className={cn(framed, "mt-2")}>
      {(s) => (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="On" htmlFor={`bs-${step.step}-on`} error={s.errors?.doneOn}>
              <Input id={`bs-${step.step}-on`} name="doneOn" type="date" max={today} defaultValue={s.values?.doneOn ?? step.doneOn ?? today} />
            </Field>
            {courier && (
              <Field label="Courier" htmlFor={`bs-${step.step}-courier`} optional error={s.errors?.courier}>
                <Input id={`bs-${step.step}-courier`} name="courier" maxLength={60} defaultValue={s.values?.courier ?? step.courier ?? "DHL"} />
              </Field>
            )}
            <Field label={courier ? "Tracking no." : "Reference"} htmlFor={`bs-${step.step}-ref`} optional error={s.errors?.reference}>
              <Input id={`bs-${step.step}-ref`} name="reference" maxLength={120} defaultValue={s.values?.reference ?? step.reference ?? ""} />
            </Field>
          </div>
          <Actions save="Mark done" pending="Saving…" onCancel={onDone} />
        </>
      )}
    </ActionForm>
  );
}

/* ---------------------------------------------------------------- delivery and SAT */

/** Delivery date and condition, and the SAT plan: engineer and date. Signing off is its own button. */
export function DeliveryForm({ action, d, people, today, onDone }: { action: Action; d: DeliveryView; people: { id: string; name: string }[]; today: string; onDone: () => void }) {
  return (
    <ActionForm action={action} onDone={onDone} className={framed}>
      {(s) => (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Delivered on" htmlFor="dv-on" optional error={s.errors?.deliveredOn}>
              <Input id="dv-on" name="deliveredOn" type="date" max={today} defaultValue={s.values?.deliveredOn ?? d.deliveredOn ?? ""} />
            </Field>
            <Field label="Condition" htmlFor="dv-cond" optional error={s.errors?.deliveryCondition}>
              <Select id="dv-cond" name="deliveryCondition" defaultValue={s.values?.deliveryCondition ?? d.condition ?? ""}>
                <option value="">Not checked</option>
                {DELIVERY_CONDITIONS.map((x) => (
                  <option key={x} value={x}>
                    {DELIVERY_CONDITION_LABEL[x]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Our engineer" htmlFor="dv-eng" optional error={s.errors?.satEngineerId}>
              <Select id="dv-eng" name="satEngineerId" defaultValue={s.values?.satEngineerId ?? d.satEngineer?.id ?? ""}>
                <option value="">—</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="SAT planned on" htmlFor="dv-sat" optional error={s.errors?.satPlannedOn}>
              <Input id="dv-sat" name="satPlannedOn" type="date" defaultValue={s.values?.satPlannedOn ?? d.satPlannedOn ?? ""} />
            </Field>
          </div>
          <Field label="Note on the delivery" htmlFor="dv-note" optional error={s.errors?.deliveryNote}>
            <Textarea id="dv-note" name="deliveryNote" rows={2} className="min-h-0" defaultValue={s.values?.deliveryNote ?? d.note ?? ""} placeholder="e.g. all cases dry and intact, 12 photos in the deal's files" />
          </Field>
          <Actions save="Save" pending="Saving…" onCancel={onDone} />
        </>
      )}
    </ActionForm>
  );
}

/** Sign the SAT off: the date and who signed for the customer. */
export function SatSignOffForm({ action, today, onDone }: { action: Action; today: string; onDone: () => void }) {
  return (
    <ActionForm action={action} onDone={onDone} className={framed}>
      {(s) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="SAT passed on" htmlFor="so-on" error={s.errors?.satDoneOn}>
              <Input id="so-on" name="satDoneOn" type="date" max={today} defaultValue={s.values?.satDoneOn ?? today} />
            </Field>
            <Field label="Signed for the customer by" htmlFor="so-by" optional error={s.errors?.satSignedBy}>
              <Input id="so-by" name="satSignedBy" maxLength={120} defaultValue={s.values?.satSignedBy ?? ""} placeholder="e.g. Mr. Imran, QA head" />
            </Field>
          </div>
          <Actions save="Sign off the SAT" pending="Saving…" onCancel={onDone} />
        </>
      )}
    </ActionForm>
  );
}

interface CheckRow {
  key: string;
  id: string | null;
  item: string;
  result: SatResult;
  note: string;
}

const RESULT_STYLE: Record<SatResult, string> = {
  pending: "border-line bg-surface text-text-2",
  pass: "border-ok bg-ok-soft text-ok",
  fail: "border-bad bg-bad-soft text-bad",
  not_applicable: "border-line bg-surface-3 text-text-2",
};

/** The SAT checklist: each point with Pass / Fail / N/A buttons and a note; saved together. */
export function SatEditor({ action, checks, suggested, locked }: { action: Action; checks: SatCheckView[]; suggested: string[]; locked: boolean }) {
  const [rows, setRows] = useState<CheckRow[]>(() =>
    checks.length ? checks.map((c) => ({ key: c.id, id: c.id, item: c.item, result: c.result, note: c.note ?? "" })) : suggested.map((t) => ({ key: nextKey(), id: null, item: t, result: "pending" as SatResult, note: "" })),
  );
  const [dirty, setDirty] = useState(!checks.length && suggested.length > 0);
  const set = (i: number, patch: Partial<CheckRow>) => {
    setDirty(true);
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  };
  const payload = JSON.stringify({ checks: rows.filter((r) => r.item.trim()).map((r) => ({ id: r.id, item: r.item, result: r.result, note: r.note || null })) });
  if (locked)
    return (
      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-sm">{r.item}</span>
              {r.note && <span className="block text-xs text-muted">{r.note}</span>}
            </span>
            <span className={cn("rounded-md border px-2 py-0.5 text-xs font-medium", RESULT_STYLE[r.result])}>{SAT_RESULT_LABEL[r.result]}</span>
          </li>
        ))}
      </ul>
    );
  return (
    <ActionForm action={action} keepFields onDone={() => setDirty(false)} className="flex flex-col gap-2">
      <input type="hidden" name="payload" value={payload} />
      {!checks.length && suggested.length > 0 && <p className="text-xs text-muted">A usual SAT list to start from. Change the points to match the customer&apos;s URS, then save.</p>}
      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
        {rows.map((r, i) => (
          <li key={r.key} className="grid gap-2 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="flex min-w-0 flex-col gap-1">
              <Input aria-label={`Point ${i + 1}`} value={r.item} disabled={locked} maxLength={200} onChange={(e) => set(i, { item: e.target.value })} className="h-8" />
              <Input aria-label={`Note on point ${i + 1}`} value={r.note} disabled={locked} maxLength={500} onChange={(e) => set(i, { note: e.target.value })} placeholder="Note" className="h-8 text-xs" />
            </div>
            <div role="radiogroup" aria-label={`Result of point ${i + 1}`} className="flex flex-wrap items-center gap-1">
              {SAT_RESULTS.map((x) => (
                <button
                  key={x}
                  type="button"
                  role="radio"
                  aria-checked={r.result === x}
                  disabled={locked}
                  onClick={() => set(i, { result: x })}
                  className={cn("h-7 rounded-md border px-2 text-xs font-medium", r.result === x ? RESULT_STYLE[x] : "border-line bg-surface text-muted hover:border-line-strong")}
                >
                  {SAT_RESULT_LABEL[x]}
                </button>
              ))}
              {!locked && (
                <Button type="button" size="icon-xs" variant="danger-ghost" aria-label={`Remove point ${i + 1}`} onClick={() => (setDirty(true), setRows((x) => x.filter((_, j) => j !== i)))}>
                  <Trash2 aria-hidden />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!locked && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => (setDirty(true), setRows((r) => [...r, { key: nextKey(), id: null, item: "", result: "pending", note: "" }]))}>
            <Plus aria-hidden /> Add a point
          </Button>
          <SubmitButton size="sm" pendingText="Saving…" disabled={!dirty}>
            Save the checklist
          </SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}

/* ---------------------------------------------------------------- claims */

export function ClaimForm({ action, today, onDone }: { action: Action; today: string; onDone: () => void }) {
  return (
    <ActionForm action={action} onDone={onDone} className={framed}>
      {(s) => (
        <>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <Field label="What is wrong" htmlFor="cl-title" error={s.errors?.title}>
              <Input id="cl-title" name="title" maxLength={160} defaultValue={s.values?.title ?? ""} placeholder="e.g. Dented guard door" />
            </Field>
            <Field label="Reported on" htmlFor="cl-on" error={s.errors?.openedOn}>
              <Input id="cl-on" name="openedOn" type="date" max={today} defaultValue={s.values?.openedOn ?? today} />
            </Field>
          </div>
          <Field label="Details" htmlFor="cl-detail" optional error={s.errors?.detail}>
            <Textarea id="cl-detail" name="detail" rows={2} className="min-h-0" defaultValue={s.values?.detail ?? ""} />
          </Field>
          <Actions save="Open the claim" pending="Saving…" onCancel={onDone} />
        </>
      )}
    </ActionForm>
  );
}

export function ClaimUpdateForm({ action, claim, onDone }: { action: Action; claim: ClaimView; onDone: () => void }) {
  const [status, setStatus] = useState(claim.status);
  const closing = status === "resolved" || status === "rejected";
  return (
    <ActionForm action={action} onDone={onDone} className={cn(framed, "mt-2")}>
      {(s) => (
        <>
          <Field label="Status" htmlFor={`cs-${claim.id}`} error={s.errors?.status}>
            <Select id={`cs-${claim.id}`} name="status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="sm:w-56">
              {CLAIM_STATUSES.map((x) => (
                <option key={x} value={x}>
                  {CLAIM_STATUS_LABEL[x]}
                </option>
              ))}
            </Select>
          </Field>
          {closing && (
            <Field label="How it was settled" htmlFor={`cr-${claim.id}`} error={s.errors?.resolution}>
              <Textarea id={`cr-${claim.id}`} name="resolution" rows={2} className="min-h-0" defaultValue={s.values?.resolution ?? claim.resolution ?? ""} placeholder="e.g. Factory sent a new door by air; fitted on site." />
            </Field>
          )}
          <Actions save="Save" pending="Saving…" onCancel={onDone} />
        </>
      )}
    </ActionForm>
  );
}

/** An edit button that swaps a block for its form. */
export function EditSwap({ view, form, label = "Edit", allowed }: { view: ReactNode; form: (close: () => void) => ReactNode; label?: string; allowed: boolean }) {
  const [open, setOpen] = useState(false);
  if (open) return <>{form(() => setOpen(false))}</>;
  return (
    <div className="flex flex-col gap-2">
      {view}
      {allowed && (
        <div>
          <EditButton label={label} onClick={() => setOpen(true)} />
        </div>
      )}
    </div>
  );
}
