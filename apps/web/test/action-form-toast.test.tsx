import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

// Every save says it was saved (board "Messages after an action"): a form that stays open shows the message in
// itself; one whose window shuts on save (Record payment) leaves it in a toast; a form whose owner says its own
// note keeps that note. Found by the browser check of Record payment: the window shut and nothing was said.
vi.mock("server-only", () => ({}));

const { ActionForm } = await import("@/components/common/action-form");
const { Toaster, toast } = await import("@kebo/ui/client");

function Closing({ message, ownNote }: { message: string; ownNote?: string }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Toaster />
      {open ? (
        <ActionForm
          action={async () => ({ ok: true, message })}
          onDone={() => {
            if (ownNote) toast(ownNote);
            setOpen(false);
          }}
        >
          <button>Save</button>
        </ActionForm>
      ) : (
        <p>Closed</p>
      )}
    </>
  );
}

/** The toast's text (the Toaster: a status with ✕), not the form's own message (also a status). */
const toastText = () =>
  screen
    .queryAllByRole("status")
    .filter((s) => s.querySelector('button[aria-label="Dismiss"]'))
    .map((s) => s.textContent ?? "")
    .join(" | ");

const submit = () =>
  act(async () => {
    fireEvent.submit(document.querySelector("form")!);
  });

/** A save that takes its own form off the page ("Mark lost…" is gone once the inquiry is lost). */
function Vanishing() {
  const [gone, setGone] = useState(false);
  return (
    <>
      <Toaster />
      {!gone && (
        <ActionForm
          action={async () => {
            setGone(true);
            return { ok: true, message: "RFQ-2026-0001 marked lost" };
          }}
        >
          <button>Mark lost</button>
        </ActionForm>
      )}
    </>
  );
}

describe("the note after a save", () => {
  it("is said even when the save takes the form off the page", async () => {
    render(<Vanishing />);
    await submit();
    expect(document.querySelector("form")).toBeNull();
    expect(toastText()).toContain("RFQ-2026-0001 marked lost");
  });

  it("goes to a toast when the form closes on save", async () => {
    render(<Closing message="Payment recorded." />);
    await submit();
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(toastText()).toContain("Payment recorded.");
  });

  it("is the owner's own note when the owner says one", async () => {
    render(<Closing message="Saved." ownNote="Saved · SO-2026-0001" />);
    await submit();
    expect(toastText()).toContain("Saved · SO-2026-0001");
    expect(toastText()).not.toContain("Saved.");
  });

  it("stays in the form when the form stays open, and no toast repeats it", async () => {
    render(
      <>
        <Toaster />
        <ActionForm action={async () => ({ ok: true, message: "Address saved." })}>
          <button>Save</button>
        </ActionForm>
      </>,
    );
    await submit();
    expect(screen.getByText("Address saved.")).toBeTruthy();
    expect(toastText()).not.toContain("Address saved.");
  });
});
