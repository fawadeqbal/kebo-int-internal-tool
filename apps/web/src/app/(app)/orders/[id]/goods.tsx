"use client";

import { useState, type ReactNode } from "react";
import { CheckCircle2, PackageCheck, Pencil, Search } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, cn, Field, Input, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { LinePacking } from "@/lib/types-orders";
import { Sheet, type SheetColumn } from "@/components/lines/sheet";
import { ExcelMenu } from "@/components/sheets/excel-menu";
import { FileActions } from "@/components/common/file-actions";
import { headerKey, sheetNumber, type ReadSheet, type SheetSpec } from "@/lib/sheet-spec";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

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

/** The goods cell: name, then model (and, on a phone, the factory) under it. */
const goodsCell = (l: GoodsLine, factoryOnPhone = false) => (
  <>
    <span className="line-clamp-2 break-words text-text">{head(l.description)}</span>
    {l.model && <span className="block truncate text-xs text-muted">Model {l.model}</span>}
    {factoryOnPhone && l.factory && <span className="block truncate text-xs text-muted md:hidden">{l.factory}</span>}
  </>
);

/** Filter chips with counts, and a find box when there are many lines. */
function Filters<K extends string>({
  chips,
  show,
  setShow,
  total,
  query,
  setQuery,
  tools,
}: {
  chips: { key: K; label: string; count: number }[];
  show: K;
  setShow: (k: K) => void;
  total: number;
  query: string;
  setQuery: (q: string) => void;
  /** Next to the find box (the Excel button). */
  tools?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setShow(c.key)}
            aria-pressed={show === c.key}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
              show === c.key ? "border-primary bg-primary-soft text-primary" : "border-line text-text-2 hover:bg-surface-2",
            )}
          >
            {c.label}
            <span className="tabular opacity-80">{c.count}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {tools}
        {total > 8 && (
          <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Find in ${total} lines…`} aria-label="Find a line" className="h-8 pl-8" />
          </div>
        )}
      </div>
    </div>
  );
}

const matches = (l: GoodsLine, q: string) => !q || [l.no, l.description, l.model ?? "", l.factory ?? ""].some((v) => v.toLowerCase().includes(q));

const Progress = ({ done, of, label }: { done: number; of: number; label: string }) => (
  <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={of} aria-valuenow={done} aria-label={label}>
    <div className="h-full rounded-full bg-ok" style={{ width: `${of ? Math.round((done / of) * 100) : 0}%` }} />
  </div>
);

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

type GoodsState = "waiting" | "partly" | "in";
const stateOf = (got: number, of: number): GoodsState => (got >= of ? "in" : got > 0 ? "partly" : "waiting");
const STATE: Record<GoodsState, { label: string; tone: "neutral" | "warn" | "ok" }> = {
  waiting: { label: "Waiting", tone: "neutral" },
  partly: { label: "Partly in", tone: "warn" },
  in: { label: "All in", tone: "ok" },
};

/**
 * What came in from the factory, in one sheet: looked at, or changed in place.
 * "Record what came in" turns the "Came in" cells into boxes (the total so far
 * for each line), with the date and Save under the sheet; the status follows
 * what is typed. "Mark all received" fills every line in one click.
 */
export function GoodsReceipt({ lines, canEdit, action, today }: { lines: GoodsLine[]; canEdit: boolean; action: Action; today: string }) {
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [on, setOn] = useState(today);
  const [show, setShow] = useState<GoodsState | "all">("all");
  const [query, setQuery] = useState("");

  const gotOf = (l: GoodsLine) => (editing ? Number(qty[l.id] ?? l.receivedQty) || 0 : Number(l.receivedQty));
  const allIn = lines.every((l) => Number(l.receivedQty) >= Number(l.quantity));
  const count: Record<GoodsState, number> = { waiting: 0, partly: 0, in: 0 };
  for (const l of lines) count[stateOf(gotOf(l), Number(l.quantity))]++;
  const q = query.trim().toLowerCase();
  const rows = lines.filter((l) => (show === "all" || stateOf(gotOf(l), Number(l.quantity)) === show) && matches(l, q));

  const start = () => {
    setQty(Object.fromEntries(lines.map((l) => [l.id, String(Number(l.receivedQty))])));
    setOn(today);
    setShow("all");
    setEditing(true);
  };
  const all = JSON.stringify({ on: today, lines: lines.map((l) => ({ lineId: l.id, receivedQty: Number(l.quantity) })) });
  const payload = JSON.stringify({ on, lines: lines.map((l) => ({ lineId: l.id, receivedQty: qty[l.id] ?? "" })) });

  const columns: SheetColumn<GoodsLine>[] = [
    { key: "goods", label: "Goods", show: (l) => goodsCell(l, true) },
    { key: "factory", label: "Factory", width: "11rem", hideBelow: "md", show: (l) => <span className="line-clamp-2 text-text-2">{l.factory ?? "—"}</span> },
    { key: "ordered", label: "Ordered", width: "6.5rem", align: "right", hideBelow: "sm", show: (l) => <span className="whitespace-nowrap">{`${n(l.quantity)} ${l.unit}`}</span> },
    {
      key: "received",
      label: "Came in",
      width: "7rem",
      phoneWidth: "5.25rem",
      align: "right",
      input: "number",
      maxLength: 14,
      value: (l) => qty[l.id] ?? "",
      aria: (l) => `${head(l.description)}: came in so far (${l.unit})`,
      show: (l) => {
        const got = Number(l.receivedQty);
        const of = Number(l.quantity);
        const st = stateOf(got, of);
        return (
          <>
            <span className={cn("block whitespace-nowrap", st === "in" ? "font-medium text-ok" : got > 0 ? "text-text" : "text-muted")}>
              {n(got)}{" "}
              <span className="text-xs text-muted">
                / {n(of)}
                <span className="sm:hidden"> {l.unit}</span>
              </span>
            </span>
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
              <span className={cn("block h-full rounded-full", st === "in" ? "bg-ok" : "bg-warn")} style={{ width: `${of > 0 ? Math.min(100, Math.round((got / of) * 100)) : 0}%` }} />
            </span>
          </>
        );
      },
    },
    {
      key: "status",
      label: "Status",
      width: "8rem",
      phoneWidth: "5.75rem",
      show: (l) => {
        const got = gotOf(l);
        const st = stateOf(got, Number(l.quantity));
        return (
          <>
            <Badge tone={STATE[st].tone} dot>
              {STATE[st].label}
            </Badge>
            {!editing && got > 0 && l.receivedOn && (
              <span className="mt-0.5 block truncate text-xs text-muted">
                {st === "in" ? "on" : "last"} {l.receivedOn}
              </span>
            )}
          </>
        );
      },
    },
  ];

  const sheet = (
    <div className="flex flex-col gap-2">
      <Filters
        chips={[
          { key: "all", label: "All", count: lines.length },
          { key: "waiting", label: "Waiting", count: count.waiting },
          { key: "partly", label: "Partly in", count: count.partly },
          { key: "in", label: "All in", count: count.in },
        ]}
        show={show}
        setShow={setShow}
        total={lines.length}
        query={query}
        setQuery={setQuery}
      />
      <Progress done={count.in} of={lines.length} label={`${count.in} of ${lines.length} lines all in`} />
      <Sheet
        label="Goods lines"
        rows={rows}
        rowKey={(l) => l.id}
        rowNo={(l) => l.no}
        columns={columns}
        editing={editing}
        onChange={(l, _k, v) => setQty((s) => ({ ...s, [l.id]: v }))}
        fit
        empty={q ? <>Nothing matches &ldquo;{query}&rdquo;.</> : "No lines here."}
      />
    </div>
  );

  if (!canEdit || !editing)
    return (
      <div className="flex flex-col gap-3">
        {sheet}
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
            <Button size="sm" variant={allIn ? "ghost" : "secondary"} onClick={start}>
              <Pencil aria-hidden /> {allIn ? "Change" : "Record what came in"}
            </Button>
          </div>
        )}
      </div>
    );

  return (
    <ActionForm action={action} onDone={() => setEditing(false)} className="flex flex-col gap-3">
      <input type="hidden" name="payload" value={payload} />
      <p className="text-sm text-text-2">Type how many of each have come in so far, in total. Enter goes down; you can paste a column from Excel.</p>
      {sheet}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Date" htmlFor="rcv-on" hint="When these came in">
          <Input id="rcv-on" type="date" max={today} className="w-44" value={on} onChange={(e) => setOn(e.target.value)} />
        </Field>
        <Button type="button" size="sm" variant="ghost" onClick={() => setQty(Object.fromEntries(lines.map((l) => [l.id, String(Number(l.quantity))])))}>
          <CheckCircle2 aria-hidden /> Everything ordered
        </Button>
      </div>
      <div className="flex gap-2">
        <SubmitButton size="sm" pendingText="Saving…">
          Save what came in
        </SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
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

type PackState = "missing" | "packed";

/**
 * The packing list, in the same sheet as the goods: packages, type, weights
 * and volume per line, with totals. Looked at once made (green "ready" with the
 * document's View / Print and PDF), and changed in place: the cells become
 * boxes, with the container and the shipping marks under the sheet.
 */
export function PackingList({
  lines,
  containerNo,
  shippingMarks,
  packed,
  totals,
  canEdit,
  canUpload,
  action,
  links,
  title,
  description,
  badge,
}: {
  title: string;
  description?: string;
  badge: ReactNode;
  lines: GoodsLine[];
  containerNo: string | null;
  shippingMarks: string | null;
  packed: boolean;
  totals: { packages: number; netWeightKg: string; grossWeightKg: string; cbm: string };
  canEdit: boolean;
  /** A filled template can be uploaded (until the order ships). */
  canUpload: boolean;
  action: Action;
  links: { view: string; pdf: string };
}) {
  const saved = rowsOf(lines);
  const started = totals.packages > 0;
  // Not made yet: open for typing straight away. Made: looked at, with "Change".
  const [editing, setEditing] = useState(canEdit && !packed);
  const [rows, setRows] = useState<PackRow[]>(() => withDefaults(saved));
  const [container, setContainer] = useState(containerNo ?? "");
  const [marks, setMarks] = useState(shippingMarks ?? "");
  const [show, setShow] = useState<PackState | "all">("all");
  const [query, setQuery] = useState("");
  const [fromFile, setFromFile] = useState<{ file: string; filled: number; problems: string[]; error: string | null } | null>(null);

  const shown = editing ? rows : saved;

  const upload = (read: ReadSheet, file: string) => {
    const r = packingFromSheet(read, lines);
    setFromFile({ file, filled: r.fill.size, problems: r.problems, error: r.error });
    if (r.error) return;
    const base = editing ? rows : withDefaults(saved);
    setRows(base.map((row) => ({ ...row, ...r.fill.get(row.lineId) })));
    if (!editing) {
      setContainer(containerNo ?? "");
      setMarks(shippingMarks ?? "");
    }
    setShow("all");
    setEditing(true);
  };

  const excel = (
    <ExcelMenu
      noun="packing"
      template={canUpload ? () => packingSheet(lines, shown, true) : undefined}
      onUpload={canUpload ? upload : undefined}
      exportSheet={() => packingSheet(lines, shown, false)}
    />
  );

  const fileNote = fromFile && (
    <div role="status" className={cn("rounded-lg border p-3 text-sm", fromFile.error ? "border-bad/30 bg-bad-soft" : "border-primary/30 bg-primary-soft/20")}>
      <p className="font-medium">From {fromFile.file}</p>
      {fromFile.error ? (
        <p className="text-bad">{fromFile.error}</p>
      ) : (
        <p className="text-text-2">
          Filled in {fromFile.filled} line{fromFile.filled === 1 ? "" : "s"}. Check them, then press Save the packing list.
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
      <Button size="xs" variant="ghost" className="mt-1" onClick={() => setFromFile(null)}>
        Close
      </Button>
    </div>
  );
  const rowOf = (l: GoodsLine) => shown[lines.indexOf(l)]!;
  const stateOfLine = (l: GoodsLine): PackState => (Number(rowOf(l).packages) > 0 ? "packed" : "missing");
  const missing = lines.filter((l) => stateOfLine(l) === "missing").length;
  const q = query.trim().toLowerCase();
  const visible = lines.filter((l) => (show === "all" || stateOfLine(l) === show) && matches(l, q));
  const total = { packages: sum(shown, "packages"), net: sum(shown, "netWeightKg"), gross: sum(shown, "grossWeightKg"), cbm: sum(shown, "cbm") };
  const payload = JSON.stringify({ containerNo: container, shippingMarks: marks, lines: rows });

  const summary = [
    `${n(totals.packages, 0)} package${totals.packages === 1 ? "" : "s"}`,
    Number(totals.netWeightKg) ? `net ${n(totals.netWeightKg)} kg` : null,
    Number(totals.grossWeightKg) ? `gross ${n(totals.grossWeightKg)} kg` : null,
    Number(totals.cbm) ? `${n(totals.cbm, 3)} m³` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const columns: SheetColumn<GoodsLine>[] = [
    {
      key: "goods",
      label: "Goods",
      show: (l) => (
        <>
          {goodsCell(l)}
          <span className="block text-xs text-muted tabular">
            {n(l.quantity)} {l.unit}
          </span>
        </>
      ),
    },
    ...FIELDS.map(
      (f): SheetColumn<GoodsLine> => ({
        key: f.key,
        label: f.label,
        width: f.width,
        align: f.mode === "text" ? undefined : "right",
        input: f.mode === "text" ? "text" : "number",
        maxLength: f.mode === "text" ? 40 : 14,
        value: (l) => rowOf(l)[f.key],
        aria: (l) => `${head(l.description)}: ${f.label}`,
        show: (l) => {
          const v = rowOf(l)[f.key];
          if (!v) return <span className="text-muted">—</span>;
          return f.mode === "text" ? v : n(v, f.digits ?? 2);
        },
      }),
    ),
  ];

  const sheet = (
    <div className="flex flex-col gap-2">
      <Filters
        chips={[
          { key: "all", label: "All", count: lines.length },
          { key: "missing", label: "Without packages", count: missing },
          { key: "packed", label: "Packed", count: lines.length - missing },
        ]}
        show={show}
        setShow={setShow}
        total={lines.length}
        query={query}
        setQuery={setQuery}
      />
      <Progress done={lines.length - missing} of={lines.length} label={`${lines.length - missing} of ${lines.length} lines have their packages`} />
      <Sheet
        label="Packing list"
        rows={visible}
        rowKey={(l) => l.id}
        rowNo={(l) => l.no}
        columns={columns}
        editing={editing}
        onChange={(l, k, v) => setRows((rs) => rs.map((r) => (r.lineId === l.id ? { ...r, [k]: v } : r)))}
        foot={["Total", n(total.packages, 0), "", n(total.net), n(total.gross), n(total.cbm, 3)]}
        empty={q ? <>Nothing matches &ldquo;{query}&rdquo;.</> : "No lines here."}
      />
    </div>
  );

  // Excel, View / Print and the PDF at the top right of the card, as everywhere.
  const card = (body: ReactNode) => (
    <Card>
      <CardHeader
        title={title}
        description={description}
        actions={
          <>
            {badge}
            <FileActions excel={excel} viewHref={started || packed ? links.view : undefined} pdfHref={started || packed ? links.pdf : undefined} />
          </>
        }
      />
      <CardBody>{body}</CardBody>
    </Card>
  );

  if (!editing)
    return card(
      <div className="flex flex-col gap-3">
        {packed ? (
          <div role="status" className="flex flex-col gap-2 rounded-lg border border-ok/30 bg-ok-soft p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2">
              <PackageCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
              <span>
                <span className="block font-medium text-ok">Packing list ready</span>
                <span className="block text-text-2 tabular">{summary}</span>
              </span>
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">{started ? `Started, not complete: ${summary}.` : "Not filled in yet."}</p>
        )}
        {fileNote}
        {(started || packed) && sheet}
        {(containerNo || shippingMarks) && (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {containerNo && (
              <div>
                <dt className="text-xs text-muted">Container number</dt>
                <dd>{containerNo}</dd>
              </div>
            )}
            {shippingMarks && (
              <div>
                <dt className="text-xs text-muted">Shipping marks</dt>
                <dd className="whitespace-pre-line">{shippingMarks}</dd>
              </div>
            )}
          </dl>
        )}
        {canEdit && (
          <div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setRows(withDefaults(saved));
                setContainer(containerNo ?? "");
                setMarks(shippingMarks ?? "");
                setShow("all");
                setFromFile(null);
                setEditing(true);
              }}
            >
              <Pencil aria-hidden /> {packed ? "Change the packing list" : "Fill in the packing list"}
            </Button>
          </div>
        )}
      </div>,
    );

  return card(
    <ActionForm action={action} onDone={() => setEditing(false)} className="flex flex-col gap-3">
      <input type="hidden" name="payload" value={payload} />
      {started && !packed && <p className="text-xs text-warn">Not complete yet: every line needs its number of packages.</p>}
      {fileNote}
      {sheet}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Container number" htmlFor="pk-container" optional>
          <Input id="pk-container" maxLength={120} value={container} onChange={(e) => setContainer(e.target.value)} placeholder="e.g. TGHU 123456-7" />
        </Field>
        <Field label="Shipping marks" htmlFor="pk-marks" optional hint="As printed on the cartons">
          <Textarea id="pk-marks" rows={2} className="min-h-0" maxLength={2000} value={marks} onChange={(e) => setMarks(e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton size="sm" pendingText="Saving…">
          Save the packing list
        </SubmitButton>
        {(packed || started) && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
        {missing > 0 && (
          <span className="text-xs text-muted">
            {missing === lines.length ? "Fill in the packages for each line." : `${missing} line${missing === 1 ? "" : "s"} still without packages.`}
          </span>
        )}
      </div>
    </ActionForm>,
  );
}
