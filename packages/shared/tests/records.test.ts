import { describe, expect, it } from "vitest";
import { INQUIRY, INQUIRY_STAGE_LABEL, INQUIRY_STAGES, inquiryStateOf, OPEN_INQUIRY_STAGES } from "../src";

describe("the inquiry record type", () => {
  it("names itself", () => {
    expect(INQUIRY.name).toEqual({ one: "inquiry", many: "inquiries" });
  });

  it("has a state for every stage, in the stage's own words, and On hold", () => {
    for (const s of INQUIRY_STAGES) expect(INQUIRY.states[s].words).toBe(INQUIRY_STAGE_LABEL[s]);
    expect(INQUIRY.states.on_hold.words).toBe("On hold");
  });

  it("gives each state the pill the lists and the board show", () => {
    const tones = Object.fromEntries(Object.entries(INQUIRY.states).map(([k, v]) => [k, v.tone]));
    expect(tones).toEqual({ new: "neutral", sourcing: "info", quoted: "warn", won: "ok", lost: "bad", on_hold: "neutral" });
  });

  it("shows On hold in place of an open stage only", () => {
    expect(OPEN_INQUIRY_STAGES).toEqual(["new", "sourcing", "quoted"]);
    for (const stage of OPEN_INQUIRY_STAGES) {
      expect(inquiryStateOf({ stage, onHold: true })).toBe("on_hold");
      expect(inquiryStateOf({ stage, onHold: false })).toBe(stage);
    }
    expect(inquiryStateOf({ stage: "won", onHold: true })).toBe("won");
    expect(inquiryStateOf({ stage: "lost", onHold: true })).toBe("lost");
  });
});
