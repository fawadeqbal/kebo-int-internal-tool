/**
 * Document numbers: PREFIX-YEAR-0001, sequential per prefix and year and never
 * reused (the database hands out the next value atomically; this only formats
 * and reads them).
 */
export const DOCUMENT_PREFIX = {
  inquiry: "RFQ",
  quotation: "QUO",
  order: "SO",
  factoryOrder: "PO",
  proformaInvoice: "PI",
  commercialInvoice: "INV",
  shipment: "SH",
} as const;

export type DocumentKind = keyof typeof DOCUMENT_PREFIX;

export const counterKey = (kind: DocumentKind, year: number) => `${DOCUMENT_PREFIX[kind]}-${year}`;

export const formatReference = (kind: DocumentKind, year: number, sequence: number) => `${counterKey(kind, year)}-${String(sequence).padStart(4, "0")}`;

export function parseReference(ref: string): { prefix: string; year: number; sequence: number } | null {
  const m = /^([A-Z]+)-(\d{4})-(\d{4,})$/.exec(ref.trim());
  return m ? { prefix: m[1], year: Number(m[2]), sequence: Number(m[3]) } : null;
}
