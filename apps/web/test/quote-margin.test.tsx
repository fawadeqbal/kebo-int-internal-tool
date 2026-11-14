import { describe, expect, it, vi } from "vitest";
import type { QuoteOffers, RevisionDraft } from "@/lib/types-deals";

// The margin box of the quotation windows. It used to price only an offer ticked after the margin was typed,
// so on a revision "type a margin, save" changed nothing; and it started at the usual margin, not the real one.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const { fromDraft, marginOf, optionTotals, pricedAll, startMargin } = await import("@/components/deals/revision-editor");

const line = (id: string, quantity: string, unitCost: string | null) => ({ id, no: id, parentId: null, requestedItemId: null, answersNo: null, description: `Line ${id}`, model: null, quantity, unit: "pcs", unitCost });
const offer = (factoryQuoteId: string, lines: ReturnType<typeof line>[], basis: "FOB" | "EXW" = "FOB") => ({
  factoryQuoteId,
  factory: { id: `f-${factoryQuoteId}`, name: `Factory ${factoryQuoteId}` },
  currency: "USD",
  basis,
  basisPlace: "Shanghai",
  receivedOn: "2026-11-01",
  validUntil: null,
  leadTime: "30 days",
  coverage: { covered: [], missing: [] } as unknown as QuoteOffers["offers"][number]["coverage"],
  missingRate: false,
  totalCost: null,
  lines,
});
const offers: QuoteOffers = {
  currency: "USD",
  defaultMargin: 15,
  mainCurrency: "USD",
  rates: { USD: 1, CNY: 7.2 },
  offers: [offer("A", [line("a1", "10", "80.00"), line("a2", "2", "500.00")]), offer("B", [line("b1", "10", "90.00"), line("b2", "1", null)])],
  items: [{ id: "i1", no: "1", parentId: null, description: "Pump", model: null, quantity: "10", unit: "pcs" }],
};
const draft = (options: RevisionDraft["options"]): RevisionDraft => ({
  number: 2,
  currency: "USD",
  incoterm: "FOB",
  incotermPlace: "Shanghai",
  depositPercent: 30,
  balanceTerms: "before_shipment" as RevisionDraft["balanceTerms"],
  validUntil: "2026-12-31",
  paymentTerms: null,
  deliveryTerms: null,
  warranty: null,
  notes: null,
  options,
});
const option = (factoryQuoteId: string | null, prices: Record<string, number>, extra: Partial<RevisionDraft["options"][number]> = {}) =>
  ({ factoryQuoteId, discount: 0, leadTime: null, charges: [], costs: [], prices: Object.entries(prices).map(([lineId, unitPrice]) => ({ lineId, unitPrice })), ...extra }) as RevisionDraft["options"][number];
const marginOfOption = (s: ReturnType<typeof fromDraft>, i: number) => optionTotals(s.options[i]!, offers, s.incoterm, "USD").costing.marginPercent;

describe("the margin a quotation window starts with", () => {
  it("is the margin the options have now, not the usual one from Settings", () => {
    // Both options were priced at 20% on cost in the last revision.
    const s = fromDraft(draft([option("A", { a1: 100, a2: 625 }), option("B", { b1: 112.5, b2: 40 })]));
    expect(marginOfOption(s, 0)).toBe(20);
    expect(startMargin(s, offers)).toBe("20");
  });

  it("is the usual margin when the options are at different margins, or nothing has a cost", () => {
    expect(startMargin(fromDraft(draft([option("A", { a1: 100, a2: 625 }), option("B", { b1: 100, b2: 40 })])), offers)).toBe("15");
    expect(startMargin(fromDraft(draft([option(null, { i1: 300 })])), offers)).toBe("15");
    // Sold under cost: a margin below zero is not something to price at.
    expect(startMargin(fromDraft(draft([option("A", { a1: 70, a2: 400 })])), offers)).toBe("15");
  });
});

describe("a margin typed in the window prices every ticked offer", () => {
  const before = fromDraft(draft([option("A", { a1: 100, a2: 625 }), option("B", { b1: 112.5, b2: 40 }), option(null, { i1: 300 })]));

  it("every line that has a cost gets the price that leaves that margin", () => {
    const after = { ...before, options: pricedAll(before, offers, 25) };
    // 80 / (1 − 0.25) = 106.67; 500 / 0.75 = 666.67; 90 / 0.75 = 120.
    expect(after.options[0]!.prices).toEqual({ a1: "106.67", a2: "666.67" });
    expect(after.options[1]!.prices.b1).toBe("120.00");
    expect(marginOfOption(after, 0)).toBeCloseTo(25, 1);
  });

  it("a line without a cost, and an option priced by hand, keep their prices", () => {
    const after = pricedAll(before, offers, 25);
    expect(after[1]!.prices.b2).toBe("40.00");
    expect(after[2]!.prices).toEqual({ i1: "300.00" });
    // Lead time, discount and charges are not touched.
    expect({ ...after[0]!, prices: null }).toEqual({ ...before.options[0]!, prices: null });
  });

  it("the costs to reach our terms are covered by the prices (the margin is on the landed cost)", () => {
    // Bought EXW, sold FOB: taking the goods to the port costs 180 more.
    const exw: QuoteOffers = { ...offers, offers: [offer("A", [line("a1", "10", "80.00"), line("a2", "2", "500.00")], "EXW")] };
    const s = fromDraft(draft([option("A", { a1: 100, a2: 625 }, { costs: [{ step: "to_port", amount: 180, currency: "USD", note: null }] } as Partial<RevisionDraft["options"][number]>)]));
    const after = { ...s, options: pricedAll(s, exw, 20) };
    const t = optionTotals(after.options[0]!, exw, "FOB", "USD");
    expect(t.extra.minor).toBe(18000);
    // Cost 1,800 + 180 = 1,980; at 20% that sells for 2,475.
    expect(t.totals.total).toBeGreaterThanOrEqual(247490);
    expect(t.totals.total).toBeLessThanOrEqual(247510);
    expect(t.costing.marginPercent).toBeCloseTo(20, 1);
  });
});

describe("what counts as a margin", () => {
  it("a number from 0 up to 100, typed with a dot or a comma; anything else prices nothing", () => {
    expect(marginOf("20")).toBe(20);
    expect(marginOf(" 12.5 ")).toBe(12.5);
    expect(marginOf("0")).toBe(0);
    expect(marginOf("")).toBeNull();
    expect(marginOf("100")).toBeNull();
    expect(marginOf("-5")).toBeNull();
    expect(marginOf("abc")).toBeNull();
  });
});
