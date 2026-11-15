import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

// An action can offer Undo (only where safe: "Mark as lost"): the note's Undo takes it back through the API,
// which checks again; a refusal says why instead of "Undone".
const undoAction = vi.fn();
vi.mock("@/lib/undo-actions", () => ({ undoAction: (...a: unknown[]) => undoAction(...a) }));

const { ActionForm } = await import("@/components/common/action-form");
const { Toaster } = await import("@kebo/ui/client");

function Lost() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Toaster />
      {open && (
        <ActionForm
          action={async () => ({ ok: true, message: "RFQ-2026-0583 marked lost", detail: "Why: Price too high", undo: { type: "inquiry-lost", id: "abc" } })}
          onDone={() => setOpen(false)}
        >
          <button>Mark as lost</button>
        </ActionForm>
      )}
    </>
  );
}

const note = () => document.querySelector<HTMLElement>("[data-note]");
const markLost = () =>
  act(async () => {
    fireEvent.submit(document.querySelector("form")!);
  });

describe("Undo in the note", () => {
  it("takes Mark as lost back, and says it was undone", async () => {
    undoAction.mockResolvedValueOnce({ ok: true });
    render(<Lost />);
    await markLost();
    expect(note()?.textContent).toContain("RFQ-2026-0583 marked lost");
    expect(note()?.textContent).toContain("Why: Price too high");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expect(undoAction).toHaveBeenCalledWith({ type: "inquiry-lost", id: "abc" });
    expect(note()?.textContent).toContain("Undone");
    expect(note()?.textContent).toContain("RFQ-2026-0583 marked lost");
  });

  it("says why when it can no longer be undone", async () => {
    undoAction.mockResolvedValueOnce({ ok: false, message: "It can no longer be undone here: a manager can reopen RFQ-2026-0583." });
    render(<Lost />);
    await markLost();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expect(note()?.dataset.note).toBe("fail");
    expect(note()?.textContent).toContain("Not undone");
    expect(note()?.textContent).toContain("a manager can reopen RFQ-2026-0583");
  });
});
