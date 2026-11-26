import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useFocusTrap } from "@/components/common/dialog";

/**
 * A window keeps the keyboard (useFocusTrap): the focus that goes to the page behind it comes back. With one
 * window open over another (the Email panel over the document window), only the top one keeps it: the one
 * under it does nothing until the top one closes, so the two never pull the focus to and fro; and a window
 * that covers the page without keeping the keyboard itself is left its own focus (review 27 Nov 2026).
 */
function Trapped({ name, children }: { name: string; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box, true);
  return (
    <div ref={box} role="dialog" aria-modal="true" aria-label={name}>
      {children}
    </div>
  );
}

function Windows({ untrapped }: { untrapped?: boolean }) {
  const [email, setEmail] = useState(false);
  return (
    <>
      <button>Behind</button>
      <Trapped name="The document">
        <button>Print</button>
        <button onClick={() => setEmail(true)}>Email</button>
      </Trapped>
      {email && (
        <Trapped name="Email it">
          <button>Send</button>
          <button onClick={() => setEmail(false)}>Cancel</button>
        </Trapped>
      )}
      {untrapped && (
        <div role="dialog" aria-modal="true" aria-label="Rename">
          <button>Save the name</button>
        </div>
      )}
    </>
  );
}

const button = (name: string) => screen.getByRole("button", { name });
const tab = (shiftKey = false) => fireEvent.keyDown(document, { key: "Tab", shiftKey });

describe("useFocusTrap", () => {
  it("takes the focus back from the page behind the window", () => {
    render(<Windows />);
    button("Behind").focus();
    expect(document.activeElement).toBe(button("Print"));
  });

  it("goes round inside the window on Tab and Shift+Tab", () => {
    render(<Windows />);
    button("Email").focus();
    tab();
    expect(document.activeElement).toBe(button("Print"));
    tab(true);
    expect(document.activeElement).toBe(button("Email"));
  });

  it("with a window open over it, only the top window keeps the keyboard", () => {
    render(<Windows />);
    act(() => button("Email").click());
    // The focus in the window under it, or on the page: the top one takes it.
    button("Print").focus();
    expect(document.activeElement).toBe(button("Send"));
    button("Behind").focus();
    expect(document.activeElement).toBe(button("Send"));
    // Tab with the focus nowhere (a click on plain words): into the top window, not the one under it.
    (document.activeElement as HTMLElement).blur();
    tab();
    expect(document.activeElement).toBe(button("Send"));
    // And round inside it.
    button("Cancel").focus();
    tab();
    expect(document.activeElement).toBe(button("Send"));
  });

  it("gives the keyboard back to the window under it when the top one closes", () => {
    render(<Windows />);
    button("Email").focus();
    act(() => button("Email").click());
    act(() => button("Cancel").click());
    expect(document.activeElement).toBe(button("Email"));
    button("Behind").focus();
    expect(document.activeElement).toBe(button("Print"));
  });

  it("leaves the focus alone in a window over it that does not keep the keyboard itself", () => {
    render(<Windows untrapped />);
    const save = button("Save the name");
    save.focus();
    expect(document.activeElement).toBe(save);
    // Its Tab is its own too: the window under it does not answer it.
    expect(tab(), "the Tab was not stopped").toBe(true);
    expect(document.activeElement).toBe(save);
  });
});
