"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { caseVolume } from "@kebo/shared";
import { Button, Input, Select } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PANEL_FORM, PanelBody, WindowFooter } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";
import type { LineCase } from "@/lib/types-orders";

/**
 * The packing package by package (design "papers in the customer's format", 25 Nov 2026; "packing for machines"
 * the same day): under each item its rows as the packing list prints them — the package number as marked, how
 * many identical packages, how they are packed, what is in it, each one's size in mm and the row's weights, and,
 * when the order goes in more than one shipment, which one takes it. The volume is worked out from the size
 * (else typed); the item's totals follow.
 */

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** One row as typed (the inputs' strings). */
export interface CaseDraft {
  key: string;
  caseNo: string;
  count: string;
  packageType: string;
  lengthMm: string;
  widthMm: string;
  heightMm: string;
  netWeightKg: string;
  grossWeightKg: string;
  cbm: string;
  contents: string;
  /** The shipment that takes it ("": not given to one). */
  shipmentId: string;
}

export const CASE_FIELDS = ["caseNo", "count", "packageType", "contents", "lengthMm", "widthMm", "heightMm", "netWeightKg", "grossWeightKg", "cbm"] as const;
export type CaseField = (typeof CASE_FIELDS)[number];

/** How the packing list names each field (the editor, the Excel file). */
export const CASE_LABEL: Record<CaseField, string> = {
  caseNo: "Package No.",
  count: "Packages",
  packageType: "Packed in",
  contents: "What is in it",
  lengthMm: "L (mm)",
  widthMm: "W (mm)",
  heightMm: "H (mm)",
  netWeightKg: "Net kg",
  grossWeightKg: "Gross kg",
  cbm: "CBM (m³)",
};

/** The usual ways goods are packed (any other can be typed). */
export const PACKAGE_TYPES = ["Carton", "Wooden case", "Fumigated wooden case (IPPC)", "Pallet", "Crate", "Bag", "Drum", "Bundle", "Roll", "Nude"];

let seq = 0;
export const caseKey = () => `c${++seq}`;
const text = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(Number(v)));

export const draftOf = (c: LineCase): CaseDraft => ({
  key: caseKey(),
  caseNo: c.caseNo ?? "",
  count: String(c.count || 1),
  packageType: c.packageType,
  lengthMm: text(c.lengthMm),
  widthMm: text(c.widthMm),
  heightMm: text(c.heightMm),
  netWeightKg: text(c.netWeightKg),
  grossWeightKg: text(c.grossWeightKg),
  cbm: text(c.cbm),
  contents: c.contents ?? "",
  shipmentId: c.shipmentId ?? "",
});

/** A new row: the one above's packing, size and shipment (identical packages are the usual), else a carton. */
const nextDraft = (above?: CaseDraft): CaseDraft => ({
  key: caseKey(),
  caseNo: "",
  count: "1",
  packageType: above?.packageType || "Carton",
  lengthMm: above?.lengthMm ?? "",
  widthMm: above?.widthMm ?? "",
  heightMm: above?.heightMm ?? "",
  netWeightKg: "",
  grossWeightKg: "",
  cbm: "",
  contents: "",
  shipmentId: above?.shipmentId ?? "",
});

const num = (v: string) => (v.trim() === "" ? null : Number(v));

/** As the API takes it (PUT /orders/:id/cases). */
export const caseInput = (d: CaseDraft) => ({
  caseNo: d.caseNo.trim() || null,
  count: d.count.trim() || "1",
  packageType: d.packageType.trim() || "Carton",
  lengthMm: d.lengthMm.trim() || null,
  widthMm: d.widthMm.trim() || null,
  heightMm: d.heightMm.trim() || null,
  netWeightKg: d.netWeightKg.trim() || null,
  grossWeightKg: d.grossWeightKg.trim() || null,
  cbm: d.cbm.trim() || null,
  contents: d.contents.trim() || null,
  shipmentId: d.shipmentId || null,
});

/** The row's volume: from the size when it is all there, else what was typed. */
export const draftVolume = (d: CaseDraft) =>
  caseVolume({ count: Number(d.count) || 1, lengthMm: num(d.lengthMm), widthMm: num(d.widthMm), heightMm: num(d.heightMm), cbm: num(d.cbm) });
const sized = (d: CaseDraft) => !!(num(d.lengthMm) && num(d.widthMm) && num(d.heightMm));

const fmt = (n: number, places: number) => n.toLocaleString("en-US", { maximumFractionDigits: places });

/** "2 packages · 6.713 m³ · net 700 kg · gross 850 kg" */
export function casesSummary(rows: CaseDraft[]) {
  const count = rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
  const cbm = rows.reduce((s, r) => s + (draftVolume(r) ?? 0), 0);
  const net = rows.reduce((s, r) => s + (num(r.netWeightKg) ?? 0), 0);
  const gross = rows.reduce((s, r) => s + (num(r.grossWeightKg) ?? 0), 0);
  return [
    `${count} package${count === 1 ? "" : "s"}`,
    cbm ? `${fmt(cbm, 3)} m³` : null,
    net ? `net ${fmt(net, 2)} kg` : null,
    gross ? `gross ${fmt(gross, 2)} kg` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export interface CaseItem {
  id: string;
  no: string;
  description: string;
  quantity: string;
  unit: string;
  cases: LineCase[];
}

/** The row's columns: number, packages, packed in, what is in it, L W H, net, gross, CBM, (shipment), remove. */
const COLS = "sm:grid-cols-[4.5rem_4rem_minmax(8rem,1fr)_minmax(8rem,1fr)_4.5rem_4.5rem_4.5rem_5rem_5rem_5rem_2rem]";
const COLS_SHIPMENT = "sm:grid-cols-[4.5rem_4rem_minmax(8rem,1fr)_minmax(8rem,1fr)_4.5rem_4.5rem_4.5rem_5rem_5rem_5rem_8rem_2rem]";
const MODE: Record<CaseField, "text" | "numeric" | "decimal"> = {
  caseNo: "text",
  count: "numeric",
  packageType: "text",
  contents: "text",
  lengthMm: "numeric",
  widthMm: "numeric",
  heightMm: "numeric",
  netWeightKg: "decimal",
  grossWeightKg: "decimal",
  cbm: "decimal",
};

/** A shipment a package can go in ("Shipment 2 · Air"). */
export interface CaseShipment {
  id: string;
  label: string;
}

/** The editor, in the packing card's window: every item with its packages, saved together. */
export function CasesEditor({
  items,
  shipments = [],
  action,
  onDone,
}: {
  items: CaseItem[];
  /** The order's shipments: with more than one, each package says which takes it. */
  shipments?: CaseShipment[];
  action: Action;
  onDone: () => void;
}) {
  const many = shipments.length > 1;
  const cols = many ? COLS_SHIPMENT : COLS;
  const [rows, setRows] = useState<Record<string, CaseDraft[]>>(() => Object.fromEntries(items.map((i) => [i.id, i.cases.map(draftOf)])));
  const set = (id: string, next: CaseDraft[]) => setRows((r) => ({ ...r, [id]: next }));
  const all = items.flatMap((i) => rows[i.id] ?? []);
  const payload = JSON.stringify({ lines: items.map((i) => ({ lineId: i.id, cases: (rows[i.id] ?? []).map(caseInput) })) });
  return (
    <ActionForm action={action} onDone={onDone} className={PANEL_FORM}>
      <input type="hidden" name="payload" value={payload} />
      <PanelBody className="gap-5">
        <datalist id="case-package-types">
          {PACKAGE_TYPES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        {items.map((item) => {
          const list = rows[item.id] ?? [];
          const change = (key: string, field: CaseField | "shipmentId", value: string) => set(item.id, list.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
          return (
            <section key={item.id} aria-label={`Item ${item.no}`} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h3 className="text-md font-semibold">
                  <span className="text-text-2">{item.no}</span> {item.description.split(/\r?\n/)[0]}
                </h3>
                <span className="text-xs text-text-2">
                  {Number(item.quantity).toLocaleString("en-US")} {item.unit}
                  {list.length > 0 && ` · ${casesSummary(list)}`}
                </span>
              </div>
              {list.length > 0 && (
                <div role="table" aria-label={`Packages of item ${item.no}`} className="flex flex-col gap-2">
                  <div role="row" className={`hidden gap-2 text-xs text-text-2 sm:grid ${cols}`}>
                    {CASE_FIELDS.map((f) => (
                      <span key={f} role="columnheader" className={MODE[f] === "text" ? undefined : "text-right"}>
                        {CASE_LABEL[f]}
                      </span>
                    ))}
                    {many && <span role="columnheader">Shipment</span>}
                    <span />
                  </div>
                  {list.map((r, n) => {
                    const net = num(r.netWeightKg);
                    const gross = num(r.grossWeightKg);
                    const volume = draftVolume(r);
                    return (
                      <div key={r.key} role="row" className={`grid grid-cols-3 gap-2 rounded-lg border border-line p-2 sm:border-0 sm:p-0 ${cols}`}>
                        {CASE_FIELDS.map((f) =>
                          f === "cbm" && sized(r) ? (
                            // Worked out from the size: shown, not typed.
                            <span key={f} role="cell" className="flex flex-col justify-center text-right text-md tabular">
                              <span className="text-xs text-text-2 sm:sr-only">{CASE_LABEL[f]}</span>
                              {volume !== null ? fmt(volume, 3) : ""}
                            </span>
                          ) : (
                            <label key={f} role="cell" className={f === "packageType" || f === "contents" ? "col-span-3 flex flex-col sm:col-span-1" : "flex flex-col"}>
                              <span className="text-xs text-text-2 sm:sr-only">
                                {CASE_LABEL[f]}
                                <span className="sr-only">{` (package ${n + 1})`}</span>
                              </span>
                              <Input
                                size="sm"
                                value={r[f]}
                                inputMode={MODE[f] === "text" ? undefined : MODE[f]}
                                list={f === "packageType" ? "case-package-types" : undefined}
                                maxLength={f === "caseNo" ? 20 : f === "packageType" ? 80 : f === "contents" ? 120 : 12}
                                aria-invalid={f === "grossWeightKg" && net !== null && gross !== null && net > gross ? true : undefined}
                                className={MODE[f] === "text" ? undefined : "text-right tabular"}
                                onChange={(e) =>
                                  change(r.key, f, MODE[f] === "text" ? e.target.value : e.target.value.replace(MODE[f] === "numeric" ? /\D/g : /[^\d.]/g, ""))
                                }
                              />
                            </label>
                          ),
                        )}
                        {many && (
                          <label role="cell" className="col-span-3 flex flex-col sm:col-span-1">
                            <span className="text-xs text-text-2 sm:sr-only">
                              Shipment<span className="sr-only">{` (package ${n + 1})`}</span>
                            </span>
                            <Select size="sm" value={r.shipmentId} onChange={(e) => change(r.key, "shipmentId", e.target.value)}>
                              <option value="">Not given yet</option>
                              {shipments.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.label}
                                </option>
                              ))}
                            </Select>
                          </label>
                        )}
                        <span role="cell" className="col-span-3 flex justify-end sm:col-span-1 sm:items-center">
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            aria-label={`Remove package row ${n + 1} of item ${item.no}`}
                            onClick={() => set(item.id, list.filter((x) => x.key !== r.key))}
                          >
                            <X aria-hidden />
                            <span className="sm:hidden">Remove</span>
                          </Button>
                        </span>
                        {net !== null && gross !== null && net > gross && (
                          <p className="col-span-full text-xs text-bad">The gross weight is less than the net.</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div>
                <Button type="button" size="xs" variant="ghost" onClick={() => set(item.id, [...list, nextDraft(list.at(-1))])}>
                  <Plus aria-hidden /> Add a package
                </Button>
              </div>
            </section>
          );
        })}
      </PanelBody>
      <WindowFooter className="justify-end gap-x-3 gap-y-2" outside>
        <span className="mr-auto min-w-0 flex-[1_1_9rem] text-xs text-text-2">{all.length ? casesSummary(all) : "No packages yet"}</span>
        <SubmitButton pendingText="Saving…">Save the packing</SubmitButton>
      </WindowFooter>
    </ActionForm>
  );
}
