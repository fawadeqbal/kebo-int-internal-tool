import { describe, expect, it } from "vitest";
import { revisionOption, revisionWorth } from "../src";

const opt = (letter: string, total: number, status = "open", sortOrder = letter.charCodeAt(0) - 65) => ({ letter, total, status, sortOrder });

describe("a revision's figures are its options'", () => {
  it("speaks with the accepted option; before that with Option A, labelled when there are several", () => {
    expect(revisionOption([opt("A", 100)])).toMatchObject({ option: { letter: "A" }, accepted: false, label: "" });
    expect(revisionOption([opt("B", 140), opt("A", 100)])).toMatchObject({ option: { letter: "A" }, label: "Option A of 2" });
    expect(revisionOption([opt("A", 100, "not_chosen"), opt("B", 140, "accepted")])).toMatchObject({
      option: { letter: "B" },
      accepted: true,
      label: "Option B, accepted",
    });
    expect(revisionOption([opt("A", 100, "accepted")])).toMatchObject({ accepted: true, label: "accepted" });
    expect(revisionOption([])).toBeNull();
  });

  it("is worth the accepted option, else the lowest–highest of its options", () => {
    const minor = (o: { total: number }) => o.total;
    expect(revisionWorth([opt("A", 100)], minor)).toEqual({ lowMinor: 100, highMinor: 100, accepted: false, label: "" });
    expect(revisionWorth([opt("A", 140), opt("B", 100), opt("C", 120)], minor)).toEqual({
      lowMinor: 100,
      highMinor: 140,
      accepted: false,
      label: "lowest–highest of 3 options",
    });
    expect(revisionWorth([opt("A", 140, "not_chosen"), opt("B", 100, "accepted")], minor)).toEqual({
      lowMinor: 100,
      highMinor: 100,
      accepted: true,
      label: "Option B, accepted",
    });
    expect(revisionWorth([], minor)).toBeNull();
  });
});
