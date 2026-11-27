import { INQUIRY_STAGE_LABEL, ORDER_STAGE_LABEL } from "@kebo/shared";
import { readableHistory } from "@/components/insights/readable-dates";

/**
 * The words a change is told in, the same on a record's History and in the Audit log (review 24 Nov: the log
 * showed "N — → 1 · Card — → request.details" and raw values): field names as people say them, values in plain
 * words, and the bookkeeping of a card's edit (its count, keys and lines) left out, its sentences said instead.
 */
/** Field names as people say them. */
const FIELD: Record<string, string> = {
  // Rows saved before step B of the rename (28 Nov 2026) name these fields with the old word: read alike.
  factory: "Supplier",
  factories: "Suppliers",
  blNo: "B/L number",
  shippedOn: "Shipped on",
  departedOn: "Left on",
  containerNo: "Container",
  shipBy: "Ship by",
  readyOn: "Ready on",
  onHold: "On hold",
  lookedAfterBy: "Looked after by",
  taxNo: "Tax no.",
  regNo: "Reg. no.",
  defaultCurrency: "Currency",
  validUntil: "Valid until",
  documentTitle: "Document title",
  portOfDischarge: "Port of discharge",
  contactPerson: "Contact person",
  bankDetails: "Bank details",
  exchangeRates: "Exchange rates",
  defaultMarginPercent: "Default margin %",
  defaultDepositPercent: "Default deposit %",
  defaultBalanceTerms: "Balance terms",
  defaultPaymentTerms: "Payment terms",
  defaultDeliveryTerms: "Delivery conditions",
  warrantyTerms: "Warranty",
  paymentTerms: "Payment terms",
  deliveryTerms: "Delivery conditions",
  warranty: "Warranty",
  incotermPlace: "Place",
  leadTime: "Lead time",
  deliveryConditions: "Delivery conditions",
  paymentConditions: "Payment conditions",
  notes: "Notes",
  printQuotedTerms: "Agreed payment conditions printed",
  sentVia: "Sent by",
  step: "Stage",
};
/** Not for people: a record's id (by its name or by its value), and the "yes, save it anyway" a form sends. */
const HIDDEN = /^(ask|id|.+Id|followUp)$/;
const IS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A stage's word, not its key ("sourcing" → "Sourcing"). */
const STAGE: Record<string, string> = { ...ORDER_STAGE_LABEL, ...INQUIRY_STAGE_LABEL };
export const hiddenChange = (c: { field: string; from: string | null; to: string | null }) => HIDDEN.test(c.field) || IS_ID.test(c.to ?? "") || IS_ID.test(c.from ?? "");
export const fieldLabel = (f: string) => FIELD[f] ?? f.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
export const shown = (v: string | null) =>
  v === null ? "—" : v === "true" ? "yes" : v === "false" ? "no" : (STAGE[v] ?? readableHistory(v.length > 80 ? `${v.slice(0, 80)}…` : v));


/** Any recorded value in plain words: a list joined, an object's values, dates and long numbers readable. */
export const valueText = (v: unknown): string =>
  v === null || v === undefined || v === ""
    ? "—"
    : Array.isArray(v)
      ? v.map(valueText).join(" · ") || "—"
      : typeof v === "object"
        ? Object.entries(v as Record<string, unknown>)
            .filter(([k]) => !HIDDEN.test(k))
            .map(([k, x]) => `${fieldLabel(k)} ${valueText(x)}`)
            .join(" · ") || "—"
        : shown(String(v));

/** A card's edit ("Offer items edited (edit 1)"): its summary and sentences say what changed; its fields are bookkeeping. */
export const isCardEdit = (action: string) => action.startsWith("card.");
/** A card edit's own sentences ("2 · Unit price CNY 4,000.00 → 4,500.00"). */
export const cardSentences = (values: Record<string, unknown> | null | undefined): string[] =>
  Array.isArray(values?.changes) ? (values.changes as unknown[]).filter((x): x is string => typeof x === "string") : [];
