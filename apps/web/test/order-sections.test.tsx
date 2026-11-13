import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// The order without checklists (13 Nov 2026): nine tabs with a small word, and stages made of small sections.
const at = vi.hoisted(() => ({ path: "/orders/o1" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => at.path,
}));

const { OrderTabs } = await import("@/components/order-sections/order-tabs");
const { EmptySection, Section } = await import("@/components/order-sections/section");

const TABS = [
  { key: "overview" as const },
  { key: "payment" as const, word: "deposit in" },
  { key: "factory" as const, word: "PO sent" },
  { key: "production" as const, word: "ready 5 Dec" },
  { key: "shipping" as const, word: "booked" },
  { key: "delivery" as const },
  { key: "documents" as const, word: "2 of 5" },
  { key: "costs" as const },
  { key: "history" as const },
];

describe("the order's tabs", () => {
  it("are nine, in order, without numbers, each stage with its small word", () => {
    at.path = "/orders/o1";
    render(<OrderTabs base="/orders/o1" tabs={TABS} />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "Overview",
      "Paymentdeposit in",
      "Factory orderPO sent",
      "Productionready 5 Dec",
      "Shippingbooked",
      "Delivery & SAT",
      "Documents2 of 5",
      "Costs",
      "History",
    ]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/orders/o1", ...["payment", "factory", "production", "shipping", "delivery", "documents", "costs", "history"].map((t) => `/orders/o1/${t}`)]);
    expect(screen.getByRole("link", { current: "page" }).textContent).toBe("Overview");
    expect(screen.queryByText(/^\d$/)).toBeNull();
  });

  it("mark the tab the page is under: a page inside a stage, and the old Items and Money addresses", () => {
    for (const [path, tab] of [
      ["/orders/o1/shipping", "Shippingbooked"],
      ["/orders/o1/packing", "Shippingbooked"],
      ["/orders/o1/goods", "Productionready 5 Dec"],
      ["/orders/o1/papers/commercial-invoice", "Documents2 of 5"],
      ["/orders/o1/items", "Overview"],
      ["/orders/o1/money", "Paymentdeposit in"],
      ["/orders/o1/history", "History"],
    ] as const) {
      at.path = path;
      const { unmount } = render(<OrderTabs base="/orders/o1" tabs={TABS} />);
      expect(screen.getByRole("link", { current: "page" }).textContent, path).toBe(tab);
      unmount();
    }
  });
});

describe("a section", () => {
  it("shows its name, its word, its values (a dash when empty), its button and its files", () => {
    render(
      <Section
        title="Booking"
        state="Booked 28 Nov"
        tone="ok"
        actions={<button>Edit</button>}
        rows={[
          { label: "Forwarder", value: "Sino-Africa Logistics" },
          { label: "Booking no.", value: null },
        ]}
        files={<div>Booking confirmation.pdf</div>}
      />,
    );
    const s = screen.getByRole("region", { name: "Booking" });
    expect(s.textContent).toContain("Booked 28 Nov");
    expect(s.textContent).toContain("Sino-Africa Logistics");
    expect(s.textContent).toContain("Booking no.—");
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(s.textContent).toContain("Booking confirmation.pdf");
  });

  it("with nothing in it says so and offers the one button that fills it", () => {
    render(<EmptySection title="Arrival and customs" text="Not arrived yet." action={<button>Add</button>} />);
    const s = screen.getByRole("region", { name: "Arrival and customs" });
    expect(s.textContent).toContain("Not arrived yet.");
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });
});

describe("the order's history", () => {
  it("shows each change with its stage, and leaves out ids and the form's own flags", async () => {
    // The table watches its width (jsdom has no ResizeObserver).
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const { HistoryTable } = await import("@/components/common/history-list");
    render(
      <HistoryTable
        tags={{ label: "Stage", of: { h1: "Production", h2: "Overview" } }}
        entries={[
          {
            id: "h1",
            at: "2026-11-13T10:00:00Z",
            by: { id: "u1", name: "Sana" },
            action: "flow.production",
            entityType: "order",
            summary: "SO-1: ready date told",
            reason: null,
            changes: [
              { field: "factoryId", from: null, to: "1ce05c69" },
              { field: "ask", from: null, to: "true" },
              { field: "readyToldVia", from: null, to: "wechat" },
            ],
          },
          { id: "h2", at: "2026-11-12T10:00:00Z", by: null, action: "create", entityType: "order", summary: "Order made", reason: null, changes: [] },
        ]}
      />,
    );
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["When", "Who", "What changed", "Stage"]);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]!.textContent).toContain("Ready Told Via");
    expect(rows[0]!.textContent).not.toContain("1ce05c69");
    expect(rows[0]!.textContent).not.toContain("Ask");
    expect(rows[0]!.textContent).toContain("Production");
    expect(rows[1]!.textContent).toContain("Overview");
  });
});
