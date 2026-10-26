"use client";

import { useActionState, useMemo, useState } from "react";
import { Alert, ButtonLink, Card, CardBody, CardHeader, Field, Input, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";
import { formatCbm, formatKg, PACKAGE_TYPES, packingTotals } from "@/lib/packing";
import { splitDescription } from "@/lib/line-items";
import { cn } from "@/lib/utils/cn";
import type { ActionState } from "@/lib/utils/result";
import type { PackingEditableLine } from "@/modules/documents/drafts";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export type PackingLine = PackingEditableLine;

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

const small = "h-9 px-2.5 text-sm";

/**
 * The invoice's lines, as shipped. What the goods are (name, model, quantity,
 * unit) comes from the invoice and is shown, not retyped; you only say how
 * each line is packed, and untick lines that are not goods (freight…).
 */
function LinesEditor({ initial, error }: { initial: PackingLine[]; error?: string }) {
  const [lines, setLines] = useState<PackingLine[]>(initial);
  const shipped = lines.filter((l) => l.include);
  const totals = useMemo(() => packingTotals(shipped), [shipped]);
  const update = (i: number, patch: Partial<PackingLine>) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name="items" value={JSON.stringify(shipped)} />
      <datalist id="package-types">
        {PACKAGE_TYPES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      <ol className="flex flex-col gap-3">
        {lines.map((l, i) => {
          const { name, details } = splitDescription(l.description);
          return (
            <li key={l.sourceId} className={cn("rounded-lg border border-line bg-surface p-3 transition-opacity", !l.include && "bg-surface-2/60")}>
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" checked={l.include} onChange={(e) => update(i, { include: e.target.checked })} className="mt-1 h-4 w-4 accent-[var(--color-primary)]" />
                <span className="min-w-0 flex-1">
                  <span className={cn("block font-medium text-text", !l.include && "text-muted")}>{name}</span>
                  <span className="block text-xs text-muted">
                    {Number(l.quantity)} {l.unit}
                    {l.model && ` · Model ${l.model}`}
                    {l.hsCode && ` · HS ${l.hsCode}`}
                    {!l.include && " · not shipped"}
                  </span>
                  {details && l.include && <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{details}</span>}
                </span>
              </label>
              {l.include && (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5 sm:pl-7">
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
              )}
            </li>
          );
        })}
      </ol>
      {error && <p className="text-xs text-bad">{error}</p>}
      <dl className="ml-auto grid w-full grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-line bg-surface-2/60 px-4 py-3 text-sm sm:w-auto sm:grid-cols-4">
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
  );
}

export function PackingListForm({ action, initial, cancelHref, submitLabel }: { action: Action; initial: PackingFormValues; cancelHref: string; submitLabel: string }) {
  const [state, formAction] = useActionState(action, {});
  const e = state.errors ?? {};
  const v = (key: Exclude<keyof PackingFormValues, "items">) => (state.values?.[key] as string | undefined) ?? initial[key];
  // After a failed save, keep what was typed (the form sends only the shipped lines).
  const sent = state.values?.items ? (JSON.parse(state.values.items as string) as PackingLine[]) : null;
  const items = sent ? initial.items.map((l) => ({ ...l, ...(sent.find((x) => x.sourceId === l.sourceId) ?? { include: false }) })) : initial.items;
  const lineError = e.items?.[0] ?? Object.entries(e).find(([k]) => k.startsWith("items."))?.[1]?.[0];

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.message && !state.ok && <Alert tone="error">{state.message}</Alert>}
      <Card>
        <CardHeader title="Goods & packing" description="The goods come from the invoice. Say how each line is packed; untick what is not shipped (freight, installation). Weights and volume are per line." />
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
