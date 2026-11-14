import { describe, expect, it, vi } from "vitest";
import type { OfferLine, QuoteOffers } from "@/lib/types-deals";

// The quotation window shows what is already known: the lead time against the wanted day,
// the factory's warranty beside ours, and the customer's target price beside our price.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const { againstTarget, factoryWarranties, readyLine, targetOf } = await import("@/components/deals/revision-editor");
type EditorState = Parameters<typeof factoryWarranties>[0];

const line = (id: string, requestedItemId: string | null): OfferLine => ({ id, no: "1", parentId: null, requestedItemId, answersNo: null, description: "Line", model: null, quantity: "1", unit: "set", unitCost: "100.00" });
const offer = (factoryQuoteId: string, name: string, warranty: string | null) => ({
  factoryQuoteId,
  factory: { id: `f-${factoryQuoteId}`, name },
  currency: "CNY",
  basis: null,
  basisPlace: null,
  receivedOn: "2026-11-01",
  validUntil: null,
  leadTime: "45 days",
  warranty,
  coverage: { covered: [], missing: [] } as unknown as QuoteOffers["offers"][number]["coverage"],
  missingRate: false,
  totalCost: null,
  lines: [line(`${factoryQuoteId}1`, "i1")],
});
const offers: QuoteOffers = {
  currency: "EUR",
  defaultMargin: 15,
  mainCurrency: "USD",
  rates: { USD: 1 },
  today: "2026-11-14",
  wantedBy: "2026-12-20",
  offers: [offer("A", "Jiangsu Filling", "12 months"), offer("B", "Henan Pack", "18 months"), offer("C", "Quiet Works", null)],
  items: [
    { id: "i1", no: "1", parentId: null, description: "Filler", model: null, quantity: "1", unit: "set", targetPrice: "85000" },
    { id: "i2", no: "2", parentId: null, description: "Capper", model: null, quantity: "1", unit: "set", targetPrice: null },
  ],
};
const state = (ids: (string | null)[]) => ({ options: ids.map((factoryQuoteId, n) => ({ key: String(n), factoryQuoteId, leadTime: "", discount: "", prices: {}, charges: [], costs: {} })) }) as unknown as EditorState;

describe("what the quotation window already knows", () => {
  it("reads a lead time against the day the customer wants the goods", () => {
    expect(readyLine("45 days", "2026-11-14", "2026-12-20")).toEqual({ text: "45 days: ready about 29 Dec 2026, 9 days after the customer wants it", late: true });
    expect(readyLine("46 days", "2026-11-04", "2026-12-19")).toMatchObject({ late: true, text: expect.stringContaining("1 day after") });
    expect(readyLine("30 days", "2026-11-14", "2026-12-20")).toEqual({ text: "30 days: ready about 14 Dec 2026, in time", late: false });
  });

  it("says nothing when the day or the lead time is not known", () => {
    expect(readyLine("45 days", "2026-11-14", null)).toBeNull();
    expect(readyLine("soon", "2026-11-14", "2026-12-20")).toBeNull();
    expect(readyLine(null, "2026-11-14", "2026-12-20")).toBeNull();
    expect(readyLine("45 days", undefined, "2026-12-20")).toBeNull();
  });

  it("names the warranty each ticked offer's factory gives", () => {
    expect(factoryWarranties(state(["A", "B"]), offers)).toBe("Jiangsu Filling gives 12 months · Henan Pack gives 18 months");
    expect(factoryWarranties(state(["B"]), offers)).toBe("Henan Pack gives 18 months");
    expect(factoryWarranties(state(["C", null]), offers)).toBeNull();
  });

  it("finds the customer's target for a line and sets our price against it", () => {
    expect(targetOf(line("x", "i1"), offers)).toBe("85000");
    expect(targetOf(line("x", "i2"), offers)).toBeNull();
    expect(targetOf(line("x", null), offers)).toBeNull();
    // Priced by hand: the line is the item itself.
    expect(targetOf(line("i1", null), offers)).toBe("85000");

    expect(againstTarget("88,400.00", "85000")).toEqual({ text: "4.0% over", over: true });
    expect(againstTarget("82620", "85000")).toEqual({ text: "2.8% under", over: false });
    expect(againstTarget("85000", "85000")).toEqual({ text: "on target", over: false });
    expect(againstTarget("", "85000")).toBeNull();
    expect(againstTarget("0", "85000")).toBeNull();
    expect(againstTarget("100", null)).toBeNull();
    expect(againstTarget("100", "0")).toBeNull();
  });
});
