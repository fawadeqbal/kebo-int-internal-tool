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
