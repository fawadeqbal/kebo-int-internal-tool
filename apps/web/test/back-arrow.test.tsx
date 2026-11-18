import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

// The back arrow beside a deeper page's title: where it goes, and what it remembers to go there as you left it.
let path = "/inquiries/abc";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => path,
  useSearchParams: () => new URLSearchParams(),
}));

const { PageHeader } = await import("@kebo/ui");
const { placeOf, readNav, writeNav } = await import("@kebo/ui/client");
const { backTarget, openedFrom, rootOf } = await import("../../../packages/ui/src/back");

beforeEach(() => {
  window.sessionStorage.clear();
  path = "/inquiries/abc";
});

const backLinks = () => screen.queryAllByRole("link", { name: /^Back to / });

describe("where Back goes", () => {
  it("remembers a page by its own address, without the window open over it", () => {
    expect(placeOf("/inquiries", "?stage=new&q=pump")).toBe("/inquiries?q=pump&stage=new");
    expect(placeOf("/inquiries", "?stage=new&panel=new-inquiry")).toBe("/inquiries?stage=new");
    expect(placeOf("/customers/x", "?panel=edit-customer&id=x")).toBe("/customers/x");
    expect(placeOf("/users", "?saved=u1")).toBe("/users");
  });

  it("knows the record a page is part of, from where it goes up to", () => {
    expect(rootOf("/orders", "/orders/abc/payment")).toBe("/orders/abc");
    expect(rootOf("/orders", "/orders/abc")).toBe("/orders/abc");
    expect(rootOf("/orders", "/customers/x")).toBeUndefined();
  });

  it("goes up to the list as it was left, or where the record was opened from", () => {
    const m = { lists: {}, scroll: {}, opened: {}, from: {} };
    expect(backTarget(m, "/orders", "Orders", "/orders/abc")).toEqual({ href: "/orders", label: "Orders" });
    const kept = { ...m, lists: { "/orders": "/orders?q=valve&stage=open" } };
    expect(backTarget(kept, "/orders", "Orders", "/orders/abc")).toEqual({ href: "/orders?q=valve&stage=open", label: "Orders" });
    const fromHome = { ...kept, from: { "/orders/abc": { url: "/dashboard", label: "Home" } } };
    expect(backTarget(fromHome, "/orders", "Orders", "/orders/abc")).toEqual({ href: "/dashboard", label: "Home" });
    // A tab of the same record is not where it came from.
    const fromTab = { ...kept, from: { "/orders/abc": { url: "/orders/abc/payment", label: "SO-1" } } };
    expect(backTarget(fromTab, "/orders", "Orders", "/orders/abc").href).toBe("/orders?q=valve&stage=open");
  });
});

describe("never a loop", () => {
  const list = { url: "/orders?stage=open", label: "Orders" };
  const order = { url: "/orders/o1", label: "SO-1", root: "/orders/o1" };
  const inquiry = { url: "/inquiries/i1", label: "RFQ-1", root: "/inquiries/i1" };

  it("remembers where a record was opened from, but not a tab of itself", () => {
    const m = { lists: {}, scroll: {}, opened: {}, from: {} };
    expect(openedFrom(m, "/orders/o1", list, false)).toEqual(list);
    expect(openedFrom(m, "/orders/o1", { url: "/orders/o1/payment", label: "SO-1", root: "/orders/o1" }, false)).toBeNull();
  });

  it("keeps a record's way back when it is come back to", () => {
    // The order was opened from its list; its inquiry from the order. Back from the inquiry to the order: the
    // order still goes back to its list, not to the inquiry (they would go back to each other forever).
    const m = { lists: {}, scroll: {}, opened: {}, from: { "/orders/o1": list, "/inquiries/i1": order } };
    expect(openedFrom(m, "/orders/o1", inquiry, true)).toBeNull();
  });

  it("does not make a loop going forward either: the inquiry opened again from its order", () => {
    // List → inquiry → its order → the inquiry again by the link on the order: the inquiry keeps its own way back.
    const m = { lists: {}, scroll: {}, opened: {}, from: { "/inquiries/i1": { url: "/inquiries?stage=won", label: "Inquiries" }, "/orders/o1": inquiry } };
    expect(openedFrom(m, "/inquiries/i1", order, false)).toBeNull();
    // A longer ring: a customer → its inquiry → its order → the customer again.
    const customer = { url: "/customers/c1", label: "Kabul", root: "/customers/c1" };
    const ring = { lists: {}, scroll: {}, opened: {}, from: { "/inquiries/i1": customer, "/orders/o1": inquiry } };
    expect(openedFrom(ring, "/customers/c1", order, false)).toBeNull();
    // Opened from somewhere new: remembered.
    expect(openedFrom(ring, "/customers/c1", { url: "/dashboard", label: "Home" }, false)).toEqual({ url: "/dashboard", label: "Home" });
  });
});

describe("the arrow beside the title", () => {
  it("is on a record, saying where it goes, on a laptop and in the phone's top bar", () => {
    render(<PageHeader crumbs={[{ label: "Sales" }, { label: "Inquiries", href: "/inquiries" }, { label: "RFQ-2026-0001" }]} title="Bottling line" />);
    const links = backLinks();
    expect(links).toHaveLength(2);
    for (const a of links) expect(a.getAttribute("href")).toBe("/inquiries");
    // The phone's top bar says the record's name (never its number: canvas row "Every page's top on a phone") and,
    // without a `record`, where ← goes; Back from the pages opened here says the name too.
    expect(document.querySelector("[data-record-bar]")?.textContent).toContain("Bottling line");
    expect(document.querySelector("[data-record-bar]")?.textContent).toContain("Inquiries");
    expect(document.querySelector("[data-page-label]")?.getAttribute("data-page-label")).toBe("Bottling line");
    // The path's list link opens the list as it was left too.
    act(() => writeNav((m) => void (m.lists["/inquiries"] = "/inquiries?stage=new")));
    for (const a of backLinks()) expect(a.getAttribute("href")).toBe("/inquiries?stage=new");
    expect(screen.getByRole("link", { name: "Inquiries" }).getAttribute("href")).toBe("/inquiries?stage=new");
  });

  it("says under the name what the record is and its number, given `record`", () => {
    render(
      <PageHeader crumbs={[{ label: "Sales" }, { label: "Inquiries", href: "/inquiries" }, { label: "RFQ-2026-0001" }]} title="Bottling line" record={{ kind: "Inquiry", number: "RFQ-2026-0001" }} />,
    );
    expect(document.querySelector("[data-record-bar]")?.textContent).toBe("Bottling lineInquiry · RFQ-2026-0001");
  });

  it("is not on a list: a list is the top, its icon stays", () => {
    path = "/inquiries";
    render(<PageHeader crumbs={[{ label: "Sales" }, { label: "Inquiries" }]} title="Inquiries" />);
    expect(backLinks()).toHaveLength(0);
    expect(document.querySelector("[data-record-bar]")).toBeNull();
  });

  it("says where the record was opened from", () => {
    act(() => writeNav((m) => void (m.from["/inquiries/abc"] = { url: "/customers/k", label: "Kabul Medical Supplies" })));
    render(<PageHeader crumbs={[{ label: "Sales" }, { label: "Inquiries", href: "/inquiries" }, { label: "RFQ-2026-0001" }]} title="Bottling line" />);
    for (const a of backLinks()) {
      expect(a.getAttribute("aria-label")).toBe("Back to Kabul Medical Supplies");
      expect(a.getAttribute("href")).toBe("/customers/k");
    }
    expect(readNav().from["/inquiries/abc"]?.label).toBe("Kabul Medical Supplies");
  });

  it("can be left out (back={false}) or pointed elsewhere", () => {
    const { rerender } = render(<PageHeader crumbs={[{ label: "Money" }, { label: "Payments", href: "/payments" }, { label: "PAY-1" }]} title="PAY-1" back={false} />);
    expect(backLinks()).toHaveLength(0);
    rerender(<PageHeader title="A document" back={{ href: "/orders/abc/papers", label: "SO-2026-0004" }} />);
    expect(backLinks()[0]?.getAttribute("aria-label")).toBe("Back to SO-2026-0004");
  });
});
