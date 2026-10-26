"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Checkbox, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { FactoryOrderLineInput } from "@/lib/types-orders";
import { InlineAction, type Action } from "./gate";

export interface FactoryOrderStart {
  factoryId: string;
  currency: string;
  pricesIncludeVat: boolean;
  depositPercent: number;
  paymentTerms: string | null;
  readyOn: string | null;
  notes: string | null;
  lines: FactoryOrderLineInput[];
}

type Row = Omit<FactoryOrderLineInput, "quantity" | "unitPrice" | "vatRate"> & {
  key: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
};

let seq = 0;
const toRow = (l: FactoryOrderLineInput): Row => ({
  ...l,
  key: `r${++seq}`,
  quantity: String(l.quantity),
  unitPrice: String(l.unitPrice),
  vatRate: String(l.vatRate),
});
const lineTotal = (r: Row) => Math.round(Number(r.quantity || 0) * Number(r.unitPrice || 0) * 100) / 100;
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Kebo's purchase order to one factory: header terms and editable lines (quantities
 * and the factory's prices, usually straight from its quotation). Saved as a draft.
 */
export function FactoryOrderEditor({
  action,
  start,
  factories,
  trigger,
  title,
  submitLabel,
  defaultOpen = false,
  triggerVariant = "secondary",
  triggerSize = "sm",
}: {
  action: Action;
  start: FactoryOrderStart;
  factories: { id: string; name: string }[];
  trigger: string;
  title: string;
  submitLabel: string;
  defaultOpen?: boolean;
  triggerVariant?: "primary" | "secondary" | "ghost";
  triggerSize?: "xs" | "sm";
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [factoryId, setFactoryId] = useState(start.factoryId);
  const [currency, setCurrency] = useState(start.currency);
  const [inclVat, setInclVat] = useState(start.pricesIncludeVat);
  const [deposit, setDeposit] = useState(String(start.depositPercent));
  const [terms, setTerms] = useState(start.paymentTerms ?? "");
  const [readyOn, setReadyOn] = useState(start.readyOn ?? "");
  const [notes, setNotes] = useState(start.notes ?? "");
  const [rows, setRows] = useState<Row[]>(() => start.lines.map(toRow));

  if (!open)
    return (
      <Button
        size={triggerSize}
        variant={triggerVariant}
        onClick={() => {
          // Start from what the page shows now (it may have changed since the last save).
          setFactoryId(start.factoryId);
          setCurrency(start.currency);
          setInclVat(start.pricesIncludeVat);
          setDeposit(String(start.depositPercent));
          setTerms(start.paymentTerms ?? "");
          setReadyOn(start.readyOn ?? "");
          setNotes(start.notes ?? "");
          setRows(start.lines.map(toRow));
          setOpen(true);
        }}
      >
        {trigger}
      </Button>
    );

  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const total = rows.reduce((s, r) => s + lineTotal(r), 0);
  const depositAmount = Math.round(total * Number(deposit || 0)) / 100;
  const payload = {
    factoryId,
    currency,
    pricesIncludeVat: inclVat,
    depositPercent: deposit,
    paymentTerms: terms || null,
    readyOn: readyOn || null,
    notes: notes || null,
    lines: rows.map((r) => ({
      orderLineId: r.orderLineId,
      factoryQuoteLineId: r.factoryQuoteLineId,
      description: r.description,
      model: r.model || null,
      quantity: r.quantity,
      unit: r.unit,
      unitPrice: r.unitPrice,
      vatRate: r.vatRate,
    })),
  };

  return (
    <ActionForm
      action={action}
      onDone={() => setOpen(false)}
      className="flex w-full flex-col gap-4 rounded-xl border border-line bg-surface p-4 shadow-card"
    >
      {(s) => (
        <>
          <input type="hidden" name="payload" value={JSON.stringify(payload)} />
          <h3 className="text-sm font-semibold">{title}</h3>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Factory" htmlFor="fo-factory" error={s.errors?.factoryId} className="sm:col-span-2">
              <Select id="fo-factory" value={factoryId} onChange={(e) => setFactoryId(e.target.value)}>
                {!factoryId && <option value="">Choose the factory</option>}
                {factories.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Currency" htmlFor="fo-currency" error={s.errors?.currency}>
              <Input id="fo-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
            </Field>
            <Field label="Deposit" htmlFor="fo-deposit" error={s.errors?.depositPercent} hint={`${currency} ${fmt(depositAmount)}`}>
              <Input id="fo-deposit" value={deposit} onChange={(e) => setDeposit(e.target.value)} inputMode="decimal" className="tabular" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field
              label="Payment terms"
              htmlFor="fo-terms"
              optional
              className="sm:col-span-2"
              hint="e.g. 30% deposit, balance before loading"
            >
              <Input id="fo-terms" value={terms} onChange={(e) => setTerms(e.target.value)} />
            </Field>
            <Field label="Ready date asked for" htmlFor="fo-ready" optional hint="The factory confirms its own date later">
              <Input id="fo-ready" type="date" value={readyOn} onChange={(e) => setReadyOn(e.target.value)} />
            </Field>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={inclVat} onChange={(e) => setInclVat(e.target.checked)} /> Prices include VAT
              </label>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-surface-2/60 text-xs text-muted">
                <tr>
                  <th className="px-2 py-2 text-left font-medium">Description</th>
                  <th className="w-32 px-2 py-2 text-left font-medium">Model</th>
                  <th className="w-24 px-2 py-2 text-right font-medium">Quantity</th>
                  <th className="w-20 px-2 py-2 text-left font-medium">Unit</th>
                  <th className="w-28 px-2 py-2 text-right font-medium">Unit price</th>
                  <th className="w-20 px-2 py-2 text-right font-medium">VAT %</th>
                  <th className="w-32 px-2 py-2 text-right font-medium">Line total</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key} className="border-t border-line align-top">
                    <td className="p-1.5">
                      <Textarea
                        aria-label={`Line ${i + 1} description`}
                        value={r.description}
                        onChange={(e) => set(r.key, { description: e.target.value })}
                        rows={1}
                        className="min-h-9 py-1.5"
                      />
                    </td>
                    <td className="p-1.5">
                      <Input
                        aria-label={`Line ${i + 1} model`}
                        value={r.model ?? ""}
                        onChange={(e) => set(r.key, { model: e.target.value })}
                      />
                    </td>
                    <td className="p-1.5">
                      <Input
                        aria-label={`Line ${i + 1} quantity`}
                        value={r.quantity}
                        onChange={(e) => set(r.key, { quantity: e.target.value })}
                        inputMode="decimal"
                        className="text-right tabular"
                      />
                    </td>
                    <td className="p-1.5">
                      <Input aria-label={`Line ${i + 1} unit`} value={r.unit} onChange={(e) => set(r.key, { unit: e.target.value })} />
                    </td>
                    <td className="p-1.5">
                      <Input
                        aria-label={`Line ${i + 1} unit price`}
                        value={r.unitPrice}
                        onChange={(e) => set(r.key, { unitPrice: e.target.value })}
                        inputMode="decimal"
                        className="text-right tabular"
                      />
                    </td>
                    <td className="p-1.5">
                      <Input
                        aria-label={`Line ${i + 1} VAT rate`}
                        value={r.vatRate}
                        onChange={(e) => set(r.key, { vatRate: e.target.value })}
                        inputMode="decimal"
                        className="text-right tabular"
                      />
                    </td>
                    <td className="px-2 py-3.5 text-right font-medium tabular">{fmt(lineTotal(r))}</td>
                    <td className="p-1.5">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove line ${i + 1}`}
                        onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                        disabled={rows.length === 1}
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line">
                  <td colSpan={6} className="px-2 py-2">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() =>
                        setRows((rs) => [
                          ...rs,
                          toRow({
                            orderLineId: null,
                            factoryQuoteLineId: null,
                            description: "",
                            model: null,
                            quantity: 1,
                            unit: "pcs",
                            unitPrice: 0,
                            vatRate: 13,
                          }),
                        ])
                      }
                    >
                      <Plus /> Add a line
                    </Button>
                  </td>
                  <td className="px-2 py-2 text-right font-semibold tabular">
                    {currency} {fmt(total)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          {s.errors?.lines && <p className="text-xs text-bad">{s.errors.lines[0]}</p>}
          <Field
            label="Notes for the factory"
            htmlFor="fo-notes"
            optional
            hint="Packing, labels, inspection… printed on the purchase order"
          >
            <Textarea id="fo-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="min-h-0" />
          </Field>
          <div className="flex gap-2">
            <SubmitButton size="sm" pendingText="Saving…">
              {submitLabel}
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

/** The buttons on one factory order: send, confirm (ready date), VAT invoice, cancel. */
export function FactoryOrderActions({
  status,
  readyOn,
  vatInvoiceNo,
  today,
  send,
  confirm,
  vat,
  cancel,
  confirmOpen,
}: {
  status: "draft" | "sent" | "confirmed" | "cancelled";
  readyOn: string | null;
  vatInvoiceNo: string | null;
  today: string;
  send: Action | null;
  confirm: Action | null;
  vat: Action | null;
  cancel: Action | null;
  confirmOpen?: boolean;
}) {
  return (
    <div className="contents">
      {send && status === "draft" && (
        <InlineAction label="Mark as sent" variant="primary" action={send} submitLabel="It was sent to the factory">
          {(s) => (
            <Field label="Sent on" htmlFor="fo-sent-on" optional hint="Today when empty" error={s.errors?.on}>
              <Input id="fo-sent-on" name="on" type="date" max={today} defaultValue={s.values?.on} />
            </Field>
          )}
        </InlineAction>
      )}
      {confirm && (status === "sent" || status === "confirmed") && (
        <InlineAction
          label={status === "sent" ? "Record the factory's confirmation" : "Change the ready date"}
          variant={status === "sent" ? "primary" : "secondary"}
          action={confirm}
          submitLabel="Save the ready date"
          defaultOpen={confirmOpen}
        >
          {(s) => (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Ready date the factory confirmed" htmlFor="fo-ready-on" error={s.errors?.readyOn}>
                <Input id="fo-ready-on" name="readyOn" type="date" defaultValue={s.values?.readyOn ?? readyOn ?? ""} />
              </Field>
              <Field label="Confirmed on" htmlFor="fo-confirmed-on" optional hint="Today when empty" error={s.errors?.on}>
                <Input id="fo-confirmed-on" name="on" type="date" max={today} defaultValue={s.values?.on} />
              </Field>
            </div>
          )}
        </InlineAction>
      )}
      {vat && status !== "draft" && status !== "cancelled" && (
        <InlineAction
          label={vatInvoiceNo ? "Change the VAT invoice" : "Record the factory's VAT invoice"}
          action={vat}
          submitLabel="Save the VAT invoice"
        >
          {(s) => (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="VAT invoice (fapiao) number" htmlFor="fo-vat-no" error={s.errors?.number}>
                <Input id="fo-vat-no" name="number" defaultValue={s.values?.number ?? vatInvoiceNo ?? ""} />
              </Field>
              <Field label="Invoice date" htmlFor="fo-vat-on" error={s.errors?.on}>
                <Input id="fo-vat-on" name="on" type="date" max={today} defaultValue={s.values?.on ?? today} />
              </Field>
            </div>
          )}
        </InlineAction>
      )}
      {cancel && status !== "cancelled" && (
        <InlineAction
          label="Cancel"
          variant="danger-ghost"
          action={cancel}
          submitLabel="Cancel this factory order"
          submitVariant="danger"
          confirm="Cancel this factory order? Payments already made stay recorded."
        >
          {(s) => (
            <Field label="Why is it cancelled?" htmlFor="fo-cancel-reason" error={s.errors?.reason}>
              <Textarea id="fo-cancel-reason" name="reason" rows={2} className="min-h-0" defaultValue={s.values?.reason} />
            </Field>
          )}
        </InlineAction>
      )}
    </div>
  );
}
