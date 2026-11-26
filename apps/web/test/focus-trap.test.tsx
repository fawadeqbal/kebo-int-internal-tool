import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useFocusTrap } from "@/components/common/dialog";

/**
 * A window keeps the keyboard (useFocusTrap): the focus that goes to the page behind it comes back. But another
 * window that covers the page (an Email panel opened from the document window) keeps its own: two windows each
 * pulling the focus to themselves would leave neither usable (review 27 Nov 2026).
 */
function Windows() {
  const first = useRef<HTMLDivElement>(null);
  useFocusTrap(first, true);
  return (
    <>
      <button>Behind</button>
      <div ref={first} role="dialog" aria-modal="true" aria-label="The document">
        <button>Print</button>
        <button>Close</button>
      </div>
      <div role="dialog" aria-modal="true" aria-label="Email it">
        <button>Send</button>
      </div>
    </>
  );
}

describe("useFocusTrap", () => {
  it("takes the focus back from the page behind the window", () => {
    render(<Windows />);
    screen.getByRole("button", { name: "Behind" }).focus();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Print" }));
  });

  it("goes round inside the window on Tab and Shift+Tab", () => {
    render(<Windows />);
    screen.getByRole("button", { name: "Close" }).focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Print" }));
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  });

  it("leaves the focus alone in another window that covers the page", () => {
    render(<Windows />);
    const send = screen.getByRole("button", { name: "Send" });
    send.focus();
    expect(document.activeElement).toBe(send);
    // Its Tab is its own too: this window does not answer it.
    const tab = fireEvent.keyDown(document, { key: "Tab" });
    expect(tab, "the Tab was not stopped").toBe(true);
    expect(document.activeElement).toBe(send);
  });
});
