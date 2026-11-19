import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChangeHint, changeKind, changeLine, changeWords, countChanges, ChangeText } from "@/components/common/change-words";

describe("the words for changes (canvas group 9)", () => {
  it("an empty field filled is Added; a saved value replaced is Changed; cleared is Removed; put back is nothing", () => {
    expect(changeKind("", "30 Nov 2026")).toBe("added");
    expect(changeKind("35 days", "40 days")).toBe("changed");
    expect(changeKind("FOB", "  ")).toBe("removed");
    expect(changeKind("Qingdao", " Qingdao ")).toBeNull();
  });

  it("counts only changes and removals as changes; added apart", () => {
    expect(countChanges([{ from: "", to: "a" }, { from: "b", to: "c" }, { from: "d", to: "" }, { from: "e", to: "e" }])).toEqual({ changed: 2, added: 1 });
  });

  it("the save button: No changes, Save (only added), Save N changes, or the new thing's name", () => {
    expect(changeWords({ changed: 0, added: 0 })).toBe("No changes");
    expect(changeWords({ changed: 0, added: 2 })).toBe("Save");
    expect(changeWords({ changed: 1, added: 3 })).toBe("Save 1 change");
    expect(changeWords({ changed: 2 })).toBe("Save 2 changes");
    expect(changeWords({ changed: 0, create: "Add the customer" })).toBe("Add the customer");
  });

  it("never says empty or none", () => {
    expect(changeLine("Valid until", "", "30 Nov 2026")).toBe("Added · Valid until: 30 Nov 2026");
    expect(changeLine("Incoterm", "FOB", "")).toBe("Removed · Incoterm · was FOB");
    expect(changeLine("Lead time", "35 days", "40 days")).toBe("Changed · Lead time: 35 days → 40 days");
  });

  it("the hint says Added in green, or Changed · was X", () => {
    const { rerender } = render(<ChangeHint was="" now="30 Nov 2026" />);
    expect(screen.getByText("Added")).toBeTruthy();
    rerender(<ChangeHint was="35 days" now="40 days" />);
    expect(screen.getByText(/Changed · was 35 days/)).toBeTruthy();
    rerender(<ChangeHint was="x" now="x" />);
    expect(screen.queryByText(/Changed|Added|Removed/)).toBeNull();
  });

  it("a history line shows its word, the old value struck and the new one bold", () => {
    const { container } = render(<ChangeText text="Changed · Lead time: 35 days → 40 days" />);
    expect(screen.getByText(/^Changed ·/)).toBeTruthy();
    expect(container.querySelector("s")?.textContent).toBe("35 days");
    expect(container.querySelector("b")?.textContent).toBe("40 days");
  });
});
