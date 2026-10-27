"use client";

import { useState, type ReactNode } from "react";
import { CheckCircle2, Download, PackageCheck, Pencil, Printer } from "lucide-react";
import { Button, buttonClass, cn, Field, Input, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { LinePacking } from "@/lib/types-orders";
import { Sheet } from "@/components/lines/sheet";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const framed = "flex flex-col gap-3 rounded-lg border border-line bg-surface-2/60 p-3";
const n = (v: string | number, digits = 2) => Number(v).toLocaleString("en-US", { maximumFractionDigits: digits });
/** The first line of a description (the rest is the specification). */
const head = (d: string) => d.split("\n")[0] ?? d;

/** A goods line as the two cards need it (dates already formatted by the page). */
export interface GoodsLine {
  /** "1", "2", "2.1" */
  no: string;
  id: string;
  description: string;
  model: string | null;
  quantity: string;
  unit: string;
  factory: string | null;
  receivedQty: string;
  receivedOn: string | null;
  packing: LinePacking;
}

/* ---------------------------------------------------------------- goods from the factory */

/**
 * What came in from the factory, line by line, with a small progress bar.
 * "Record what came in" opens one number per line (the total so far);
 * "Mark all received" fills every line in one click.
 */
export function GoodsReceipt({ lines, canEdit, action, today }: { lines: GoodsLine[]; canEdit: boolean; action: Action; today: string }) {
  const [editing, setEditing] = useState(false);
  const allIn = lines.every((l) => Number(l.receivedQty) >= Number(l.quantity));
  const all = JSON.stringify({ on: today, lines: lines.map((l) => ({ lineId: l.id, receivedQty: Number(l.quantity) })) });

  const rows = (input?: (l: GoodsLine, i: number) => ReactNode) => (
    <ul className="flex flex-col divide-y divide-line rounded-lg border border-line" aria-label="Goods lines">
      {lines.map((l, i) => {
        const got = Number(l.receivedQty);
        const of = Number(l.quantity);
        const pct = of > 0 ? Math.min(100, Math.round((got / of) * 100)) : 0;
        const done = got >= of;
        return (
          <li key={l.id} className="flex flex-col gap-1.5 px-3 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium break-words">
                  <span className="mr-1.5 text-muted tabular">{l.no}</span>
                  {head(l.description)}
                </p>
                <p className="text-xs text-muted">
                  {[l.model && `Model ${l.model}`, l.factory && `from ${l.factory}`].filter(Boolean).join(" · ") || "Factory not recorded"}
                </p>
              </div>
              <p className={cn("shrink-0 text-sm tabular", done ? "font-medium text-ok" : "text-text-2")}>
                {n(got)} / {n(of)} {l.unit}
              </p>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-surface-3"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={of}
              aria-valuenow={got}
              aria-label={`${head(l.description)}: ${n(got)} of ${n(of)} ${l.unit} received`}
            >
              <div className={cn("h-full rounded-full", done ? "bg-ok" : "bg-primary")} style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-muted">
              {got > 0 && l.receivedOn ? `${done ? "All in" : "Last came in"} on ${l.receivedOn}` : "Nothing in yet"}
            </p>
            {input?.(l, i)}
          </li>
        );
      })}
    </ul>
  );

  if (!canEdit || !editing)
    return (
      <div className="flex flex-col gap-3">
        {rows()}
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {!allIn && (
              <ActionForm action={action} className="contents">
                <input type="hidden" name="payload" value={all} />
                <input type="hidden" name="all" value="true" />
                <SubmitButton size="sm" pendingText="Saving…">
                  <CheckCircle2 aria-hidden /> Mark all received
                </SubmitButton>
              </ActionForm>
            )}
            <Button size="sm" variant={allIn ? "ghost" : "secondary"} onClick={() => setEditing(true)}>
              <Pencil aria-hidden /> {allIn ? "Change" : "Record what came in"}
            </Button>
          </div>
        )}
      </div>
    );
  return <ReceiptForm lines={lines} action={action} today={today} close={() => setEditing(false)} />;
}

function ReceiptForm({ lines, action, today, close }: { lines: GoodsLine[]; action: Action; today: string; close: () => void }) {
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, String(Number(l.receivedQty))])));
  const [on, setOn] = useState(today);
  const payload = JSON.stringify({ on, lines: lines.map((l) => ({ lineId: l.id, receivedQty: qty[l.id] ?? "" })) });
  return (
    <ActionForm action={action} onDone={close} className={framed}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">How many have come in so far, in total?</p>
        <Button type="button" size="xs" variant="ghost" onClick={() => setQty(Object.fromEntries(lines.map((l) => [l.id, String(Number(l.quantity))])))}>
          <CheckCircle2 aria-hidden /> Everything ordered
        </Button>
      </div>
      <input type="hidden" name="payload" value={payload} />
      <Sheet
        label="Goods that came in"
        rows={lines}
        rowKey={(l) => l.id}
        rowNo={(l) => l.no}
        onChange={(i, _k, v) => setQty((q) => ({ ...q, [lines[i]!.id]: v }))}
        columns={[
          { key: "goods", label: "Goods", show: (l) => <span className="line-clamp-2 text-text">{head(l.description)}</span> },
          { key: "factory", label: "Factory", width: "10rem", show: (l) => <span className="truncate">{l.factory ?? "—"}</span> },
          { key: "ordered", label: "Ordered", width: "7rem", align: "right", show: (l) => `${n(l.quantity)} ${l.unit}` },
          {
            key: "received",
            label: "Came in so far",
            width: "8rem",
            align: "right",
            input: "number",
            maxLength: 14,
            value: (l) => qty[l.id] ?? "",
            aria: (l) => `${head(l.description)}: came in so far (${l.unit})`,
          },
        ]}
      />
      <Field label="Date" htmlFor="rcv-on" hint="When these came in">
        <Input id="rcv-on" type="date" max={today} className="w-44" value={on} onChange={(e) => setOn(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <SubmitButton size="sm" pendingText="Saving…">
          Save what came in
        </SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={close}>
          Cancel
        </Button>
      </div>
    </ActionForm>
  );
}

/* ---------------------------------------------------------------- packing list */

interface PackRow {
  lineId: string;
  packages: string;
  packageType: string;
  netWeightKg: string;
  grossWeightKg: string;
  cbm: string;
}

const FIELDS: {
  key: Exclude<keyof PackRow, "lineId">;
  label: string;
  short: string;
  span: string;
  mode: "numeric" | "decimal" | "text";
}[] = [
  { key: "packages", label: "Packages", short: "Pkgs", span: "col-span-2", mode: "numeric" },
  { key: "packageType", label: "Package type", short: "Type", span: "col-span-4", mode: "text" },
  { key: "netWeightKg", label: "Net kg", short: "Net kg", span: "col-span-2", mode: "decimal" },
  { key: "grossWeightKg", label: "Gross kg", short: "Gross kg", span: "col-span-2", mode: "decimal" },
  { key: "cbm", label: "CBM (m³)", short: "CBM", span: "col-span-2", mode: "decimal" },
];

const sum = (rows: PackRow[], k: keyof PackRow) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);

/**
 * The packing list: packages, type, weights and volume per goods line, the
 * container and the shipping marks. Once every line has its packages it is
 * "ready" (green) with the document's View / Print and PDF links.
 */
export function PackingList({
  lines,
  containerNo,
  shippingMarks,
  packed,
  totals,
  canEdit,
  action,
  links,
}: {
  lines: GoodsLine[];
  containerNo: string | null;
  shippingMarks: string | null;
  packed: boolean;
  totals: { packages: number; netWeightKg: string; grossWeightKg: string; cbm: string };
  canEdit: boolean;
  action: Action;
  links: { view: string; pdf: string };
}) {
  // Not made yet: the form is open. Made: the green "ready" panel, with "Change" to reopen the form.
  const [editing, setEditing] = useState(false);
  const summary = [
    `${n(totals.packages, 0)} package${totals.packages === 1 ? "" : "s"}`,
    Number(totals.netWeightKg) ? `net ${n(totals.netWeightKg)} kg` : null,
    Number(totals.grossWeightKg) ? `gross ${n(totals.grossWeightKg)} kg` : null,
    Number(totals.cbm) ? `${n(totals.cbm, 3)} m³` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const docLinks = (
    <span className="flex flex-wrap gap-2">
      <a href={links.view} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>
        <Printer aria-hidden /> View / Print
      </a>
      <a href={links.pdf} className={buttonClass("ghost", "sm")}>
        <Download aria-hidden /> Download PDF
      </a>
    </span>
  );

  if (packed && !(editing && canEdit))
    return (
      <div className="flex flex-col gap-3">
        <div role="status" className="flex flex-col gap-2 rounded-lg border border-ok/30 bg-ok-soft p-3 text-sm">
          <p className="flex items-start gap-2">
            <PackageCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
            <span>
              <span className="block font-medium text-ok">Packing list ready</span>
              <span className="block text-text-2 tabular">{summary}</span>
              {containerNo && <span className="block text-text-2">Container {containerNo}</span>}
            </span>
          </p>
          {docLinks}
        </div>
        {canEdit && (
          <div>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil aria-hidden /> Change the packing list
            </Button>
          </div>
        )}
      </div>
    );
  if (!canEdit)
    return <p className="text-sm text-muted">{totals.packages > 0 ? `Started, not complete: ${summary}.` : "Not filled in yet."}</p>;
  return (
    <PackingForm
      lines={lines}
      containerNo={containerNo}
      shippingMarks={shippingMarks}
      packed={packed}
      action={action}
      close={() => setEditing(false)}
      started={totals.packages > 0}
    />
  );
}

function PackingForm({
  lines,
  containerNo,
  shippingMarks,
  packed,
  started,
  action,
  close,
}: {
  lines: GoodsLine[];
  containerNo: string | null;
  shippingMarks: string | null;
  packed: boolean;
  started: boolean;
  action: Action;
  close: () => void;
}) {
  const [rows, setRows] = useState<PackRow[]>(() =>
    lines.map((l) => ({
      lineId: l.id,
      packages: l.packing.packages === null ? "" : String(l.packing.packages),
      packageType: l.packing.packageType ?? "Carton",
      netWeightKg: l.packing.netWeightKg === null ? "" : String(Number(l.packing.netWeightKg)),
      grossWeightKg: l.packing.grossWeightKg === null ? "" : String(Number(l.packing.grossWeightKg)),
      cbm: l.packing.cbm === null ? "" : String(Number(l.packing.cbm)),
    })),
  );
  const [container, setContainer] = useState(containerNo ?? "");
  const [marks, setMarks] = useState(shippingMarks ?? "");
  const set = (i: number, k: keyof PackRow, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const payload = JSON.stringify({ containerNo: container, shippingMarks: marks, lines: rows });
  const total = {
    packages: sum(rows, "packages"),
    net: sum(rows, "netWeightKg"),
    gross: sum(rows, "grossWeightKg"),
    cbm: sum(rows, "cbm"),
  };
  const missing = rows.filter((r) => !(Number(r.packages) > 0)).length;

  return (
    <ActionForm action={action} onDone={close} className="flex flex-col gap-3">
      <input type="hidden" name="payload" value={payload} />
      {started && !packed && <p className="text-xs text-warn">Not complete yet: every line needs its number of packages.</p>}
      <Sheet
        label="Packing list"
        rows={lines}
        rowKey={(l) => l.id}
        rowNo={(l) => l.no}
        onChange={(i, k, v) => set(i, k as keyof PackRow, v)}
        columns={[
          {
            key: "goods",
            label: "Goods",
            show: (l) => (
              <span className="block min-w-0">
                <span className="line-clamp-1 text-text">{head(l.description)}</span>
                <span className="text-xs text-muted tabular">
                  {n(l.quantity)} {l.unit}
                </span>
              </span>
            ),
          },
          ...FIELDS.map((f) => ({
            key: f.key,
            label: f.label,
            width: f.mode === "text" ? "8rem" : "6.5rem",
            align: f.mode === "text" ? undefined : ("right" as const),
            input: f.mode === "text" ? ("text" as const) : ("number" as const),
            maxLength: f.mode === "text" ? 40 : 14,
            value: (l: GoodsLine) => rows[lines.indexOf(l)]![f.key],
            aria: (l: GoodsLine) => `${head(l.description)}: ${f.label}`,
          })),
        ]}
        foot={["Total", n(total.packages, 0), "", n(total.net), n(total.gross), n(total.cbm, 3)]}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Container number" htmlFor="pk-container" optional>
          <Input
            id="pk-container"
            maxLength={120}
            value={container}
            onChange={(e) => setContainer(e.target.value)}
            placeholder="e.g. TGHU 123456-7"
          />
        </Field>
        <Field label="Shipping marks" htmlFor="pk-marks" optional hint="As printed on the cartons">
          <Textarea id="pk-marks" rows={2} className="min-h-0" maxLength={2000} value={marks} onChange={(e) => setMarks(e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton size="sm" pendingText="Saving…">
          Save the packing list
        </SubmitButton>
        {packed && (
          <Button type="button" size="sm" variant="ghost" onClick={close}>
            Cancel
          </Button>
        )}
        {missing > 0 && (
          <span className="text-xs text-muted">
            {missing === rows.length
              ? "Fill in the packages for each line."
              : `${missing} line${missing === 1 ? "" : "s"} still without packages.`}
          </span>
        )}
      </div>
    </ActionForm>
  );
}
