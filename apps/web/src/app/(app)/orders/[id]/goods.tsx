"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { LINE_CONDITION_LABEL } from "@kebo/shared";
import { Button, Card, CardBody, CardHeader, cn, Field, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { LinePacking, OrderLineView } from "@/lib/types-orders";
import { ExcelMenu } from "@/components/sheets/excel-menu";
import { FileActions } from "@/components/common/file-actions";
import { EditableRows, EditButton, useFocusRow } from "@/components/common/edit-button";
import { OrderLines, PhoneLines } from "@/components/orders/order-lines";
import { headerKey, sheetNumber, type ReadSheet, type SheetSpec } from "@/lib/sheet-spec";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;


/** A goods line as the Excel files need it (dates already formatted by the page). */
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

/** Excel for the goods (export only), in the card's header. */
export function GoodsExcel({ lines }: { lines: GoodsLine[] }) {
  return <ExcelMenu noun="lines" exportSheet={() => goodsExport(lines)} />;
}

/** The goods lines with what came in, as a file. */
const goodsExport = (lines: GoodsLine[]): SheetSpec => ({
  name: "Goods from the factory",
  title: "Goods",
  columns: [
    { header: "No.", width: 7 },
    { header: "Goods", width: 48 },
    { header: "Model", width: 16 },
    { header: "Factory", width: 24 },
    { header: "Ordered", kind: "number", width: 11 },
    { header: "Unit", width: 9 },
    { header: "Came in", kind: "number", width: 11 },
    { header: "Status", width: 11 },
    { header: "Last came in", width: 14 },
  ],
  rows: lines.map((l) => [
    l.no,
    l.description,
    l.model,
    l.factory,
    Number(l.quantity),
    l.unit,
    Number(l.receivedQty),
    STATE[stateOf(Number(l.receivedQty), Number(l.quantity))].label,
    Number(l.receivedQty) > 0 ? l.receivedOn : null,
  ]),
});

/** What reached the customer, line by line, as a file (export only). */
export function DeliveredExcel({ lines }: { lines: OrderLineView[] }) {
  return (
    <ExcelMenu
      noun="lines"
      exportSheet={() => ({
        name: "Delivered to the customer",
        title: "Delivered",
        columns: [
          { header: "No.", width: 7 },
          { header: "Goods", width: 48 },
          { header: "Model", width: 16 },
          { header: "Ordered", kind: "number", width: 11 },
          { header: "Unit", width: 9 },
          { header: "Delivered", kind: "number", width: 11 },
          { header: "Condition", width: 14 },
          { header: "Note", width: 40 },
        ],
        rows: lines.map((l) => [
          l.no,
          l.description,
          l.model,
          Number(l.quantity),
          l.unit,
          Number(l.delivered?.qty ?? 0),
          l.delivered?.condition ? LINE_CONDITION_LABEL[l.delivered.condition] : null,
          l.delivered?.note ?? null,
        ]),
      })}
    />
  );
}

type GoodsState = "waiting" | "partly" | "in";
const stateOf = (got: number, of: number): GoodsState => (got >= of ? "in" : got > 0 ? "partly" : "waiting");
const STATE: Record<GoodsState, { label: string; tone: "neutral" | "warn" | "ok" }> = {
  waiting: { label: "Waiting", tone: "neutral" },
  partly: { label: "Partly in", tone: "warn" },
  in: { label: "All in", tone: "ok" },
};

/* ---------------------------------------------------------------- packing list */

interface PackRow {
  lineId: string;
  packages: string;
  packageType: string;
  netWeightKg: string;
  grossWeightKg: string;
  cbm: string;
}

const FIELDS: { key: Exclude<keyof PackRow, "lineId">; label: string; mode: "numeric" | "decimal" | "text"; width: string; digits?: number }[] = [
  { key: "packages", label: "Packages", mode: "numeric", width: "6rem", digits: 0 },
  { key: "packageType", label: "Package type", mode: "text", width: "8rem" },
  { key: "netWeightKg", label: "Net kg", mode: "decimal", width: "6.5rem" },
  { key: "grossWeightKg", label: "Gross kg", mode: "decimal", width: "6.5rem" },
  { key: "cbm", label: "CBM (m³)", mode: "decimal", width: "6.5rem", digits: 3 },
];

const sum = (rows: PackRow[], k: keyof PackRow) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);
const rowsOf = (lines: GoodsLine[]): PackRow[] =>
  lines.map((l) => ({
    lineId: l.id,
    packages: l.packing.packages === null ? "" : String(l.packing.packages),
    packageType: l.packing.packageType ?? "",
    netWeightKg: l.packing.netWeightKg === null ? "" : String(Number(l.packing.netWeightKg)),
    grossWeightKg: l.packing.grossWeightKg === null ? "" : String(Number(l.packing.grossWeightKg)),
    cbm: l.packing.cbm === null ? "" : String(Number(l.packing.cbm)),
  }));
const withDefaults = (rows: PackRow[]) => rows.map((r) => ({ ...r, packageType: r.packageType || "Carton" }));

/** The packing list as a file: the goods, then the packing columns (a template has them to fill in). */
function packingSheet(lines: GoodsLine[], rows: PackRow[], template: boolean): SheetSpec {
  const goods = lines.map((l, i) => [
    l.no,
    l.description,
    l.model,
    Number(l.quantity),
    l.unit,
    ...FIELDS.map((f) => (f.mode === "text" ? rows[i]![f.key] || null : rows[i]![f.key] === "" ? null : Number(rows[i]![f.key]))),
  ]);
  return {
    name: template ? "Packing list - template" : "Packing list",
    title: "Packing list",
    columns: [
      { header: "No.", width: 7, note: "the order's line number: keep it as it is" },
      { header: "Goods", width: 48 },
      { header: "Model", width: 16 },
      { header: "Qty", kind: "number", width: 10 },
      { header: "Unit", width: 9 },
      ...FIELDS.map((f) => ({
        header: f.label,
        kind: f.mode === "text" ? ("text" as const) : ("number" as const),
        width: 13,
        choices: f.key === "packageType" ? PACKAGE_TYPES : undefined,
        note: f.key === "packages" ? "a whole number" : f.key === "packageType" ? "pick one or type your own" : undefined,
      })),
    ],
    rows: goods,
    foot: template
      ? undefined
      : ["Total", null, null, null, null, sum(rows, "packages"), null, sum(rows, "netWeightKg"), sum(rows, "grossWeightKg"), sum(rows, "cbm")],
    template: template
      ? {
          help: [
            "Packing list: fill in the packing for each line of the order.",
            "Keep the No., Goods, Qty and Unit columns as they are: lines are matched by their No.",
            "Fill in Packages, Package type, Net kg, Gross kg and CBM, then upload the file with Excel › Upload a filled file.",
            "The packing list is filled in from the file to check; nothing is saved until you press Save the packing list.",
          ],
        }
      : undefined,
  };
}

const PACKAGE_TYPES = ["Carton", "Wooden case", "Pallet", "Crate", "Bag", "Drum", "Bundle", "Roll", "Nude"];

/** Other headings a factory's own packing list may use. */
const PACK_HEADINGS: Record<Exclude<keyof PackRow, "lineId">, string[]> = {
  packages: ["packages", "pkgs", "ctns", "cartons", "noofpackages", "qtyofpackages", "packagesqty"],
  packageType: ["packagetype", "packing", "packaging", "kindofpackages"],
  netWeightKg: ["netkg", "nw", "nwkg", "netweight", "netweightkg"],
  grossWeightKg: ["grosskg", "gw", "gwkg", "grossweight", "grossweightkg"],
  cbm: ["cbm", "cbmm3", "volume", "m3", "meas", "measurement"],
};

/** The packing typed in an uploaded file, line by line (matched by No.), and what could not be used. */
function packingFromSheet(read: ReadSheet, lines: GoodsLine[]): { fill: Map<string, Partial<PackRow>>; problems: string[]; error: string | null } {
  const keys = read.headers.map(headerKey);
  const noAt = keys.findIndex((k) => ["no", "sn", "sno", "itemno", "line", "lineno"].includes(k));
  const at = Object.fromEntries(
    Object.entries(PACK_HEADINGS).map(([field, names]) => [field, keys.findIndex((k) => names.includes(k))]),
  ) as Record<keyof typeof PACK_HEADINGS, number>;
  const fill = new Map<string, Partial<PackRow>>();
  const problems: string[] = [];
  if (noAt < 0) return { fill, problems, error: "No “No.” column in the file: lines are matched by their number. Download the template from Excel › Download a template." };
  if (Object.values(at).every((i) => i < 0)) return { fill, problems, error: "No packing columns (Packages, Net kg, Gross kg, CBM) in the file." };
  const byNo = new Map(lines.map((l) => [l.no, l]));
  read.rows.forEach((cells, r) => {
    const no = (cells[noAt] ?? "").trim().replace(/\.0+$/, "");
    const values = FIELDS.filter((f) => at[f.key] >= 0 && (cells[at[f.key]] ?? "").trim());
    if (!values.length) return;
    const line = byNo.get(no);
    if (!line) {
      problems.push(`Row ${r + 2}: no line ${no || "(empty No.)"} on this order`);
      return;
    }
    const got: Partial<PackRow> = {};
    for (const f of values) {
      const t = cells[at[f.key]]!.trim();
      if (f.mode === "text") got[f.key] = t.slice(0, 40);
      else {
        const v = sheetNumber(t);
        if (v === null || Number(v) < 0 || (f.mode === "numeric" && !Number.isInteger(Number(v)))) problems.push(`Row ${r + 2}, line ${no}: ${f.label} “${t}” is not ${f.mode === "numeric" ? "a whole number" : "a number"}`);
        else got[f.key] = v;
      }
    }
    fill.set(line.id, got);
  });
  if (!fill.size && !problems.length) return { fill, problems, error: "The file has no packing filled in." };
  return { fill, problems, error: null };
}


/* ---------------------------------------------------------------- the cards */

/** "Mark all received": every goods line in full, dated today (the bulk save). */
export function MarkAllReceived({ lines, action }: { lines: GoodsLine[]; action: Action }) {
  const payload = JSON.stringify({ lines: lines.map((l) => ({ lineId: l.id, receivedQty: Number(l.quantity) })) });
  return (
    <ActionForm action={action} className="contents">
      <input type="hidden" name="payload" value={payload} />
      <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
        <CheckCircle2 aria-hidden /> Mark all received
      </SubmitButton>
    </ActionForm>
  );
}

/**
 * The packing list card on Shipping: the order's lines with the packing
 * columns (each cell saved as it is typed), the totals, the container and the
 * shipping marks; Excel (export, and a filled template to upload until the
 * order ships), View / Print and the PDF at the top right as everywhere.
 */
export function PackingCard({
  title,
  description,
  badge,
  orderId,
  lines,
  goods,
  containerNo,
  containerHref,
  shippingMarks,
  canEdit,
  canUpload,
  action,
  marksAction,
  links,
  today,
  toggle,
}: {
  title: string;
  description?: string;
  badge: ReactNode;
  orderId: string;
  lines: OrderLineView[];
  goods: GoodsLine[];
  /** Shipment 1's container: shown here, changed on the shipment (`containerHref` lands there lit up). */
  containerNo: string | null;
  containerHref?: string;
  shippingMarks: string | null;
  canEdit: boolean;
  /** A filled template can be uploaded (until the order ships). */
  canUpload: boolean;
  action: Action;
  marksAction: Action;
  /** The paper's View / Print and PDF (once there is something on it). */
  links?: { view: string; pdf: string };
  today: string;
  /** Order v4's view: read-only until "Edit lines" ("#edit-lines" opens it); short text lines on a phone. */
  toggle?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  // The row clicked in the read-only lines: selected in the editor once it is open.
  const [row, setRow] = useState<number | null>(null);
  const tableBox = useRef<HTMLDivElement>(null);
  useFocusRow(editing ? row : null, tableBox, () => setRow(null));
  useEffect(() => {
    if (!toggle || !canEdit) return;
    const check = () => window.location.hash === "#edit-lines" && setEditing(true);
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [toggle, canEdit]);
  const editable = toggle ? canEdit && editing : canEdit;
  const [fromFile, setFromFile] = useState<{ file: string; rows: PackRow[]; filled: number; problems: string[]; error: string | null } | null>(null);
  const saved = rowsOf(goods);

  const upload = (read: ReadSheet, file: string) => {
    const r = packingFromSheet(read, goods);
    setFromFile({
      file,
      filled: r.fill.size,
      problems: r.problems,
      error: r.error,
      rows: withDefaults(saved.map((row) => ({ ...row, ...r.fill.get(row.lineId) }))),
    });
  };

  const excel = (
    <ExcelMenu
      noun="packing"
      template={canUpload ? () => packingSheet(goods, saved, true) : undefined}
      onUpload={canUpload ? upload : undefined}
      exportSheet={() => packingSheet(goods, saved, false)}
    />
  );

  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        actions={
          <>
            {badge}
            <FileActions excel={excel} viewHref={links?.view} pdfHref={links?.pdf} />
            {toggle &&
              canEdit &&
              (editing ? (
                <Button size="sm" variant="secondary" className="h-8 px-3 text-[13px]" onClick={() => setEditing(false)}>
                  Done
                </Button>
              ) : (
                <EditButton label="Edit lines" onClick={() => setEditing(true)} />
              ))}
          </>
        }
      />
      <CardBody className="flex flex-col gap-3">
        {fromFile && (
          <div role="status" className={cn("rounded-lg border p-3 text-sm", fromFile.error ? "border-bad/30 bg-bad-soft" : "border-primary/30 bg-primary-soft/20")}>
            <p className="font-medium">From {fromFile.file}</p>
            {fromFile.error ? (
              <p className="text-bad">{fromFile.error}</p>
            ) : (
              <p className="text-text-2">
                {fromFile.filled} line{fromFile.filled === 1 ? "" : "s"} filled in from the file. Save them to the packing list?
              </p>
            )}
            {fromFile.problems.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs text-bad">
                {fromFile.problems.slice(0, 20).map((p) => (
                  <li key={p}>{p}</li>
                ))}
                {fromFile.problems.length > 20 && <li>…and {fromFile.problems.length - 20} more</li>}
              </ul>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {!fromFile.error && fromFile.filled > 0 && (
                <ActionForm action={action} onDone={() => setFromFile(null)} className="contents">
                  <input
                    type="hidden"
                    name="payload"
                    value={JSON.stringify({ shippingMarks, lines: fromFile.rows })}
                  />
                  <SubmitButton size="xs" pendingText="Saving…">
                    Save {fromFile.filled} line{fromFile.filled === 1 ? "" : "s"}
                  </SubmitButton>
                </ActionForm>
              )}
              <Button size="xs" variant="ghost" onClick={() => setFromFile(null)}>
                {fromFile.error ? "Close" : "Cancel"}
              </Button>
            </div>
          </div>
        )}
        {toggle && !editing && (
          <div className="sm:hidden">
            <PhoneLines set="packing" lines={lines} />
          </div>
        )}
        <div ref={tableBox} className={cn(toggle && !editing && "max-sm:hidden")}>
          {toggle && canEdit && !editing ? (
            <EditableRows label="Click a row to change it" onRow={(n) => (setRow(n), setEditing(true))}>
              <OrderLines
                set="packing"
                orderId={orderId}
                lines={lines}
                canEdit={false}
                today={today}
                footer={<PackingMarks containerNo={containerNo} containerHref={containerHref} shippingMarks={shippingMarks} canEdit={false} action={marksAction} />}
              />
            </EditableRows>
          ) : (
            <OrderLines
              set="packing"
              orderId={orderId}
              lines={lines}
              canEdit={editable}
              today={today}
              footer={<PackingMarks containerNo={containerNo} containerHref={containerHref} shippingMarks={shippingMarks} canEdit={editable} action={marksAction} />}
            />
          )}
        </div>
      </CardBody>
    </Card>
  );
}

/** The container (the shipment's, read-only here) and the shipping marks, under the packing totals; "Change" opens the marks. */
function PackingMarks({
  containerNo,
  containerHref,
  shippingMarks,
  canEdit,
  action,
}: {
  containerNo: string | null;
  containerHref?: string;
  shippingMarks: string | null;
  canEdit: boolean;
  action: Action;
}) {
  const [editing, setEditing] = useState(false);
  const fromShipment = containerHref ? (
    <a href={containerHref} className="text-xs font-normal text-primary hover:underline">
      {containerNo ? "from Shipment 1 · change it there" : "add it on the shipment"}
    </a>
  ) : null;
  if (editing)
    return (
      <ActionForm action={action} onDone={() => setEditing(false)} className="flex flex-col gap-3 border-t border-line pt-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Container number</span>
            <span id="pk-container" className="flex min-h-9 flex-wrap items-center gap-x-2 rounded-md border border-line bg-surface-2/60 px-3 text-sm" aria-readonly="true">
              {containerNo ?? <span className="text-muted">—</span>}
            </span>
            {fromShipment}
          </div>
          <Field label="Shipping marks" htmlFor="pk-marks" optional hint="As printed on the cartons">
            <Textarea id="pk-marks" name="shippingMarks" rows={2} className="min-h-0" maxLength={2000} defaultValue={shippingMarks ?? ""} />
          </Field>
        </div>
        <div className="flex gap-2">
          <SubmitButton size="xs" pendingText="Saving…">
            Save
          </SubmitButton>
          <Button type="button" size="xs" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </ActionForm>
    );
  if (!containerNo && !shippingMarks && !canEdit) return null;
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1 border-t border-line pt-2 text-sm">
      <dl className="flex min-w-0 flex-wrap gap-x-6 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-1.5">
          <dt className="text-muted">Container</dt>
          <dd className="font-medium">{containerNo ?? <span className="text-muted">—</span>}</dd>
          {fromShipment && <dd>{fromShipment}</dd>}
        </div>
        <div className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 text-muted">Shipping marks</dt>
          <dd className="min-w-0 font-medium whitespace-pre-line">{shippingMarks ?? <span className="text-muted">—</span>}</dd>
        </div>
      </dl>
      {canEdit && <EditButton size="xs" label="Change" onClick={() => setEditing(true)} />}
    </div>
  );
}
