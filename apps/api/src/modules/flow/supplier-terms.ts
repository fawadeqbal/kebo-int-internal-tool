import { fromDbDate, type Prisma } from "@kebo/database";
import { isLeadFrom, isWarrantyFrom, leadWords, warrantyLine, type LeadFrom, type WarrantyFrom } from "@kebo/shared";
import { addDays, type ISODate } from "@kebo/utils";

/*
 * Agreed with the supplier (design "RFQ Desk — terms that travel", step 3b): what each purchase order keeps as
 * agreed with its supplier — copied from the offer its lines were bought on when it is sent, changed there later
 * with a reason — and, until then, the offer's own terms. The same four groups as the customer's: Delivery (basis,
 * lead time and the ready date worked out from it), Payment (the plan's parts and the note), Warranty, Conditions.
 */

/** The offer's terms, as read with a purchase order's lines. */
export const offerTermsSelect = {
  id: true,
  reference: true,
  receivedOn: true,
  basis: true,
  basisPlace: true,
  leadTime: true,
  leadDays: true,
  leadFrom: true,
  warranty: true,
  warrantyMonths: true,
  warrantyFrom: true,
  paymentTerms: true,
  paymentParts: true,
  moq: true,
} satisfies Prisma.SupplierQuoteSelect;

export type OfferTermsRow = Prisma.SupplierQuoteGetPayload<{ select: typeof offerTermsSelect }>;

/** The purchase order's own copy. */
export const poTermsSelect = {
  termsCopied: true,
  basis: true,
  basisPlace: true,
  leadDays: true,
  leadFrom: true,
  warrantyMonths: true,
  warrantyFrom: true,
  warrantyWords: true,
  paymentNote: true,
  moq: true,
  conditionsNotes: true,
} satisfies Prisma.PurchaseOrderSelect;

export type PoTermsRow = Prisma.PurchaseOrderGetPayload<{ select: typeof poTermsSelect }>;

export interface SupplierTerms {
  basis: OfferTermsRow["basis"];
  basisPlace: string | null;
  leadDays: number | null;
  leadFrom: LeadFrom | null;
  /** In words ("30 days after the advance"); an older offer's own words. */
  leadTime: string | null;
  warrantyMonths: number | null;
  warrantyFrom: WarrantyFrom | null;
  warranty: string | null;
  /** Printed after the payment's parts. An older offer's payment words are its terms, not a note: none. */
  paymentNote: string | null;
  moq: string | null;
  /** Our notes to the supplier, printed last (the offer has none of ours). */
  notes: string | null;
  /** The warranty as the paper prints it. */
  warrantyLine: string | null;
}

/** What the offer said, in the agreed shape. */
export function offeredTerms(q: OfferTermsRow | null): SupplierTerms {
  const t = {
    basis: q?.basis ?? null,
    basisPlace: q?.basisPlace ?? null,
    leadDays: q?.leadDays ?? null,
    leadFrom: isLeadFrom(q?.leadFrom) ? q!.leadFrom! : null,
    leadTime: q ? (q.leadDays !== null ? leadWords(q.leadDays, q.leadFrom, "factory") : q.leadTime) : null,
    warrantyMonths: q?.warrantyMonths ?? null,
    warrantyFrom: isWarrantyFrom(q?.warrantyFrom) ? q!.warrantyFrom! : null,
    warranty: q?.warranty ?? null,
    paymentNote: q && Array.isArray(q.paymentParts) && q.paymentTerms?.trim() ? q.paymentTerms.trim() : null,
    moq: q?.moq ?? null,
    notes: null,
  };
  return { ...t, warrantyLine: warrantyLine(t) };
}

/** Agreed with the supplier: the purchase order's own copy, else (not sent yet, or sent before it was kept) its offer's. */
export function supplierAgreed(po: PoTermsRow, q: OfferTermsRow | null) {
  const offered = offeredTerms(q);
  const own: SupplierTerms = po.termsCopied
    ? (() => {
        const t = {
          basis: po.basis,
          basisPlace: po.basisPlace,
          leadDays: po.leadDays,
          leadFrom: isLeadFrom(po.leadFrom) ? po.leadFrom : null,
          leadTime: po.leadDays !== null ? leadWords(po.leadDays, po.leadFrom, "factory") : offered.leadTime,
          warrantyMonths: po.warrantyMonths,
          warrantyFrom: isWarrantyFrom(po.warrantyFrom) ? po.warrantyFrom : null,
          warranty: po.warrantyWords,
          paymentNote: po.paymentNote,
          moq: po.moq,
          notes: po.conditionsNotes,
        };
        return { ...t, warrantyLine: warrantyLine(t) };
      })()
    : offered;
  return { copied: po.termsCopied, ...own, offered };
}

/** The offer's terms as the purchase order's own copy (taken when it is sent). */
export function copyOfOffer(
  q: OfferTermsRow | null,
): Pick<
  Prisma.PurchaseOrderUncheckedUpdateInput,
  "termsCopied" | "basis" | "basisPlace" | "leadDays" | "leadFrom" | "warrantyMonths" | "warrantyFrom" | "warrantyWords" | "paymentNote" | "moq" | "conditionsNotes"
> {
  const t = offeredTerms(q);
  return {
    termsCopied: true,
    basis: q?.basis ?? null,
    basisPlace: t.basisPlace,
    leadDays: t.leadDays,
    leadFrom: t.leadDays === null ? null : (t.leadFrom ?? "after_payment"),
    warrantyMonths: t.warrantyMonths,
    warrantyFrom: t.warrantyMonths === null ? null : (t.warrantyFrom ?? "shipment"),
    warrantyWords: t.warranty,
    paymentNote: t.paymentNote,
    moq: t.moq,
    conditionsNotes: null,
  };
}

/**
 * The ready date worked out from the lead time: days after the advance was paid in full, or after we ordered;
 * waiting for the advance (on: null); after the drawings (not worked out). Null: no lead time in days.
 */
export function readyFromLead(
  t: Pick<SupplierTerms, "leadDays" | "leadFrom">,
  orderedOn: ISODate | null,
  advancePaidOn: ISODate | null,
): { by: "advance"; on: ISODate | null; readyOn: ISODate | null } | { by: "order"; on: ISODate | null; readyOn: ISODate | null } | { by: "drawings" } | null {
  if (t.leadDays === null) return null;
  if (t.leadFrom === "after_drawings") return { by: "drawings" };
  if (t.leadFrom === "after_order") return { by: "order", on: orderedOn, readyOn: orderedOn ? addDays(orderedOn, t.leadDays) : null };
  return { by: "advance", on: advancePaidOn, readyOn: advancePaidOn ? addDays(advancePaidOn, t.leadDays) : null };
}

/** The day the parts due when we order were paid in full: the last day a payment went to them (null: not yet, or none). */
export function advancePaidOn(rows: { dueRule: string; status: string; payments: { id: string }[] }[], dayOf: Map<string, Date>): ISODate | null {
  const advance = rows.filter((r) => r.dueRule === "on_order");
  if (!advance.length || advance.some((r) => r.status !== "paid")) return null;
  const days = advance.flatMap((r) => r.payments.map((p) => dayOf.get(p.id))).filter((d): d is Date => !!d);
  if (!days.length) return null;
  return fromDbDate(new Date(Math.max(...days.map((d) => d.getTime()))));
}
