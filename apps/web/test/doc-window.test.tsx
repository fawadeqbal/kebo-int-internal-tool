import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DocWindow, lookOf, withLook } from "@/components/window/doc-window";
import { docStateOf, orderWindowOfPrint, rowWindowHref } from "@/lib/doc-links";

const ID = "6f1d2b3c-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

/** One window for documents and files (design 26 Nov 2026): each thing in one place. */
describe("the one window", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  });

  it("an order's paper as printed opens as the order's window; other papers do not", () => {
    expect(orderWindowOfPrint(`/print/orders/${ID}/commercial-invoice?ref=x1&copy=customs&back=/x`, "/orders/a/shipping")).toBe(
      `/orders/${ID}/papers/commercial-invoice?ref=x1&copy=customs&back=%2Forders%2Fa%2Fshipping`,
    );
    expect(orderWindowOfPrint(`/print/orders/${ID}/proforma`, "/b")).toBe(`/orders/${ID}/papers/proforma?back=%2Fb`);
    expect(orderWindowOfPrint(`/print/orders/not-an-id/proforma`, "/b")).toBeNull();
    expect(orderWindowOfPrint(`/print/orders/${ID}/something-else`, "/b")).toBeNull();
    expect(orderWindowOfPrint("/print/revisions/abc", "/b")).toBeNull();
  });

  it("every row of Documents has its window, an uploaded one by its record", () => {
    const up = { kind: "other", ref: null, source: "upload" as const, doc: { id: "d1", status: "ready", keptWhere: null, file: null, issuedOn: null } };
    expect(rowWindowHref(ID, up, "/back")).toBe(`/orders/${ID}/papers/other?doc=d1&back=%2Fback`);
    expect(rowWindowHref(ID, { kind: "payment-request", ref: "p2", source: "app", doc: null }, "")).toBe(`/orders/${ID}/papers/payment-request?ref=p2`);
  });

  it("marks where each document stands", () => {
    const row = (x: Partial<Parameters<typeof docStateOf>[0]>) => docStateOf({ state: "can", source: "app", live: false, draft: false, ...x });
    expect(row({ live: true })).toBe("live");
    expect(row({ draft: true, state: "ready" })).toBe("draft");
    expect(row({ state: "ready" })).toBe("final");
    expect(row({ state: "wait" })).toBe("todo");
    expect(row({ source: "upload", state: "up" })).toBe("file");
    expect(row({ source: "upload", state: "miss" })).toBe("needed");
    expect(row({ source: "upload", state: "else" })).toBe("final");
  });

  it("which copy and language a paper shows go on its address and come off a switch's link", () => {
    expect(lookOf("/print/orders/1/packing-list?embed=1&copy=customs")).toEqual({ copy: "customs", lang: null });
    expect(withLook("/print/orders/1/packing-list?embed=1&lang=zh", { copy: "customs", lang: null })).toBe("/print/orders/1/packing-list?embed=1&copy=customs");
  });

  it("draws Download and Print once, the strong button at the panel's foot, and ⋯ only for the rare things", () => {
    const close = vi.fn();
    const go = vi.fn();
    render(
      <DocWindow
        kind="order"
        title="Commercial invoice"
        number="CI-2026-0572"
        state={{ state: "draft", word: "Draft · version 1" }}
        sub="SO-2026-0572 · Vision Pharmaceuticals"
        items={[
          { key: "a", name: "Packing list", state: "final", go },
          { key: "b", name: "Commercial invoice", state: "draft", go: () => {} },
        ]}
        at={1}
        download={{ href: "/pdf/commercial-invoice/1", word: "Download PDF" }}
        onPrint={() => {}}
        more={[{ label: "Open the Shipping step", onClick: () => {} }]}
        onClose={close}
        stage={<p>the page</p>}
        panel={{
          label: "Make it",
          tabs: [
            { key: "make", label: "Make", count: 2 },
            { key: "details", label: "Details" },
          ],
          tab: "make",
          onTab: () => {},
          body: <p>checks</p>,
          foot: <button type="button">Make final</button>,
          bar: { text: "2 to fill" },
        }}
      />,
    );
    expect(screen.getAllByRole("link", { name: /Download PDF/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Print$/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Make final" })).toHaveLength(1);
    expect(screen.getByText("Draft · version 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Open the Shipping step"]);
    fireEvent.keyDown(document.activeElement ?? window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Previous: Packing list" }));
    expect(go).toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalled();
  });
});
