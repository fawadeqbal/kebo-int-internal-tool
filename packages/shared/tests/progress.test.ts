import { describe, expect, it } from "vitest";
import { orderWord, type OrderWordFacts } from "../src/workflows/progress";

describe("orderWord: one word for where an order stands, from what is stored", () => {
  const at = (f: Partial<OrderWordFacts>, features: string[] | null = null) => orderWord({ status: "open", ordered: false, shipments: [], delivered: false, ...f }, features);
  it("moves with the facts, forward and back", () => {
    expect(at({})).toBe("Confirmed");
    expect(at({ ordered: true })).toBe("In production");
    expect(at({ ordered: true, shipments: [{ status: "booked", left: false }] })).toBe("In production");
    expect(at({ ordered: true, shipments: [{ status: "departed", left: true }] })).toBe("Shipped");
    // Two shipments, one still at sea: not arrived yet.
    expect(at({ shipments: [{ status: "arrived", left: true }, { status: "departed", left: true }] })).toBe("Shipped");
    expect(at({ shipments: [{ status: "arrived", left: true }, { status: "cleared", left: true }] })).toBe("Arrived");
    expect(at({ shipments: [{ status: "arrived", left: true }], delivered: true })).toBe("Delivered");
    // A shipment set back to planned: the word goes back with it.
    expect(at({ ordered: true, shipments: [{ status: "planned", left: false }] })).toBe("In production");
  });
  it("closed is Done and cancelled is Cancelled, whatever else is stored", () => {
    expect(at({ status: "closed", ordered: true })).toBe("Done");
    expect(at({ status: "cancelled", delivered: true })).toBe("Cancelled");
  });
  it("does not read a module that is switched off", () => {
    expect(at({ delivered: true, ordered: true }, ["shipping"])).toBe("In production");
    expect(at({ shipments: [{ status: "arrived", left: true }] }, [])).toBe("Shipped");
    expect(at({ shipments: [{ status: "planned", left: false }] }, [])).toBe("Confirmed");
  });
});
