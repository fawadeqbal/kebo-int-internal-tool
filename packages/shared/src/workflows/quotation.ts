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
 * Numbers for document lines that follow the deal's items: a line for a part
 * of an item is numbered under the line for that item ("2.1").
 */
export function numberLines(lines: { id: string; requestedItemId: string | null; parentItemId: string | null }[]): string[] {
  return lineNumbers(lines.map((l) => ({ key: l.id, parentKey: l.parentItemId ? (lines.find((x) => x.requestedItemId === l.parentItemId)?.id ?? null) : null })));
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
