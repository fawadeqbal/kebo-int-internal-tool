"use client";

import { Totals, type TotalsRow } from "@/components/records/totals";
import { useMemo, type ReactNode } from "react";
import { factoryUnitCostMinor, formatMinor, multiplyMinor, toMinor } from "@kebo/money";
import { LINE_CONDITION_LABEL, LINE_CONDITION_TONE, LINE_CONDITIONS, type LineCondition } from "@kebo/shared";
import { Badge, cn, Dash } from "@kebo/ui";
import { BatchLines } from "@/components/edits/batch-lines";
import type { EditCard, EditRef } from "@/lib/types-edits";
import { type LineColumn, type LineResult, type LineRow, type LineValues } from "@/components/lines/line-table";
import { orderLineAction } from "@/app/(app)/orders/actions";
import { formatDate } from "@kebo/utils";
import type { OrderLineView } from "@/lib/types-orders";
import { ItemsBody, type ItemsPhoneRow } from "@/components/records/items-box";

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
const dash = <Dash />;

type GoodsState = "waiting" | "partly" | "in";
const stateOf = (got: number, of: number): GoodsState => (got >= of && of > 0 ? "in" : got > 0 ? "partly" : "waiting");
const STATE: Record<GoodsState, { label: string; tone: "neutral" | "warn" | "ok" }> = {
  waiting: { label: "At the supplier", tone: "neutral" },
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
    // Typed back in this table (readDate takes "02 Nov 2026"), so always written that way.
    receivedOn: l.receivedOn ? formatDate(l.receivedOn) : "",
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
    // Quantity and Unit apart, as on every record's items (canvas "The order's Overview today", 7).
    { key: "quantity", label: "Quantity", width: "4.75rem", align: "right", format: (v) => n(v.quantity) },
    { key: "unit", label: "Unit", width: "3.75rem", phoneHidden: true },
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
        { key: "factory", label: "Supplier", width: "9rem", phoneHidden: true },
        {
          key: "factoryPrice",
          label: "Supplier price",
          width: "8.5rem",
          align: "right",
          format: (_v, r) => (r.values.factoryPrice ? formatMinor(toMinor(r.values.factoryPrice), r.values.factoryCurrency || "") : dash),
        },
        { key: "taxRate", label: "Tax", width: "4.5rem", align: "right", phoneHidden: true, format: (v) => (v.factoryPrice && Number(v.taxRate) ? `${n(v.taxRate)}%` : dash) },
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
        { key: "packageType", label: "Packed in", width: "6.75rem", input: "text", maxLength: 40, phoneHidden: true },
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
        { key: "note", label: "Note", width: "8.5rem", input: "text", maxLength: 200, phoneHidden: true },
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
  message: "The order's items come from the accepted quotation: they are not added, removed or moved here.",
};
const fixed = async () => FIXED;

/**
 * The step's lines in the edit panel (board "View first, edit on purpose"):
 * the step's columns typed on a copy, saved together with Save changes. Lines
 * are not added, removed or moved here. Filling a value is plain; changing a
 * value already saved asks why.
 */
export function OrderLinesEditor({
  set,
  orderId,
  lines,
  today,
  edit,
  card,
}: {
  set: LineSet;
  orderId: string;
  lines: OrderLineView[];
  today: string;
  edit?: EditRef;
  card?: EditCard | null;
}) {
  const columns = useMemo(() => columnsOf(set), [set]);
  const byNo = new Map(lines.map((l) => [l.no, l.id]));
  const rows: LineRow[] = lines.map((l) => {
    const top = l.no.includes(".") ? l.no.split(".")[0]! : null;
    return { key: l.id, parentKey: top ? (byNo.get(top) ?? null) : null, values: valuesOf(l) };
  });
  const onEdit = async (key: string, values: LineValues): Promise<LineResult> => {
    const body = bodyOf(set, values, today);
    if (typeof body === "string") return { ok: false, message: body };
    const r = await orderLineAction(orderId, key, body);
    return r.ok ? { ok: true } : r;
  };
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        // The line table's tools for adding, pasting and moving lines (and its help on them) do not apply here.
        "[&_tr[aria-label^='New_']]:hidden [&_[role=toolbar]]:hidden [&_button:has(>.lucide-clipboard-paste)]:hidden [&_div:has(>details)]:hidden",
        // Add item (laptop and phone) and the phone's other ways to add: an order's items come from its quotation.
        "[&_button:has(>.lucide-plus)]:hidden [&_button[aria-label='More_ways_to_add']]:hidden",
        "[&_tbody_tr>td:last-child:not(:first-child)]:hidden [&_thead_tr>th:last-child:not(:first-child)]:hidden [&_colgroup>col:last-child]:hidden",
      )}
    >
      <BatchLines
        rows={rows}
        columns={columns}
        noun="item"
        handlers={{ onEdit, onAdd: fixed, onRemove: fixed, onMove: fixed }}
        edit={edit}
        card={card}
        askOnAdd={false}
        empty="No items on this order."
        below={
          <p className="text-xs text-muted">
            Click a cell and type: Enter keeps it and goes down, Esc cancels. Nothing is saved until Save changes.
            {set === "received" ? " The date is today unless you type another." : ""}
          </p>
        }
      />
    </div>
  );
}

/** Under the table: the step's totals. */
/** Under a step's lines: the money as the one Totals block (the supplier's lines), or the step's own figures. */
function StepFigures({ set, lines, extra }: { set: LineSet; lines: OrderLineView[]; extra?: ReactNode }) {
  const sum = (f: (l: OrderLineView) => number) => lines.reduce((t, l) => t + (f(l) || 0), 0);
  const item = (label: string, value: ReactNode) => (
    <span className="text-muted">
      {label} <span className="font-semibold text-text tabular">{value}</span>
    </span>
  );
  let body: ReactNode;
  let money: TotalsRow[] | null = null;
  if (set === "factory") {
    // Before tax · Tax · Total with tax (as on the supplier's offer), per currency; no tax: the total alone.
    const gross = new Map<string, number>();
    const net = new Map<string, number>();
    for (const l of lines) {
      const p = l.factoryPrice;
      if (!p?.currency) continue;
      const unit = toMinor(p.unitPrice);
      const rate = Number(p.taxRate) || 0;
      const before = p.taxIncluded && rate ? Math.round(unit / (1 + rate / 100)) : unit;
      gross.set(p.currency, (gross.get(p.currency) ?? 0) + multiplyMinor(factoryUnitCostMinor(unit, p.taxRate, p.taxIncluded), l.quantity));
      net.set(p.currency, (net.get(p.currency) ?? 0) + multiplyMinor(before, l.quantity));
    }
    const say = (m: Map<string, number>) => [...m].map(([c, x]) => formatMinor(x, c)).join(" + ");
    const tax = new Map([...gross].map(([c, g]) => [c, g - (net.get(c) ?? g)]));
    const taxed = [...tax.values()].some((x) => x > 0);
    money = !gross.size
      ? null
      : taxed
        ? [
            { label: "Before tax", value: say(net) },
            { label: "Tax", value: say(tax) },
            { label: "Total with tax", value: say(gross), big: true },
          ]
        : [{ label: "Supplier total", value: say(gross), big: true }];
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
            {problems} item{problems === 1 ? "" : "s"} not in good order
          </span>
        )}
      </>
    );
  }
  if (!body && !money && !extra) return null;
  return (
    <div className="flex flex-col gap-2">
      {money && <Totals rows={money} />}
      {body && <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 px-3 py-2 text-sm">{body}</div>}
      {extra && <div className="px-3 pb-2">{extra}</div>}
    </div>
  );
}

/**
 * A step's lines read only, in the one items box's inside (ItemsBody): the step's columns in the lined sheet on a
 * laptop, the item lines on a phone (number, name, model, the step's figure), the step's totals under them. Every
 * step box that shows the order's lines uses it (Goods from the supplier, Items to the supplier, Delivery).
 */
export function OrderLinesView({ set, lines, label }: { set: LineSet; lines: OrderLineView[]; label: string }) {
  const byNo = new Map(lines.map((l) => [l.no, l.id]));
  const rows: LineRow[] = lines.map((l) => {
    const top = l.no.includes(".") ? l.no.split(".")[0]! : null;
    return { key: l.id, parentKey: top ? (byNo.get(top) ?? null) : null, values: valuesOf(l) };
  });
  const phone: ItemsPhoneRow[] = lines.map((l) => {
    const v = valuesOf(l);
    return {
      key: l.id,
      no: l.no,
      part: l.no.includes("."),
      title: head(l.description),
      under: l.model || undefined,
      sub: phoneLine(set, v),
    };
  });
  return (
    <ItemsBody
      label={label}
      rows={rows}
      columns={columnsOf(set).map((c) => (c.key === "description" ? { ...c, width: "minmax(0,1fr)" } : c))}
      numbers={lines.map((l) => l.no)}
      phone={phone}
      totals={<StepFigures set={set} lines={lines} />}
      empty="No items on this order."
    />
  );
}
