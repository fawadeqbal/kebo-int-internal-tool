import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LastOffer } from "@/lib/types-deals";

// A new factory offer starts from that factory's last one: filled, said so under each field, and
// never locked ("Start empty", or just type over it).
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const { fillFromLast, lastOfferValues, unfill, OfferHeaderForm } = await import("@/components/deals/factory-quote-form");
type QuoteState = Parameters<typeof fillFromLast>[0];

const last: LastOffer = {
  inquiryRef: "RFQ-2026-0483",
  receivedOn: "2026-10-12",
  currency: "USD",
  taxIncluded: true,
  taxRate: 13,
  basis: "FOB",
  basisPlace: "Shanghai",
  leadTime: "45 days",
  moq: "1 set",
  paymentTerms: "30% T/T advance, 70% before shipment",
  advancePercent: 30,
  warranty: null,
};
const start: QuoteState = {
  factory: null,
  reference: "",
  currency: "CNY",
  convertPrices: true,
  receivedOn: "2026-11-14",
  validUntil: "",
  basis: "",
  basisPlace: "",
  leadTime: "",
  moq: "",
  paymentTerms: "",
  advancePercent: "",
  warranty: "",
  notes: "",
  taxIncluded: false,
  taxRate: "0",
};

describe("a new offer from the factory's last one", () => {
  it("takes what the last offer said and leaves out what it did not", () => {
    const v = lastOfferValues(last);
    expect(v).toEqual({ currency: "USD", taxIncluded: true, taxRate: "13", basis: "FOB", basisPlace: "Shanghai", leadTime: "45 days", paymentTerms: "30% T/T advance, 70% before shipment", advancePercent: "30" });
    // The minimum order belongs to the product, the reference and dates to that one offer.
    expect(v).not.toHaveProperty("moq");
    expect(v).not.toHaveProperty("warranty");
  });

  it("fills only what nobody typed yet", () => {
    const typed = { ...start, leadTime: "20 days", reference: "JS-77" };
    const s = fillFromLast(typed, start, lastOfferValues(last));
    expect(s).toMatchObject({ currency: "USD", basis: "FOB", basisPlace: "Shanghai", taxIncluded: true, taxRate: "13", advancePercent: "30" });
    expect(s.leadTime).toBe("20 days");
    expect(s.reference).toBe("JS-77");
    expect(s.warranty).toBe("");
  });

  it("starts empty again, keeping what was typed over", () => {
    const values = lastOfferValues(last);
    const s = { ...fillFromLast(start, start, values), basisPlace: "Ningbo", reference: "JS-78" };
    const back = unfill(s, start, values);
    expect(back).toMatchObject({ currency: "CNY", basis: "", taxIncluded: false, taxRate: "0", leadTime: "", paymentTerms: "", advancePercent: "" });
    expect(back.basisPlace).toBe("Ningbo");
    expect(back.reference).toBe("JS-78");
    expect(unfill(s, start, null)).toBe(s);
  });

  const show = (lastOffer?: (id: string) => Promise<LastOffer | null>) =>
    render(
      <OfferHeaderForm
        action={async () => ({ ok: true })}
        quote={null}
        today="2026-11-14"
        mainCurrency="USD"
        rates={{ USD: 1, CNY: 7.2 }}
        searchFactories={async () => [{ id: "f1", name: "Jiangsu Filling Machinery", contactPerson: null }]}
        lastOffer={lastOffer}
        onDone={() => {}}
        defaults={{ taxIncluded: false, taxRate: 0 }}
        files={null}
        footer={null}
      />,
    );
  const pick = async () => {
    fireEvent.focus(screen.getByPlaceholderText(/search factories/i));
    fireEvent.mouseDown(await screen.findByText("Jiangsu Filling Machinery"));
  };
  const field = (id: string) => document.getElementById(id) as HTMLInputElement;
  const value = (id: string) => field(id).value;

  it("fills the window when the factory is chosen, says where from, and can start empty", async () => {
    const asked = vi.fn(async () => last);
    show(asked);
    await pick();
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Filled from Jiangsu Filling Machinery’s last offer: RFQ-2026-0483/));
    expect(asked).toHaveBeenCalledWith("f1");
    expect(value("basis")).toBe("FOB");
    expect(value("basisPlace")).toBe("Shanghai");
    expect(value("leadTime")).toBe("45 days");
    expect(value("advancePercent")).toBe("30");
    expect(value("paymentTerms")).toBe("30% T/T advance, 70% before shipment");
    expect(screen.getAllByText(/from their last offer/).length).toBeGreaterThanOrEqual(5);

    // Typed over: it is the person's own now, and no longer says "from their last offer".
    const before = screen.getAllByText(/from their last offer/).length;
    fireEvent.change(field("leadTime"), { target: { value: "30 days" } });
    expect(screen.getAllByText(/from their last offer/).length).toBe(before - 1);

    fireEvent.click(screen.getByRole("button", { name: "Start empty" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(value("basis")).toBe("");
    expect(value("basisPlace")).toBe("");
    expect(value("advancePercent")).toBe("");
    expect(value("leadTime")).toBe("30 days");
    expect(screen.queryByText(/from their last offer/)).toBeNull();
  });

  it("stays as today for a factory with no offer before", async () => {
    show(async () => null);
    await pick();
    await waitFor(() => expect(screen.getByText("Jiangsu Filling Machinery")).toBeTruthy());
    expect(screen.queryByRole("status")).toBeNull();
    expect(value("basis")).toBe("");
    expect(screen.queryByText(/from their last offer/)).toBeNull();
  });
});
