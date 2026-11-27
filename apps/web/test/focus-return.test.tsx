import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

let path = "/orders/o1/papers/quotation";
vi.mock("next/navigation", () => ({ usePathname: () => path }));

import { FocusReturn, rememberOpener } from "@/components/window/focus-return";

const PAPER = "/orders/o1/papers/quotation?back=%2Forders%2Fo1%2Fdocuments";
const go = (to: string) => window.history.pushState(null, "", to);

afterEach(() => {
  window.sessionStorage.clear();
  go("/");
});

/** The Documents list: two documents, each a link to its own window's page. */
const List = () => (
  <>
    <a href="/orders/o1/papers/proforma?back=%2Forders%2Fo1%2Fdocuments">Proforma</a>
    <a href={PAPER}>Quotation (accepted)</a>
    <FocusReturn />
  </>
);

describe("a window that is a page of its own gives the focus back to what opened it", () => {
  it("closed from the quotation's window: back on the Documents list, the quotation's link has the focus", async () => {
    go(PAPER);
    const { rerender } = render(<List />);
    rememberOpener("/orders/o1/documents");
    // Still on the window's page: nothing happens yet.
    expect(document.activeElement).toBe(document.body);
    path = "/orders/o1/documents";
    go(path);
    await act(async () => rerender(<List />));
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole("link", { name: "Quotation (accepted)" })));
    expect(window.sessionStorage.length).toBe(0);
  });

  it("does nothing on another page, or with a note from long ago", async () => {
    go(PAPER);
    rememberOpener("/orders/o1/documents");
    path = "/orders/o2/documents";
    go(path);
    const { unmount } = render(<List />);
    expect(document.activeElement).toBe(document.body);
    unmount();

    vi.useFakeTimers({ now: Date.now() });
    go(PAPER);
    rememberOpener("/orders/o1/documents");
    vi.setSystemTime(Date.now() + 60_000);
    path = "/orders/o1/documents";
    go(path);
    render(<List />);
    vi.useRealTimers();
    expect(document.activeElement).toBe(document.body);
    expect(window.sessionStorage.length).toBe(0);
  });
});
