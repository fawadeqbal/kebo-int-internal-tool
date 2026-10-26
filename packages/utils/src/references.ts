/**
 * Document numbers: PREFIX-YEAR-0001, sequential per prefix and year and never
 * reused (the database hands out the next value atomically; this only formats
 * and reads them). An order's documents take its number (SO-2026-0005 →
 * PI-2026-0005, INV-2026-0005, PL-2026-0005), so they need no counter.
 */
export const DOCUMENT_PREFIX = {
  inquiry: "RFQ",
  quotation: "QUO",
  order: "SO",
} as const;

export type DocumentKind = keyof typeof DOCUMENT_PREFIX;

export const counterKey = (kind: DocumentKind, year: number) => `${DOCUMENT_PREFIX[kind]}-${year}`;

export const formatReference = (kind: DocumentKind, year: number, sequence: number) => `${counterKey(kind, year)}-${String(sequence).padStart(4, "0")}`;

export function parseReference(ref: string): { prefix: string; year: number; sequence: number } | null {
  const m = /^([A-Z]+)-(\d{4})-(\d{4,})$/.exec(ref.trim());
  return m ? { prefix: m[1], year: Number(m[2]), sequence: Number(m[3]) } : null;
}
