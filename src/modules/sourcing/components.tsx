"use client";

import { useActionState, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Button, ButtonLink, Card, CardBody, CardHeader, controlClass, Field, Input, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";
import { EditableCard } from "@/components/ui/editable-card";
import { splitDescription, UNITS } from "@/lib/line-items";
import { unitPriceWithVat } from "@/lib/costing";
import { formatCents, formatMoney } from "@/lib/utils/money";
import { cn } from "@/lib/utils/cn";
import type { ActionState } from "@/lib/utils/result";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/* ---------------------------------------------------------------- factory form */

export interface SupplierValues {
  name: string;
  contactPerson: string;
  phone: string;
  wechat: string;
  email: string;
  address: string;
  defaultVatRate: string;
  bankDetails: string;
  notes: string;
}

export function SupplierForm({ action, initial, onDone, cancelHref }: { action: Action; initial?: Partial<SupplierValues>; onDone?: () => void; cancelHref?: string }) {
  const [state, formAction] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.ok) onDone?.();
    return r;
  }, {});
  const e = state.errors ?? {};
  const v = (k: keyof SupplierValues, fallback = "") => (state.values?.[k] as string | undefined) ?? initial?.[k] ?? fallback;
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.message && !state.ok && <Alert tone="error">{state.message}</Alert>}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Factory name" htmlFor="name" required error={e.name} className="sm:col-span-2">
          <Input id="name" name="name" defaultValue={v("name")} placeholder="e.g. Jinan Pharma Machinery Co., Ltd." />
        </Field>
        <Field label="Contact person" htmlFor="contactPerson" optional error={e.contactPerson}>
          <Input id="contactPerson" name="contactPerson" defaultValue={v("contactPerson")} />
        </Field>
        <Field label="Phone" htmlFor="phone" optional error={e.phone}>
          <Input id="phone" name="phone" defaultValue={v("phone")} />
        </Field>
        <Field label="WeChat" htmlFor="wechat" optional error={e.wechat}>
          <Input id="wechat" name="wechat" defaultValue={v("wechat")} />
        </Field>
        <Field label="Email" htmlFor="email" optional error={e.email}>
          <Input id="email" name="email" type="email" defaultValue={v("email")} />
        </Field>
        <Field label="Usual VAT on their prices (%)" htmlFor="defaultVatRate" error={e.defaultVatRate} hint="New offer lines start with this; each line can differ">
          <Input id="defaultVatRate" name="defaultVatRate" type="number" min="0" max="100" step="0.01" defaultValue={v("defaultVatRate", "13")} />
        </Field>
        <Field label="Address" htmlFor="address" optional error={e.address}>
          <Input id="address" name="address" defaultValue={v("address")} />
        </Field>
        <Field label="Bank details" htmlFor="bankDetails" optional error={e.bankDetails} className="sm:col-span-2">
          <Textarea id="bankDetails" name="bankDetails" rows={3} className="min-h-0" defaultValue={v("bankDetails")} />
        </Field>
        <Field label="Notes" htmlFor="notes" optional error={e.notes} hint="Quality, reliability, what they are good at" className="sm:col-span-2">
          <Textarea id="notes" name="notes" rows={2} className="min-h-0" defaultValue={v("notes")} />
        </Field>
      </div>
      <div className="flex gap-2">
        <SubmitButton>{initial?.name ? "Save" : "Add factory"}</SubmitButton>
        {onDone ? (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        ) : (
          cancelHref && (
            <ButtonLink href={cancelHref} variant="secondary">
              Cancel
            </ButtonLink>
          )
        )}
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------- offer form */

export interface OfferLine {
  id?: string;
  /** The customer's item it is for ("" = an extra line). */
  sourceId: string;
  description: string;
  model: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  vatRate: string;
}

export interface OfferValues {
  supplierId: string;
  reference: string;
  quotedOn: string;
  validUntil: string;
  currency: string;
  pricesIncludeVat: boolean;
  priceBasis: string;
  leadTime: string;
  paymentTerms: string;
  notes: string;
  items: OfferLine[];
}

const NEW = "__new__";
const CURRENCIES = ["CNY", "USD", "EUR"];

/**
 * What one factory offered for this inquiry: one line per customer item it
 * quoted (filled in from the inquiry; untick or remove what they did not
 * quote), each with its own price and VAT %.
 */
export function OfferForm({
  action,
  initial,
  suppliers,
  requested,
  cancelHref,
  submitLabel,
}: {
  action: Action;
  initial: OfferValues;
  suppliers: { id: string; name: string; defaultVatRate: string }[];
  requested: { id: string; description: string; quantity: string; unit: string }[];
  cancelHref: string;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const e = state.errors ?? {};
  const sent = state.values;
  const [supplierId, setSupplierId] = useState<string>((sent?.supplierId as string) ?? (initial.supplierId || (suppliers.length ? "" : NEW)));
  const [currency, setCurrency] = useState<string>((sent?.currency as string) ?? initial.currency);
  const [inclVat, setInclVat] = useState<boolean>(sent ? sent.pricesIncludeVat === "on" : initial.pricesIncludeVat);
  const [lines, setLines] = useState<OfferLine[]>(sent?.items ? (JSON.parse(sent.items as string) as OfferLine[]) : initial.items);
  const v = (k: keyof Omit<OfferValues, "items" | "pricesIncludeVat">) => (sent?.[k] as string | undefined) ?? initial[k];
  const update = (i: number, patch: Partial<OfferLine>) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const pickSupplier = (id: string) => {
    setSupplierId(id);
    const s = suppliers.find((x) => x.id === id);
    // A new factory's usual VAT replaces the starting rate on lines nobody has priced yet.
    if (s) setLines((prev) => prev.map((l) => (l.unitPrice === "" ? { ...l, vatRate: String(Number(s.defaultVatRate)) } : l)));
  };

  const total = useMemo(
    () => lines.reduce((t, l) => t + Math.round(unitPriceWithVat(Number(l.unitPrice) || 0, Number(l.vatRate) || 0, inclVat) * 100) * (Number(l.quantity) || 0), 0),
    [lines, inclVat],
  );
  const filled = lines.filter((l) => l.description.trim() && l.unitPrice !== "");
  const itemName = (id: string) => splitDescription(requested.find((r) => r.id === id)?.description ?? "").name;

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.message && !state.ok && <Alert tone="error">{state.message}</Alert>}
      <input type="hidden" name="items" value={JSON.stringify(filled)} />
      <Card>
        <CardHeader title="Factory" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field label="Factory" htmlFor="supplierId" required error={e.supplierId}>
            <Select id="supplierId" name={supplierId === NEW ? "" : "supplierId"} value={supplierId} onChange={(ev) => pickSupplier(ev.target.value)}>
              <option value="" disabled>
                Choose a factory…
              </option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value={NEW}>+ New factory…</option>
            </Select>
          </Field>
          {supplierId === NEW ? (
            <Field label="New factory's name" htmlFor="newSupplierName" required error={e.newSupplierName} hint="Add the contact details later under Factories">
              <Input id="newSupplierName" name="newSupplierName" defaultValue={(sent?.newSupplierName as string) ?? ""} autoFocus />
            </Field>
          ) : (
            <Field label="Their quotation no." htmlFor="reference" optional error={e.reference}>
              <Input id="reference" name="reference" defaultValue={v("reference")} />
            </Field>
          )}
          <Field label="Date of their offer" htmlFor="quotedOn" required error={e.quotedOn}>
            <Input id="quotedOn" name="quotedOn" type="date" defaultValue={v("quotedOn")} />
          </Field>
          <Field label="Valid until" htmlFor="validUntil" optional error={e.validUntil}>
            <Input id="validUntil" name="validUntil" type="date" defaultValue={v("validUntil")} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Prices" description="One line per item they quoted. Remove the ones they did not; add extras (tooling, spare parts) as new lines." />
        <CardBody className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <Field label="Currency" htmlFor="currency" error={e.currency}>
              <Input id="currency" name="currency" list="offer-currencies" value={currency} onChange={(ev) => setCurrency(ev.target.value.toUpperCase())} maxLength={3} />
            </Field>
            <label className="flex cursor-pointer items-center gap-2.5 self-end rounded-lg border border-line px-3 py-2.5 text-sm text-text-2 has-[:checked]:border-primary/40 has-[:checked]:bg-primary-soft/40 has-[:checked]:text-text">
              <input type="checkbox" name="pricesIncludeVat" checked={inclVat} onChange={(ev) => setInclVat(ev.target.checked)} className="size-4 accent-[var(--primary-solid)]" />
              The prices below already include VAT (含税)
            </label>
          </div>
          <datalist id="offer-currencies">
            {CURRENCIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <datalist id="offer-units">
            {UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
          <ol className="flex flex-col divide-y divide-line rounded-xl border border-line">
            {lines.map((l, i) => {
              const withVat = unitPriceWithVat(Number(l.unitPrice) || 0, Number(l.vatRate) || 0, inclVat);
              return (
                <li key={l.id ?? `n${i}`} className="grid gap-3 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-xs text-muted">
                      For
                      <select
                        value={l.sourceId}
                        onChange={(ev) => update(i, { sourceId: ev.target.value })}
                        className={cn(controlClass, "h-8 w-auto max-w-[18rem] py-0 text-xs")}
                        aria-label={`Customer item for line ${i + 1}`}
                      >
                        {requested.map((r) => (
                          <option key={r.id} value={r.id}>
                            {splitDescription(r.description).name}
                          </option>
                        ))}
                        <option value="">Extra (not asked for)</option>
                      </select>
                    </label>
                    <button type="button" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))} className="rounded-md p-1.5 text-muted hover:bg-bad-soft hover:text-bad" aria-label={`Remove line ${i + 1}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <textarea
                    rows={l.description.includes("\n") ? 2 : 1}
                    value={l.description}
                    onChange={(ev) => update(i, { description: ev.target.value })}
                    className={cn(controlClass, "field-sizing-content min-h-10 resize-y py-2")}
                    aria-label={`What they offer, line ${i + 1}`}
                    placeholder={l.sourceId ? `What they offer for: ${itemName(l.sourceId)}` : "What they offer"}
                  />
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_6rem_6rem_9rem_6rem]">
                    <Input aria-label={`Model, line ${i + 1}`} placeholder="Model" value={l.model} onChange={(ev) => update(i, { model: ev.target.value })} />
                    <Input aria-label={`Quantity, line ${i + 1}`} type="number" min="0" step="any" value={l.quantity} onChange={(ev) => update(i, { quantity: ev.target.value })} />
                    <Input aria-label={`Unit, line ${i + 1}`} list="offer-units" value={l.unit} onChange={(ev) => update(i, { unit: ev.target.value })} />
                    <Input aria-label={`Unit price (${currency}), line ${i + 1}`} placeholder={`Unit price ${currency}`} type="number" min="0" step="0.01" value={l.unitPrice} onChange={(ev) => update(i, { unitPrice: ev.target.value })} />
                    <div className="relative">
                      <Input aria-label={`VAT %, line ${i + 1}`} type="number" min="0" max="100" step="0.01" value={l.vatRate} onChange={(ev) => update(i, { vatRate: ev.target.value })} className="pr-7" />
                      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted">%</span>
                    </div>
                  </div>
                  {l.unitPrice !== "" && (
                    <p className="text-right text-xs text-muted tabular">
                      {inclVat ? "Incl." : "+ VAT ="} {formatMoney(withVat, currency)} / {l.unit || "unit"} · line {formatCents(Math.round(withVat * 100) * (Number(l.quantity) || 0), currency)} incl. VAT
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
          {(e.items || Object.keys(e).some((k) => k.startsWith("items"))) && <p className="text-xs text-bad">{e.items?.[0] ?? "Check the prices: each line needs a description and a price."}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setLines((prev) => [...prev, { sourceId: "", description: "", model: "", quantity: "1", unit: "pcs", unitPrice: "", vatRate: prev.at(-1)?.vatRate ?? "13" }])}
            >
              <Plus aria-hidden /> Add line
            </Button>
            <p className="text-sm">
              Total incl. VAT <span className="font-semibold text-text tabular">{formatCents(total, currency)}</span>
            </p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Terms" description="Optional" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field label="Price basis" htmlFor="priceBasis" optional error={e.priceBasis} hint="EXW factory, FOB Qingdao, delivered to port…">
            <Input id="priceBasis" name="priceBasis" defaultValue={v("priceBasis")} />
          </Field>
          <Field label="Lead time" htmlFor="leadTime" optional error={e.leadTime} hint="e.g. 45 days after deposit">
            <Input id="leadTime" name="leadTime" defaultValue={v("leadTime")} />
          </Field>
          <Field label="Payment terms" htmlFor="paymentTerms" optional error={e.paymentTerms}>
            <Input id="paymentTerms" name="paymentTerms" defaultValue={v("paymentTerms")} placeholder="30% deposit, 70% before shipment" />
          </Field>
          <Field label="Notes" htmlFor="notes" optional error={e.notes}>
            <Input id="notes" name="notes" defaultValue={v("notes")} />
          </Field>
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2">
        <SubmitButton>{submitLabel}</SubmitButton>
        <ButtonLink href={cancelHref} variant="secondary">
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------- compare & choose */

export interface CompareItem {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  chosenId: string | null;
  options: {
    id: string;
    supplierName: string;
    description: string;
    model: string | null;
    quantity: string;
    unit: string;
    offerCurrency: string;
    unitPrice: string;
    vatRate: string;
    unitPriceWithVat: number;
    unitCost: number | null;
    leadTime: string | null;
  }[];
}

/** Per customer item, every factory line offered for it, cheapest first: pick the one to quote from. */
export function ChooseOffersForm({ action, items, currency, canEdit }: { action: Action; items: CompareItem[]; currency: string; canEdit: boolean }) {
  const [state, formAction] = useActionState(action, {});
  const [choices, setChoices] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id, i.chosenId ?? ""])));
  const changed = items.some((i) => (i.chosenId ?? "") !== choices[i.id]);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="choices" value={JSON.stringify(choices)} />
      {state.message && <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>}
      {items.map((it, n) => {
        const { name } = splitDescription(it.description);
        const cheapest = it.options.find((o) => o.unitCost !== null)?.id;
        return (
          <Card key={it.id}>
            <CardHeader title={`${n + 1}. ${name}`} description={`${Number(it.quantity)} ${it.unit} · ${it.options.length ? `${it.options.length} ${it.options.length === 1 ? "offer" : "offers"}` : "no factory offer yet"}`} />
            {it.options.length > 0 && (
              <CardBody className="p-0">
                <ul className="divide-y divide-line">
                  {it.options.map((o) => (
                    <li key={o.id}>
                      <label className={cn("flex cursor-pointer items-start gap-3 px-5 py-3 hover:bg-surface-2", choices[it.id] === o.id && "bg-primary-soft/40")}>
                        <input
                          type="radio"
                          name={`choice-${it.id}`}
                          checked={choices[it.id] === o.id}
                          disabled={!canEdit}
                          onChange={() => setChoices((c) => ({ ...c, [it.id]: o.id }))}
                          className="mt-1 size-4 accent-[var(--primary-solid)]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-text">{o.supplierName}</span>
                            {o.id === cheapest && it.options.length > 1 && <span className="rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-medium text-ok">Cheapest</span>}
                          </span>
                          <span className="block text-xs text-muted">
                            {splitDescription(o.description).name}
                            {o.model && ` · ${o.model}`}
                            {o.leadTime && ` · ${o.leadTime}`}
                            {Number(o.quantity) !== Number(it.quantity) && ` · quoted for ${Number(o.quantity)} ${o.unit}`}
                          </span>
                        </span>
                        <span className="text-right tabular">
                          <span className="block text-sm font-semibold text-text">{o.unitCost === null ? "No rate" : formatMoney(o.unitCost, currency)}</span>
                          <span className="block text-xs text-muted">
                            {formatMoney(o.unitPriceWithVat, o.offerCurrency)} incl. {Number(o.vatRate)}% VAT
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                  <li>
                    <label className="flex cursor-pointer items-center gap-3 px-5 py-2.5 text-sm text-muted hover:bg-surface-2">
                      <input type="radio" name={`choice-${it.id}`} checked={choices[it.id] === ""} disabled={!canEdit} onChange={() => setChoices((c) => ({ ...c, [it.id]: "" }))} className="size-4 accent-[var(--primary-solid)]" />
                      None: price this item by hand
                    </label>
                  </li>
                </ul>
              </CardBody>
            )}
          </Card>
        );
      })}
      {canEdit && (
        <div className="sticky bottom-20 z-10 flex items-center justify-end gap-3 rounded-xl border border-line bg-surface/90 p-3 shadow-pop backdrop-blur lg:bottom-4">
          {changed && <span className="text-sm text-muted">Not saved yet</span>}
          <SubmitButton disabled={!changed}>Save choices</SubmitButton>
        </div>
      )}
    </form>
  );
}

/** A factory's details, read first; "Edit" opens the form in place. */
export function SupplierProfileCard({ action, supplier }: { action: Action; supplier: SupplierValues }) {
  const rows: [string, string][] = [
    ["Contact person", supplier.contactPerson],
    ["Phone", supplier.phone],
    ["WeChat", supplier.wechat],
    ["Email", supplier.email],
    ["Usual VAT", `${Number(supplier.defaultVatRate)}%`],
    ["Address", supplier.address],
    ["Bank details", supplier.bankDetails],
    ["Notes", supplier.notes],
  ];
  return (
    <EditableCard
      title="Details"
      read={
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="mt-0.5 text-sm break-words whitespace-pre-wrap text-text">{value || <span className="text-muted">Not set</span>}</dd>
            </div>
          ))}
        </dl>
      }
      edit={(done) => <SupplierForm action={action} initial={supplier} onDone={done} />}
    />
  );
}
