import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { toMinor } from "@kebo/money";
import {
  isWarrantyFrom,
  leadCheck,
  leadWords,
  partsWords,
  paymentCheck,
  planParts,
  WARRANTY_FROM_LABEL,
  warrantyCheck,
  type OurTerms,
  type TermsCheck,
  type TheirTerms,
} from "@kebo/shared";
import { Badge, cn } from "@kebo/ui";
import type { OrderView } from "@/lib/types-orders";
import type { OrderMoney } from "@/lib/types-money";
import { date, dayMonth, money } from "@/lib/format";
import { shortName } from "@/components/deals/offer-facts";

/*
 * The order's Overview, design "RFQ Desk — terms that travel" (16 Nov 2026): what was agreed with the customer
 * in the four groups every offer, quotation and order uses (Delivery · Payment · Warranty · Conditions), and the
 * customer beside the factory — what we promised against what the factory gives us, with what to look at.
 */

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type Agreed = NonNullable<OrderView["agreed"]>;

/** One of the four groups: its name, its main fact in bold, the rest under it. */
export function Group({ title, big, children }: { title: string; big: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-line bg-surface-2/40 px-3.5 py-3 text-[13px] [overflow-wrap:anywhere]">
      <h3 className="text-xs font-semibold text-text-2">{title}</h3>
      <p className="text-[15px] font-bold">{big}</p>
      {children}
    </div>
  );
}

/** "Port of discharge Karachi": a fact with its value in bold (a dash when empty). */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="text-text-2">
      {label} {children === null || children === undefined || children === "" ? <span className="text-muted">—</span> : <b className="font-semibold text-text">{children}</b>}
    </p>
  );
}

/** A condition as printed: its first lines, as typed. */
export const Printed = ({ text }: { text: string | null }) => (text?.trim() ? <p className="line-clamp-4 whitespace-pre-line text-text-2">{text}</p> : null);

/** How ship by came about, in a few words (null: nothing to say). */
export function shipByNote(a: Agreed, shipBy: string | null): { ok: boolean; text: string } | null {
  const f = a.shipByFrom;
  if (!f) return null;
  if (f.by === "typed") return { ok: false, text: "typed by hand" };
  if (f.by === "drawings") return { ok: false, text: "type it once the drawings are approved" };
  if (f.by === "order") return shipBy ? { ok: true, text: `worked out: ${plural(a.leadDays ?? 0, "day")} after the order of ${dayMonth(f.on)}` } : null;
  return f.on && shipBy ? { ok: true, text: `worked out: the deposit came in ${dayMonth(f.on)}` } : { ok: false, text: "worked out once the deposit is in" };
}

/* ---------------------------------------------------------------- the customer and the factory, side by side */

export interface SideRow {
  key: "basis" | "lead" | "payment" | "warranty";
  label: string;
  ours: string | null;
  oursSub?: string;
  theirs: string | null;
  theirsSub?: string;
  /** ok: fine; false: to look at; null: worth knowing (a different basis). */
  check: { ok: boolean | null; word: string; text?: string } | null;
}

export interface SideTable {
  key: string;
  factory: string;
  offer: string;
  rows: SideRow[];
  /** The checks to look at. */
  look: number;
}

/** What the factory's goods cost us, in the order's currency (at the rate quoted: about). */
const aboutCost = (minor: number, currency: string) => `≈ ${money((minor / 100).toFixed(2), currency)}`;
const same = (a: string | null, b: string | null) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
const asCheck = (c: TermsCheck | null): SideRow["check"] => (c ? { ok: c.ok, word: c.word, text: c.ok ? undefined : c.text } : null);

/**
 * What we promised the customer against what each factory gives us (its offer): the delivery basis, the lead time
 * (with ship by and the factory's ready date), the payment (the plan's parts against the offer's) and the warranty
 * — green when we give no more than the factory gives us, amber with what to do when we promise more.
 */
export function sideBySide(o: OrderView, m: OrderMoney | null): SideTable[] {
  const a = o.agreed;
  if (!a || !o.factoryTerms?.length) return [];
  const items = m?.plan.items ?? [];
  const planMinor = items.reduce((t, i) => t + toMinor(i.amount), 0);
  const ourParts = planParts(
    items.map((i) => ({ label: i.label, amountMinor: toMinor(i.amount), part: i.part, dueRule: i.dueRule, dueDays: i.dueDays, dueOn: i.dueOn })),
    planMinor,
    o.shipBy,
  );
  const ours: OurTerms = {
    leadDays: a.leadDays,
    leadFrom: a.leadFrom,
    parts: ourParts,
    warrantyMonths: a.warrantyMonths,
    warrantyFrom: a.warrantyFrom,
    totalMinor: toMinor(o.total),
    currency: o.currency,
  };
  const ourBasis = `${o.incoterm}${o.incotermPlace ? ` ${o.incotermPlace}` : ""}`;
  const ourWarranty = a.warrantyMonths !== null ? `${plural(a.warrantyMonths, "month")} from ${WARRANTY_FROM_LABEL[isWarrantyFrom(a.warrantyFrom) ? a.warrantyFrom : "shipment"]}` : a.warranty;
  return o.factoryTerms.map((f) => {
    const name = shortName(f.factory.name);
    const t = f.terms;
    const theirs: TheirTerms = {
      factory: name,
      leadDays: t.leadDays,
      leadFrom: t.leadFrom,
      parts: t.parts.length ? t.parts : null,
      warrantyMonths: t.warrantyMonths,
      warrantyFrom: t.warrantyFrom,
      costMinor: f.costMinor > 0 ? f.costMinor : null,
    };
    const theirBasis = f.basis ? `${f.basis}${f.basisPlace ? ` ${f.basisPlace}` : ""}` : null;
    const rows: SideRow[] = [
      {
        key: "basis",
        label: "Incoterm",
        ours: ourBasis,
        theirs: theirBasis,
        check: !theirBasis
          ? null
          : same(theirBasis, ourBasis)
            ? { ok: true, word: "The same" }
            : { ok: null, word: "Different", text: `From ${theirBasis} to ${ourBasis} is ours to arrange and pay.` },
      },
      {
        key: "lead",
        label: "Lead time",
        ours: a.leadDays !== null ? leadWords(a.leadDays, a.leadFrom, "customer") : a.leadTime,
        oursSub: o.shipBy ? `ship by ${date(o.shipBy)}` : undefined,
        theirs: t.leadDays !== null ? leadWords(t.leadDays, t.leadFrom, "factory") : null,
        theirsSub: f.readyOn ? `ready by ${date(f.readyOn)}` : undefined,
        check: asCheck(leadCheck(ours, theirs)),
      },
      {
        key: "payment",
        label: "Payment",
        ours: ourParts.length ? partsWords(ourParts, "customer") : null,
        theirs: t.parts.length ? partsWords(t.parts, "factory") : null,
        theirsSub: f.costMinor > 0 ? `${aboutCost(f.costMinor, o.currency)} in all` : undefined,
        check: asCheck(paymentCheck(ours, theirs)),
      },
      {
        key: "warranty",
        label: "Warranty",
        ours: ourWarranty,
        theirs: t.warrantyMonths !== null ? `${plural(t.warrantyMonths, "month")} from ${WARRANTY_FROM_LABEL[isWarrantyFrom(t.warrantyFrom) ? t.warrantyFrom : "shipment"]}` : null,
        check: asCheck(warrantyCheck(ours, theirs)),
      },
    ];
    const shown = rows.filter((r) => r.ours || r.theirs);
    return {
      key: f.offer.id,
      factory: name,
      offer: `${f.offer.reference ? `their offer ${f.offer.reference}` : "their offer"} of ${date(f.offer.receivedOn)}`,
      rows: shown,
      look: shown.filter((r) => r.check?.ok === false).length,
    };
  });
}

function CheckWord({ check }: { check: NonNullable<SideRow["check"]> }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <Badge tone={check.ok === true ? "ok" : check.ok === false ? "warn" : "neutral"}>
        {check.ok === true ? <CheckCircle2 className="size-3" aria-hidden /> : check.ok === false ? <AlertTriangle className="size-3" aria-hidden /> : null}
        {check.word}
      </Badge>
      {check.text && <span className="text-xs text-text-2">{check.text}</span>}
    </span>
  );
}

/**
 * The customer and the factory, side by side: one table per factory offer. On a phone each row is a short card:
 * what it is, what we promised, what the factory gives, then the check.
 */
export function SideBySideTable({ table, customer, many }: { table: SideTable; customer: string; many: boolean }) {
  const cell = "px-3.5 py-2.5 align-top max-sm:p-0";
  return (
    <div className="min-w-0 border-t border-line">
      {many && (
        <p className="px-[18px] pt-2.5 text-xs text-text-2">
          <b className="font-semibold text-text">{table.factory}</b> · {table.offer}
        </p>
      )}
      {/* Made to fit a phone (each row a short card there): no phone-width minimum. */}
      <table data-fit="" className="w-full table-fixed text-[13px] max-sm:block">
        <caption className="sr-only">
          What we promised {customer}, beside what {table.factory} gives us ({table.offer})
        </caption>
        <thead className="max-sm:sr-only">
          <tr className="text-left text-xs text-text-2">
            <th scope="col" className="w-[130px] px-3.5 py-2 pl-[18px] font-medium">
              <span className="sr-only">Term</span>
            </th>
            <th scope="col" className="px-3.5 py-2 font-medium">
              What we promised {customer}
            </th>
            <th scope="col" className="px-3.5 py-2 font-medium">
              What {table.factory} gives us
            </th>
            <th scope="col" className="w-[32%] px-3.5 py-2 pr-[18px] font-medium">
              <span className="sr-only">Check</span>
            </th>
          </tr>
        </thead>
        <tbody className="max-sm:block">
          {table.rows.map((r) => (
            <tr key={r.key} className="border-t border-line max-sm:flex max-sm:flex-col max-sm:gap-1 max-sm:px-[18px] max-sm:py-2.5">
              <th scope="row" className={cn(cell, "pl-[18px] text-left font-semibold max-sm:pl-0")}>
                {r.label}
              </th>
              <td className={cell}>
                <span className="text-xs text-text-2 sm:hidden">We promised: </span>
                {r.ours ?? <span className="text-muted">—</span>}
                {r.oursSub && <span className="block text-xs text-text-2">{r.oursSub}</span>}
              </td>
              <td className={cell}>
                <span className="text-xs text-text-2 sm:hidden">{table.factory} gives: </span>
                {r.theirs ?? <span className="text-muted">—</span>}
                {r.theirsSub && <span className="block text-xs text-text-2">{r.theirsSub}</span>}
              </td>
              <td className={cn(cell, "pr-[18px] max-sm:pr-0")}>{r.check ? <CheckWord check={r.check} /> : <span className="text-muted max-sm:hidden">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
