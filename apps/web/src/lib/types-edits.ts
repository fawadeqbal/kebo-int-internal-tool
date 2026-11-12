/** The records whose cards count their edits (GET /edits). */
export type EditRecordType = "inquiry" | "factory_quote" | "quotation" | "order" | "customer" | "factory";

/** Which card of which record: where an edit is counted. */
export interface EditRef {
  type: EditRecordType;
  id: string;
  /** "items", "lines.packing", "shipment"… */
  card: string;
}

/** One card's edits since it was first saved. */
export interface EditCard {
  count: number;
  first: { by: string | null; at: string } | null;
  edits: { n: number; by: string | null; at: string; reason: string | null; changes: string[] }[];
  /** How often each line (or field) was changed. */
  keys: Record<string, number>;
}

export interface EditsView {
  cards: Record<string, EditCard>;
}
