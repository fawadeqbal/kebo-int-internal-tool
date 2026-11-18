import type { Tone } from "../labels";

/*
 * Record types (canvas "RFQ Desk — the pieces", board "One record type feeds every piece"): what a kind of record
 * is, said once as data, so every piece that shows it — list tabs, pills, board columns, counts — reads the same
 * words. Built a piece at a time: names and states first; fields, lists and pages join as their pieces do.
 */

/** One state of a record (board "States"): the words its pill and tab say, and the pill's meaning. */
export interface StateDef {
  words: string;
  tone: Tone;
}

export interface RecordName {
  /** "inquiry" */
  one: string;
  /** "inquiries" */
  many: string;
}

export interface RecordType<S extends string> {
  name: RecordName;
  states: Record<S, StateDef>;
}

/** A record type, checked: every state has its words and its pill. */
export const recordType = <S extends string>(t: RecordType<S>): RecordType<S> => t;
