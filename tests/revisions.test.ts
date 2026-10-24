import { describe, expect, it } from "vitest";
import { compareLines } from "@/lib/revisions";
import { isServiceLine } from "@/modules/documents/drafts";
import { itemsSummary, lineItemsField } from "@/lib/line-items";

const line = (description: string, quantity: number, unitPrice: number, queryItemId: string | null = null, unit = "set") => ({ description, quantity, unit, unitPrice, queryItemId });

describe("quotation version changes", () => {
  it("matches lines by requested item, then by name", () => {
    const v1 = [line("Tablet press\n35 stations", 1, 68000, "a"), line("Sea freight CIF", 1, 4000)];
    const v2 = [line("Tablet press (GMP)\n35 stations", 1, 65500, "a"), line("Sea freight CIF", 1, 4000), line("Spare tooling set", 2, 900)];
    expect(compareLines(v1, v2)).toEqual([
      { kind: "changed", name: "Tablet press (GMP)", unitPrice: [68000, 65500], details: true },
      { kind: "added", name: "Spare tooling set", quantity: 2, unit: "set", unitPrice: 900 },
    ]);
  });

  it("reports removed lines and quantity/unit changes", () => {
    const v1 = [line("Hospital bed", 50, 1150, "b", "pcs"), line("Installation", 1, 2000)];
    const v2 = [line("Hospital bed", 40, 1150, "b", "set")];
    expect(compareLines(v1, v2)).toEqual([
      { kind: "changed", name: "Hospital bed", quantity: [50, 40], unit: ["pcs", "set"] },
      { kind: "removed", name: "Installation" },
    ]);
  });

  it("finds nothing when only the order is the same", () => {
    const v = [line("A", 1, 1, "x"), line("B", 2, 2)];
    expect(compareLines(v, v)).toEqual([]);
  });
});

describe("lines", () => {
  it("defaults the unit and keeps model / HS code optional", () => {
    const r = lineItemsField.safeParse(JSON.stringify([{ description: "Capsule filler", quantity: "2", unit: "", unitPrice: "54000", model: "", hsCode: "8422.30" }]));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data[0]).toMatchObject({ unit: "pcs", model: null, hsCode: "8422.30", quantity: 2 });
  });

  it("leaves services off a new packing list", () => {
    expect(isServiceLine("Sea freight CIF destination port, incl. export documents")).toBe(true);
    expect(isServiceLine("Third-party inspection (SGS)")).toBe(true);
    expect(isServiceLine("Rotary tablet press\nshipping weight 1.2 t")).toBe(false);
  });

  it("summarises several items", () => {
    expect(itemsSummary([{ description: "Hospital bed set" }])).toBe("Hospital bed set");
    expect(itemsSummary([{ description: "A" }, { description: "B" }])).toBe("A + 1 more");
  });
});
