import { describe, expect, it } from "vitest";
import { newName, newNames, oldName, readSettings, withNewNames, withOldNamesToo } from "../src";
import renamed from "./old-names.renamed.json";

describe("old names: JSON saved before the rename, and phone apps installed before it", () => {
  it("reads a compound old name as the new one, and nothing else", () => {
    expect(newName("factoryId")).toBe("supplierId");
    expect(newName("newFactoryName")).toBe("newSupplierName");
    expect(newName("factoryIds")).toBe("supplierIds");
    expect(newName("ordersOwingFactories")).toBe("ordersOwingSuppliers");
    // The bare word and snake_case names did not change: they are still what the code and the database say.
    const untouched = ["factory", "factories", "Factory", "factory_quote", "with_factory", "customerId"];
    expect(newNames(untouched)).toEqual(untouched);
    // A word that only holds it is another word.
    expect(newNames(["satisfactory", "unsatisfactoryResult", "factoryname"])).toEqual([
      "satisfactory",
      "unsatisfactoryResult",
      "factoryname",
    ]);
    expect(newName("FactoryQuoteView")).toBe("SupplierQuoteView");
  });

  it("gives a new name its old twin, for a phone app that still reads it", () => {
    expect(oldName("supplierTotal")).toBe("factoryTotal");
    expect(oldName("supplierQuoteId")).toBe("factoryQuoteId");
    expect(oldName("ordersOwingSuppliers")).toBe("ordersOwingFactories");
    expect(oldName("supplier")).toBe("supplier");
    expect(oldName("suppliers")).toBe("suppliers");
    expect(oldName("supplier_code")).toBe("supplier_code");
    expect(oldName(newName("factoryAdvancePercent"))).toBe("factoryAdvancePercent");
  });

  it("renames all the way down, and leaves values alone", () => {
    const day = new Date("2026-11-27T00:00:00Z");
    const saved = {
      factoryId: "f1",
      note: "at their factory",
      lines: [{ factoryUnitPrice: "2.50", factory: { id: "f1" } }],
      on: day,
      none: null,
    };
    expect(withNewNames(saved)).toEqual({
      supplierId: "f1",
      note: "at their factory",
      lines: [{ supplierUnitPrice: "2.50", factory: { id: "f1" } }],
      on: day,
      none: null,
    });
    expect(withNewNames(saved).on).toBe(day); // a date is a value, not a bag of names
    expect(withNewNames("factoryId")).toBe("factoryId"); // a text is a value too
  });

  it("a new name already there wins over its old twin", () => {
    expect(withNewNames({ factoryId: "old", supplierId: "new" })).toEqual({ supplierId: "new" });
  });

  it("an answer for an old phone app carries both names", () => {
    expect(withOldNamesToo({ supplierTotal: "10.00", rows: [{ supplierQuoteId: "q1", factory: { name: "Jiangsu" } }] })).toEqual({
      supplierTotal: "10.00",
      factoryTotal: "10.00",
      rows: [{ supplierQuoteId: "q1", factoryQuoteId: "q1", factory: { name: "Jiangsu" } }],
    });
  });

  it("reads every name the rename changed exactly as the rename wrote it, and back", () => {
    // The list is the rename tool's own record of the camelCase names it changed (step R1a, 27 Nov 2026).
    const pairs = Object.entries(renamed as Record<string, string>);
    expect(pairs.length).toBe(225);
    expect(pairs.filter(([old, now]) => newName(old) !== now || oldName(now) !== old)).toEqual([]);
  });

  it("a body from an old phone app: the name it knows is the one it means", () => {
    // It got both names, changed the one it knows, and sent the other back as it was.
    expect(withNewNames({ factoryQuoteId: "edited", supplierQuoteId: "as it got it" }, "old")).toEqual({ supplierQuoteId: "edited" });
    expect(withNewNames({ supplierQuoteId: "q1", note: "x" }, "old")).toEqual({ supplierQuoteId: "q1", note: "x" });
  });

  it("a key named __proto__ is data, never a prototype", () => {
    const body = JSON.parse('{"__proto__":{"factoryIds":["x"]},"a":1}') as Record<string, unknown>;
    const read = withNewNames(body);
    expect(Object.getPrototypeOf(read)).toBe(Object.prototype);
    expect((read as { supplierIds?: unknown }).supplierIds).toBeUndefined();
    expect(Object.keys(read)).toEqual(["__proto__", "a"]);
    expect(Object.getPrototypeOf(withOldNamesToo(body))).toBe(Object.prototype);
  });

  it("settings saved before the rename keep their values", () => {
    // Settings › Sales as every company's row holds it today: with the old names, and not the defaults.
    const read = readSettings({ sales: { factoryAdvancePercent: 40, factoryTaxIncluded: true, factoryTaxRate: 13 } });
    expect(read.sales).toMatchObject({ supplierAdvancePercent: 40, supplierTaxIncluded: true, supplierTaxRate: 13 });
    // Saved again with today's names, and read again: the same.
    expect(readSettings({ sales: read.sales }).sales).toEqual(read.sales);
  });
});
