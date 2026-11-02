"use client";

import { useMemo, useState, type ReactNode } from "react";
import { formatMinor, multiplyMinor, toMinor, withTaxMinor } from "@kebo/money";
import { LINE_CONDITION_LABEL, LINE_CONDITION_TONE, LINE_CONDITIONS, type LineCondition } from "@kebo/shared";
import { Badge, cn } from "@kebo/ui";
import { LineTable, type LineColumn, type LineResult, type LineRow, type LineValues } from "@/components/lines/line-table";
import { orderLineAction } from "@/app/(app)/orders/actions";
import { date } from "@/lib/format";
import type { OrderLineView } from "@/lib/types-orders";

/**
 * The order's lines, kept once, opened by each step with its own columns:
 * - factory: the factory, its price and tax (read only; people who see factory prices)
 * - received: how many came in from the factory, when, and the status (Production)
 * - packing: packed in, packages, gross, net, CBM (Shipping)
 * - delivered: how many reached the customer, in what condition, a note (Delivery & SAT)
 */
export type LineSet = "factory" | "received" | "packing" | "delivered";

const n = (v: string | number | null | undefined, digits = 2) =>
  v === null || v === undefined || v === "" ? "" : Number(v).toLocaleString("en-US", { maximumFractionDigits: digits });
/** Volume: always two decimals (18.40), three when typed. */
const cbmOf = (v: string | number) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
/** A number as it is typed (no thousands commas, no trailing zeros). */
const raw = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "" : String(Number(v)));
const head = (d: string) => d.split("\n")[0] ?? d;
const dash = <span className="text-muted">—</span>;

type GoodsState = "waiting" | "partly" | "in";
const stateOf = (got: number, of: number): GoodsState => (got >= of && of > 0 ? "in" : got > 0 ? "partly" : "waiting");
const STATE: Record<GoodsState, { label: string; tone: "neutral" | "warn" | "ok" }> = {
  waiting: { label: "At the factory", tone: "neutral" },
  partly: { label: "Partly in", tone: "warn" },
  in: { label: "All in", tone: "ok" },
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const iso = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
};
/** A typed date as YYYY-MM-DD: "2026-11-02", "2 Nov 2026", "02/11/2026" (day first), "today", "yesterday"; "" clears it. */
export function readDate(text: string, today: string): string | null | undefined {
  const t = text.trim().toLowerCase().replace(/,/g, " ");
  if (!t) return null;
  if (t === "today") return today;
  if (t === "yesterday") return new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!) ?? undefined;
  m = /^(\d{1,2})[\s-]+([a-z]{3})[a-z]*\.?[\s-]+(\d{2,4})$/.exec(t);
  if (m && MONTHS.includes(m[2]!)) return iso(m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!, MONTHS.indexOf(m[2]!) + 1, +m[1]!) ?? undefined;
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/.exec(t);
  if (m) return iso(m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!, +m[2]!, +m[1]!) ?? undefined;
  return undefined;
}

/** The line's values as the table keeps them (text, as typed). */
function valuesOf(l: OrderLineView): LineValues {
  return {
    description: l.description,
    model: l.model ?? "",
    quantity: raw(l.quantity),
    unit: l.unit,
    factory: l.factory?.name ?? "",
    factoryPrice: l.factoryPrice ? raw(l.factoryPrice.unitPrice) : "",
    factoryCurrency: l.factoryPrice?.currency ?? "",
    taxRate: l.factoryPrice ? raw(l.factoryPrice.taxRate) : "",
    receivedQty: raw(l.receivedQty),
    receivedOn: l.receivedOn ? date(l.receivedOn) : "",
    packageType: l.packing.packageType ?? "",
    packages: l.packing.packages === null ? "" : String(l.packing.packages),
    grossWeightKg: raw(l.packing.grossWeightKg),
    netWeightKg: raw(l.packing.netWeightKg),
    cbm: raw(l.packing.cbm),
    deliveredQty: raw(l.delivered?.qty),
    condition: l.delivered?.condition ?? "",
    note: l.delivered?.note ?? "",
  };
}

/** The step's figure for a line in one short line (shown under the name on a phone). */
function phoneLine(set: LineSet, v: LineValues): string {
  const qty = `${n(v.quantity)} ${v.unit}`;
  if (set === "received") return `In ${n(v.receivedQty) || 0} of ${qty} · ${STATE[stateOf(Number(v.receivedQty) || 0, Number(v.quantity))].label}`;
  if (set === "packing")
    return v.packages ? [`${n(v.packages, 0)} ${v.packageType || "packages"}`, v.grossWeightKg && `${n(v.grossWeightKg)} kg`, v.cbm && `${cbmOf(v.cbm)} CBM`].filter(Boolean).join(" · ") : `${qty} · not packed yet`;
  if (set === "delivered")
    return `Delivered ${n(v.deliveredQty) || 0} of ${qty}${v.condition ? ` · ${LINE_CONDITION_LABEL[v.condition as LineCondition]}` : ""}`;
  return v.factoryPrice ? `${v.factory} · ${formatMinor(toMinor(v.factoryPrice), v.factoryCurrency || "")}` : qty;
}

function columnsOf(set: LineSet): LineColumn[] {
  const base: LineColumn[] = [
    {
      key: "description",
      label: "Description",
      // Many columns (packing): a narrower description, so the table fits the card on a laptop.
      width: set === "packing" ? "10rem" : "minmax(0,1fr)",
      format: (v) => (
        <>
          {head(v.description ?? "")}
          {v.model && <span className="block truncate text-xs text-muted">Model {v.model}</span>}
          {/* On a phone the table scrolls sideways: the step's figure stays in view under the name. */}
          <span className="block text-xs text-muted sm:hidden">{phoneLine(set, v)}</span>
        </>
      ),
    },
    { key: "quantity", label: "Qty", width: "4.75rem", align: "right", format: (v, r) => `${n(v.quantity)} ${r.values.unit}` },
  ];
  const number = (key: string, label: string, width: string, digits = 2, phoneHidden = false): LineColumn => ({
    key,
    label,
    width,
    align: "right",
    input: "number",
    maxLength: 14,
    placeholder: "—",
    phoneHidden,
    format: (v) => (v[key] ? n(v[key], digits) : dash),
  });
  switch (set) {
    case "factory":
      return [
        ...base,
        { key: "factory", label: "Factory", width: "9rem", phoneHidden: true },
        {
          key: "factoryPrice",
          label: "Factory price",
          width: "8.5rem",
          align: "right",
          format: (_v, r) => (r.values.factoryPrice ? formatMinor(toMinor(r.values.factoryPrice), r.values.factoryCurrency || "") : dash),
        },
        { key: "taxRate", label: "Tax %", width: "4.5rem", align: "right", phoneHidden: true, format: (v) => (v.factoryPrice ? n(v.taxRate) : dash) },
      ];
    case "received":
      return [
        ...base,
        number("receivedQty", "Received", "5.25rem"),
        {
          key: "receivedOn",
          label: "Received on",
          width: "6.75rem",
          input: "text",
          maxLength: 20,
          placeholder: "e.g. 02 Nov 2026",
          phoneHidden: true,
          format: (v) => (Number(v.receivedQty) > 0 && v.receivedOn ? v.receivedOn : dash),
        },
        {
          key: "status",
          label: "Status",
          width: "7.25rem",
          format: (v) => {
            const st = STATE[stateOf(Number(v.receivedQty) || 0, Number(v.quantity))];
            return (
              <Badge tone={st.tone} dot>
                {st.label}
              </Badge>
            );
          },
        },
      ];
    case "packing":
      return [
        ...base,
        { key: "packageType", label: "Packed in", width: "6.75rem", input: "text", maxLength: 40, placeholder: "Carton", phoneHidden: true },
        { ...number("packages", "Packages", "4.75rem", 0), format: (v) => (v.packages ? n(v.packages, 0) : dash) },
        number("grossWeightKg", "Gross kg", "5rem"),
        number("netWeightKg", "Net kg", "5rem", 2, true),
        { ...number("cbm", "CBM", "4.25rem", 3), format: (v) => (v.cbm ? cbmOf(v.cbm) : dash) },
      ];
    case "delivered":
      return [
        ...base,
        number("deliveredQty", "Delivered", "5rem"),
        {
          key: "condition",
          label: "Condition",
          width: "7.25rem",
          input: "select",
          options: [{ value: "", label: "—" }, ...LINE_CONDITIONS.map((c) => ({ value: c, label: LINE_CONDITION_LABEL[c] }))],
          format: (v) =>
            v.condition ? (
              <Badge tone={LINE_CONDITION_TONE[v.condition as LineCondition]} dot>
                {LINE_CONDITION_LABEL[v.condition as LineCondition]}
              </Badge>
            ) : (
              dash
            ),
        },
        { key: "note", label: "Note", width: "8.5rem", input: "text", maxLength: 200, placeholder: "e.g. one case dented", phoneHidden: true },
      ];
  }
}

const NUMERIC = new Set(["receivedQty", "packages", "grossWeightKg", "netWeightKg", "cbm", "deliveredQty"]);

/** The table's change as the API's: one set, the fields changed. */
function bodyOf(set: LineSet, values: LineValues, today: string): Record<string, unknown> | string {
  const body: Record<string, unknown> = { set };
  for (const [k, v] of Object.entries(values)) {
    if (k === "receivedOn") {
      const d = readDate(v, today);
      if (d === undefined) return "Use a date like 02 Nov 2026.";
      body.receivedOn = d;
    } else body[k] = NUMERIC.has(k) ? v.replace(/,/g, "").trim() : v;
  }
  return body;
}

const FIXED: LineResult = {
  ok: false,
  message: "The order's lines come from the accepted quotation: they are not added, removed or moved here.",
};
const fixed = async () => FIXED;

/**
 * The line table on a step page: the order's goods lines with the step's
 * columns. Each change is saved as it is made (one line, one field); lines are
 * not added, removed or moved here, so the table's add row, paste and row
 * tools are left out.
 */
export function OrderLines({
  set,
  orderId,
  lines,
  canEdit,
  today,
  footer,
}: {
  set: LineSet;
  orderId: string;
  /** The order's goods lines (charges are not received, packed or delivered). */
  lines: OrderLineView[];
  canEdit: boolean;
  today: string;
  /** Under the totals (e.g. the container and the marks). */
  footer?: ReactNode;
}) {
  // What each save answered, until the page brings the same (or newer) lines.
  const [saved, setSaved] = useState<{ of: OrderLineView[]; byId: Record<string, OrderLineView> }>({ of: lines, byId: {} });
  const byId = saved.of === lines ? saved.byId : null;
  const shown = useMemo(() => (byId ? lines.map((l) => byId[l.id] ?? l) : lines), [lines, byId]);
  const readOnly = !canEdit || set === "factory";
  const columns = useMemo(() => columnsOf(set), [set]);

  const byNo = new Map(shown.map((l) => [l.no, l.id]));
  const rows: LineRow[] = shown.map((l) => {
    const top = l.no.includes(".") ? l.no.split(".")[0]! : null;
    return { key: l.id, parentKey: top ? (byNo.get(top) ?? null) : null, values: valuesOf(l) };
  });

  const onEdit = async (key: string, values: LineValues): Promise<LineResult> => {
    const body = bodyOf(set, values, today);
    if (typeof body === "string") return { ok: false, message: body };
    const r = await orderLineAction(orderId, key, body);
    if (!r.ok) return r;
    setSaved((s) => ({ of: lines, byId: { ...(s.of === lines ? s.byId : {}), [key]: r.line } }));
    return { ok: true };
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        // The line table's tools for adding, pasting and moving lines (and its help on them) do not apply here.
        "[&_tr[aria-label^='New_']]:hidden [&_[role=toolbar]]:hidden [&_button:has(>.lucide-clipboard-paste)]:hidden [&>div>div:has(>details)]:hidden",
        // …nor its row tools column (its last; a read-only table has none).
        !readOnly &&
          "[&_tbody_tr>td:last-child:not(:first-child)]:hidden [&_thead_tr>th:last-child:not(:first-child)]:hidden [&_colgroup>col:last-child]:hidden",
      )}
    >
      <LineTable
        rows={rows}
        columns={columns}
        noun="line"
        readOnly={readOnly}
        onAdd={fixed}
        onRemove={fixed}
        onMove={fixed}
        onEdit={onEdit}
        footer={<Totals set={set} lines={shown} extra={footer} />}
        empty="No goods lines on this order."
      />
      {!readOnly && (
        <p className="text-xs text-muted">
          Click a cell and type: Enter saves it and goes down, Esc cancels.
          {set === "received" ? " The date is today unless you type another." : ""}
        </p>
      )}
    </div>
  );
}

/** Under the table: the step's totals. */
function Totals({ set, lines, extra }: { set: LineSet; lines: OrderLineView[]; extra?: ReactNode }) {
  const sum = (f: (l: OrderLineView) => number) => lines.reduce((t, l) => t + (f(l) || 0), 0);
  const item = (label: string, value: ReactNode) => (
    <span className="text-muted">
      {label} <span className="font-semibold text-text tabular">{value}</span>
    </span>
  );
  let body: ReactNode;
  if (set === "factory") {
    const totals = new Map<string, number>();
    for (const l of lines) {
      const p = l.factoryPrice;
      if (!p?.currency) continue;
      totals.set(p.currency, (totals.get(p.currency) ?? 0) + multiplyMinor(withTaxMinor(toMinor(p.unitPrice), p.taxRate), l.quantity));
    }
    body = totals.size ? item("Factory total", [...totals].map(([c, m]) => formatMinor(m, c)).join(" + ")) : null;
  } else if (set === "received") {
    const done = lines.filter((l) => stateOf(Number(l.receivedQty), Number(l.quantity)) === "in").length;
    body = item("Received", `${done} of ${lines.length}`);
  } else if (set === "packing") {
    body = (
      <>
        {item("Packages", n(sum((l) => l.packing.packages ?? 0), 0))}
        {item("Gross", `${n(sum((l) => Number(l.packing.grossWeightKg)))} kg`)}
        {item("Net", `${n(sum((l) => Number(l.packing.netWeightKg)))} kg`)}
        {item("Volume", `${cbmOf(sum((l) => Number(l.packing.cbm)))} CBM`)}
      </>
    );
  } else {
    const done = lines.filter((l) => Number(l.delivered?.qty) >= Number(l.quantity)).length;
    const problems = lines.filter((l) => l.delivered?.condition && l.delivered.condition !== "good").length;
    body = (
      <>
        {item("Delivered", `${done} of ${lines.length}`)}
        {problems > 0 && (
          <span className="font-medium text-bad">
            {problems} line{problems === 1 ? "" : "s"} not in good order
          </span>
        )}
      </>
    );
  }
  if (!body && !extra) return null;
  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      {body && <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 text-sm">{body}</div>}
      {extra}
    </div>
  );
}

/**
 * The lines as short text lines (a phone's read-only view, board
 * OrderV4Phone): the number and name, then the step's figure.
 */
export function PhoneLines({ set, lines }: { set: LineSet; lines: OrderLineView[] }) {
  if (!lines.length) return <p className="text-sm text-muted">No goods lines on this order.</p>;
  return (
    <ul className="flex flex-col divide-y divide-line" aria-label="Lines">
      {lines.map((l) => (
        <li key={l.id} className={cn("py-2.5", l.no.includes(".") && "pl-3")}>
          <p className="text-sm font-medium">
            <span className="font-normal text-muted tabular">{l.no}</span> {head(l.description)}
          </p>
          <p className="text-xs text-muted">{phoneLine(set, valuesOf(l))}</p>
        </li>
      ))}
    </ul>
  );
}
