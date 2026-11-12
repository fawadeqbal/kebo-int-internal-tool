"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight } from "lucide-react";
import { Button, Card, CardBody, CardHeader, cn, Field, Input, Textarea } from "@kebo/ui";
import { PanelBody, SidePanel } from "@/components/common/panel";
import { ConfirmSubmit, SubmitButton } from "@kebo/ui/client";
import { EditButton } from "@/components/common/edit-button";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { OrderNext } from "@/lib/types-orders";
import { AccountSelect } from "@/components/money/accounts";
import { Modal } from "@/components/common/dialog";

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
  readyEach,
  compact,
  after = [],
}: {
  /** Board look: the editable rows show only when they hold something (Ready by always). */
  compact?: boolean;
  /** Read-only rows after the rest (delivery terms), full width. */
  after?: { label: string; value: ReactNode }[];
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
    /** The customer's PO (number and day), the consignee, the notify party and where it is delivered. */
    customerRef?: string | null;
    customerPoOn?: string | null;
    consignee?: string | null;
    notifyParty?: string | null;
    deliveryAddress?: string | null;
  };
  /** The same values, formatted for reading. */
  shown: { shipBy: string | null; readyOn: string | null; shippedOn: string | null; blNo: string | null };
  /** Where shipped on / B/L / container are edited: on Shipping (read-only here, `href` lands there), or here (no shipping module). */
  shipment: { onShipping: boolean; href: string; label: string };
  /** An LC order: its latest shipment date (as read) and whether our ship-by is later. */
  lc?: { latest: string | null; late: boolean } | null;
  /** While ship-by is empty: the deal's "wanted by" (YYYY-MM-DD and as read). */
  suggestShipBy?: { on: string; shown: string } | null;
  /** An order from several factories: each gives its own ready date (edited on the Factory step); this is the latest. */
  readyEach?: { count: number; href: string } | null;
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
    {
      label: compact ? "Ready by" : "Ready at factory",
      value: shown.readyOn,
      note: readyEach ? (
        <a href={readyEach.href} className="text-xs font-normal text-primary hover:underline">
          the latest of {readyEach.count} factories · edit in Factory
        </a>
      ) : undefined,
    },
    { label: "Shipped on", value: shown.shippedOn, note: fromShipment(!!shown.shippedOn) },
    { label: "B/L no.", value: shown.blNo, note: fromShipment(!!shown.blNo) },
    { label: "Container", value: values.containerNo, note: fromShipment(!!values.containerNo) },
    { label: "Port of discharge", value: values.portOfDischarge },
    { label: "Heading on documents", value: values.documentTitle },
    { label: "Consignee", value: values.consignee ? <span className="whitespace-pre-line">{values.consignee}</span> : null },
    { label: "Notify party", value: values.notifyParty ? <span className="whitespace-pre-line">{values.notifyParty}</span> : null },
    { label: "Deliver to", value: values.deliveryAddress ? <span className="whitespace-pre-line">{values.deliveryAddress}</span> : null },
  ];
  return (
    <Card id="details" className="scroll-mt-24">
      <CardHeader
        title="The order"
        actions={canEdit && !editing ? <EditButton onClick={() => setEditing(true)} /> : undefined}
      />
      <CardBody>
        {
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
            {[
              ...(compact ? rows.filter((r, i) => i < fixed.length || r.label === "Ready by" || (r.value !== null && r.value !== undefined && r.value !== "")) : rows),
              ...after.map((r) => ({ ...r, wide: true })),
            ].map((r) => (
              <div key={r.label} className={cn("flex min-w-0 flex-col", "wide" in r && "sm:col-span-2 xl:col-span-3")}>
                <dt className="text-xs text-muted">{r.label}</dt>
                <dd className="mt-[3px] text-sm [overflow-wrap:anywhere]">
                  {r.value !== null && r.value !== undefined && r.value !== "" ? r.value : <span className="text-muted">—</span>}
                </dd>
              </div>
            ))}
          </dl>
        }
        {editing && (
          <SidePanel title="Edit the order" description="Its dates, the customer's PO, and who the goods go to. Saving updates every page of the order." onClose={() => setEditing(false)}>
          <PanelBody>
          <ActionForm action={action} onDone={() => setEditing(false)} className="flex flex-col gap-3">
            {(s) => (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Their PO no." htmlFor="d-po" optional error={s.errors?.customerRef}>
                    <Input id="d-po" name="customerRef" maxLength={80} defaultValue={s.values?.customerRef ?? values.customerRef ?? ""} />
                  </Field>
                  <Field label="Their PO date" htmlFor="d-poOn" optional error={s.errors?.customerPoOn}>
                    <Input id="d-poOn" name="customerPoOn" type="date" max={today} defaultValue={s.values?.customerPoOn ?? values.customerPoOn ?? ""} />
                  </Field>
                </div>
                <Field label="Consignee" htmlFor="d-consignee" optional hint="Who the goods are consigned to, as it should print. Empty: the customer." error={s.errors?.consignee}>
                  <Textarea id="d-consignee" name="consignee" rows={2} className="min-h-0" maxLength={500} defaultValue={s.values?.consignee ?? values.consignee ?? ""} />
                </Field>
                <Field label="Notify party" htmlFor="d-notify" optional hint="Who the carrier tells on arrival. Empty: same as the consignee." error={s.errors?.notifyParty}>
                  <Textarea id="d-notify" name="notifyParty" rows={2} className="min-h-0" maxLength={500} defaultValue={s.values?.notifyParty ?? values.notifyParty ?? ""} />
                </Field>
                <Field label="Deliver to" htmlFor="d-deliver" optional hint="The address the goods go to after the port" error={s.errors?.deliveryAddress}>
                  <Textarea id="d-deliver" name="deliveryAddress" rows={2} className="min-h-0" maxLength={500} defaultValue={s.values?.deliveryAddress ?? values.deliveryAddress ?? ""} />
                </Field>
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
                {readyEach ? (
                  <p className="rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-xs text-text-2">
                    Each of the {readyEach.count} factories gives its own ready date:{" "}
                    <a href={readyEach.href} className="font-medium text-primary hover:underline">
                      edit them on the Factory step
                    </a>
                    .
                  </p>
                ) : (
                  <Field label="Ready on" htmlFor="d-readyOn" optional hint="When the factory expects the goods ready" error={s.errors?.readyOn}>
                    <Input id="d-readyOn" name="readyOn" type="date" defaultValue={s.values?.readyOn ?? values.readyOn ?? ""} />
                  </Field>
                )}
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
          </PanelBody>
          </SidePanel>
        )}
      </CardBody>
    </Card>
  );
}

/* ---------------------------------------------------------------- payments */

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
  total,
  voids,
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
  /** The order total, for the dialog's title line. */
  total?: string;
  /** What else cancelling ends ("The quotation R2 becomes void and PO-2026-0044 is cancelled."). */
  voids?: string;
}) {
  const [open, setOpen] = useState(false);
  const [customerMoney, setCustomerMoney] = useState<"credit" | "refund" | "fee">("credit");
  const [refundNow, setRefundNow] = useState(true);
  const [factoryMoney, setFactoryMoney] = useState<"refund_due" | "loss">("refund_due");
  const moneyIn = Number(received ?? 0) > 0 && currency;
  const close = () => setOpen(false);
  const choice = (value: string, chosen: string, title: string, pick: () => void) => (
    <button
      key={value}
      type="button"
      role="radio"
      aria-checked={chosen === value}
      onClick={pick}
      className={cn(
        "flex items-center gap-3 rounded-[10px] border px-3.5 py-2.5 text-left text-sm",
        chosen === value ? "border-primary bg-primary-soft text-text ring-1 ring-primary" : "border-line bg-surface hover:border-line-strong",
      )}
    >
      <span className={cn("size-4 shrink-0 rounded-full border-2", chosen === value ? "border-primary bg-primary shadow-[inset_0_0_0_3px_var(--surface)]" : "border-line-strong")} aria-hidden />
      {title}
    </button>
  );
  const amount = (v: string) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (
    <>
      <div>
        <Button size="sm" variant="danger-ghost" onClick={() => setOpen(true)}>
          Cancel this order
        </Button>
      </div>
      {open && (
      <Modal title={`Cancel ${refNo ?? "this order"}?`} sub={[customer, total && currency ? `${currency} ${amount(total)}` : null].filter(Boolean).join(" · ") || undefined} onClose={close}>
        <ActionForm action={action} onDone={close} keepFields className="flex flex-col gap-4">
          {(s) => (
            <>
              <p className="rounded-[10px] bg-bad-soft px-3.5 py-2.5 text-sm text-bad">
                <b>Cancel order.</b> This cannot be undone.{voids ? ` ${voids}` : ""}
              </p>
              <Field label="Why is it cancelled?" htmlFor="cancel-reason" required error={s.errors?.reason}>
                <Textarea id="cancel-reason" name="reason" rows={3} required defaultValue={s.values?.reason} />
              </Field>
              {moneyIn && (
                <div className="flex flex-col gap-2">
                  <input type="hidden" name="customerMoney" value={customerMoney} />
                  <p className="text-sm font-semibold">
                    Customer&rsquo;s {currency} {amount(received!)}
                  </p>
                  <div role="radiogroup" aria-label="Money received" className="grid gap-2 sm:grid-cols-3">
                    {choice("credit", customerMoney, "Kept as the customer\u2019s credit", () => setCustomerMoney("credit"))}
                    {choice("refund", customerMoney, "Refunded", () => setCustomerMoney("refund"))}
                    {choice("fee", customerMoney, "Kept as a cancellation fee", () => setCustomerMoney("fee"))}
                  </div>
                  {customerMoney === "refund" && (
                    <div className="mt-1 grid items-end gap-3 sm:grid-cols-3">
                      <input type="hidden" name="refundNow" value={refundNow ? "true" : "false"} />
                      <label className="flex h-11 items-center gap-2.5 text-sm">
                        <input type="checkbox" className="size-4 accent-[var(--primary-solid)]" checked={refundNow} onChange={(e) => setRefundNow(e.target.checked)} />
                        Refund now
                      </label>
                      {refundNow ? (
                        <>
                          <AccountSelect id="cx-account" label="From account" currency={currency} defaultValue={s.values?.refundAccountId} error={s.errors?.refundAccountId} />
                          <Field label="Refund on" htmlFor="cx-on" error={s.errors?.refundOn}>
                            <Input id="cx-on" name="refundOn" type="date" max={today} defaultValue={s.values?.refundOn ?? today} />
                          </Field>
                        </>
                      ) : (
                        <p className="text-xs text-muted sm:col-span-2">Kept as their credit until the refund is recorded.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
              {factoryPaid.length > 0 && (
                <div className="flex flex-col gap-2">
                  <input type="hidden" name="factoryMoney" value={factoryMoney} />
                  <p className="text-sm font-semibold">Factory advance {factoryPaid.join(", ")}</p>
                  <div role="radiogroup" aria-label="Money paid to the factory" className="grid gap-2 sm:grid-cols-2">
                    {choice("refund_due", factoryMoney, "Refund expected from the factory", () => setFactoryMoney("refund_due"))}
                    {choice("loss", factoryMoney, "A loss on this order", () => setFactoryMoney("loss"))}
                  </div>
                </div>
              )}
              {!moneyIn && !factoryPaid.length && <p className="text-xs text-muted">No money was received or paid on this order.</p>}
              <div className="-mx-5 -mb-4 mt-1 flex flex-wrap justify-end gap-2 border-t border-line bg-surface-2/60 px-5 py-3.5 sm:-mx-6 sm:px-6">
                <Button type="button" variant="secondary" onClick={close}>
                  Keep the order
                </Button>
                <SubmitButton variant="danger" pendingText="Cancelling…">
                  Cancel order
                </SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Modal>
      )}
    </>
  );
}
