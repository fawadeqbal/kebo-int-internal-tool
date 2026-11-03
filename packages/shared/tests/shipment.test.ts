import { describe, expect, it } from "vitest";
import { INCOTERMS, placeIsLoading, portsOf, primaryShipment, shipByVsLc, shipmentsInOrder, shippedOnOf } from "../src";

/** Single source of truth, PR 3: the shipment is the shipment. */
describe("ports per Incoterm", () => {
  const order = (incoterm: string, place: string | null, pod: string | null = null) => ({ incoterm, incotermPlace: place, portOfDischarge: pod });

  it("E/F terms load at the Incoterm place", () => {
    for (const t of ["EXW", "FCA", "FAS", "FOB"]) {
      expect(placeIsLoading(t)).toBe(true);
      expect(portsOf(order(t, "Ningbo"))).toEqual({ portOfLoading: "Ningbo", portOfDischarge: null });
      // The contract destination typed on the order is the discharge port.
      expect(portsOf(order(t, "Ningbo", "Karachi"))).toEqual({ portOfLoading: "Ningbo", portOfDischarge: "Karachi" });
    }
  });

  it("C/D terms discharge at the Incoterm place: never pre-typed as the loading port", () => {
    for (const t of ["CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"]) {
      expect(placeIsLoading(t)).toBe(false);
      expect(portsOf(order(t, "Karachi"))).toEqual({ portOfLoading: null, portOfDischarge: "Karachi" });
      // The order's destination wins over the place (e.g. CIF Karachi, unloaded at Hairatan).
      expect(portsOf(order(t, "Karachi", "Hairatan, Afghanistan"))).toEqual({ portOfLoading: null, portOfDischarge: "Hairatan, Afghanistan" });
    }
    expect(INCOTERMS.filter((t) => placeIsLoading(t))).toEqual(["EXW", "FCA", "FAS", "FOB"]);
  });

  it("the shipment's own ports win; an empty one falls back to the terms", () => {
    expect(portsOf(order("CFR", "Karachi"), { portOfLoading: "Shanghai", portOfDischarge: "Port Qasim" })).toEqual({
      portOfLoading: "Shanghai",
      portOfDischarge: "Port Qasim",
    });
    expect(portsOf(order("FOB", "Ningbo", "Karachi"), { portOfLoading: null, portOfDischarge: "" })).toEqual({
      portOfLoading: "Ningbo",
      portOfDischarge: "Karachi",
    });
    expect(portsOf(order("FOB", null))).toEqual({ portOfLoading: null, portOfDischarge: null });
  });
});

describe("the primary shipment", () => {
  const s = (id: string, createdAt: string, departedOn: string | null = null) => ({ id, createdAt, departedOn });

  it("is Shipment 1, the first made (then by id), whatever order the list comes in", () => {
    const a = s("b", "2026-10-01T10:00:00Z");
    const b = s("a", "2026-10-02T10:00:00Z", "2026-10-20");
    const c = s("c", "2026-10-01T10:00:00Z", "2026-10-25");
    expect(primaryShipment([b, c, a])?.id).toBe("b");
    expect(shipmentsInOrder([b, c, a]).map((x) => x.id)).toEqual(["b", "c", "a"]);
    expect(primaryShipment([])).toBeNull();
    // Dates as Date work the same.
    expect(primaryShipment([{ id: "x", createdAt: new Date("2026-10-03") }, { id: "y", createdAt: new Date("2026-10-02") }])?.id).toBe("y");
  });

  it("shipped on is the earliest day any shipment left", () => {
    expect(shippedOnOf([s("a", "2026-10-01", "2026-10-25"), s("b", "2026-10-02", "2026-10-20"), s("c", "2026-10-03")])).toBe("2026-10-20");
    expect(shippedOnOf([s("a", "2026-10-01")])).toBeNull();
    expect(shippedOnOf([])).toBeNull();
  });
});

describe("ship-by against the LC", () => {
  it("warns only when our ship-by is later than the LC's latest shipment", () => {
    expect(shipByVsLc("2027-04-01", "2027-04-15")).toEqual({ late: false, text: "ship by 2027-04-01 · LC latest 2027-04-15" });
    expect(shipByVsLc("2027-04-20", "2027-04-15")).toMatchObject({ late: true });
    expect(shipByVsLc("2027-04-15", "2027-04-15")!.late).toBe(false);
    expect(shipByVsLc(null, "2027-04-15")).toBeNull();
    expect(shipByVsLc("2027-04-15", null)).toBeNull();
  });
});
