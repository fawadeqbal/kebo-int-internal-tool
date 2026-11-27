import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

let path = "/orders/o1/papers/quotation";
vi.mock("next/navigation", () => ({ usePathname: () => path }));

import { FocusReturn, rememberOpener } from "@/components/window/focus-return";

const BACK = "/orders/o1/documents";
const PAPER = "/orders/o1/papers/quotation?back=%2Forders%2Fo1%2Fdocuments";
const go = (to: string) => window.history.pushState(null, "", to);
/** Closing the window: it notes its address, then the app goes back to the list. */
const closeTo = (back: string) => {
  rememberOpener(BACK);
  path = new URL(back, "http://x").pathname;
  go(back);
};

beforeEach(() => {
  // jsdom draws nothing: every element counts as shown unless marked hidden.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    return (this.hidden ? [] : [{}]) as unknown as DOMRectList;
  });
  path = "/orders/o1/papers/quotation";
  go(PAPER);
});
afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  go("/");
});

/** The Documents list: each document a link to its own window's page. `ready`: drawn yet. */
function List({ ready = true, quotation = PAPER }: { ready?: boolean; quotation?: string }) {
  return (
    <>
      <input aria-label="Search" />
      {ready && (
        <>
          <a href="/orders/o1/papers/proforma?back=%2Forders%2Fo1%2Fdocuments">Proforma</a>
          <a href={quotation} hidden>
            Quotation (phone copy)
          </a>
          <a href={quotation}>Quotation (accepted)</a>
        </>
      )}
      <FocusReturn />
    </>
  );
}
const quotationLink = () => screen.getByRole("link", { name: "Quotation (accepted)" });

describe("a window that is a page of its own gives the focus back to what opened it", () => {
  it("back on the Documents list: the link to the document has the focus, once the list is drawn", async () => {
    closeTo(BACK);
    const { rerender } = render(<List ready={false} />);
    // The list draws a moment later: the link is looked for until it is there.
    await new Promise((r) => setTimeout(r, 50));
    rerender(<List />);
    await vi.waitFor(() => expect(document.activeElement).toBe(quotationLink()));
    expect(window.sessionStorage.length).toBe(0);
  });

  it("a paper uploaded in the window: its link now names the file, and still gets the focus", async () => {
    closeTo(BACK);
    render(<List quotation={`${PAPER}&doc=d1`} />);
    await vi.waitFor(() => expect(document.activeElement).toBe(quotationLink()));
  });

  it("leaves alone a focus the person has moved since", async () => {
    closeTo(BACK);
    const { rerender } = render(<List ready={false} />);
    screen.getByRole("textbox", { name: "Search" }).focus();
    rerender(<List />);
    await new Promise((r) => setTimeout(r, 100));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search" }));
  });

  it("does nothing on another page, or with a note from long ago", async () => {
    rememberOpener(BACK);
    path = "/orders/o2/documents";
    go(path);
    const first = render(<List />);
    await new Promise((r) => setTimeout(r, 50));
    expect(document.activeElement).toBe(document.body);
    first.unmount();
    window.sessionStorage.clear();

    go(PAPER);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    rememberOpener(BACK);
    vi.spyOn(Date, "now").mockReturnValue(now + 60_000);
    path = BACK;
    go(BACK);
    render(<List />);
    await act(async () => {});
    expect(document.activeElement).toBe(document.body);
    expect(window.sessionStorage.length).toBe(0);
  });
});
