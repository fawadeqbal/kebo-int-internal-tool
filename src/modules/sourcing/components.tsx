"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Button, ButtonLink, Card, CardBody, CardHeader, Field, Input, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";
import { EditableCard } from "@/components/ui/editable-card";
import { formatMoney } from "@/lib/utils/money";
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

/* ---------------------------------------------------------------- Factory prices (the simple way) */

export interface ItemPriceRow {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  price: {
    factory: string;
    unitPrice: number;
    vatRate: number;
    pricesIncludeVat: boolean;
    unitPriceWithVat: number;
    unitCost: number | null;
    leadTime: string | null;
  } | null;
}

/**
 * Per customer item: which factory supplies it and at what price. One price
 * per item, typed straight in (no offers to compare). New quotations are
 * priced from these. Internal: never shown to the customer.
 */
export function ItemPricesCard({
  rows,
  factories,
  currency,
  margin,
  canEdit,
  setAction,
  clearAction,
}: {
  rows: ItemPriceRow[];
  factories: { name: string; defaultVatRate: string }[];
  currency: string;
  margin: number;
  canEdit: boolean;
  /** Per item id: the bound save / remove actions. */
  setAction: Record<string, Action>;
  clearAction: Record<string, () => Promise<ActionState>>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const priced = rows.filter((r) => r.price).length;
  return (
    <Card>
      <CardHeader
        title="Factory prices"
        description={
          rows.length === 0
            ? "Add the customer's items first."
            : `${priced} of ${rows.length} ${rows.length === 1 ? "item" : "items"} priced · internal, never shown to the customer`
        }
      />
      <datalist id="factory-names">
        {factories.map((f) => (
          <option key={f.name} value={f.name} />
        ))}
      </datalist>
      <CardBody className="p-0">
        <ul className="divide-y divide-line">
          {rows.map((r, n) => (
            <li key={r.id} className="px-5 py-3">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text">
                    {n + 1}. {r.name} <span className="font-normal text-muted">· {r.quantity} {r.unit}</span>
                  </p>
                  {r.price ? (
                    <p className="mt-0.5 text-sm text-text-2">
                      <span className="font-medium text-text">{r.price.factory}</span> · {formatMoney(r.price.unitPrice, currency)} {r.price.pricesIncludeVat ? "incl." : "+"} {r.price.vatRate}% VAT
                      {r.price.leadTime && ` · ${r.price.leadTime}`}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-sm text-muted">No factory price yet</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {r.price && (
                    <span className="text-right text-xs text-muted">
                      Our cost
                      <span className="block text-sm font-semibold text-text tabular">{formatMoney(r.price.unitCost ?? r.price.unitPriceWithVat, currency)}</span>
                      <span className="block">incl. VAT</span>
                    </span>
                  )}
                  {canEdit && open !== r.id && (
                    <Button type="button" variant={r.price ? "secondary" : "primary"} size="xs" onClick={() => setOpen(r.id)}>
                      {r.price ? "Change" : <><Plus aria-hidden /> Add price</>}
                    </Button>
                  )}
                </div>
              </div>
              {open === r.id && (
                <ItemPriceForm
                  key={r.id}
                  row={r}
                  factories={factories}
                  currency={currency}
                  action={setAction[r.id]}
                  clear={r.price ? clearAction[r.id] : undefined}
                  onDone={() => setOpen(null)}
                />
              )}
            </li>
          ))}
        </ul>
        {priced > 0 && (
          <p className="border-t border-line px-5 py-2.5 text-xs text-muted">
            New quotations are priced from these: our cost (VAT included) plus {margin}% margin. You can still change each price on the quotation.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function ItemPriceForm({
  row,
  factories,
  currency,
  action,
  clear,
  onDone,
}: {
  row: ItemPriceRow;
  factories: { name: string; defaultVatRate: string }[];
  currency: string;
  action: Action;
  clear?: () => Promise<ActionState>;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState(async (prev: ActionState, fd: FormData) => {
    const result = await action(prev, fd);
    if (result.ok) onDone();
    return result;
  }, {});
  const e = state.errors ?? {};
  const sent = state.values;
  const p = row.price;
  const [vat, setVat] = useState<string>((sent?.vatRate as string) ?? String(p?.vatRate ?? 13));
  const [clearing, setClearing] = useState(false);
  const [name, setName] = useState<string>((sent?.factoryName as string) ?? p?.factory ?? "");
  // A name we have not seen before is a new factory: ask for its contacts here, once.
  const isNew = name.trim().length >= 2 && !factories.some((f) => f.name.toLowerCase() === name.trim().toLowerCase());
  const id = (k: string) => `${k}-${row.id}`;
  return (
    <form action={formAction} className="mt-3 grid gap-3 rounded-xl border border-line bg-surface-2/60 p-4 sm:grid-cols-2" noValidate>
      {state.message && !state.ok && (
        <Alert tone="error" className="sm:col-span-2">
          {state.message}
        </Alert>
      )}
      <Field label="Factory" htmlFor={id("factoryName")} required error={e.factoryName} hint={isNew ? "New factory: it is added for you" : "Start typing to pick one you have used before"} className="sm:col-span-2">
        <Input
          id={id("factoryName")}
          name="factoryName"
          list="factory-names"
          autoFocus
          value={name}
          placeholder="e.g. Jinan Pharma Machinery Co., Ltd."
          onChange={(ev) => {
            setName(ev.target.value);
            const known = factories.find((f) => f.name.toLowerCase() === ev.target.value.trim().toLowerCase());
            if (known && !p) setVat(String(Number(known.defaultVatRate)));
          }}
        />
      </Field>
      {isNew && (
        <>
          <Field label="Factory email" htmlFor={id("email")} optional error={e.email}>
            <Input id={id("email")} name="email" type="email" defaultValue={(sent?.email as string) ?? ""} />
          </Field>
          <Field label="Phone / WeChat" htmlFor={id("phone")} optional error={e.phone}>
            <Input id={id("phone")} name="phone" defaultValue={(sent?.phone as string) ?? ""} />
          </Field>
        </>
      )}
      <Field label={`Price for 1 ${row.unit || "unit"} (${currency})`} htmlFor={id("unitPrice")} required error={e.unitPrice}>
        <Input id={id("unitPrice")} name="unitPrice" type="number" min="0" step="0.01" inputMode="decimal" defaultValue={(sent?.unitPrice as string) ?? (p ? String(p.unitPrice) : "")} />
      </Field>
      <div className="grid grid-cols-[6rem_1fr] items-end gap-3">
        <Field label="VAT %" htmlFor={id("vatRate")} error={e.vatRate}>
          <Input id={id("vatRate")} name="vatRate" type="number" min="0" max="100" step="0.01" inputMode="decimal" value={vat} onChange={(ev) => setVat(ev.target.value)} />
        </Field>
        <label className="mb-2.5 flex cursor-pointer items-center gap-2 text-sm text-text-2">
          <input type="checkbox" name="pricesIncludeVat" defaultChecked={sent ? sent.pricesIncludeVat === "on" : (p?.pricesIncludeVat ?? true)} className="size-4 accent-[var(--primary-solid)]" />
          The price includes VAT
        </label>
      </div>
      <Field label="Lead time" htmlFor={id("leadTime")} optional error={e.leadTime} className="sm:col-span-2">
        <Input id={id("leadTime")} name="leadTime" defaultValue={(sent?.leadTime as string) ?? p?.leadTime ?? ""} placeholder="e.g. 45 days after deposit" />
      </Field>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <SubmitButton size="sm">Save</SubmitButton>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        {clear && (
          <Button
            type="button"
            variant="danger-ghost"
            size="sm"
            className="ml-auto"
            disabled={clearing}
            onClick={async () => {
              setClearing(true);
              const r = await clear();
              setClearing(false);
              if (r.ok) onDone();
            }}
          >
            <Trash2 aria-hidden /> Remove price
          </Button>
        )}
      </div>
    </form>
  );
}
