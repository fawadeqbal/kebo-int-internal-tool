import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

// Canvas board "Shipping" (19 Nov 2026): a shipment is one box with a line per part, each with its own button.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
const { PartsBox } = await import("@/components/records/parts-box");

describe("a box made of parts", () => {
  it("names each part with its word, shows only what it holds, says when it is empty, and keeps its button", () => {
    render(
      <PartsBox
        title="Shipment"
        word={{ text: "Booked", tone: "info" }}
        parts={[
          { key: "b", title: "Booking", word: { text: "Booked", tone: "ok" }, facts: [["Forwarder", "Ocean Star"], ["Booking no.", null], ["ETD", "2 Dec 2026"]], action: <button>Edit</button> },
          { key: "a", title: "Arrival and customs", facts: [], empty: "Not arrived yet.", action: <button>Add</button> },
        ]}
      />,
    );
    const box = screen.getByRole("region", { name: "Shipment" });
    const booking = within(box).getByRole("listitem", { name: "Booking" });
    expect(booking.textContent).toContain("ForwarderOcean Star");
    expect(booking.textContent).toContain("ETD2 Dec 2026");
    expect(booking.textContent).not.toContain("Booking no.");
    expect(within(booking).getByRole("button", { name: "Edit" })).toBeTruthy();
    const arrival = within(box).getByRole("listitem", { name: "Arrival and customs" });
    expect(arrival.textContent).toContain("Not arrived yet.");
    expect(within(arrival).getByRole("button", { name: "Add" })).toBeTruthy();
  });
});
