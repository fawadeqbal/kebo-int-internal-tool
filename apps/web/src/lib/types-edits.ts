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
  /** Newest first; `keys` the lines (or fields) it changed, `lines` what changed on each. */
  edits: { n: number; by: string | null; at: string; reason: string | null; changes: string[]; keys?: string[]; lines?: Record<string, string[]> }[];
  /** How often each line (or field) was changed. */
  keys: Record<string, number>;
}

export interface EditsView {
  cards: Record<string, EditCard>;
}
