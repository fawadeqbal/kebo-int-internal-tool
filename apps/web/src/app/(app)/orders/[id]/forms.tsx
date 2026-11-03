"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Plus } from "lucide-react";
import { PAYMENT_KIND_LABEL, PAYMENT_KINDS, PAYMENT_METHOD_LABEL, PAYMENT_METHODS, type PaymentKind } from "@kebo/shared";
import { Alert, Button, Card, CardBody, CardHeader, cn, DetailList, Field, Input, Select, Textarea } from "@kebo/ui";
import { ConfirmSubmit, SubmitButton } from "@kebo/ui/client";
import { EditButton } from "@/components/common/edit-button";
import { ActionForm } from "@/components/common/action-form";
import { MoneyInput } from "@/components/common/money-input";
import type { ActionState } from "@/lib/actions";
import type { OrderNext } from "@/lib/types-orders";
import { AccountSelect } from "@/components/money/accounts";
import { FilePicker, useSaveThenSend } from "@/components/money/attachment";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const framed = "flex flex-col gap-3 rounded-lg border border-line bg-surface-2/60 p-3";

/* ---------------------------------------------------------------- the one button */

/**
 * The order's one button (and the small "Back to …" link). Moving to In
 * production asks for the ready date if known, to Shipped for the ship date and
 * B/L; to Done nothing. When the API warns (no deposit, money still due) the
 * warning shows with "Go ahead anyway", which sends the same move with confirm.
 */
export function StageActions({
  next,
  back,
  action,
  today,
  readyOn,
  shippedOn,
  blNo,
}: {
  next: OrderNext | null;
  back: { to: string; label: string } | null;
  action: Action;
  today: string;
  readyOn: string | null;
  /** Kept when shipping again after a move back. */
  shippedOn: string | null;
  blNo: string | null;
}) {
  const [open, setOpen] = useState(false);
  // A new key remounts the form, which clears a warning that was not taken up.
  const [round, setRound] = useState(0);
  const close = () => {
    setOpen(false);
    setRound((r) => r + 1);
  };
  const asks = next?.to === "in_production" || next?.to === "shipped";
  const backLink = back && (
    <ActionForm action={action} showSuccess={false} className="inline-flex flex-col items-start">
      <input type="hidden" name="to" value={back.to} />
      <ConfirmSubmit variant="ghost" size="sm" pendingText="Moving…" message={`${back.label}? Use this only if the order was moved by mistake.`} className="text-muted">
        <ArrowLeft aria-hidden /> {back.label}
      </ConfirmSubmit>
    </ActionForm>
  );
  if (!next) return backLink ? <div className="flex flex-wrap items-center gap-2">{backLink}</div> : null;
  if (asks && !open)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => setOpen(true)}>
          {next.label} <ArrowRight aria-hidden />
        </Button>
        {backLink}
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      <ActionForm key={round} action={action} quietCodes={["confirm"]} onDone={close} className={asks ? framed : "flex flex-col gap-3"}>
        {(s) => {
          const warn = s.code === "confirm";
          return (
            <>
              <input type="hidden" name="to" value={next.to} />
              {asks && <p className="text-sm font-medium">{next.label}</p>}
              {next.to === "in_production" && (
                <Field label="When will the goods be ready?" htmlFor="move-readyOn" optional hint="The factory's expected ready date, if you know it" error={s.errors?.readyOn}>
                  <Input id="move-readyOn" name="readyOn" type="date" className="w-44" defaultValue={s.values?.readyOn ?? readyOn ?? ""} />
                </Field>
              )}
              {next.to === "shipped" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Shipped on" htmlFor="move-shippedOn" error={s.errors?.shippedOn}>
                    <Input id="move-shippedOn" name="shippedOn" type="date" max={today} defaultValue={s.values?.shippedOn ?? shippedOn ?? today} />
                  </Field>
                  <Field label="B/L number" htmlFor="move-blNo" optional hint="Bill of lading, if you have it" error={s.errors?.blNo}>
                    <Input id="move-blNo" name="blNo" maxLength={60} defaultValue={s.values?.blNo ?? blNo ?? ""} />
                  </Field>
                </div>
              )}
              {warn && (
                <div role="alert" className="flex flex-col gap-2 rounded-lg border border-warn/30 bg-warn-soft p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                    <div>
                      <span className="block font-medium">Check before you go ahead</span>
                      <Warnings text={s.message ?? ""} />
                    </div>
                  </div>
                  <input type="hidden" name="confirm" value="true" />
                  <Field label="Note" htmlFor="move-note" optional hint="Why you are going ahead; it is kept in the order's history" error={s.errors?.note}>
                    <Textarea id="move-note" name="note" rows={2} className="min-h-0" defaultValue={s.values?.note} />
                  </Field>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <SubmitButton pendingText="Moving…">
                  {warn ? "Go ahead anyway" : next.label}
                  {!warn && <ArrowRight aria-hidden />}
                </SubmitButton>
                {(asks || warn) && (
                  <Button type="button" variant="ghost" onClick={close}>
                    Cancel
                  </Button>
                )}
              </div>
            </>
          );
        }}
      </ActionForm>
      {backLink && <div>{backLink}</div>}
    </div>
  );
}

/** The API sends its warnings as sentences in one message; more than one reads better as a list. */
function Warnings({ text }: { text: string }) {
  const parts = text.split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean);
  if (parts.length < 2) return <>{text}</>;
  return (
    <ul className="mt-0.5 list-disc pl-4">
      {parts.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- details */

/**
 * The order's Details card (the overview's right column): terms, dates and
 * shipping in two columns, values wrapping; ✎ Edit in the header opens the
 * form in place; an empty value offers "+ Add" to people who may edit.
 * Shipped on, the B/L and the container are Shipment 1's: with the shipping
 * module they are shown read-only, "from Shipment 1 · edit in Shipping" (a link
 * that lands on the shipment lit up); without it they are typed here (and saved
 * on the shipment). With an LC, ship-by shows the LC's latest shipment date
 * beside ours, warned about when ours is later.
 */
export function DetailsCard({
  action,
  canEdit,
  today,
  fixed,
  values,
  shown,
  shipment,
  lc,
  suggestShipBy,
}: {
  action: Action;
  canEdit: boolean;
  today: string;
  /** Read-only rows (incoterm, payment terms, ordered on). */
  fixed: { label: string; value: ReactNode }[];
  values: {
    shipBy: string | null;
    readyOn: string | null;
    shippedOn: string | null;
    blNo: string | null;
    containerNo: string | null;
    documentTitle: string | null;
    portOfDischarge: string | null;
  };
  /** The same values, formatted for reading. */
  shown: { shipBy: string | null; readyOn: string | null; shippedOn: string | null; blNo: string | null };
  /** Where shipped on / B/L / container are edited: on Shipping (read-only here, `href` lands there), or here (no shipping module). */
  shipment: { onShipping: boolean; href: string; label: string };
  /** An LC order: its latest shipment date (as read) and whether our ship-by is later. */
  lc?: { latest: string | null; late: boolean } | null;
  /** While ship-by is empty: the deal's "wanted by" (YYYY-MM-DD and as read). */
  suggestShipBy?: { on: string; shown: string } | null;
}) {
  const [editing, setEditing] = useState(false);
  const fromShipment = (filled: boolean) =>
    shipment.onShipping ? (
      <a href={shipment.href} className="text-xs font-normal text-primary hover:underline">
        {filled ? `from ${shipment.label} · edit in Shipping` : "add it in Shipping"}
      </a>
    ) : null;
  const shipBy =
    shown.shipBy && lc?.latest ? (
      <span className="flex flex-col gap-0.5">
        <span>
          {shown.shipBy} <span className="font-normal text-text-2">· LC latest {lc.latest}</span>
        </span>
        {lc.late && (
          <span className="flex items-center gap-1 text-xs font-medium text-bad">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden /> Later than the LC allows
          </span>
        )}
      </span>
    ) : !shown.shipBy && lc?.latest ? (
      <span className="font-normal text-text-2">LC latest {lc.latest}</span>
    ) : (
      shown.shipBy
    );
  const rows: { label: string; value: ReactNode; note?: ReactNode }[] = [
    ...fixed,
    { label: "Ship by", value: shipBy },
    { label: "Ready at factory", value: shown.readyOn },
    { label: "Shipped on", value: shown.shippedOn, note: fromShipment(!!shown.shippedOn) },
    { label: "B/L no.", value: shown.blNo, note: fromShipment(!!shown.blNo) },
    { label: "Container", value: values.containerNo, note: fromShipment(!!values.containerNo) },
    { label: "Port of discharge", value: values.portOfDischarge },
    { label: "Heading on documents", value: values.documentTitle },
  ];
  const filled = rows.filter((r) => r.value !== null && r.value !== undefined && r.value !== "").length;
  return (
    <Card id="details" className="scroll-mt-24">
      <CardHeader
        title="Details"
        description={`terms, dates and shipping · ${filled} of ${rows.length} filled`}
        actions={canEdit && !editing ? <EditButton onClick={() => setEditing(true)} /> : undefined}
      />
      <CardBody>
        {!editing ? (
          <dl className="grid grid-cols-2 gap-x-5 gap-y-3.5">
            {rows.map((r) => (
              <div key={r.label} className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-xs text-text-2">{r.label}</dt>
                <dd className="text-sm font-medium [overflow-wrap:anywhere]">
                  {r.value !== null && r.value !== undefined && r.value !== "" ? (
                    r.value
                  ) : r.note ? (
                    <span className="font-normal text-muted">—</span>
                  ) : canEdit ? (
                    <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setEditing(true)}>
                      + Add
                    </button>
                  ) : (
                    <span className="font-normal text-muted">—</span>
                  )}
                </dd>
                {r.note && <dd>{r.note}</dd>}
              </div>
            ))}
          </dl>
        ) : (
          <ActionForm action={action} onDone={() => setEditing(false)} className="flex flex-col gap-3">
            {(s) => (
              <>
                <DetailList columns={2} items={fixed} />
                <Field
                  label="Ship by"
                  htmlFor="d-shipBy"
                  optional
                  hint={
                    lc?.latest
                      ? `Promised to the customer · the LC's latest shipment is ${lc.latest}`
                      : !values.shipBy && suggestShipBy
                        ? `Promised to the customer · suggested: the customer wanted it by ${suggestShipBy.shown}`
                        : "Promised to the customer"
                  }
                  error={s.errors?.shipBy}
                >
                  <Input id="d-shipBy" name="shipBy" type="date" defaultValue={s.values?.shipBy ?? values.shipBy ?? suggestShipBy?.on ?? ""} />
                </Field>
                <Field label="Ready on" htmlFor="d-readyOn" optional hint="When the factory expects the goods ready" error={s.errors?.readyOn}>
                  <Input id="d-readyOn" name="readyOn" type="date" defaultValue={s.values?.readyOn ?? values.readyOn ?? ""} />
                </Field>
                {shipment.onShipping ? (
                  <p className="rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-xs text-text-2">
                    Shipped on, the B/L and the container are {shipment.label}&apos;s:{" "}
                    <a href={shipment.href} className="font-medium text-primary hover:underline">
                      edit them in Shipping
                    </a>
                    .
                  </p>
                ) : (
                  <>
                    <Field label="Shipped on" htmlFor="d-shippedOn" optional error={s.errors?.shippedOn}>
                      <Input id="d-shippedOn" name="shippedOn" type="date" max={today} defaultValue={s.values?.shippedOn ?? values.shippedOn ?? ""} />
                    </Field>
                    <Field label="B/L number" htmlFor="d-blNo" optional error={s.errors?.blNo}>
                      <Input id="d-blNo" name="blNo" maxLength={60} defaultValue={s.values?.blNo ?? values.blNo ?? ""} />
                    </Field>
                    <Field label="Container no." htmlFor="d-containerNo" optional error={s.errors?.containerNo}>
                      <Input id="d-containerNo" name="containerNo" maxLength={120} defaultValue={s.values?.containerNo ?? values.containerNo ?? ""} />
                    </Field>
                  </>
                )}
                <Field label="Port of discharge" htmlFor="d-pod" optional hint="The contract destination: printed on the proforma, the default for a new shipment" error={s.errors?.portOfDischarge}>
                  <Input id="d-pod" name="portOfDischarge" maxLength={120} defaultValue={s.values?.portOfDischarge ?? values.portOfDischarge ?? ""} />
                </Field>
                <Field label="Heading on documents" htmlFor="d-title" optional hint="Over the items, e.g. Complete automatic liquid syrup filling line" error={s.errors?.documentTitle}>
                  <Input id="d-title" name="documentTitle" maxLength={200} defaultValue={s.values?.documentTitle ?? values.documentTitle ?? ""} />
                </Field>
                <div className="flex gap-2">
                  <SubmitButton size="sm" pendingText="Saving…">
                    Save details
                  </SubmitButton>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </ActionForm>
        )}
      </CardBody>
    </Card>
  );
}

/* ---------------------------------------------------------------- payments */

/** "Record a payment" (managers): suggests the deposit still missing, else what is still due. */
export function PaymentForm({
  action,
  currency,
  depositDue,
  due,
  today,
  label = "Record a payment",
  quiet,
}: {
  action: Action;
  currency: string;
  depositDue: string;
  due: string;
  today: string;
  /** The button's words, and a plain (not violet) button. */
  label?: string;
  quiet?: boolean;
}) {
  const first: PaymentKind = Number(depositDue) > 0 ? "deposit" : "balance";
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<PaymentKind>(first);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  // The slip goes with the save itself, so it is kept even when the page re-draws without this form.
  const save = useSaveThenSend(action, file, (id) => `/files/payments/${id}`, "The payment is recorded", setFileError);
  const done = () => {
    setFile(null);
    setOpen(false);
  };
  if (Number(due) <= 0) return <p className="text-sm text-muted">Paid in full: nothing more to record.</p>;
  if (!open)
    return (
      <div className="flex flex-col gap-2">
        {fileError && <Alert tone="error">{fileError}</Alert>}
        <Button
          className="w-fit"
          variant={quiet ? "secondary" : "primary"}
          size="sm"
          onClick={() => {
            setKind(first);
            setFileError(null);
            setOpen(true);
          }}
        >
          {quiet && <Plus aria-hidden />} {label}
        </Button>
      </div>
    );
  const amount = kind === "deposit" && Number(depositDue) > 0 ? depositDue : kind === "other" ? "" : due;
  return (
    <ActionForm action={save} onDone={done} className={framed}>
      {(s) => (
        <>
          <p className="text-sm font-medium">Payment from the customer</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="What for" htmlFor="p-kind" error={s.errors?.kind}>
              <Select id="p-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as PaymentKind)}>
                {PAYMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {PAYMENT_KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount received" htmlFor="p-amount" hint={`What reached our bank, in ${currency} (the order's currency)`} error={s.errors?.amount}>
              <MoneyInput key={kind} id="p-amount" name="amount" currency={currency} defaultValue={s.values?.amount ?? amount} />
            </Field>
            <Field label="Bank charges" htmlFor="p-charges" optional hint="Deducted by the banks; counts as paid" error={s.errors?.bankCharges}>
              <MoneyInput id="p-charges" name="bankCharges" currency={currency} placeholder="0.00" defaultValue={s.values?.bankCharges ?? ""} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Paid on" htmlFor="p-paidOn" error={s.errors?.paidOn}>
              <Input id="p-paidOn" name="paidOn" type="date" max={today} defaultValue={s.values?.paidOn ?? today} />
            </Field>
            <Field label="Method" htmlFor="p-method" error={s.errors?.method}>
              <Select id="p-method" name="method" defaultValue={s.values?.method ?? "bank_transfer"}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Bank reference" htmlFor="p-reference" optional hint="e.g. the T/T or SWIFT reference" error={s.errors?.reference}>
              <Input id="p-reference" name="reference" maxLength={120} defaultValue={s.values?.reference ?? ""} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <AccountSelect id="p-account" label="Into account" currency={currency} defaultValue={s.values?.accountId} error={s.errors?.accountId} />
            <FilePicker id="p-file" label="Proof of payment" hint="Bank slip or transfer screenshot (photo or PDF)" file={file} onChange={setFile} className="sm:col-span-2" />
          </div>
          <Field label="Note" htmlFor="p-note" optional error={s.errors?.note}>
            <Textarea id="p-note" name="note" rows={2} className="min-h-0" defaultValue={s.values?.note} />
          </Field>
          <div className="flex gap-2">
            <SubmitButton size="sm" pendingText={file ? "Recording, sending the file…" : "Recording…"}>
              Record the payment
            </SubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Remove a payment recorded by mistake (managers), with a reason. */
export function VoidPayment({ action }: { action: Action }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button size="xs" variant="danger-ghost" onClick={() => setOpen(true)}>
        Remove
      </Button>
    );
  return (
    <ActionForm action={action} onDone={() => setOpen(false)} className={`${framed} mt-2 w-full`}>
      {(s) => (
        <>
          <Field label="Why remove it?" htmlFor="void-reason" error={s.errors?.reason} hint="It stays listed, crossed out">
            <Textarea id="void-reason" name="reason" rows={2} className="min-h-0" placeholder="e.g. recorded twice" defaultValue={s.values?.reason} />
          </Field>
          <div className="flex gap-2">
            <SubmitButton size="sm" variant="danger" pendingText="Removing…">
              Remove the payment
            </SubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Keep it
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/* ---------------------------------------------------------------- cancelling */

/**
 * Cancel an order (MoneyV2Cancel). Money is never left hanging: with money
 * received it asks what happens to it (keep as credit, refund now or later,
 * keep as a fee); with money paid to the factory, a refund expected from the
 * factory or a loss on this order.
 */
export function CancelOrderForm({
  action,
  refNo,
  customer,
  received,
  currency,
  factoryPaid = [],
  today,
}: {
  action: Action;
  refNo?: string;
  customer?: string;
  /** Money received on the order (its currency). */
  received?: string;
  currency?: string;
  /** Money paid to the factories ("CNY 30,000.00 to Wenzhou Works"). */
  factoryPaid?: string[];
  today?: string;
}) {
  const [open, setOpen] = useState(false);
  const [customerMoney, setCustomerMoney] = useState<"credit" | "refund" | "fee">("credit");
  const [refundNow, setRefundNow] = useState(true);
  const [factoryMoney, setFactoryMoney] = useState<"refund_due" | "loss">("refund_due");
  const moneyIn = Number(received ?? 0) > 0 && currency;
  if (!open)
    return (
      <div>
        <Button size="sm" variant="danger-ghost" onClick={() => setOpen(true)}>
          Cancel this order
        </Button>
      </div>
    );
  const choice = (value: string, chosen: string, title: string, text: string, pick: () => void) => (
    <button
      key={value}
      type="button"
      role="radio"
      aria-checked={chosen === value}
      onClick={pick}
      className={cn(
        "flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left",
        chosen === value ? "border-primary bg-primary-soft ring-1 ring-primary" : "border-line bg-surface hover:border-line-strong",
      )}
    >
      <span className={cn("mt-1 size-4 shrink-0 rounded-full border-2", chosen === value ? "border-primary bg-primary shadow-[inset_0_0_0_3px_var(--surface)]" : "border-line-strong")} aria-hidden />
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-xs text-text-2">{text}</span>
      </span>
    </button>
  );
  return (
    <ActionForm action={action} onDone={() => setOpen(false)} keepFields className="flex flex-col gap-3">
      {(s) => (
        <>
          {refNo && <p className="font-semibold">Cancel {refNo}</p>}
          {moneyIn && (
            <>
              <input type="hidden" name="customerMoney" value={customerMoney} />
              <p className="flex items-center gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-sm">
                <AlertTriangle className="size-4 shrink-0 text-warn" aria-hidden />
                {currency} {Number(received).toLocaleString("en-US", { minimumFractionDigits: 2 })} was received on this order. What happens to it?
              </p>
              <div role="radiogroup" aria-label="Money received" className="grid gap-2 sm:grid-cols-3">
                {choice("credit", customerMoney, "Keep as credit", `${customer ?? "The customer"}'s credit, for the next order.`, () => setCustomerMoney("credit"))}
                {choice("refund", customerMoney, "Refund it", "Record the refund now or later (amount, account, date).", () => setCustomerMoney("refund"))}
                {choice("fee", customerMoney, "Keep as a fee", "A cancellation charge: counts as income, not owed back.", () => setCustomerMoney("fee"))}
              </div>
              {customerMoney === "refund" && (
                <div className="grid gap-3 rounded-lg border border-line bg-surface-2/60 p-3 sm:grid-cols-3">
                  <input type="hidden" name="refundNow" value={refundNow ? "true" : "false"} />
                  <Field label="Refund" htmlFor="cx-now">
                    <Select id="cx-now" value={refundNow ? "now" : "later"} onChange={(e) => setRefundNow(e.target.value === "now")}>
                      <option value="now">Now</option>
                      <option value="later">Later (kept as credit until then)</option>
                    </Select>
                  </Field>
                  {refundNow && <AccountSelect id="cx-account" label="Paid from" currency={currency} defaultValue={s.values?.refundAccountId} error={s.errors?.refundAccountId} />}
                  {refundNow && (
                    <Field label="On" htmlFor="cx-on" error={s.errors?.refundOn}>
                      <Input id="cx-on" name="refundOn" type="date" max={today} defaultValue={s.values?.refundOn ?? today} />
                    </Field>
                  )}
                </div>
              )}
            </>
          )}
          {factoryPaid.length > 0 && (
            <>
              <input type="hidden" name="factoryMoney" value={factoryMoney} />
              <p className="text-sm text-text-2">Paid to the factory: {factoryPaid.join(", ")}.</p>
              <div role="radiogroup" aria-label="Money paid to the factory" className="grid gap-2 sm:grid-cols-2">
                {choice("refund_due", factoryMoney, "Refund expected", "The factory pays it back; it stays on the order until then.", () => setFactoryMoney("refund_due"))}
                {choice("loss", factoryMoney, "A loss on this order", "Recorded as the order's expense, borne by us.", () => setFactoryMoney("loss"))}
              </div>
            </>
          )}
          <Field label="Why is it cancelled" htmlFor="cancel-reason" error={s.errors?.reason}>
            <Textarea id="cancel-reason" name="reason" rows={2} className="min-h-0" defaultValue={s.values?.reason} />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Keep the order
            </Button>
            <SubmitButton size="sm" variant="danger" pendingText="Cancelling…">
              Cancel the order
            </SubmitButton>
          </div>
          {!moneyIn && !factoryPaid.length && <p className="text-xs text-muted">No money was received or paid on this order.</p>}
        </>
      )}
    </ActionForm>
  );
}
