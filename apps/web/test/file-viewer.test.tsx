import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { FileViewerProvider, kindOf } from "@/components/files/viewer";

/** Files and papers open over the page in the app's one viewer, never in a new tab (Fawad 21 Nov). */
describe("the file viewer", () => {
  beforeEach(() => {
    // The viewer asks the server what a file is; here it says nothing.
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 404 }))));
  });

  it("knows a file by its type or its name", () => {
    expect(kindOf({ name: "a.pdf" })).toBe("pdf");
    expect(kindOf({ name: "x", type: "image/jpeg" })).toBe("image");
    expect(kindOf({ name: "Cost sheet.xlsx" })).toBe("sheet");
    expect(kindOf({ name: "list.csv" })).toBe("csv");
    expect(kindOf({ name: "Quote.docx" })).toBe("other");
    expect(kindOf({ name: "Proforma", viewHref: "/print/orders/1/proforma" })).toBe("paper");
  });

  it("opens a file's link over the page, with ‹ › through the others of its list", () => {
    render(
      <FileViewerProvider>
        <ul>
          <li>
            <a href="/files/aaa?view=1">Bank slip.pdf</a>
          </li>
          <li>
            <a href="/files/bbb?view=1" aria-label="View Receipt.jpg">
              eye
            </a>
          </li>
          <li>
            <a href="/files/ccc" download>
              Download
            </a>
          </li>
        </ul>
      </FileViewerProvider>,
    );
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    act(() => void screen.getByText("Bank slip.pdf").dispatchEvent(click));
    expect(click.defaultPrevented).toBe(true);
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Bank slip.pdf");
    expect(dialog.textContent).toContain("1 of 2");
    fireEvent.click(screen.getByRole("button", { name: "Next: Receipt.jpg" }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Receipt.jpg");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves a download, a Ctrl-click and a link marked for a new tab alone", () => {
    render(
      <FileViewerProvider>
        <a href="/files/ccc" download>
          Download
        </a>
        <a href="/files/ddd?view=1">Photo.png</a>
        <a href="/print/orders/1/proforma" data-new-tab="">
          Proforma
        </a>
      </FileViewerProvider>,
    );
    for (const [text, init] of [
      ["Download", {}],
      ["Photo.png", { ctrlKey: true }],
      ["Proforma", {}],
    ] as const) {
      const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
      act(() => void screen.getByText(text).dispatchEvent(click));
      expect(click.defaultPrevented).toBe(false);
    }
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a paper with Print, and a Word file with Download only", () => {
    render(
      <FileViewerProvider>
        <section>
          <a href="/print/orders/1/proforma">View / Print the proforma</a>
        </section>
        <section>
          <a href="/files/eee?view=1" data-file-name="Spec.docx">
            Spec
          </a>
        </section>
      </FileViewerProvider>,
    );
    fireEvent.click(screen.getByText("View / Print the proforma"));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("proforma");
    expect(screen.getByTitle("proforma").tagName).toBe("IFRAME");
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByText("Spec"));
    expect(screen.getByText(/does not open in the app/)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Download/ })[0]!.getAttribute("href")).toBe("/files/eee");
  });

  it("sends any file from the panel's Send tab: email, WhatsApp, or the link for the team", () => {
    render(
      <FileViewerProvider>
        <a href="/files/fff?view=1">Bank slip.pdf</a>
      </FileViewerProvider>,
    );
    fireEvent.click(screen.getByText("Bank slip.pdf"));
    // One window: Download and Print in the header, sending in the panel (no Share button beside them).
    expect(screen.queryByRole("button", { name: /^Share/ })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Send" }));
    expect(screen.getByRole("radio", { name: "Email" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "WhatsApp" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Copy link" }));
    expect(screen.getByRole("button", { name: /Copy the link/ })).toBeTruthy();
  });

  it("opens an order's paper in the order's own window, not the viewer", () => {
    const toOrder = vi.fn();
    const id = "6f1d2b3c-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
    render(
      <FileViewerProvider toOrder={toOrder}>
        <a href={`/print/orders/${id}/commercial-invoice?v=2&back=/orders/${id}/documents`}>View the commercial invoice</a>
        <a href="/print/revisions/abc">The quotation</a>
      </FileViewerProvider>,
    );
    fireEvent.click(screen.getByText("View the commercial invoice"));
    expect(toOrder).toHaveBeenCalledWith(`/orders/${id}/papers/commercial-invoice?v=2&back=%2F`);
    expect(screen.queryByRole("dialog")).toBeNull();
    // A paper that is not an order's (a quotation's revision) still opens in the viewer.
    fireEvent.click(screen.getByText("The quotation"));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
