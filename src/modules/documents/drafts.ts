import type { SessionUser } from "@/lib/auth/session";
import { addDaysISO, todayISO } from "@/lib/utils/dates";
import { DomainError, NotFoundError } from "@/lib/utils/result";
import { toEditableLine, type EditableLine } from "@/lib/line-items";
import { getQueryDetail } from "@/modules/queries/repository";
import { getQuotationDetail } from "@/modules/quotations/repository";
import { getInvoiceDetail } from "@/modules/invoices/repository";
import { getPackingListDetail } from "@/modules/packing/repository";
import { vatForCustomer } from "./vat";
import { getSettings } from "@/modules/settings/service";
import { sourcingForQuery } from "@/modules/sourcing/repository";
import { marginPercent, priceForMargin } from "@/lib/costing";
import { can } from "@/lib/auth/permissions";

/**
 * The starting values of every document form, in one place for the web pages
 * and the phone app. Each step starts from the one before it: a quotation from
 * the customer's requested items (or the latest version), an invoice from the
 * accepted quotation, a packing list from the invoice. Nothing is retyped.
 */

/** A line without our internal cost (for people who may not see costs). */
export function withoutCost(l: EditableLine): EditableLine {
  const out = { ...l };
  delete out.unitCost;
  delete out.costSourceId;
  delete out.fxRate;
  delete out.costNote;
  return out;
}

export interface PackingEditableLine {
  sourceId: string;
  /** Shipped on this packing list (services such as freight are not). */
  include: boolean;
  description: string;
  model: string;
  hsCode: string;
  quantity: string;
  unit: string;
  packages: string;
  packageType: string;
  netWeight: string;
  grossWeight: string;
  cbm: string;
}

export async function quotationDraft(user: SessionUser, queryId: string) {
  const detail = await getQueryDetail(user, queryId);
  if (!detail) throw new NotFoundError("Inquiry");
  const settings = await getSettings();
  const vat = await vatForCustomer(detail.query.customerId);
  const latest = detail.quotations[0];
  let items: EditableLine[];
  let discount = "0";
  let terms = settings.defaultQuotationTerms;
  if (latest) {
    // A new version starts from the latest one.
    const prev = await getQuotationDetail(user, latest.id);
    items = (prev?.items ?? []).map((i) => toEditableLine(i, { sourceId: i.queryItemId }));
    // If another factory line was chosen since, the new version is costed from it (keeping the line's margin).
    if (can(user.role, "sourcing.manage")) {
      const sourcing = await sourcingForQuery(queryId, settings.currency, settings.currency, settings.exchangeRates);
      items = items.map((l) => {
        const chosen = sourcing.items.find((x) => x.id === l.sourceId)?.chosen;
        if (!chosen || chosen.unitCost === null || chosen.id === l.costSourceId) return l;
        const prevVat = prev ? { rate: Number(prev.quotation.taxRate), included: prev.quotation.pricesIncludeVat } : undefined;
        const margin = l.unitCost && l.unitPrice ? (marginPercent(Number(l.unitPrice), Number(l.unitCost), prevVat) ?? settings.defaultMarginPercent) : settings.defaultMarginPercent;
        return {
          ...l,
          unitCost: String(chosen.unitCost),
          costSourceId: chosen.id,
          fxRate: String(chosen.fxRate),
          unitPrice: String(priceForMargin(chosen.unitCost, Math.min(Math.max(margin, 0), 90), vat)),
          costNote: `Now from ${chosen.supplierName} · ${chosen.offerCurrency} ${chosen.unitPriceWithVat.toLocaleString("en", { minimumFractionDigits: 2 })} incl. VAT`,
        };
      });
    }
    if (!can(user.role, "sourcing.manage")) items = items.map(withoutCost);
    discount = String(Number(prev?.quotation.discount ?? 0));
    terms = prev?.quotation.terms ?? terms;
  } else {
    // Version 1 starts from what the customer asked for. Items with a factory
    // offer are priced from it: our cost (VAT included, converted) plus the
    // default margin. The chosen offer is used, or the cheapest one.
    const sourcing = can(user.role, "sourcing.manage") ? await sourcingForQuery(queryId, settings.currency, settings.currency, settings.exchangeRates) : null;
    items = detail.items.map((i) => {
      const line = toEditableLine(i, { asSource: true, withPrice: false });
      const option = sourcing?.items.find((x) => x.id === i.id);
      const from = option?.chosen ?? option?.cheapest ?? null;
      if (!from || from.unitCost === null) return line;
      return {
        ...line,
        model: line.model || from.model || "",
        unitCost: String(from.unitCost),
        costSourceId: from.id,
        fxRate: String(from.fxRate),
        unitPrice: String(priceForMargin(from.unitCost, settings.defaultMarginPercent, vat)),
        costNote: `${from.supplierName} · ${from.offerCurrency} ${from.unitPriceWithVat.toLocaleString("en", { minimumFractionDigits: 2 })} incl. VAT`,
      };
    });
  }
  return {
    query: detail.query,
    customer: detail.customer,
    requestedItems: detail.items,
    version: (latest?.version ?? 0) + 1,
    currency: settings.currency,
    /** The VAT this quotation will carry (from Settings, none for a VAT-exempt customer). */
    vat,
    initial: {
      items,
      discount,
      dueDate: addDaysISO(todayISO(), settings.quotationValidityDays),
      submittedAt: "",
      terms,
      notes: "",
    },
  };
}

export function quotationEditValues(detail: NonNullable<Awaited<ReturnType<typeof getQuotationDetail>>>) {
  const q = detail.quotation;
  return {
    items: detail.items.map((i) => toEditableLine(i, { sourceId: i.queryItemId })),
    discount: String(Number(q.discount)),
    dueDate: q.dueDate,
    submittedAt: q.submittedAt ?? "",
    terms: q.terms ?? "",
    notes: q.notes ?? "",
  };
}

/** Throws a clear message when the quotation cannot be invoiced (yet). */
export async function invoiceDraft(user: SessionUser, quotationId: string) {
  const detail = await getQuotationDetail(user, quotationId);
  if (!detail) throw new NotFoundError("Quotation");
  const q = detail.quotation;
  if (detail.superseded) throw new DomainError(`A newer version (v${detail.latestVersion}) exists: invoice that one.`);
  if (q.status !== "accepted") throw new DomainError("Only an accepted quotation can be invoiced.");
  const existing = detail.invoices.find((i) => i.status !== "cancelled");
  if (existing) throw new DomainError(`This quotation already has invoice ${existing.invoiceNo}.`);
  const settings = await getSettings();
  const today = todayISO();
  return {
    detail,
    currency: q.currency,
    initial: {
      items: detail.items.map((i) => withoutCost(toEditableLine(i, { asSource: true }))),
      issueDate: today,
      dueDate: addDaysISO(today, settings.invoicePaymentDays),
      notes: "",
    },
  };
}

type PackingHeader = Partial<
  Record<"packDate" | "incoterm" | "portOfLoading" | "portOfDischarge" | "finalDestination" | "transport" | "containerNo" | "sealNo" | "marks" | "notes", string | null>
>;

const packingHeader = (pl?: PackingHeader) => ({
  packDate: pl?.packDate ?? todayISO(),
  incoterm: pl?.incoterm ?? "",
  portOfLoading: pl?.portOfLoading ?? "",
  portOfDischarge: pl?.portOfDischarge ?? "",
  finalDestination: pl?.finalDestination ?? "",
  transport: pl?.transport ?? "",
  containerNo: pl?.containerNo ?? "",
  sealNo: pl?.sealNo ?? "",
  marks: pl?.marks ?? "",
  notes: pl?.notes ?? "",
});

type PackRow = { invoiceItemId: string | null; packages: number; packageType: string; netWeight: string; grossWeight: string; cbm: string };

/** Lines that are a service, not goods: left out of a new packing list (they can be ticked in). */
export const isServiceLine = (description: string) =>
  /\b(freight|shipping|shipment|insurance|inspection|installation|commissioning|training|documents?|commission|handling|customs|courier)\b/i.test(description.split("\n")[0]);

/** Every invoice line, with how it is packed (from an existing packing list, matched by line). */
function packingLines(
  invoiceItems: { id: string; description: string; model: string | null; hsCode: string | null; quantity: string; unit: string }[],
  packed: PackRow[] | null = null,
): PackingEditableLine[] {
  const legacy = !!packed && packed.every((r) => !r.invoiceItemId);
  return invoiceItems.map((it, i) => {
    const p = packed ? (packed.find((r) => r.invoiceItemId === it.id) ?? (legacy ? packed[i] : undefined)) : undefined;
    return {
      sourceId: it.id,
      include: packed ? !!p : !isServiceLine(it.description),
      description: it.description,
      model: it.model ?? "",
      hsCode: it.hsCode ?? "",
      quantity: String(Number(it.quantity)),
      unit: it.unit,
      packages: p ? String(p.packages) : "1",
      packageType: p?.packageType ?? "Wooden case",
      netWeight: p && Number(p.netWeight) ? String(Number(p.netWeight)) : "",
      grossWeight: p && Number(p.grossWeight) ? String(Number(p.grossWeight)) : "",
      cbm: p && Number(p.cbm) ? String(Number(p.cbm)) : "",
    };
  });
}

/** Throws when the invoice cannot be shipped or already has its packing list. */
export async function packingDraft(invoiceId: string) {
  const detail = await getInvoiceDetail(invoiceId);
  if (!detail) throw new NotFoundError("Invoice");
  if (detail.invoice.status === "cancelled") throw new DomainError("This invoice is cancelled, so it cannot be shipped.");
  if (detail.packingList) throw new DomainError(`This invoice already has its packing list (${detail.packingList.plNo}). Open it to make changes.`);
  return { detail, initial: { items: packingLines(detail.items), ...packingHeader() } };
}

export async function packingEditValues(packingListId: string) {
  const pl = await getPackingListDetail(packingListId);
  if (!pl) throw new NotFoundError("Packing list");
  const inv = await getInvoiceDetail(pl.invoice.id);
  return { pl, initial: { items: packingLines(inv?.items ?? [], pl.items), ...packingHeader(pl.packingList) } };
}
