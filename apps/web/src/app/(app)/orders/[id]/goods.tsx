"use client";

import { useState } from "react";
import { CheckCircle2, Download, PackageCheck, Pencil, Printer, Search } from "lucide-react";
import { Badge, Button, buttonClass, cn, Field, Input, ScrollFade, Textarea } from "@kebo/ui";
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

type GoodsState = "waiting" | "partly" | "in";

const stateOf = (l: GoodsLine): GoodsState => {
  const got = Number(l.receivedQty);
  return got >= Number(l.quantity) ? "in" : got > 0 ? "partly" : "waiting";
};

const STATE: Record<GoodsState, { label: string; tone: "neutral" | "warn" | "ok" }> = {
  waiting: { label: "Waiting", tone: "neutral" },
  partly: { label: "Partly in", tone: "warn" },
  in: { label: "All in", tone: "ok" },
};

/**
 * What came in from the factory, as a sheet you can only look at: one row per
 * goods line with what was ordered, what came in (with a small bar) and its
 * status. Filter by status, or find a line when there are many.
 * "Record what came in" opens one number per line (the total so far);
 * "Mark all received" fills every line in one click.
 */
export function GoodsReceipt({ lines, canEdit, action, today }: { lines: GoodsLine[]; canEdit: boolean; action: Action; today: string }) {
  const [editing, setEditing] = useState(false);
  const allIn = lines.every((l) => Number(l.receivedQty) >= Number(l.quantity));
  const all = JSON.stringify({ on: today, lines: lines.map((l) => ({ lineId: l.id, receivedQty: Number(l.quantity) })) });

  if (!canEdit || !editing)
    return (
      <div className="flex flex-col gap-3">
        <GoodsGrid lines={lines} />
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

function GoodsGrid({ lines }: { lines: GoodsLine[] }) {
  const [show, setShow] = useState<GoodsState | "all">("all");
  const [query, setQuery] = useState("");
  const count = { waiting: 0, partly: 0, in: 0 } as Record<GoodsState, number>;
  for (const l of lines) count[stateOf(l)]++;
  const q = query.trim().toLowerCase();
  const rows = lines.filter(
    (l) =>
      (show === "all" || stateOf(l) === show) &&
      (!q || [l.no, l.description, l.model ?? "", l.factory ?? ""].some((v) => v.toLowerCase().includes(q))),
  );
  const cellBase = "h-9 border border-line px-1.5 align-middle text-sm sm:px-2";
  const hd = "h-8 border border-t-0 border-line bg-surface-2 px-1.5 sm:px-2 text-left text-xs font-medium whitespace-nowrap text-text-2";
  const chip = (key: GoodsState | "all", label: string, n: number) => (
    <button
      key={key}
      type="button"
      onClick={() => setShow(key)}
      aria-pressed={show === key}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
        show === key ? "border-primary bg-primary-soft text-primary" : "border-line text-text-2 hover:bg-surface-2",
      )}
    >
      {label}
      <span className="tabular opacity-80">{n}</span>
    </button>
  );
  const done = count.in;
  const pct = lines.length ? Math.round((done / lines.length) * 100) : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
          {chip("all", "All", lines.length)}
          {chip("waiting", "Waiting", count.waiting)}
          {chip("partly", "Partly in", count.partly)}
          {chip("in", "All in", count.in)}
        </div>
        {lines.length > 8 && (
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Find in ${lines.length} lines…`}
              aria-label="Find a line"
              className="h-8 pl-8"
            />
          </div>
        )}
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={lines.length}
        aria-valuenow={done}
        aria-label={`${done} of ${lines.length} lines all in`}
      >
        <div className="h-full rounded-full bg-ok" style={{ width: `${pct}%` }} />
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <ScrollFade className="overflow-x-auto" role="region" aria-label="Goods lines">
          {/* On a phone: the factory goes under the goods and "Ordered" into "Came in", so the status stays in view. */}
          <table data-fit className="w-full table-fixed border-collapse [&_tr>*:first-child]:border-l-0 [&_tr>*:last-child]:border-r-0">
            <thead>
              <tr>
                <th scope="col" className={cn(hd, "w-8 px-0.5 text-center sm:w-12 sm:px-1")}>
                  No.
                </th>
                <th scope="col" className={hd}>
                  Goods
                </th>
                <th scope="col" className={cn(hd, "hidden w-44 md:table-cell")}>
                  Factory
                </th>
                <th scope="col" className={cn(hd, "hidden w-24 text-right sm:table-cell")}>
                  Ordered
                </th>
                <th scope="col" className={cn(hd, "w-[5.25rem] text-right sm:w-28")}>
                  Came in
                </th>
                <th scope="col" className={cn(hd, "w-[5.75rem] sm:w-32")}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-sm text-muted">
                    {q ? <>Nothing matches &ldquo;{query}&rdquo;.</> : "No lines here."}
                  </td>
                </tr>
              )}
              {rows.map((l) => {
                const got = Number(l.receivedQty);
                const of = Number(l.quantity);
                const st = stateOf(l);
                const p = of > 0 ? Math.min(100, Math.round((got / of) * 100)) : 0;
                return (
                  <tr key={l.id} aria-label={`Line ${l.no}`}>
                    <th scope="row" className={cn(cellBase, "bg-surface-2 px-0.5 text-center text-xs font-normal whitespace-nowrap text-muted tabular sm:px-1")}>
                      {l.no}
                    </th>
                    <td className={cn(cellBase, "py-1.5")}>
                      <span className="line-clamp-2 break-words">{head(l.description)}</span>
                      {l.model && <span className="block truncate text-xs text-muted">Model {l.model}</span>}
                      {l.factory && <span className="block truncate text-xs text-muted md:hidden">{l.factory}</span>}
                    </td>
                    <td className={cn(cellBase, "hidden text-text-2 md:table-cell")}>
                      <span className="line-clamp-2">{l.factory ?? <span className="text-muted">—</span>}</span>
                    </td>
                    <td className={cn(cellBase, "hidden text-right whitespace-nowrap tabular sm:table-cell")}>
                      {n(of)} {l.unit}
                    </td>
                    <td className={cn(cellBase, "py-1.5 text-right tabular")}>
                      <span className={cn("block whitespace-nowrap", st === "in" ? "font-medium text-ok" : got > 0 ? "text-text" : "text-muted")}>
                        {n(got)}{" "}
                        <span className="text-xs text-muted">
                          / {n(of)}
                          <span className="sm:hidden"> {l.unit}</span>
                        </span>
                      </span>
                      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                        <span className={cn("block h-full rounded-full", st === "in" ? "bg-ok" : "bg-warn")} style={{ width: `${p}%` }} />
                      </span>
                    </td>
                    <td className={cn(cellBase, "py-1.5")}>
                      <Badge tone={STATE[st].tone} dot>
                        {STATE[st].label}
                      </Badge>
                      {got > 0 && l.receivedOn && (
                        <span className="mt-0.5 block truncate text-xs text-muted">
                          {st === "in" ? "on" : "last"} {l.receivedOn}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollFade>
      </div>
    </div>
  );
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
