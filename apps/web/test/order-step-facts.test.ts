import { describe, expect, it } from "vitest";
import type { OrderView } from "@/lib/types-orders";
import type { OrderFlow } from "@/lib/types-flow";
import { orderStepFacts } from "@/components/orders/order-facts";

/** The header's next step reads gone and in as the order's word does: every shipment's status (review of #442). */
describe("the next step's shipping facts", () => {
  const order = (word: string) => ({ word, status: "open", money: { depositDue: "0", due: "0" }, goods: null, readyOn: null }) as unknown as OrderView;
  const flow = (statuses: string[]) =>
    ({
      payment: { route: "tt", balanceWhen: null },
      modules: { production: true, shipping: true },
      factory: { orderedOn: "2026-11-01", readyOn: null },
      shipping: { shipments: statuses.map((status, i) => ({ id: `s${i}`, status, bookingNo: "B1", etd: null, eta: null, departedOn: "2026-11-10", arrivedOn: null })) },
      delivery: null,
    }) as unknown as OrderFlow;
  const facts = (word: string, statuses: string[]) => orderStepFacts(order(word), flow(statuses), null, { update: true });

  it("two shipments, one still at sea: sailed, not arrived (Shipment 1 alone said arrived)", () => {
    expect(facts("Shipped", ["arrived", "departed"])).toMatchObject({ sailed: true, arrived: false });
  });
  it("every shipment in: arrived", () => {
    expect(facts("Arrived", ["arrived", "cleared"])).toMatchObject({ sailed: true, arrived: true });
  });
  it("a shipment set back to booked, its day kept: not sailed", () => {
    expect(facts("In production", ["booked"])).toMatchObject({ sailed: false, arrived: false });
  });
});
