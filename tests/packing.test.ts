import { describe, expect, it } from "vitest";
import { formatCbm, formatKg, packingTotals } from "@/lib/packing";

describe("packing list totals", () => {
  it("adds packages, weights and volume without floating-point drift", () => {
    const t = packingTotals([
      { quantity: 2, packages: 3, netWeight: "1250.10", grossWeight: "1380.20", cbm: "4.125" },
      { quantity: 1, packages: "1", netWeight: "0.1", grossWeight: "0.2", cbm: "0.001" },
      { quantity: 1, packages: 2, netWeight: "0.2", grossWeight: "0.1", cbm: "0.002" },
    ]);
    expect(t).toEqual({ packages: 6, netKg: 1250.4, grossKg: 1380.5, cbm: 4.128 });
  });

  it("treats empty or invalid cells as zero", () => {
    expect(packingTotals([{ quantity: "", packages: "", netWeight: "abc", grossWeight: "", cbm: "" }])).toEqual({ packages: 0, netKg: 0, grossKg: 0, cbm: 0 });
  });

  it("formats weights and volume for documents", () => {
    expect(formatKg(1380.5)).toBe("1,380.50 kg");
    expect(formatCbm(4.128)).toBe("4.128 m³");
  });
});
