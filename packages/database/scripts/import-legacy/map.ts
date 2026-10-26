/**
 * Pure mapping rules for the one-time import from the old app (legacy/, Drizzle)
 * into the new schema. No database access here: import-legacy.ts reads the old
 * rows, asks these functions what they become, and writes the result. The rules
 * follow docs/revamp-plan.md ("Data import mapping").
 */
import { splitDeposit, type Minor } from "@kebo/money";
import {
  SETTINGS,
  type BalanceTerms,
  type Incoterm,
  type InquiryChannel,
  type InquiryStage,
  type LineType,
  type LostReason,
  type OrderStage,
  type OrderStatus,
  type PaymentKind,
  type PaymentMethod,
  type RevisionStatus,
  type Settings,
  type SettingsKey,
  type TaxTreatment,
} from "@kebo/shared";
import { DOCUMENT_PREFIX, parseReference, type DocumentKind, type ISODate } from "@kebo/utils";

/* ---------------------------------------------------------------- old vocabulary */

export type LegacyQueryStatus = "pending" | "processing" | "completed" | "not_completed";
export type LegacyQuotationStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";
export type LegacySource = "phone" | "email" | "whatsapp" | "walk_in" | "website" | "other" | "wechat";
export type LegacyPaymentMethod = "cash" | "bank_transfer" | "cheque" | "online" | "other" | "lc";

/** Sent to the customer at some point (the old "quoted" signal). */
const SENT_STATUSES: readonly LegacyQuotationStatus[] = ["sent", "accepted", "rejected", "expired"];
export const wasSent = (status: LegacyQuotationStatus) => SENT_STATUSES.includes(status);

/* ---------------------------------------------------------------- small enums */

const CHANNELS: Record<LegacySource, InquiryChannel> = {
  phone: "phone",
  email: "email",
  whatsapp: "whatsapp",
  wechat: "wechat",
  website: "website",
  walk_in: "visit",
  other: "other",
};
export const mapChannel = (source: LegacySource): InquiryChannel => CHANNELS[source] ?? "other";

const METHODS: Record<LegacyPaymentMethod, PaymentMethod> = {
  cash: "cash",
  bank_transfer: "bank_transfer",
  cheque: "cheque",
  online: "online",
  other: "other",
  lc: "letter_of_credit",
};
export const mapPaymentMethod = (method: LegacyPaymentMethod): PaymentMethod => METHODS[method] ?? "other";

/** Customer payments on an order, oldest first: the first is the deposit, the rest pay the balance. */
export const paymentKind = (index: number): PaymentKind => (index === 0 ? "deposit" : "balance");

/** The old app's rule for lines that are not goods (legacy/src/modules/documents/drafts.ts `isServiceLine`). */
export const isServiceLine = (description: string) =>
  /\b(freight|shipping|shipment|insurance|inspection|installation|commissioning|training|documents?|commission|handling|customs|courier)\b/i.test(description.split("\n")[0]);

/** Quotation / invoice line type: a charge when the old app treated it as a service line, else goods. */
export const lineType = (description: string): LineType => (isServiceLine(description) ? "charge" : "goods");

/* ---------------------------------------------------------------- parties */

/**
 * The old customers had a VAT-exempt flag; the new ones have a tax treatment.
 * Exempt → zero-rated export. Not exempt only meant VAT when the old app had a
 * VAT rate set; with a 0% rate nobody was ever charged VAT, so they stay export.
 */
export function mapTaxTreatment(vatExempt: boolean, legacyVatRate: number): TaxTreatment {
  return !vatExempt && legacyVatRate > 0 ? "domestic_vat" : "export_zero_rated";
}

/** Placeholder country for customers the old app had none for (the app asks for it on first edit). */
export const UNKNOWN_COUNTRY = "ZZ";

const CALLING_CODES: [string, string][] = [
  ["+880", "BD"], ["+971", "AE"], ["+966", "SA"], ["+974", "QA"], ["+968", "OM"], ["+965", "KW"], ["+973", "BH"],
  ["+998", "UZ"], ["+996", "KG"], ["+992", "TJ"], ["+993", "TM"], ["+994", "AZ"], ["+212", "MA"], ["+213", "DZ"],
  ["+216", "TN"], ["+218", "LY"], ["+234", "NG"], ["+233", "GH"], ["+254", "KE"], ["+255", "TZ"], ["+256", "UG"],
  ["+251", "ET"], ["+260", "ZM"], ["+263", "ZW"], ["+249", "SD"], ["+964", "IQ"], ["+962", "JO"], ["+961", "LB"],
  ["+963", "SY"], ["+967", "YE"], ["+977", "NP"], ["+976", "MN"], ["+855", "KH"], ["+856", "LA"], ["+852", "HK"],
  ["+92", "PK"], ["+91", "IN"], ["+93", "AF"], ["+94", "LK"], ["+95", "MM"], ["+98", "IR"], ["+90", "TR"],
  ["+86", "CN"], ["+84", "VN"], ["+66", "TH"], ["+62", "ID"], ["+60", "MY"], ["+63", "PH"], ["+20", "EG"],
  ["+27", "ZA"], ["+44", "GB"], ["+49", "DE"], ["+33", "FR"], ["+39", "IT"], ["+34", "ES"], ["+55", "BR"],
  ["+52", "MX"], ["+7", "RU"], ["+1", "US"],
];

/** A guess from the phone's calling code, only to help whoever fills the countries in (never stored). */
export function countryHintFromPhone(phone: string | null | undefined): string | null {
  const p = (phone ?? "").replace(/[^\d+]/g, "").replace(/^00/, "+");
  if (!p.startsWith("+")) return null;
  return CALLING_CODES.find(([code]) => p.startsWith(code))?.[1] ?? null;
}

/* ---------------------------------------------------------------- inquiry stage */

export interface StageFacts {
  status: LegacyQueryStatus;
  assigned: boolean;
  /** A (not deleted) quotation version was sent at some point. */
  quotationSent: boolean;
  /** A (not deleted) quotation version is accepted. */
  quotationAccepted: boolean;
  statusReason: string | null;
}

export interface StageResult {
  stage: InquiryStage;
  lostReason: LostReason | null;
  lostNote: string | null;
  /** The order made from the accepted quotation is cancelled (deal closed as not completed after acceptance). */
  orderCancelled: boolean;
  /** Set when the old data needed a judgement call (listed in the report). */
  judgement: string | null;
}

const note = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

/**
 * pending → new (sourcing if assigned); processing → quoted if a quotation was
 * sent, else sourcing; completed → won if a quotation was accepted, else lost
 * (reason "other", old reason kept as the note); not_completed → lost.
 * An accepted quotation always makes an order, so an open deal with one is won.
 */
export function mapInquiryStage(f: StageFacts): StageResult {
  const base = { lostReason: null, lostNote: null, orderCancelled: false, judgement: null };
  if (f.status === "not_completed") {
    return {
      stage: "lost",
      lostReason: "other",
      lostNote: note(f.statusReason),
      orderCancelled: f.quotationAccepted,
      judgement: f.quotationAccepted ? "closed as not completed after its quotation was accepted: order imported as cancelled, revision void" : null,
    };
  }
  if (f.status === "completed") {
    if (f.quotationAccepted) return { ...base, stage: "won" };
    return {
      ...base,
      stage: "lost",
      lostReason: "other",
      lostNote: note(f.statusReason) ?? "Marked completed in the old app without an accepted quotation.",
      judgement: "completed without an accepted quotation → lost (reason other)",
    };
  }
  if (f.quotationAccepted) return { ...base, stage: "won", judgement: `still ${f.status} in the old app but its quotation is accepted → won (order created)` };
  if (f.status === "processing") return { ...base, stage: f.quotationSent ? "quoted" : "sourcing" };
  return { ...base, stage: f.assigned ? "sourcing" : "new" };
}

/** An old status-history entry as a stage (completed depends on how the deal ended). */
export function mapHistoryStage(status: LegacyQueryStatus, quotationAccepted: boolean): InquiryStage {
  switch (status) {
    case "pending":
      return "new";
    case "processing":
      return "sourcing";
    case "completed":
      return quotationAccepted ? "won" : "lost";
    case "not_completed":
      return "lost";
  }
}

/* ---------------------------------------------------------------- quotation revisions */

export interface LegacyVersion {
  id: string;
  version: number;
  status: LegacyQuotationStatus;
  deleted: boolean;
}

export interface RevisionMapping {
  status: RevisionStatus;
  /** Soft-delete it on import (an older draft left behind by a newer version). */
  discard: boolean;
  judgement: string | null;
}

/**
 * One old quotation row per version → one revision each. A sent version that a
 * newer non-draft version exists for is superseded. The new schema allows one
 * open draft and one accepted revision per quotation, so older leftovers of
 * those are superseded or discarded (and reported).
 */
export function mapRevisionStatuses(versions: LegacyVersion[], opts: { orderCancelled?: boolean } = {}): Map<string, RevisionMapping> {
  const live = versions.filter((v) => !v.deleted);
  const newerNonDraft = (v: LegacyVersion) => live.some((o) => o.version > v.version && o.status !== "draft");
  const newerAny = (v: LegacyVersion) => live.some((o) => o.version > v.version);
  const out = new Map<string, RevisionMapping>();
  for (const v of versions) {
    let m: RevisionMapping = { status: v.status, discard: false, judgement: null };
    if (!v.deleted) {
      if (v.status === "sent" && newerNonDraft(v)) m = { status: "superseded", discard: false, judgement: null };
      else if (v.status === "accepted" && newerNonDraft(v))
        m = { status: "superseded", discard: false, judgement: `v${v.version} was accepted but a newer version was sent after it → superseded (no order made from it)` };
      else if (v.status === "accepted" && opts.orderCancelled) m = { status: "void", discard: false, judgement: null };
      else if (v.status === "draft" && newerAny(v)) m = { status: "draft", discard: true, judgement: `draft v${v.version} left behind by a newer version → imported as deleted` };
    }
    out.set(v.id, m);
  }
  return out;
}

/* ---------------------------------------------------------------- commercial terms */

/** "30% advance by bank transfer…" → 30. Null when the terms do not say. */
export function depositPercentFromTerms(terms: string | null | undefined): number | null {
  const m = /(\d{1,3}(?:\.\d+)?)\s*%\s*(?:of the total\s*)?(?:in\s+)?(?:advance|deposit|down[\s-]?payment|prepayment|upfront)/i.exec(terms ?? "");
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}

const INCOTERM_ALIASES: Record<string, Incoterm> = { CNF: "CFR", "C&F": "CFR", CANDF: "CFR", DAT: "DPU" };
const INCOTERM_CODES = new Set<string>(["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"]);

/** "CIF Karachi" → { incoterm: "CIF", place: "Karachi" }. Null when it does not start with a trade term. */
export function parseIncoterm(text: string | null | undefined): { incoterm: Incoterm; place: string | null } | null {
  const m = /^\s*(C&F|[A-Z]{3})\b[\s,:-]*(.*)$/i.exec(text ?? "");
  if (!m) return null;
  const code = m[1].toUpperCase();
  const incoterm = INCOTERM_CODES.has(code) ? (code as Incoterm) : INCOTERM_ALIASES[code];
  if (!incoterm) return null;
  const place = m[2].trim().slice(0, 80);
  return { incoterm, place: place || null };
}

/**
 * The day the customer accepted (the order date). The old app kept no
 * acceptance date: use the audit log's status change when there is one, else
 * the quotation's last update (if it is not before it was sent), else the day
 * it was sent; never after the first invoice.
 */
export function acceptanceDate(f: { auditOn: ISODate | null; updatedOn: ISODate; sentOn: ISODate | null; createdOn: ISODate; firstInvoiceOn: ISODate | null }): {
  date: ISODate;
  inferred: boolean;
} {
  let date: ISODate;
  if (f.auditOn) date = f.auditOn;
  else if (!f.sentOn || f.updatedOn >= f.sentOn) date = f.updatedOn;
  else date = f.sentOn;
  if (f.firstInvoiceOn && date > f.firstInvoiceOn) date = f.firstInvoiceOn;
  if (date < f.createdOn) date = f.createdOn;
  return { date, inferred: !f.auditOn };
}

/* ---------------------------------------------------------------- order checklist */

export interface Evidence {
  /** Document number or payment reference, quoted in the step's note. */
  ref: string;
  on: ISODate;
  /** Who recorded it in the old app. */
  by: string;
}

export interface OrderStageFacts {
  status: OrderStatus;
  orderedOn: ISODate;
  /** When the old deal was completed (closed orders). */
  closedOn: ISODate | null;
  depositPercent: number;
  totalMinor: Minor;
  /** Customer payments. */
  payments: (Evidence & { amountMinor: Minor })[];
  /** Packing lists of invoices that still stand. */
  shipments: Evidence[];
}

export interface InferredStage {
  stage: OrderStage;
  /** When the order entered that stage, as best the old data shows. */
  since: ISODate;
  shippedOn: ISODate | null;
  /** Each stage it went through, with the day and why we think so. */
  history: { to: OrderStage; on: ISODate; note: string }[];
}

const byDate = <T extends { on: ISODate }>(xs: T[]) => [...xs].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));

/**
 * Where an old order stands among Confirmed → In production → Shipped → Done:
 * closed in the old app → Done; a packing list → Shipped; payments reaching the
 * deposit → In production; otherwise Confirmed. Money is never assumed: what is
 * still owed shows on the order, whatever its stage.
 */
export function inferStage(f: OrderStageFacts): InferredStage {
  const { deposit } = splitDeposit(f.totalMinor, f.depositPercent);
  let paid = 0;
  let depositOn: ISODate | null = null;
  for (const p of byDate(f.payments)) {
    paid += p.amountMinor;
    if (!depositOn && paid >= deposit && paid > 0) depositOn = p.on;
  }
  const shipment = byDate(f.shipments)[0];
  const shippedOn = shipment?.on ?? null;
  const stage: OrderStage = f.status === "closed" ? "done" : shipment ? "shipped" : depositOn ? "in_production" : "confirmed";

  const history: InferredStage["history"] = [{ to: "confirmed", on: f.orderedOn, note: "Imported: the quotation was accepted in the old app." }];
  const reached = (s: OrderStage) => ["confirmed", "in_production", "shipped", "done"].indexOf(stage) >= ["confirmed", "in_production", "shipped", "done"].indexOf(s);
  if (reached("in_production")) {
    history.push(
      depositOn
        ? { to: "in_production", on: depositOn, note: `Imported: payments reached the ${f.depositPercent}% deposit.` }
        : { to: "in_production", on: shippedOn ?? f.closedOn ?? f.orderedOn, note: "Imported: no deposit was recorded in the old app; production is assumed because the order went further." },
    );
  }
  if (reached("shipped") && shipment) history.push({ to: "shipped", on: shipment.on, note: `Imported: packing list ${shipment.ref} (pack date).` });
  if (reached("done")) history.push({ to: "done", on: f.closedOn ?? shippedOn ?? f.orderedOn, note: "Imported: the deal was completed in the old app." });
  return { stage, since: history[history.length - 1]!.on, shippedOn, history };
}

/**
 * Old "completed" means staff closed the deal. Close its order only when
 * nothing is left to chase (paid in full and shipped); a deal closed as not
 * completed after acceptance has its order cancelled; everything else stays open.
 */
export function orderStatusFor(f: { legacyStatus: LegacyQueryStatus; paidInFull: boolean; shipped: boolean }): OrderStatus {
  if (f.legacyStatus === "not_completed") return "cancelled";
  if (f.legacyStatus === "completed" && f.paidInFull && f.shipped) return "closed";
  return "open";
}

/* ---------------------------------------------------------------- counters */

/**
 * Counter values so new numbers continue after the imported ones: the highest
 * sequence per PREFIX-YEAR among the imported references, or the old counter
 * when it is higher (numbers of deleted records are never reused).
 */
export function counterValues(refs: string[], legacyCounters: Record<string, number>, kinds: DocumentKind[]): Map<string, number> {
  const prefixes = new Set<string>(kinds.map((k) => DOCUMENT_PREFIX[k]));
  const out = new Map<string, number>();
  for (const ref of refs) {
    const p = parseReference(ref);
    if (!p || !prefixes.has(p.prefix)) continue;
    const key = `${p.prefix}-${p.year}`;
    out.set(key, Math.max(out.get(key) ?? 0, p.sequence));
  }
  for (const [key, value] of Object.entries(legacyCounters)) {
    const m = /^([A-Z]+)-(\d{4})$/.exec(key);
    if (m && prefixes.has(m[1])) out.set(key, Math.max(out.get(key) ?? 0, value));
  }
  return out;
}

/* ---------------------------------------------------------------- settings */

export interface SettingsMapping {
  values: Settings;
  /** Old settings with no place in the new ones. */
  dropped: string[];
  /** Values that could not be read and fell back to the default. */
  problems: string[];
}

const OLD_KEYS_USED = new Set([
  "companyName", "companyNameLocal", "companyAddress", "companyPhone", "companyEmail", "companyEmail2", "companyTaxNo", "companyWebsite",
  "bankDetails", "invoiceFooter", "currency", "exchangeRates", "defaultMarginPercent", "vatRate", "defaultTaxRate", "pricesIncludeVat",
  "quotationValidityDays", "defaultQuotationTerms", "categories", "reminderPendingDays", "reminderProcessingDays", "reminderDueSoonDays",
  "notifyEmails", "notifyNewQuery", "notifyClosed", "notifyPayment", "notifyDailySummary",
]);

/** The old single "app" settings JSON (legacy/src/modules/settings/service.ts) → the new groups. */
export function mapSettings(old: Record<string, unknown> | null | undefined): SettingsMapping {
  const o = old ?? {};
  const pick = (entries: Record<string, unknown>) => Object.fromEntries(Object.entries(entries).filter(([, v]) => v !== undefined && v !== null));
  const vatRate = o.vatRate ?? o.defaultTaxRate;
  const raw: Record<SettingsKey, Record<string, unknown>> = {
    company: pick({
      name: o.companyName,
      nameLocal: o.companyNameLocal,
      address: o.companyAddress,
      phone: o.companyPhone,
      email: o.companyEmail,
      email2: o.companyEmail2,
      website: o.companyWebsite,
      taxNo: o.companyTaxNo,
      bankDetails: o.bankDetails,
      invoiceFooter: o.invoiceFooter,
    }),
    sales: pick({
      currency: o.currency,
      exchangeRates: o.exchangeRates,
      defaultMarginPercent: o.defaultMarginPercent,
      vatRate,
      pricesIncludeVat: o.pricesIncludeVat,
      quotationValidityDays: o.quotationValidityDays,
      defaultTerms: o.defaultQuotationTerms,
      defaultDepositPercent: depositPercentFromTerms(typeof o.defaultQuotationTerms === "string" ? o.defaultQuotationTerms : null),
      categories: o.categories,
    }),
    reminders: pick({ newDays: o.reminderPendingDays, sourcingDays: o.reminderProcessingDays, dueSoonDays: o.reminderDueSoonDays }),
    notifications: pick({
      emails: o.notifyEmails,
      newInquiry: o.notifyNewQuery,
      dealWonOrLost: o.notifyClosed,
      paymentReceived: o.notifyPayment,
      dailySummary: o.notifyDailySummary,
    }),
  };
  const problems: string[] = [];
  const values = {} as Record<SettingsKey, unknown>;
  for (const key of Object.keys(SETTINGS) as SettingsKey[]) {
    const parsed = SETTINGS[key].safeParse(raw[key]);
    if (parsed.success) values[key] = parsed.data;
    else {
      problems.push(`${key}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")} (defaults used)`);
      values[key] = SETTINGS[key].parse({});
    }
  }
  const dropped = Object.keys(o).filter((k) => !OLD_KEYS_USED.has(k));
  return { values: values as Settings, dropped, problems };
}
