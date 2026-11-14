import type { BalanceTerms, RevisionStatus } from "../enums";
import { BALANCE_TERMS_LABEL } from "../labels";

/**
 * A deal has one quotation (QUO-2026-0007) with revisions R1, R2… Only the
 * newest revision is live. A revision cannot change after it is sent; a price
 * change is a new revision, so what the customer saw is never altered. When a
 * newer revision is sent, the previous sent one becomes "superseded", so it no
 * longer counts as waiting for a reply, in reminders or in quoted value.
 * Acceptance is final: changes after that belong to the order. If that order
 * is cancelled, the accepted revision becomes "void" and the reopened deal can
 * be quoted again.
 */

export const REVISION_MOVES: Record<RevisionStatus, { to: RevisionStatus; label: string }[]> = {
  draft: [{ to: "sent", label: "Mark as sent to customer" }],
  sent: [
    { to: "accepted", label: "Customer accepted" },
    { to: "rejected", label: "Customer rejected" },
    { to: "expired", label: "Mark expired" },
  ],
  accepted: [],
  rejected: [],
  expired: [],
  superseded: [],
  void: [],
};

export const canMoveRevision = (from: RevisionStatus, to: RevisionStatus) => REVISION_MOVES[from].some((m) => m.to === to);

export const isEditable = (status: RevisionStatus) => status === "draft";

/** Statuses that count as "we quoted the customer" (for reports: only the live revision is counted). */
export const QUOTED_STATUSES: readonly RevisionStatus[] = ["sent", "accepted", "rejected", "expired"];

export interface RevisionRef {
  number: number;
  status: RevisionStatus;
}

export const latestRevision = <R extends RevisionRef>(revisions: R[]): R | null =>
  revisions.reduce<R | null>((best, r) => (!best || r.number > best.number ? r : best), null);

/**
 * Whether a new revision can be started, and why not. A new revision starts
 * from the latest one when it was answered or still waiting; never after
 * acceptance, and not while a draft is open (edit that instead).
 */
export function canStartRevision(revisions: RevisionRef[]): { ok: true } | { ok: false; reason: string } {
  const latest = latestRevision(revisions);
  if (!latest) return { ok: true };
  if (latest.status === "draft") return { ok: false, reason: `R${latest.number} is still a draft: edit it instead of starting a new revision.` };
  if (latest.status === "accepted") return { ok: false, reason: "The customer accepted this quotation. Changes now go on the order." };
  return { ok: true };
}

/** When revision `sentNumber` is sent: which older revisions become superseded. */
export const supersededBy = (revisions: RevisionRef[], sentNumber: number): number[] =>
  revisions.filter((r) => r.number < sentNumber && r.status === "sent").map((r) => r.number);

/**
 * Answers (accept/reject/expire) apply to the newest revision the customer has
 * seen. A draft started after it does not stop the customer's answer being
 * recorded; accepting then discards that draft.
 */
export const canAnswer = (revisions: RevisionRef[], number: number) =>
  latestRevision(revisions.filter((r) => r.status !== "draft"))?.number === number && revisions.find((r) => r.number === number)?.status === "sent";

/** Drafts to discard when a revision is accepted. */
export const draftsDiscardedBy = (revisions: RevisionRef[], acceptedNumber: number): number[] =>
  revisions.filter((r) => r.status === "draft" && r.number > acceptedNumber).map((r) => r.number);

/** The payment terms as Kebo writes them on its documents: "Our usual payment is made by 30% Advance deposit and 70% before shipment." */
export function paymentSentenceOf(depositPercent: number, balanceTerms: BalanceTerms): string {
  const rest = BALANCE_TERMS_LABEL[balanceTerms];
  const lower = rest.charAt(0).toLowerCase() + rest.slice(1);
  if (depositPercent <= 0) return `Payment: ${rest}.`;
  if (depositPercent >= 100) return "Our usual payment is made by 100% Advance payment.";
  return `Our usual payment is made by ${depositPercent}% Advance deposit and ${100 - depositPercent}% ${lower.replace(/^balance /, "")}.`;
}

/**
 * Line numbers as on Kebo's documents: 1, 2, 3, and a part of an item right
 * after it as 3.1, 3.2. `parentKey` names the line a part belongs to; a part
 * whose item is not on the document (or comes later) is numbered on its own.
 */
/**
 * Numbers for quotation and order lines: "1", "2", "2.1". A line from a factory
 * part is numbered under the line of its factory line; a line for one of the
 * customer's item parts (options without factory prices) under that item's line.
 * Charges (freight…) are numbered after the goods.
 */
export function numberQuoteLines(
  lines: { id: string; factoryQuoteLineId: string | null; factoryParentId: string | null; requestedItemId: string | null; itemParentId: string | null }[],
): string[] {
  return lineNumbers(
    lines.map((l) => ({
      key: l.id,
      parentKey: l.factoryParentId
        ? (lines.find((x) => x.factoryQuoteLineId === l.factoryParentId)?.id ?? null)
        : !l.factoryQuoteLineId && l.itemParentId
          ? (lines.find((x) => !x.factoryQuoteLineId && x.requestedItemId === l.itemParentId)?.id ?? null)
          : null,
    })),
  );
}

export function lineNumbers(lines: { key: string; parentKey?: string | null }[]): string[] {
  const numberOf = new Map<string, string>();
  const partsOf = new Map<string, number>();
  let top = 0;
  return lines.map((l) => {
    const parent = l.parentKey ? numberOf.get(l.parentKey) : undefined;
    let no: string;
    if (parent && !parent.includes(".")) {
      const k = (partsOf.get(l.parentKey!) ?? 0) + 1;
      partsOf.set(l.parentKey!, k);
      no = `${parent}.${k}`;
    } else {
      top += 1;
      no = String(top);
    }
    numberOf.set(l.key, no);
    return no;
  });
}

/** Options are lettered A, B, C… in the order they are offered. */
export const optionLetter = (index: number) => String.fromCharCode(65 + index);

/**
 * Which of the customer's items (top level) an offer answers. An item counts as
 * covered when the offer answers it or any of its parts; extras the factory
 * added (no item) do not count.
 */
export function coverage(items: { id: string; parentId: string | null; no: string }[], answered: Iterable<string | null | undefined>) {
  const set = new Set([...answered].filter((v): v is string => !!v));
  const top = items.filter((i) => !i.parentId);
  const isCovered = (t: { id: string }) => set.has(t.id) || items.some((p) => p.parentId === t.id && set.has(p.id));
  return { covered: top.filter(isCovered).map((t) => t.no), missing: top.filter((t) => !isCovered(t)).map((t) => t.no) };
}

/** What the option figures below need: its letter, its place in the list, and whether the customer chose it. */
export interface OptionRef {
  letter: string;
  sortOrder?: number;
  status: string;
}

/**
 * The option that speaks for a revision: the one the customer accepted; before that, Option A (the first
 * offered), which is what a draft or a sent revision shows in lists. The revision keeps no figures of its
 * own: its total, discount and lead time are always read from here. `label` says which option it is, for
 * screens that show one figure for a revision with several options ("Option B, accepted", "Option A of 3").
 */
export function revisionOption<O extends OptionRef>(options: readonly O[]): { option: O; accepted: boolean; label: string } | null {
  const accepted = options.find((o) => o.status === "accepted");
  if (accepted) return { option: accepted, accepted: true, label: options.length > 1 ? `Option ${accepted.letter}, accepted` : "accepted" };
  const first = [...options].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.letter.localeCompare(b.letter))[0];
  if (!first) return null;
  return { option: first, accepted: false, label: options.length > 1 ? `Option ${first.letter} of ${options.length}` : "" };
}

/**
 * What a revision is worth, for reports and the pipeline: the accepted option's total; before the customer
 * chooses, the lowest and the highest of its options (the same number when there is one option). `label`
 * names the basis when it is a range ("lowest–highest of 3 options").
 */
export function revisionWorth<O extends OptionRef>(
  options: readonly O[],
  minorOf: (o: O) => number,
): { lowMinor: number; highMinor: number; accepted: boolean; label: string } | null {
  const accepted = options.find((o) => o.status === "accepted");
  if (accepted) {
    const v = minorOf(accepted);
    return { lowMinor: v, highMinor: v, accepted: true, label: options.length > 1 ? `Option ${accepted.letter}, accepted` : "" };
  }
  if (!options.length) return null;
  const all = options.map(minorOf);
  const lowMinor = Math.min(...all);
  const highMinor = Math.max(...all);
  return { lowMinor, highMinor, accepted: false, label: lowMinor === highMinor ? "" : `lowest–highest of ${options.length} options` };
}

/** "45 days", "8-10 weeks", "2 months after the deposit" → days (the longer end of a range); null when it says no number. */
export function leadDays(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /(\d+)(?:\s*(?:-|–|to)\s*(\d+))?\s*(working days?|days?|weeks?|wks?|months?)/i.exec(text);
  if (!m) return null;
  const n = Number(m[2] ?? m[1]);
  const unit = m[3]!.toLowerCase();
  const days = unit.startsWith("month") ? n * 30 : unit.startsWith("w") && !unit.startsWith("working") ? n * 7 : unit.startsWith("working") ? Math.ceil((n * 7) / 5) : n;
  return days > 0 && days <= 730 ? days : null;
}

const DAY = 86_400_000;
const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/**
 * A lead time against the day the customer wants the goods: ordered today it is ready on `readyOn`,
 * `late` days after the wanted day (0 or less: in time). Null when the lead time says no number or
 * the customer gave no day.
 */
export function readyAgainst(leadTime: string | null | undefined, today: string, wantedBy: string | null | undefined): { days: number; readyOn: string; late: number } | null {
  const days = leadDays(leadTime);
  if (days === null || !wantedBy) return null;
  const ready = utc(today) + days * DAY;
  return { days, readyOn: new Date(ready).toISOString().slice(0, 10), late: Math.round((ready - utc(wantedBy)) / DAY) };
}
