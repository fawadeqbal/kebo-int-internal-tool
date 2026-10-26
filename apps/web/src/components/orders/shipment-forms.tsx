"use client";

import { useState } from "react";
import { Button, Field, Input, Textarea, cn } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { GateHelp, InlineAction, NoteField, type Action } from "./gate";

export interface ShipmentHeader {
  forwarder: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  finalDestination: string | null;
  transport: string | null;
  containerNos: string | null;
  sealNos: string | null;
  blNo: string | null;
  etd: string | null;
  eta: string | null;
  marks: string | null;
  notes: string | null;
}

export interface PackRow {
  orderLineId: string;
  description: string;
  unit: string;
  /** The most that can go on this shipment (what is left, plus what it already holds). */
  max: number;
  quantity: number;
  packages: number;
  packageType: string;
  netWeightKg: number;
  grossWeightKg: number;
  cbm: number;
}

type Row = { [K in keyof PackRow]: PackRow[K] extends number ? string : PackRow[K] };
const toRow = (r: PackRow): Row => ({
  ...r,
  max: String(r.max),
  quantity: String(r.quantity),
  packages: String(r.packages),
  netWeightKg: r.netWeightKg ? String(r.netWeightKg) : "",
  grossWeightKg: r.grossWeightKg ? String(r.grossWeightKg) : "",
  cbm: r.cbm ? String(r.cbm) : "",
});
const n = (v: string) => Number(v || 0);
const fmt = (v: number, d = 2) => v.toLocaleString("en-US", { maximumFractionDigits: d });

const HEADER_FIELDS: { key: keyof ShipmentHeader; label: string; type?: string; wide?: boolean; hint?: string }[] = [
  { key: "forwarder", label: "Forwarder" },
  { key: "transport", label: "Transport", hint: "e.g. Sea, 1×40'HQ, vessel / voyage" },
  { key: "blNo", label: "B/L number" },
  { key: "portOfLoading", label: "Port of loading" },
  { key: "portOfDischarge", label: "Port of discharge" },
  { key: "finalDestination", label: "Final destination" },
  { key: "containerNos", label: "Container numbers" },
  { key: "sealNos", label: "Seal numbers" },
  { key: "etd", label: "ETD", type: "date" },
  { key: "eta", label: "ETA", type: "date" },
];

/**
 * A packing list: how much of each goods line goes on this shipment (lower a
 * quantity to split the order into several shipments; 0 leaves the line out),
 * the packages, weights and volume, and the shipping details as they are known.
 */
export function ShipmentEditor({
  action,
  header,
  lines,
  linesLocked = false,
  trigger,
  title,
  submitLabel,
  defaultOpen = false,
  triggerVariant = "secondary",
  triggerSize = "sm",
}: {
  action: Action;
  header: ShipmentHeader;
  lines: PackRow[];
  linesLocked?: boolean;
  trigger: string;
  title: string;
  submitLabel: string;
  defaultOpen?: boolean;
  triggerVariant?: "primary" | "secondary" | "ghost";
  triggerSize?: "xs" | "sm";
}) {
  const fresh = () => Object.fromEntries(Object.entries(header).map(([k, v]) => [k, v ?? ""])) as Record<keyof ShipmentHeader, string>;
  const [open, setOpen] = useState(defaultOpen);
  const [h, setH] = useState(fresh);
  const [rows, setRows] = useState<Row[]>(() => lines.map(toRow));
  if (!open)
    return (
      <Button
        size={triggerSize}
        variant={triggerVariant}
        onClick={() => {
          // Start from what the page shows now (it may have changed since the last save).
          setH(fresh());
          setRows(lines.map(toRow));
          setOpen(true);
        }}
      >
        {trigger}
      </Button>
    );

  const set = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.orderLineId === id ? { ...r, ...patch } : r)));
  const packed = rows.filter((r) => n(r.quantity) > 0);
  const totals = packed.reduce(
    (t, r) => ({
      packages: t.packages + n(r.packages),
      net: t.net + n(r.netWeightKg),
      gross: t.gross + n(r.grossWeightKg),
      cbm: t.cbm + n(r.cbm),
    }),
    { packages: 0, net: 0, gross: 0, cbm: 0 },
  );
  const payload = {
    ...Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v.trim() || null])),
    lines: packed.map((r) => ({
      orderLineId: r.orderLineId,
      quantity: r.quantity,
      packages: r.packages,
      packageType: r.packageType,
      netWeightKg: r.netWeightKg,
      grossWeightKg: r.grossWeightKg,
      cbm: r.cbm,
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
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-surface-2/60 text-xs text-muted">
                <tr>
                  <th className="px-2 py-2 text-left font-medium">Goods</th>
                  <th className="w-28 px-2 py-2 text-right font-medium">Quantity</th>
                  <th className="w-20 px-2 py-2 text-right font-medium">Packages</th>
                  <th className="w-36 px-2 py-2 text-left font-medium">Package type</th>
                  <th className="w-24 px-2 py-2 text-right font-medium">Net kg</th>
                  <th className="w-24 px-2 py-2 text-right font-medium">Gross kg</th>
                  <th className="w-24 px-2 py-2 text-right font-medium">CBM</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const over = n(r.quantity) > n(r.max) + 1e-9;
                  const off = n(r.quantity) <= 0;
                  return (
                    <tr key={r.orderLineId} className={cn("border-t border-line align-top", off && "text-muted")}>
                      <td className="px-2 py-2">
                        <span className="line-clamp-2 whitespace-pre-line">{r.description}</span>
                        <span className={cn("block text-xs", over ? "text-bad" : "text-muted")}>
                          {off
                            ? "Not on this shipment"
                            : over
                              ? `Only ${fmt(n(r.max))} ${r.unit} left to ship`
                              : `${fmt(n(r.max))} ${r.unit} can go`}
                        </span>
                      </td>
                      <td className="p-1.5">
                        <div className="flex items-center gap-1">
                          <Input
                            aria-label={`Line ${i + 1} quantity`}
                            value={r.quantity}
                            onChange={(e) => set(r.orderLineId, { quantity: e.target.value })}
                            inputMode="decimal"
                            className="text-right tabular"
                            disabled={linesLocked}
                            aria-invalid={over || undefined}
                          />
                          <span className="text-xs text-muted">{r.unit}</span>
                        </div>
                      </td>
                      <td className="p-1.5">
                        <Input
                          aria-label={`Line ${i + 1} packages`}
                          value={r.packages}
                          onChange={(e) => set(r.orderLineId, { packages: e.target.value })}
                          inputMode="numeric"
                          className="text-right tabular"
                          disabled={linesLocked}
                        />
                      </td>
                      <td className="p-1.5">
                        <Input
                          aria-label={`Line ${i + 1} package type`}
                          value={r.packageType}
                          onChange={(e) => set(r.orderLineId, { packageType: e.target.value })}
                          disabled={linesLocked}
                        />
                      </td>
                      <td className="p-1.5">
                        <Input
                          aria-label={`Line ${i + 1} net weight`}
                          value={r.netWeightKg}
                          onChange={(e) => set(r.orderLineId, { netWeightKg: e.target.value })}
                          inputMode="decimal"
                          placeholder="0"
                          className="text-right tabular"
                          disabled={linesLocked}
                        />
                      </td>
                      <td className="p-1.5">
                        <Input
                          aria-label={`Line ${i + 1} gross weight`}
                          value={r.grossWeightKg}
                          onChange={(e) => set(r.orderLineId, { grossWeightKg: e.target.value })}
                          inputMode="decimal"
                          placeholder="0"
                          className="text-right tabular"
                          disabled={linesLocked}
                        />
                      </td>
                      <td className="p-1.5">
                        <Input
                          aria-label={`Line ${i + 1} volume`}
                          value={r.cbm}
                          onChange={(e) => set(r.orderLineId, { cbm: e.target.value })}
                          inputMode="decimal"
                          placeholder="0"
                          className="text-right tabular"
                          disabled={linesLocked}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-surface-2/40 font-medium">
                  <td className="px-2 py-2 text-xs text-muted" colSpan={2}>
                    {linesLocked
                      ? "The goods have left: packed quantities can no longer change."
                      : `${packed.length} of ${rows.length} line${rows.length === 1 ? "" : "s"} on this shipment`}
                  </td>
                  <td className="px-2 py-2 text-right tabular">{fmt(totals.packages, 0)}</td>
                  <td />
                  <td className="px-2 py-2 text-right tabular">{fmt(totals.net)}</td>
                  <td className="px-2 py-2 text-right tabular">{fmt(totals.gross)}</td>
                  <td className="px-2 py-2 text-right tabular">{fmt(totals.cbm, 3)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {s.errors?.lines && <p className="text-xs text-bad">{s.errors.lines[0]}</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            {HEADER_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} htmlFor={`sh-${f.key}`} optional hint={f.hint} error={s.errors?.[f.key]}>
                <Input
                  id={`sh-${f.key}`}
                  type={f.type}
                  value={h[f.key]}
                  onChange={(e) => setH((x) => ({ ...x, [f.key]: e.target.value }))}
                />
              </Field>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Shipping marks" htmlFor="sh-marks" optional hint="Printed on the packing list as written">
              <Textarea
                id="sh-marks"
                value={h.marks}
                onChange={(e) => setH((x) => ({ ...x, marks: e.target.value }))}
                rows={3}
                className="min-h-0 font-mono text-xs"
              />
            </Field>
            <Field label="Notes" htmlFor="sh-notes" optional>
              <Textarea
                id="sh-notes"
                value={h.notes}
                onChange={(e) => setH((x) => ({ ...x, notes: e.target.value }))}
                rows={3}
                className="min-h-0"
              />
            </Field>
          </div>
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

/**
 * Moving a shipment along: Booked, Departed (date, note), Arrived, and handing
 * over the original documents. Gate refusals (inspect first, balance first) are
 * shown with what to do; a manager can go ahead by writing why.
 */
export function ShipmentSteps({
  status,
  released,
  today,
  setStatus,
  release,
  canOverride,
  shipGate,
  releaseGate,
  checklistHref,
  uid,
}: {
  status: "planned" | "booked" | "departed" | "arrived";
  released: boolean;
  today: string;
  setStatus: Action;
  release: Action;
  canOverride: boolean;
  shipGate: string | null;
  releaseGate: string | null;
  checklistHref: string;
  /** Keeps the field ids unique when several shipments are on the page. */
  uid: string;
}) {
  const hint = (gate: string | null) =>
    gate ? (
      <p className="text-xs text-warn">
        {gate}{" "}
        <a href={checklistHref} className="underline underline-offset-2">
          Open the checklist
        </a>
      </p>
    ) : null;
  return (
    <div className="contents">
      {status === "planned" && (
        <InlineAction label="Booked" action={setStatus} submitLabel="Mark as booked">
          {(s) => (
            <>
              <input type="hidden" name="to" value="booked" />
              <Field label="Booked on" htmlFor={`${uid}-booked-on`} optional hint="Today when empty" error={s.errors?.on}>
                <Input id={`${uid}-booked-on`} name="on" type="date" max={today} defaultValue={s.values?.on} />
              </Field>
              <NoteField id={`${uid}-booked-note`} state={s} canOverride={false} />
            </>
          )}
        </InlineAction>
      )}
      {(status === "planned" || status === "booked") && (
        <InlineAction label="Departed" variant="primary" action={setStatus} submitLabel="The goods have left">
          {(s) => (
            <>
              <input type="hidden" name="to" value="departed" />
              {!s.code && hint(shipGate)}
              <GateHelp state={s} canOverride={canOverride} reason={shipGate} />
              <Field
                label="Left on"
                htmlFor={`${uid}-departed-on`}
                optional
                hint="Today when empty (the date on the B/L)"
                error={s.errors?.on}
              >
                <Input id={`${uid}-departed-on`} name="on" type="date" max={today} defaultValue={s.values?.on} />
              </Field>
              <NoteField id={`${uid}-departed-note`} state={s} canOverride={canOverride} gated={!!shipGate} />
            </>
          )}
        </InlineAction>
      )}
      {status === "departed" && (
        <InlineAction label="Arrived" action={setStatus} submitLabel="Mark as arrived">
          {(s) => (
            <>
              <input type="hidden" name="to" value="arrived" />
              <Field label="Arrived on" htmlFor={`${uid}-arrived-on`} optional hint="Today when empty" error={s.errors?.on}>
                <Input id={`${uid}-arrived-on`} name="on" type="date" max={today} defaultValue={s.values?.on} />
              </Field>
              <NoteField id={`${uid}-arrived-note`} state={s} canOverride={false} />
            </>
          )}
        </InlineAction>
      )}
      {(status === "departed" || status === "arrived") && !released && (
        <InlineAction label="Original documents released" action={release} submitLabel="The documents were handed over">
          {(s) => (
            <>
              {!s.code && hint(releaseGate)}
              <GateHelp state={s} canOverride={canOverride} reason={releaseGate} />
              <Field label="Released on" htmlFor={`${uid}-released-on`} optional hint="Today when empty" error={s.errors?.on}>
                <Input id={`${uid}-released-on`} name="on" type="date" max={today} defaultValue={s.values?.on} />
              </Field>
              <NoteField
                id={`${uid}-released-note`}
                state={s}
                canOverride={canOverride}
                gated={!!releaseGate}
                label="Note (e.g. courier and tracking number)"
              />
            </>
          )}
        </InlineAction>
      )}
    </div>
  );
}
