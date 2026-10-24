"use client";

import { useActionState, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Button, ButtonLink, Card, CardBody, CardHeader, controlClass, Field, Input, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";
import { formatCbm, formatKg, PACKAGE_TYPES, packingTotals, UNITS } from "@/lib/packing";
import { cn } from "@/lib/utils/cn";
import type { ActionState } from "@/lib/utils/result";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface PackingLine {
  description: string;
  quantity: string;
  unit: string;
  packages: string;
  packageType: string;
  netWeight: string;
  grossWeight: string;
  cbm: string;
}

export interface PackingFormValues {
  items: PackingLine[];
  packDate: string;
  incoterm: string;
  portOfLoading: string;
  portOfDischarge: string;
  finalDestination: string;
  transport: string;
  containerNo: string;
  sealNo: string;
  marks: string;
  notes: string;
}

const blank: PackingLine = { description: "", quantity: "1", unit: "pcs", packages: "1", packageType: "Wooden case", netWeight: "", grossWeight: "", cbm: "" };
const small = "h-9 px-2.5 text-sm";

function LinesEditor({ initial, error }: { initial: PackingLine[]; error?: string }) {
  const [lines, setLines] = useState<PackingLine[]>(initial.length ? initial : [blank]);
  const totals = useMemo(() => packingTotals(lines), [lines]);
  const update = (i: number, patch: Partial<PackingLine>) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const remove = (i: number) => setLines((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev));

  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name="items" value={JSON.stringify(lines.filter((l) => l.description.trim()))} />
      <datalist id="package-types">
        {PACKAGE_TYPES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <datalist id="units">
        {UNITS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      <ol className="flex flex-col gap-3">
        {lines.map((l, i) => (
          <li key={i} className="rounded-lg border border-line bg-surface p-3">
            <div className="flex items-start gap-2">
              <span className="mt-2 w-5 shrink-0 text-xs text-muted tabular">{i + 1}</span>
              <div className="grid min-w-0 flex-1 gap-3">
                <div>
                  <label className="sr-only" htmlFor={`pl-desc-${i}`}>
                    Description, line {i + 1}
                  </label>
                  <textarea
                    id={`pl-desc-${i}`}
                    rows={1}
                    value={l.description}
                    onChange={(e) => update(i, { description: e.target.value })}
                    placeholder="e.g. Rotary tablet press ZP-35, with spare punches"
                    className={cn(controlClass, "resize-y py-2")}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                  <Field label="Qty" htmlFor={`pl-qty-${i}`}>
                    <Input id={`pl-qty-${i}`} className={small} type="number" min="0" step="any" inputMode="decimal" value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
                  </Field>
                  <Field label="Unit" htmlFor={`pl-unit-${i}`}>
                    <Input id={`pl-unit-${i}`} className={small} list="units" value={l.unit} onChange={(e) => update(i, { unit: e.target.value })} />
                  </Field>
                  <Field label="Packages" htmlFor={`pl-pk-${i}`}>
                    <Input id={`pl-pk-${i}`} className={small} type="number" min="0" step="1" inputMode="numeric" value={l.packages} onChange={(e) => update(i, { packages: e.target.value })} />
                  </Field>
                  <Field label="Packed in" htmlFor={`pl-type-${i}`}>
                    <Input id={`pl-type-${i}`} className={small} list="package-types" value={l.packageType} onChange={(e) => update(i, { packageType: e.target.value })} />
                  </Field>
                  <Field label="Net kg" htmlFor={`pl-nw-${i}`}>
                    <Input id={`pl-nw-${i}`} className={small} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={l.netWeight} onChange={(e) => update(i, { netWeight: e.target.value })} />
                  </Field>
                  <Field label="Gross kg" htmlFor={`pl-gw-${i}`}>
                    <Input
                      id={`pl-gw-${i}`}
                      className={cn(small, Number(l.grossWeight) > 0 && Number(l.grossWeight) < Number(l.netWeight) && "border-bad")}
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={l.grossWeight}
                      onChange={(e) => update(i, { grossWeight: e.target.value })}
                    />
                  </Field>
                  <Field label="CBM (m³)" htmlFor={`pl-cbm-${i}`}>
                    <Input id={`pl-cbm-${i}`} className={small} type="number" min="0" step="0.001" inputMode="decimal" placeholder="0.000" value={l.cbm} onChange={(e) => update(i, { cbm: e.target.value })} />
                  </Field>
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={lines.length === 1}
                className="mt-1 rounded-md p-1.5 text-muted hover:bg-bad-soft hover:text-bad disabled:opacity-30"
                aria-label={`Remove line ${i + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ol>
      {error && <p className="text-xs text-bad">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => setLines((prev) => [...prev, { ...blank, packageType: prev.at(-1)?.packageType || blank.packageType }])}>
          <Plus aria-hidden /> Add line
        </Button>
        <dl className="grid w-full grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-line bg-surface-2/60 px-4 py-3 text-sm sm:w-auto sm:grid-cols-4">
          {[
            ["Packages", String(totals.packages)],
            ["Net", formatKg(totals.netKg)],
            ["Gross", formatKg(totals.grossKg)],
            ["Volume", formatCbm(totals.cbm)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="font-medium text-text tabular">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

export function PackingListForm({ action, initial, cancelHref, submitLabel }: { action: Action; initial: PackingFormValues; cancelHref: string; submitLabel: string }) {
  const [state, formAction] = useActionState(action, {});
  const e = state.errors ?? {};
  const v = (key: Exclude<keyof PackingFormValues, "items">) => (state.values?.[key] as string | undefined) ?? initial[key];
  const items = state.values?.items ? (JSON.parse(state.values.items as string) as PackingLine[]) : initial.items;
  const lineError = e.items?.[0] ?? Object.entries(e).find(([k]) => k.startsWith("items."))?.[1]?.[0];

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.message && !state.ok && <Alert tone="error">{state.message}</Alert>}
      <Card>
        <CardHeader title="Goods & packing" description="Copied from the invoice. Remove lines that are not shipped (freight, installation). Weights and volume are per line, not per package." />
        <CardBody>
          <LinesEditor initial={items} error={lineError} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Shipment" description="Fill in what you know now; the packing list stays editable until the goods leave." />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field label="Packing date" htmlFor="packDate" required error={e.packDate}>
            <Input id="packDate" name="packDate" type="date" defaultValue={v("packDate")} />
          </Field>
          <Field label="Terms of delivery" htmlFor="incoterm" optional error={e.incoterm} hint="e.g. FOB Qingdao, CIF Karachi">
            <Input id="incoterm" name="incoterm" defaultValue={v("incoterm")} />
          </Field>
          <Field label="Port of loading" htmlFor="portOfLoading" optional error={e.portOfLoading}>
            <Input id="portOfLoading" name="portOfLoading" defaultValue={v("portOfLoading")} placeholder="Qingdao, China" />
          </Field>
          <Field label="Port of discharge" htmlFor="portOfDischarge" optional error={e.portOfDischarge}>
            <Input id="portOfDischarge" name="portOfDischarge" defaultValue={v("portOfDischarge")} />
          </Field>
          <Field label="Final destination" htmlFor="finalDestination" optional error={e.finalDestination}>
            <Input id="finalDestination" name="finalDestination" defaultValue={v("finalDestination")} />
          </Field>
          <Field label="Vessel / transport" htmlFor="transport" optional error={e.transport} hint="Vessel and voyage, flight, or truck">
            <Input id="transport" name="transport" defaultValue={v("transport")} />
          </Field>
          <Field label="Container no." htmlFor="containerNo" optional error={e.containerNo} hint="e.g. 1 × 40HQ MSKU1234567">
            <Input id="containerNo" name="containerNo" defaultValue={v("containerNo")} />
          </Field>
          <Field label="Seal no." htmlFor="sealNo" optional error={e.sealNo}>
            <Input id="sealNo" name="sealNo" defaultValue={v("sealNo")} />
          </Field>
          <Field label="Shipping marks & numbers" htmlFor="marks" optional error={e.marks} hint="As painted on the cases">
            <Textarea id="marks" name="marks" rows={3} className="min-h-0 font-mono" defaultValue={v("marks")} />
          </Field>
          <Field label="Remarks" htmlFor="notes" optional error={e.notes}>
            <Textarea id="notes" name="notes" rows={3} className="min-h-0" defaultValue={v("notes")} />
          </Field>
        </CardBody>
      </Card>
      <div className="flex flex-wrap gap-2">
        <SubmitButton pendingText="Saving…">{submitLabel}</SubmitButton>
        <ButtonLink href={cancelHref} variant="secondary">
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}
