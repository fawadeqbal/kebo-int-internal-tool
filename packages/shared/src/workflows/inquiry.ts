import type { InquiryStage, LostReason } from "../enums";

/**
 * The inquiry (deal) lifecycle: New → Sourcing → Quoted → Won | Lost.
 *
 * Staff only make two decisions by hand: "Mark as lost" (with a reason) and
 * putting a deal on hold. Every other move follows from the work itself
 * (assigning someone, recording a factory price, sending or accepting a
 * quotation), so the stage is always true without anyone remembering to click.
 */

export const OPEN_STAGES: readonly InquiryStage[] = ["new", "sourcing", "quoted"];
export const CLOSED_STAGES: readonly InquiryStage[] = ["won", "lost"];

export const isOpen = (stage: InquiryStage) => OPEN_STAGES.includes(stage);

/** Order of progress; an automatic move never goes backwards. */
const RANK: Record<InquiryStage, number> = { new: 0, sourcing: 1, quoted: 2, won: 3, lost: 3 };

/** Things that happen to a deal and move it on by themselves. */
export type InquiryEvent =
  | "assigned"
  | "factory_price_added"
  | "quotation_sent"
  | "quotation_accepted"
  /** The order made from the accepted quotation was cancelled. */
  | "order_cancelled";

/** The stage an event moves a deal to, or null when it changes nothing. */
export function stageAfter(current: InquiryStage, event: InquiryEvent): InquiryStage | null {
  const forward = (to: InquiryStage) => (isOpen(current) && RANK[to] > RANK[current] ? to : null);
  switch (event) {
    case "assigned":
    case "factory_price_added":
      return forward("sourcing");
    case "quotation_sent":
      return forward("quoted");
    case "quotation_accepted":
      return isOpen(current) ? "won" : null;
    case "order_cancelled":
      return current === "won" ? "lost" : null;
  }
}

export interface ManualMove {
  to: InquiryStage;
  label: string;
  /** Needs a lost reason. */
  needsReason?: boolean;
  /** Only people allowed to reopen closed deals. */
  reopen?: boolean;
}

/** The moves a person can make by hand from a stage. Won deals change through their order instead. */
export const MANUAL_MOVES: Record<InquiryStage, ManualMove[]> = {
  new: [
    { to: "sourcing", label: "Start working on it" },
    { to: "lost", label: "Mark as lost", needsReason: true },
  ],
  sourcing: [{ to: "lost", label: "Mark as lost", needsReason: true }],
  quoted: [{ to: "lost", label: "Mark as lost", needsReason: true }],
  won: [],
  lost: [{ to: "sourcing", label: "Reopen", reopen: true }],
};

export function manualMove(from: InquiryStage, to: InquiryStage): ManualMove | null {
  return MANUAL_MOVES[from].find((m) => m.to === to) ?? null;
}

/** Problems with a manual move, as messages for the person (empty = allowed). */
export function checkManualMove(
  from: InquiryStage,
  to: InquiryStage,
  input: { lostReason?: LostReason | null; canReopen: boolean },
): string[] {
  const move = manualMove(from, to);
  if (!move) return [`A deal that is ${from} cannot be moved to ${to} by hand.`];
  const problems: string[] = [];
  if (move.needsReason && !input.lostReason) problems.push("Choose why the deal was lost.");
  if (move.reopen && !input.canReopen) problems.push("Only a manager can reopen a closed deal.");
  return problems;
}

/** On hold is a flag on open deals (waiting for drawings, budget…); reminders skip it. */
export const canHold = (stage: InquiryStage) => isOpen(stage);

/** A quotation can be made or revised only while the deal is open. */
export const canQuote = (stage: InquiryStage) => isOpen(stage);
