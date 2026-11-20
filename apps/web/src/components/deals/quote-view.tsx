import { AlertTriangle, CheckCircle2, Lock, Pencil } from "lucide-react";
import { toMinor } from "@kebo/money";
import { isWarrantyFrom, LINE_TYPE_LABEL, partsWords, partWhen, percentText, termsChecks, warrantyLine, type TermsCheck, type WarrantyFrom } from "@kebo/shared";
import { Badge, cn, Dash } from "@kebo/ui";
import { money, qty } from "@/lib/format";
import type { OptionView, RevisionView } from "@/lib/types-deals";
import type { LineColumn, LineRow } from "@/components/lines/line-table";
import type { ItemsPhoneRow } from "@/components/records/items-box";
import { Totals } from "@/components/records/totals";
import { SheetFact, SheetPart } from "@/components/records/phone-items";
import { OpenPanelButton } from "@/components/common/panel";
import { shortName } from "./offer-facts";

/*
 * One quotation read only, from the record pieces (canvas board "The quotation, from the pieces"): its prices in the
 * one items box with the totals under them, its checks against the supplier's offer, and the facts the
 * Quotations tab lists. Server-safe: no state of its own.
 */

const two = (v: string | number) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The option that speaks for the revision: the accepted one, else the first. */
export const optionOf = (r: RevisionView): OptionView | undefined => r.options.find((o) => o.status === "accepted") ?? r.options[0];

/** What we promise against what the option's factory gives (people who see costs): lead time, payment, warranty. */
export function checksOf(r: RevisionView, o: OptionView | undefined): TermsCheck[] {
  if (!o?.factory || !o.factoryTerms) return [];
  const factoryMinor = o.costing ? o.costing.costMinor - o.costing.extraCostMinor : 0;
  return termsChecks(
    { leadDays: o.leadDays, leadFrom: o.leadFrom, parts: r.paymentParts, warrantyMonths: r.warrantyMonths, warrantyFrom: r.warrantyFrom, totalMinor: toMinor(o.total), currency: r.currency },
    { factory: shortName(o.factory.name), ...o.factoryTerms, costMinor: factoryMinor > 0 ? factoryMinor : null },
  );
}

/** A check as a short chip: its words, the whole sentence on hover and for screen readers. */
export function CheckChip({ check }: { check: TermsCheck }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", check.ok ? "text-ok" : "text-warn")} title={check.text}>
      {check.ok ? <CheckCircle2 className="size-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="size-3.5 shrink-0" aria-hidden />}
      {check.word}
      <span className="sr-only">: {check.text}</span>
    </span>
  );
}

const FROM_SHORT: Record<WarrantyFrom, string> = { shipment: "shipment", delivery: "delivery", sat: "SAT" };

/** The revision's facts in a line each, for the list row: "FOB Ningbo", "45 days after the deposit", the parts, "12 months from SAT". */
export function termsFacts(r: RevisionView) {
  const o = optionOf(r);
  const from = isWarrantyFrom(r.warrantyFrom) ? r.warrantyFrom : "shipment";
  return {
    delivery: `${r.incoterm}${r.incotermPlace ? ` ${r.incotermPlace}` : ""}`,
    lead: o?.leadTime ?? r.leadTime ?? null,
    payment: partsWords(r.paymentParts, "customer"),
    warranty: r.warrantyMonths !== null ? `${r.warrantyMonths} months from ${FROM_SHORT[from]}` : (warrantyLine(r)?.replace(/\.$/, "") ?? null),
  };
}

/** "2 items, 3 parts": a quotation's lines, parts (2.1) apart. */
export function quoteCount(o: OptionView) {
  const parts = o.lines.filter((l) => l.no.includes(".")).length;
  const items = o.lines.length - parts;
  return [`${items} item${items === 1 ? "" : "s"}`, parts ? `${parts} part${parts === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
}

/** An option's name over its prices when the quotation offers several ("Option A · Jinan · accepted"). */
export function optionTitle(o: OptionView) {
  return `Option ${o.letter}${o.factory ? ` · ${shortName(o.factory.name)}` : ""}${o.status === "accepted" ? " · accepted" : o.status === "not_chosen" ? " · not chosen" : ""}`;
}

const marginOf = (price: string, cost: string | null | undefined) => {
  const p = Number(price);
  const k = cost === null || cost === undefined || cost === "" ? NaN : Number(cost);
  return p > 0 && Number.isFinite(k) ? ((p - k) / p) * 100 : null;
};
const marginTone = (m: number | null) => (m === null ? "text-text-2" : m < 0 ? "text-bad" : m < 5 ? "text-warn" : undefined);
const dash = <Dash />;

/**
 * An option's prices for the one items box (canvas board "The quotation, from the pieces"): the columns from the one
 * set — our cost and the margin shaded, for people who see costs — its rows (parts as 2.1), its phone rows, its
 * totals (with our cost, profit and margin in the "Ours only" strip) and plain columns for its Excel file.
 */
export function quotePrices(o: OptionView, currency: string, phone: { edit?: boolean; locked?: boolean } = {}) {
  const costs = !!o.costing;
  const rows: LineRow[] = o.lines.map((l) => ({
    key: l.id,
    parentKey: l.no.includes(".") ? l.no.split(".")[0]! : null,
    values: { description: l.description, model: l.model ?? "", quantity: l.quantity, unit: l.unit, unitCost: l.unitCost ?? "", unitPrice: l.unitPrice, lineTotal: l.lineTotal },
    badge:
      l.type !== "goods" ? (
        <span className="ml-1.5 align-middle">
          <Badge tone="outline">{LINE_TYPE_LABEL[l.type]}</Badge>
        </span>
      ) : undefined,
  }));
  const plain: LineColumn[] = [
    { key: "description", label: "Description", width: "minmax(0,1fr)" },
    ...(o.lines.some((l) => l.model) ? [{ key: "model", label: "Model / part no.", width: "8rem" }] : []),
    { key: "quantity", label: "Quantity", width: "4rem", align: "right" },
    { key: "unit", label: "Unit", width: "4rem" },
    { key: "unitPrice", label: `Unit price ${currency}`, width: "6.5rem", align: "right" },
    { key: "lineTotal", label: `Amount ${currency}`, width: "7.5rem", align: "right" },
  ];
  const columns: LineColumn[] = plain.flatMap((c): LineColumn[] => {
    if (c.key === "quantity") return [{ ...c, format: (v) => qty(v.quantity!) }];
    if (c.key === "unitPrice")
      return [
        ...(costs ? [{ key: "unitCost", label: "Our cost", width: "6.5rem", align: "right" as const, shade: true, format: (v: LineRow["values"]) => (Number(v.unitCost) > 0 ? two(v.unitCost!) : dash) }] : []),
        { ...c, format: (v) => (Number(v.unitPrice) > 0 ? two(v.unitPrice!) : dash) },
        ...(costs
          ? [
              {
                key: "margin",
                label: "Margin",
                width: "4.5rem",
                align: "right" as const,
                shade: true,
                format: (v: LineRow["values"]) => {
                  const m = marginOf(v.unitPrice!, v.unitCost);
                  return <span className={marginTone(m)}>{m === null ? "—" : `${m.toFixed(1)}%`}</span>;
                },
              },
            ]
          : []),
      ];
    if (c.key === "lineTotal") return [{ ...c, format: (v) => (Number(v.lineTotal) > 0 ? <span className="font-semibold">{two(v.lineTotal!)}</span> : dash) }];
    return [c];
  });
  // A phone: the item line, read only; a tap shows its price, our cost and margin, and its one way to change.
  const phoneRows: ItemsPhoneRow[] = o.lines.map((l) => {
    const m = costs ? marginOf(l.unitPrice, l.unitCost) : null;
    const priced = Number(l.unitPrice) > 0;
    return {
      key: l.id,
      no: l.no,
      part: l.no.includes("."),
      title: l.description.split("\n")[0],
      under: l.model || undefined,
      badge: rows.find((r) => r.key === l.id)?.badge,
      sub: priced ? `${qty(l.quantity)} ${l.unit} × ${two(l.unitPrice)}` : `${qty(l.quantity)} ${l.unit}`,
      amount: Number(l.lineTotal) > 0 ? two(l.lineTotal) : undefined,
      more: m !== null ? <span className={marginTone(m)}>margin {m.toFixed(1)}%</span> : undefined,
      sheet: {
        sub: [l.model, `${qty(l.quantity)} ${l.unit}`].filter(Boolean).join(" · "),
        body: (
          <>
            <SheetPart>
              <SheetFact label="Unit price">{priced ? money(l.unitPrice, currency) : "—"}</SheetFact>
              <SheetFact label="Amount">{Number(l.lineTotal) > 0 ? money(l.lineTotal, currency) : "—"}</SheetFact>
              {costs && (
                <SheetFact label="Our cost · margin" ours>
                  {Number(l.unitCost) > 0 ? money(l.unitCost!, currency) : "—"}
                  {m !== null ? ` · ${m.toFixed(1)}%` : ""}
                </SheetFact>
              )}
            </SheetPart>
            {phone.edit ? (
              <div className="px-4 pt-1 pb-2">
                <OpenPanelButton panel="edit-quote" className="w-full">
                  <Pencil aria-hidden /> Edit prices
                </OpenPanelButton>
              </div>
            ) : phone.locked ? (
              <p className="flex items-center gap-1.5 px-4 pt-1 pb-2 text-md text-text-2">
                <Lock className="size-3.5" aria-hidden /> Sent: a change needs a new revision.
              </p>
            ) : null}
          </>
        ),
      },
    };
  });
  const discount = Number(o.discount);
  const totals = (
    <Totals
      ours={
        o.costing
          ? [
              { label: "Our cost", value: money(o.costing.cost, currency) },
              { label: "Profit", value: money(o.costing.profit, currency), bad: Number(o.costing.profit) < 0 },
              { label: "Margin", value: o.costing.marginPercent === null ? "—" : `${o.costing.marginPercent.toFixed(1)}%`, bad: o.costing.marginPercent !== null && o.costing.marginPercent < 0 },
            ]
          : null
      }
      rows={[
        ...(discount ? [{ label: "Subtotal", value: money(o.subtotal, currency) }, { label: "Discount", value: money(o.discount, currency) }] : []),
        { label: "Total", value: money(o.total, currency), big: true },
      ]}
    />
  );
  return { rows, columns, plain, numbers: o.lines.map((l) => l.no), phone: phoneRows, totals };
}

/** A quotation's payment, a part a line: "30% with the order", its amount under it. */
export function PaymentParts({ r, total }: { r: RevisionView; total: number }) {
  if (!r.paymentParts.length) return null;
  return (
    <span className="flex flex-col gap-1">
      {r.paymentParts.map((p, i) => (
        <span key={i} className="tabular">
          {percentText(p.percent)}% {partWhen(p, "customer")}
          {total > 0 && <span className="block text-xs font-normal text-text-2">{money((total * p.percent) / 100, r.currency)}</span>}
        </span>
      ))}
    </span>
  );
}
