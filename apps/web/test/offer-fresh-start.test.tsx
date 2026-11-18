import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Every new factory offer starts fresh (decided 16 Nov 2026): choosing a factory fills nothing from its last offer;
// the window keeps the company's usual tax and advance (Settings) and what was typed.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const { OfferHeaderForm } = await import("@/components/deals/factory-quote-form");

describe("a new supplier offer starts fresh", () => {
  const show = () =>
    render(
      <OfferHeaderForm
        action={async () => ({ ok: true })}
        quote={null}
        today="2026-11-14"
        mainCurrency="USD"
        rates={{ USD: 1, CNY: 7.2 }}
        searchFactories={async () => [{ id: "f1", name: "Jiangsu Filling Machinery", contactPerson: null }]}
        onDone={() => {}}
        defaults={{ taxIncluded: false, taxRate: 0, advancePercent: 30 }}
        files={null}
        lines={() => null}
      />,
    );
  const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value;

  it("choosing a supplier fills nothing from its last offer", async () => {
    show();
    // The window is in steps (design 18 Nov): Factory · Prices · Delivery & payment · Conditions · Review.
    const step = (name: RegExp) =>
      fireEvent.click(screen.getByRole("navigation", { name: "Steps" }).querySelectorAll("button")[["Supplier", "Prices", "Delivery & payment", "Conditions", "Review"].findIndex((n) => name.test(n))]!);
    step(/Delivery/);
    fireEvent.change(document.getElementById("leadDays") as HTMLInputElement, { target: { value: "40" } });
    step(/Supplier/);
    fireEvent.focus(screen.getByPlaceholderText(/search suppliers/i));
    fireEvent.mouseDown(await screen.findByText("Jiangsu Filling Machinery"));
    await waitFor(() => expect(screen.getAllByText("Jiangsu Filling Machinery").length).toBeGreaterThan(0));
    expect(screen.queryByText(/Filled from|last offer/)).toBeNull();
    step(/Delivery/);
    expect(value("basis")).toBe("");
    expect(value("basisPlace")).toBe("");
    // What was typed stays; the payment is in the same step as the delivery.
    expect(value("leadDays")).toBe("40");
    expect(value("paymentTerms")).toBe("");
    // The payment starts from the company's usual advance.
    expect(screen.getAllByLabelText("Share").map((x) => (x as HTMLInputElement).value)).toEqual(["30", "70"]);
  });
});
