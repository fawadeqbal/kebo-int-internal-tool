"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, CardBody, CardHeader, cn, RULES, linkClass, Dash } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { LinePacking, OrderLineView } from "@/lib/types-orders";
import { ExcelMenu } from "@/components/sheets/excel-menu";
import { FileActions } from "@/components/common/file-actions";
import { EditButton } from "@/components/common/edit-button";
import { SidePanel } from "@/components/common/panel";
import { EditsChip, editedMark } from "@/components/edits/edits";
import { OrderLinesView } from "@/components/orders/order-lines";
import {
  CASE_FIELDS,
  CASE_LABEL,
  caseInput,
  caseKey,
  CasesEditor,
  type CaseShipment,
  draftOf,
  draftVolume,
  PACKAGE_TYPES,
  type CaseDraft,
  type CaseField,
} from "@/components/orders/cases-editor";
import { FieldsForm } from "@/components/orders/step-view";
import type { EditCard, EditRef, EditsView } from "@/lib/types-edits";
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

/* ---------------------------------------------------------------- packing list */

/** The packing list as a file: a row per case under each item (an item not packed yet: one row to fill in). */
function packingSheet(lines: GoodsLine[], template: boolean): SheetSpec {
  const rows = lines.flatMap((l) => {
    const cases = l.packing.cases?.length ? l.packing.cases.map(draftOf) : [null];
    return cases.map((c, n) => [
      l.no,
      n === 0 ? l.description : null,
      n === 0 ? l.model : null,
      n === 0 ? Number(l.quantity) : null,
      n === 0 ? l.unit : null,
      ...CASE_FIELDS.map((f) => (!c || c[f] === "" ? null : MODE_OF[f] === "text" ? c[f] : Number(f === "cbm" ? (draftVolume(c) ?? c[f]) : c[f]))),
    ]);
  });
  const total = (k: "packages" | "netWeightKg" | "grossWeightKg" | "cbm") => lines.reduce((t, l) => t + (Number(l.packing[k]) || 0), 0);
  return {
    name: template ? "Packing list - template" : "Packing list",
    title: "Packing list",
    columns: [
      { header: "No.", width: 7, note: "the order's item number: keep it, and repeat it on each of the item's cases" },
      { header: "Goods", width: 44 },
      { header: "Model", width: 14 },
      { header: "Quantity", kind: "number", width: 10 },
      { header: "Unit", width: 9 },
      ...CASE_FIELDS.map((f) => ({
        header: CASE_LABEL[f],
        kind: MODE_OF[f] === "text" ? ("text" as const) : ("number" as const),
        width: f === "packageType" || f === "contents" ? 22 : 10,
        choices: f === "packageType" ? PACKAGE_TYPES : undefined,
        note:
          f === "count"
            ? "how many identical packages on this row"
            : f === "packageType"
              ? "pick one or type your own"
              : f === "cbm"
                ? "worked out from L × W × H when they are given"
                : f === "lengthMm"
                  ? "each package's size, in mm"
                  : f === "contents"
                    ? "when an item takes more than one package: Main body, Feeder…"
                    : undefined,
      })),
    ],
    rows,
    foot: template ? undefined : ["Total", null, null, null, null, null, total("packages"), null, null, null, null, null, total("netWeightKg"), total("grossWeightKg"), total("cbm")],
    template: template
      ? {
          help: [
            "Packing list: fill in the packing of each item, a row per package (or per group of identical packages).",
            "Keep the No. column: items are matched by their number. For an item in more packages, add a row under it with the same No.",
            "Fill in Package No., Packages, Packed in, What is in it, the size (L, W, H in mm), Net kg and Gross kg; the CBM is worked out from the size.",
            "Upload the file with Excel › Upload a filled file. Nothing is saved until you press Save.",
          ],
        }
      : undefined,
  };
}

const MODE_OF: Record<CaseField, "text" | "number"> = {
  caseNo: "text",
  count: "number",
  packageType: "text",
  contents: "text",
  lengthMm: "number",
  widthMm: "number",
  heightMm: "number",
  netWeightKg: "number",
  grossWeightKg: "number",
  cbm: "number",
};

/** Other headings a factory's own packing list may use. */
const PACK_HEADINGS: Record<CaseField, string[]> = {
  caseNo: ["caseno", "case", "cno", "caseno.", "boxno", "packageno", "cartonno", "ctnno", "markno"],
  count: ["cases", "packages", "pkgs", "ctns", "cartons", "noofpackages", "qtyofpackages", "packagesqty", "noofcases"],
  packageType: ["packedin", "packagetype", "package", "packing", "packaging", "kindofpackages"],
  contents: ["whatisinit", "contents", "content", "inside", "partname", "part"],
  lengthMm: ["lmm", "l", "length", "lengthmm"],
  widthMm: ["wmm", "w", "width", "widthmm"],
  heightMm: ["hmm", "h", "height", "heightmm"],
  netWeightKg: ["netkg", "nw", "nwkg", "netweight", "netweightkg"],
  grossWeightKg: ["grosskg", "gw", "gwkg", "grossweight", "grossweightkg"],
  cbm: ["cbm", "cbmm3", "volume", "m3", "meas", "measurement"],
};

/** The cases typed in an uploaded file, grouped by item (rows matched by No.), and what could not be used. */
function packingFromSheet(read: ReadSheet, lines: GoodsLine[]): { fill: Map<string, CaseDraft[]>; problems: string[]; error: string | null } {
  const keys = read.headers.map(headerKey);
  const noAt = keys.findIndex((k) => ["no", "sn", "sno", "itemno", "line", "lineno"].includes(k));
  const at = Object.fromEntries(CASE_FIELDS.map((f) => [f, keys.findIndex((k) => PACK_HEADINGS[f].includes(k))])) as Record<CaseField, number>;
  const fill = new Map<string, CaseDraft[]>();
  const problems: string[] = [];
  if (noAt < 0) return { fill, problems, error: "No “No.” column in the file: items are matched by their number. Download the template from Excel › Download a template." };
  if (CASE_FIELDS.every((f) => at[f] < 0)) return { fill, problems, error: "No packing columns (Packages, Packed in, sizes, Net kg, Gross kg, CBM) in the file." };
  const byNo = new Map(lines.map((l) => [l.no, l]));
  read.rows.forEach((cells, r) => {
    const no = (cells[noAt] ?? "").trim().replace(/\.0+$/, "");
    const given = CASE_FIELDS.filter((f) => at[f] >= 0 && (cells[at[f]] ?? "").trim());
    if (!given.length) return;
    const line = byNo.get(no);
    if (!line) {
      problems.push(`Row ${r + 2}: no item ${no || "(empty No.)"} on this order`);
      return;
    }
    // The file says nothing of shipments: an item whose packages all went in one stays in it.
    const was = line.packing.cases ?? [];
    const shipmentId = was.length && was.every((c) => c.shipmentId && c.shipmentId === was[0]!.shipmentId) ? was[0]!.shipmentId! : "";
    const d: CaseDraft = {
      key: caseKey(),
      caseNo: "",
      count: "1",
      packageType: "Carton",
      contents: "",
      lengthMm: "",
      widthMm: "",
      heightMm: "",
      netWeightKg: "",
      grossWeightKg: "",
      cbm: "",
      shipmentId,
    };
    for (const f of given) {
      const t = cells[at[f]]!.trim();
      if (MODE_OF[f] === "text") d[f] = t.slice(0, f === "caseNo" ? 20 : f === "contents" ? 120 : 80);
      else {
        const v = sheetNumber(t);
        const whole = f === "count" || f === "lengthMm" || f === "widthMm" || f === "heightMm";
        if (v === null || Number(v) < 0 || (whole && !Number.isInteger(Number(v)))) problems.push(`Row ${r + 2}, item ${no}: ${CASE_LABEL[f]} “${t}” is not ${whole ? "a whole number" : "a number"}`);
        else d[f] = String(v);
      }
    }
    fill.set(line.id, [...(fill.get(line.id) ?? []), d]);
  });
  if (!fill.size && !problems.length) return { fill, problems, error: "The file has no packing filled in." };
  return { fill, problems, error: null };
}

/* ---------------------------------------------------------------- the cards */

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
  edits,
  shipments,
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
  /** The order's saved edits ("Edited n×" on the lines and the marks). */
  edits?: EditsView;
  /** The order's shipments: with more than one, each package says which takes it. */
  shipments?: CaseShipment[];
}) {
  // Read only, always: "Edit lines" opens them in the edit panel ("#edit-lines" too).
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!canEdit) return;
    const check = () => window.location.hash === "#edit-lines" && setEditing(true);
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [canEdit]);
  const closeEditor = () => {
    setEditing(false);
    if (window.location.hash === "#edit-lines") history.replaceState(null, "", window.location.pathname + window.location.search);
  };
  const ref = (card: string) => ({ type: "order" as const, id: orderId, card });
  const [fromFile, setFromFile] = useState<{ file: string; cases: Map<string, CaseDraft[]>; problems: string[]; error: string | null } | null>(null);

  const upload = (read: ReadSheet, file: string) => {
    const r = packingFromSheet(read, goods);
    setFromFile({ file, cases: r.fill, problems: r.problems, error: r.error });
  };
  const filled = fromFile?.cases.size ?? 0;

  const excel = (
    <ExcelMenu
      noun="packing"
      template={canUpload ? () => packingSheet(goods, true) : undefined}
      onUpload={canUpload ? upload : undefined}
      exportSheet={() => packingSheet(goods, false)}
    />
  );

  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        actions={
          <>
            <EditsChip card={edits?.cards["lines.packing"]} title="Packing list" />
            {badge}
            <FileActions excel={excel} viewHref={links?.view} pdfHref={links?.pdf} />
            {canEdit && <EditButton label="Edit items" onClick={() => setEditing(true)} />}
          </>
        }
      />
      {/* What a filled template would change, above the lines until it is saved or put away. */}
      {fromFile && (
        <CardBody>
          <div role="status" className={cn("rounded-lg border p-3 text-sm", fromFile.error ? "border-bad/30 bg-bad-soft" : "border-primary/30 bg-primary-soft/20")}>
            <p className="font-medium">From {fromFile.file}</p>
            {fromFile.error ? (
              <p className="text-bad">{fromFile.error}</p>
            ) : (
              <p className="text-text-2">
                {filled} item{filled === 1 ? "" : "s"} filled in from the file, package by package. Save them to the packing list?
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
              {!fromFile.error && filled > 0 && (
                <ActionForm action={action} onDone={() => setFromFile(null)} className="contents">
                  <input
                    type="hidden"
                    name="payload"
                    value={JSON.stringify({ lines: [...fromFile.cases].map(([lineId, cases]) => ({ lineId, cases: cases.map(caseInput) })) })}
                  />
                  <SubmitButton size="xs" pendingText="Saving…">
                    Save {filled} item{filled === 1 ? "" : "s"}
                  </SubmitButton>
                </ActionForm>
              )}
              <Button size="xs" variant="ghost" onClick={() => setFromFile(null)}>
                {fromFile.error ? "Close" : "Cancel"}
              </Button>
            </div>
          </div>
        </CardBody>
      )}
      {/* The lines read only as every other box's items (OrderLinesView: a plain table edge to edge, a list on a
          phone), never the grid editor locked: that one is for Edit items. */}
      <OrderLinesView set="packing" lines={lines} label={`${title} · items`} />
      <div className={cn(RULES.box.body, "border-t border-line")}>
        <PackingMarks
          containerNo={containerNo}
          containerHref={containerHref}
          shippingMarks={shippingMarks}
          canEdit={canEdit}
          action={marksAction}
          edit={ref("packing.marks")}
          card={edits?.cards["packing.marks"]}
        />
      </div>
        {editing && canEdit && (
          <SidePanel
            title="Edit packing list"
            description="Each item's packages as the packing list prints them: package number, how packed, what is in it, size (mm) and weights. Nothing is saved until Save the packing."
            onClose={closeEditor}
            className={RULES.window.items}
          >
            <CasesEditor
              items={goods.map((g) => ({ id: g.id, no: g.no, description: g.description, quantity: g.quantity, unit: g.unit, cases: g.packing.cases ?? [] }))}
              shipments={shipments}
              action={action}
              onDone={closeEditor}
            />
          </SidePanel>
        )}
    </Card>
  );
}

/** The container (the shipment's, read-only here) and the shipping marks, under the packing totals; "Change" opens the marks in the panel. */
function PackingMarks({
  containerNo,
  containerHref,
  shippingMarks,
  canEdit,
  action,
  edit,
  card,
}: {
  containerNo: string | null;
  containerHref?: string;
  shippingMarks: string | null;
  canEdit: boolean;
  action: Action;
  edit?: EditRef;
  card?: EditCard | null;
}) {
  const [editing, setEditing] = useState(false);
  const fromShipment = containerHref ? (
    <a href={containerHref} className={cn(linkClass, "text-xs")}>
      {containerNo ? "from Shipment 1 · change it there" : "add it on the shipment"}
    </a>
  ) : null;
  if (!containerNo && !shippingMarks && !canEdit) return null;
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1 text-sm">
      <dl className="flex min-w-0 flex-wrap gap-x-6 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-1.5">
          <dt className="text-muted">Container</dt>
          <dd className="font-medium">{containerNo ?? <Dash />}</dd>
          {fromShipment && <dd>{fromShipment}</dd>}
        </div>
        <div className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 text-muted">
            Shipping marks{edit && editedMark(card, "shippingMarks")}
          </dt>
          <dd className="min-w-0 font-medium whitespace-pre-line">{shippingMarks ?? <Dash />}</dd>
        </div>
      </dl>
      <span className="flex items-center gap-2">
        <EditsChip card={card} title="Shipping marks" />
        {canEdit && <EditButton onClick={() => setEditing(true)} />}
      </span>
      {editing && (
        <SidePanel title="Edit the shipping marks" description="As printed on the cartons. The container is changed on the shipment." onClose={() => setEditing(false)}>
          <FieldsForm
            action={action}
            edit={edit}
            card={card}
            fields={[{ name: "shippingMarks", label: "Shipping marks", value: shippingMarks, type: "textarea", wide: true }]}
          />
        </SidePanel>
      )}
    </div>
  );
}
