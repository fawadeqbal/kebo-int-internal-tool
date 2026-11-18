import { INQUIRY_STAGES, type InquiryStage } from "../enums";
import { INQUIRY_STAGE_LABEL } from "../labels";
import { recordType } from "./types";

/** An inquiry's state as people see it: its stage, or On hold in place of an open stage. */
export type InquiryState = InquiryStage | "on_hold";

/** The stages that are still going on (a hold shows in their place). */
export const OPEN_INQUIRY_STAGES: readonly InquiryStage[] = INQUIRY_STAGES.filter((s) => s !== "won" && s !== "lost");

/**
 * The inquiry (canvas "the pieces", board "States"): New has nothing to do yet, Sourcing is moving, Quoted waits for
 * the customer, Won is done, Lost is a problem; On hold is quiet.
 */
export const INQUIRY = recordType<InquiryState>({
  name: { one: "inquiry", many: "inquiries" },
  states: {
    new: { words: INQUIRY_STAGE_LABEL.new, tone: "neutral" },
    sourcing: { words: INQUIRY_STAGE_LABEL.sourcing, tone: "info" },
    quoted: { words: INQUIRY_STAGE_LABEL.quoted, tone: "warn" },
    won: { words: INQUIRY_STAGE_LABEL.won, tone: "ok" },
    lost: { words: INQUIRY_STAGE_LABEL.lost, tone: "bad" },
    on_hold: { words: "On hold", tone: "neutral" },
  },
});

/** Which state an inquiry shows: On hold in place of an open stage; a won or lost one keeps its stage. */
export function inquiryStateOf(d: { stage: InquiryStage; onHold: boolean }): InquiryState {
  return d.onHold && OPEN_INQUIRY_STAGES.includes(d.stage) ? "on_hold" : d.stage;
}
