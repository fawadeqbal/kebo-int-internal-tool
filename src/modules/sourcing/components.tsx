"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, Button, ButtonLink, Card, CardBody, CardHeader, Field, Input, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";
import { EditableCard } from "@/components/ui/editable-card";
import { formatMoney } from "@/lib/utils/money";
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
  pricesIncludeVat: boolean;
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
  const v = (k: Exclude<keyof SupplierValues, "pricesIncludeVat">, fallback = "") => (state.values?.[k] as string | undefined) ?? initial?.[k] ?? fallback;
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
        <Field label="Their VAT (%)" htmlFor="defaultVatRate" error={e.defaultVatRate} hint="Their prices start with this; an item can differ (e.g. 6% on a service)">
          <Input id="defaultVatRate" name="defaultVatRate" type="number" min="0" max="100" step="0.01" defaultValue={v("defaultVatRate", "13")} />
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-text-2">
            <input type="hidden" name="pricesIncludeVat" value="off" />
            <input
              type="checkbox"
              name="pricesIncludeVat"
              defaultChecked={state.values ? [state.values.pricesIncludeVat].flat().at(-1) === "on" : (initial?.pricesIncludeVat ?? true)}
              className="size-4 accent-[var(--primary-solid)]"
            />
            Their prices include VAT
          </label>
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
    ["VAT", `${Number(supplier.defaultVatRate)}%, ${supplier.pricesIncludeVat ? "included in their prices" : "added on top of their prices"}`],
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

/* ---------------------------------------------------------------- Factory prices */

export interface ItemPriceRow {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  price: {
    supplierId: string;
    factory: string;
    factoryEmail: string | null;
    factoryPhone: string | null;
    /** The factory's own VAT (what new prices from it start with). */
    factoryVatRate: number;
    factoryPricesIncludeVat: boolean;
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
 * per item; new quotations are priced from these. Internal: never shown to the customer.
 */
export function ItemPricesCard({
  rows,
  currency,
  margin,
  canEdit,
  setAction,
  clearAction,
}: {
  rows: ItemPriceRow[];
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
          rows.length === 0 ? "Add the customer's items first." : `${priced} of ${rows.length} ${rows.length === 1 ? "item" : "items"} priced · internal, never shown to the customer`
        }
      />
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
                      {r.price ? (
                        "Change"
                      ) : (
                        <>
                          <Plus aria-hidden /> Add price
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
              {open === r.id && <ItemPriceForm key={r.id} row={r} currency={currency} action={setAction[r.id]} clear={r.price ? clearAction[r.id] : undefined} onDone={() => setOpen(null)} />}
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

type FactoryOption = {
  id: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  wechat: string | null;
  address: string | null;
  defaultVatRate: string;
  pricesIncludeVat: boolean;
};

/** What the factory box holds: a factory from the list, or a new one (quick, or with its details). */
export type PickedFactory =
  | { kind: "existing"; id: string; name: string; contact: string; vatRate: number; pricesIncludeVat: boolean }
  | { kind: "new"; name: string; withDetails: boolean };

const vatText = (rate: number, incl: boolean) => `VAT ${rate}%, ${incl ? "included in their prices" : "added on top"}`;
const contactLine = (f: { contactPerson?: string | null; phone?: string | null; email?: string | null; wechat?: string | null }) =>
  [f.contactPerson, f.phone, f.email, f.wechat && `WeChat ${f.wechat}`].filter(Boolean).join(" · ");

/**
 * The standard supplier search box: opening it lists the factories used most
 * recently; typing filters by name, email, phone or WeChat. The last options are
 * Create "…" (just the name) and Create and edit… (with its email, phone and VAT).
 */
export function FactoryPicker({ id, value, onChange, error }: { id: string; value: PickedFactory | null; onChange: (v: PickedFactory | null) => void; error?: string[] }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<FactoryOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);

  const load = (q: string) => {
    const n = ++seq.current;
    setLoading(true);
    fetch(`/api/v1/factories/search?q=${encodeURIComponent(q)}`)
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows: FactoryOption[] }) => {
        if (n === seq.current) {
          setRows(d.rows);
          setActive(0);
        }
      })
      .catch(() => {})
      .finally(() => n === seq.current && setLoading(false));
  };
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => load(text), text ? 180 : 0);
    return () => clearTimeout(t);
  }, [text, open]);

  const typed = text.trim();
  const exact = rows.some((r) => r.name.toLowerCase() === typed.toLowerCase());
  const options: ({ type: "factory"; f: FactoryOption } | { type: "create" } | { type: "createEdit" })[] = [
    ...rows.map((f) => ({ type: "factory" as const, f })),
    ...(typed.length >= 2 && !exact ? [{ type: "create" as const }, { type: "createEdit" as const }] : []),
  ];
  const choose = (o: (typeof options)[number]) => {
    if (o.type === "factory")
      onChange({ kind: "existing", id: o.f.id, name: o.f.name, contact: contactLine(o.f), vatRate: Number(o.f.defaultVatRate), pricesIncludeVat: o.f.pricesIncludeVat });
    else onChange({ kind: "new", name: typed.replace(/\s+/g, " "), withDetails: o.type === "createEdit" });
    setOpen(false);
    setText("");
  };

  if (value) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2.5">
        {value.kind === "existing" ? <input type="hidden" name="supplierId" value={value.id} /> : <input type="hidden" name="factoryName" value={value.name} />}
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text">
            {value.name}
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", value.kind === "existing" ? "bg-ok-soft text-ok" : "bg-info-soft text-info")}>
              {value.kind === "existing" ? "Existing factory" : "New factory"}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted">{value.kind === "existing" ? value.contact || vatText(value.vatRate, value.pricesIncludeVat) : "It is added to Factories when you save."}</p>
        </div>
        <Button type="button" variant="ghost" size="xs" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    );
  }

  const listId = `${id}-list`;
  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={!!error}
        autoComplete="off"
        autoFocus
        placeholder="Search factories, or type a new name"
        value={text}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            if (open && options[active]) {
              e.preventDefault();
              choose(options[active]);
            }
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-line bg-surface py-1 shadow-pop">
          {!typed && rows.length > 0 && <li className="px-3 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">Recently used</li>}
          {options.length === 0 && (
            <li className="px-3 py-2.5 text-sm text-muted">{loading ? "Searching…" : typed ? "Type at least 2 letters to add a new factory." : "No factories yet: type a name to add one."}</li>
          )}
          {options.map((o, k) => (
            <li
              key={o.type === "factory" ? o.f.id : o.type}
              role="option"
              aria-selected={k === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(k)}
              onClick={() => choose(o)}
              className={cn("cursor-pointer px-3 py-2 text-sm", k === active && "bg-surface-2", o.type !== "factory" && "border-t border-line")}
            >
              {o.type === "factory" ? (
                <>
                  <span className="block font-medium text-text">{o.f.name}</span>
                  <span className="block truncate text-xs text-muted">{[contactLine(o.f), `VAT ${Number(o.f.defaultVatRate)}%`].filter(Boolean).join(" · ")}</span>
                </>
              ) : o.type === "create" ? (
                <span className="flex items-center gap-2 font-medium text-primary">
                  <Plus className="size-4" aria-hidden /> Create &ldquo;{typed}&rdquo;
                </span>
              ) : (
                <span className="flex items-center gap-2 text-text-2">
                  <Pencil className="size-4" aria-hidden /> Create and edit… <span className="text-xs text-muted">(add email, phone, VAT)</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 text-xs text-bad">{error[0]}</p>}
    </div>
  );
}

function ItemPriceForm({
  row,
  currency,
  action,
  clear,
  onDone,
}: {
  row: ItemPriceRow;
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
  const [factory, setFactory] = useState<PickedFactory | null>(
    p ? { kind: "existing", id: p.supplierId, name: p.factory, contact: contactLine({ phone: p.factoryPhone, email: p.factoryEmail }), vatRate: p.factoryVatRate, pricesIncludeVat: p.factoryPricesIncludeVat } : null,
  );
  // This item's own VAT, only when it differs from the factory's (e.g. 6% on a service).
  const differs = !!p && (p.vatRate !== p.factoryVatRate || p.pricesIncludeVat !== p.factoryPricesIncludeVat);
  const [own, setOwn] = useState<{ rate: string; incl: boolean } | null>(differs && p ? { rate: String(p.vatRate), incl: p.pricesIncludeVat } : null);
  const [clearing, setClearing] = useState(false);
  const id = (k: string) => `${k}-${row.id}`;
  const details = factory?.kind === "new" && factory.withDetails;
  const factoryVat = factory?.kind === "existing" ? { rate: factory.vatRate, incl: factory.pricesIncludeVat } : { rate: 13, incl: true };

  return (
    <form action={formAction} className="mt-3 grid gap-3 rounded-xl border border-line bg-surface-2/60 p-4 sm:grid-cols-2" noValidate>
      {state.message && !state.ok && (
        <Alert tone="error" className="sm:col-span-2">
          {state.message}
        </Alert>
      )}
      <div className="sm:col-span-2">
        <label htmlFor={id("factory")} className="mb-1.5 block text-sm font-medium text-text">
          Factory <span className="text-bad">*</span>
        </label>
        <FactoryPicker
          id={id("factory")}
          value={factory}
          error={e.factoryName ?? e.supplierId}
          onChange={(v) => {
            setFactory(v);
            setOwn(null);
          }}
        />
      </div>
      {details && (
        <>
          <Field label="Factory email" htmlFor={id("email")} optional error={e.email}>
            <Input id={id("email")} name="email" type="email" defaultValue={(sent?.email as string) ?? ""} />
          </Field>
          <Field label="Phone / WeChat" htmlFor={id("phone")} optional error={e.phone}>
            <Input id={id("phone")} name="phone" defaultValue={(sent?.phone as string) ?? ""} />
          </Field>
          <Field label="Their VAT %" htmlFor={id("vatRate")} error={e.vatRate} hint="Used for all their prices">
            <Input id={id("vatRate")} name="vatRate" type="number" min="0" max="100" step="0.01" inputMode="decimal" defaultValue={(sent?.vatRate as string) ?? "13"} />
          </Field>
          <label className="flex cursor-pointer items-center gap-2 self-end pb-2.5 text-sm text-text-2">
            <input type="hidden" name="pricesIncludeVat" value="off" />
            <input type="checkbox" name="pricesIncludeVat" defaultChecked className="size-4 accent-[var(--primary-solid)]" />
            Their prices include VAT
          </label>
        </>
      )}
      <Field label={`Price for 1 ${row.unit || "unit"} (${currency})`} htmlFor={id("unitPrice")} required error={e.unitPrice}>
        <Input id={id("unitPrice")} name="unitPrice" type="number" min="0" step="0.01" inputMode="decimal" defaultValue={(sent?.unitPrice as string) ?? (p ? String(p.unitPrice) : "")} />
      </Field>
      <Field label="Lead time" htmlFor={id("leadTime")} optional error={e.leadTime}>
        <Input id={id("leadTime")} name="leadTime" defaultValue={(sent?.leadTime as string) ?? p?.leadTime ?? ""} placeholder="e.g. 45 days after deposit" />
      </Field>
      {factory && !details && (
        <div className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm sm:col-span-2">
          {own ? (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="VAT % for this item" htmlFor={id("vatRate")} error={e.vatRate} className="w-36">
                <Input id={id("vatRate")} name="vatRate" type="number" min="0" max="100" step="0.01" inputMode="decimal" value={own.rate} onChange={(ev) => setOwn({ ...own, rate: ev.target.value })} />
              </Field>
              <label className="flex cursor-pointer items-center gap-2 pb-2.5 text-text-2">
                <input type="hidden" name="pricesIncludeVat" value="off" />
                <input type="checkbox" name="pricesIncludeVat" checked={own.incl} onChange={(ev) => setOwn({ ...own, incl: ev.target.checked })} className="size-4 accent-[var(--primary-solid)]" />
                The price includes VAT
              </label>
              <button type="button" className="pb-2.5 text-xs font-medium text-primary hover:underline" onClick={() => setOwn(null)}>
                Use the factory&apos;s VAT ({factoryVat.rate}%)
              </button>
            </div>
          ) : (
            <p className="flex flex-wrap items-center justify-between gap-2 text-text-2">
              <span>
                {vatText(factoryVat.rate, factoryVat.incl)} <span className="text-muted">({factory.kind === "existing" ? "from the factory" : "default for a new factory"})</span>
              </span>
              <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setOwn({ rate: String(factoryVat.rate), incl: factoryVat.incl })}>
                Different for this item
              </button>
            </p>
          )}
        </div>
      )}
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
