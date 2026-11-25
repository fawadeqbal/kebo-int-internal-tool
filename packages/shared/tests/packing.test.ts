import { describe, expect, it } from "vitest";
import { caseTotals, itemPacked, lineCaseInput, packingWarnings, shipmentOfCase, shipmentPacking, tooBigForContainer, type CaseRow } from "../src";

const row = (over: Partial<CaseRow> = {}): CaseRow => ({
  caseNo: null,
  count: 1,
  packageType: "Wooden case",
  lengthMm: null,
  widthMm: null,
  heightMm: null,
  netWeightKg: null,
  grossWeightKg: null,
  cbm: null,
  ...over,
});

describe("tooBigForContainer", () => {
  it("a press frame taller than the door needs a flat rack", () => {
    expect(tooBigForContainer(row({ lengthMm: 6100, widthMm: 2650, heightMm: 3100 }))).toBe(true);
  });
  it("a case that passes the door turned on its side fits", () => {
    expect(tooBigForContainer(row({ lengthMm: 3100, widthMm: 2200, heightMm: 2400 }))).toBe(false);
  });
  it("longer than the container is too big", () => {
    expect(tooBigForContainer(row({ lengthMm: 12500, widthMm: 1000, heightMm: 1000 }))).toBe(true);
  });
  it("an unknown size is never too big", () => {
    expect(tooBigForContainer(row({ lengthMm: 9000 }))).toBe(false);
  });
});

describe("shipments", () => {
  const sea = "s1";
  const air = "s2";
  it("with one shipment every package goes in it", () => {
    expect(shipmentOfCase(row(), [sea])).toBe(sea);
  });
  it("with two, a package goes where it was put, else nowhere yet", () => {
    expect(shipmentOfCase(row({ shipmentId: air }), [sea, air])).toBe(air);
    expect(shipmentOfCase(row(), [sea, air])).toBeNull();
    // A shipment that was removed: not given to one any more.
    expect(shipmentOfCase(row({ shipmentId: "gone" }), [sea, air])).toBeNull();
  });
  it("adds up a shipment's packages apart", () => {
    const rows = [
      row({ count: 1, lengthMm: 3100, widthMm: 2200, heightMm: 2400, grossWeightKg: 4950, shipmentId: sea }),
      row({ count: 1, lengthMm: 6100, widthMm: 2650, heightMm: 3100, grossWeightKg: 5600, shipmentId: sea }),
      row({ count: 4, packageType: "Carton", lengthMm: 600, widthMm: 400, heightMm: 400, grossWeightKg: 88, shipmentId: air }),
    ];
    const s = shipmentPacking(rows, sea, [sea, air]);
    expect(s.packages).toBe(2);
    expect(s.grossWeightKg).toBe(10550);
    expect(s.cbm).toBe(66.48);
    expect(s.tooBig).toBe(1);
    const a = shipmentPacking(rows, air, [sea, air]);
    expect(a).toMatchObject({ packages: 4, grossWeightKg: 88, cbm: 0.384, tooBig: 0 });
  });
});

describe("packingWarnings", () => {
  it("names the items not packed, counts the too big and the ones in no shipment", () => {
    const w = packingWarnings(
      [
        { name: "Tablet press line", cases: [row({ lengthMm: 6100, widthMm: 2650, heightMm: 3100 }), row({ count: 2 })] },
        { name: "Blister packing machine", cases: [] },
        { name: "Spare parts kit", cases: [row({ count: 0 })] },
      ],
      ["s1", "s2"],
    );
    expect(w).toEqual({ notPacked: ["Blister packing machine", "Spare parts kit"], tooBig: 1, noShipment: 3 });
  });
  it("with one shipment nothing is left out of a shipment", () => {
    expect(packingWarnings([{ name: "A", cases: [row()] }], ["s1"]).noShipment).toBe(0);
  });
});

describe("a package inside another (a mixed pallet)", () => {
  it("counts no package and adds no weight, but the item is packed", () => {
    const own = row({ caseNo: "4", packageType: "Pallet", grossWeightKg: 420 });
    const inside = row({ count: 0, packageType: "Carton", inPackage: "4" });
    expect(caseTotals([own, inside])).toMatchObject({ packages: 1, packageType: "Pallet", grossWeightKg: 420 });
    expect(caseTotals([inside])).toMatchObject({ packages: null, packageType: null });
    expect(itemPacked([inside])).toBe(true);
    expect(itemPacked([row({ count: 0 })])).toBe(false);
    expect(packingWarnings([{ name: "Spare parts kit", cases: [inside] }], ["s1"]).notPacked).toEqual([]);
  });
  it("the input drops what belongs to the other package", () => {
    const c = lineCaseInput.parse({ caseNo: "9", count: 3, packageType: "Carton", lengthMm: 600, grossWeightKg: 80, inPackage: "4", contents: "Wear parts" });
    expect(c).toMatchObject({ caseNo: null, count: 0, lengthMm: null, grossWeightKg: null, inPackage: "4", contents: "Wear parts" });
  });
});
