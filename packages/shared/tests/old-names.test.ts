import { describe, expect, it } from "vitest";
import { newName, newNames, oldName, readSettings, withNewNames, withOldNamesToo } from "../src";
import { RENAMED } from "../src/old-names.renamed";

describe("old names: JSON saved before the rename, and phone apps installed before it", () => {
  it("reads an old name as the new one, and nothing else", () => {
    expect(newName("factoryId")).toBe("supplierId");
    expect(newName("newFactoryName")).toBe("newSupplierName");
    expect(newName("factoryIds")).toBe("supplierIds");
    expect(newName("ordersOwingFactories")).toBe("ordersOwingSuppliers");
    // The bare word and snake_case names did not change: they are still what the code and the database say.
    const untouched = ["factory", "factories", "Factory", "factory_quote", "with_factory", "customerId"];
    expect(newNames(untouched)).toEqual(untouched);
    // A word that only holds it, a name that never was in the code, an object's own machinery: not names that changed.
    expect(
      newNames(["satisfactory", "unsatisfactoryResult", "factoryname", "factoryCode", "constructor", "toString", "__proto__"]),
    ).toEqual(["satisfactory", "unsatisfactoryResult", "factoryname", "factoryCode", "constructor", "toString", "__proto__"]);
  });

  it("gives a new name its old twin, for a phone app that still reads it: only a name that changed", () => {
    expect(oldName("supplierTotal")).toBe("factoryTotal");
    expect(oldName("supplierQuoteId")).toBe("factoryQuoteId");
    expect(oldName("ordersOwingSuppliers")).toBe("ordersOwingFactories");
    expect(oldName(newName("factoryAdvancePercent"))).toBe("factoryAdvancePercent");
    // These always said supplier: they have no old twin.
    for (const always of ["supplier", "suppliers", "supplier_code", "supplierCode", "supplierRef", "isSupplier"])
      expect(oldName(always)).toBe(always);
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

  it("the list of names that changed is the rename's own: 225 names, each word swapped and nothing else", () => {
    const pairs = Object.entries(RENAMED);
    expect(pairs.length).toBe(225);
    const swap = (s: string) =>
      s
        .replace(/Factories/g, "Suppliers")
        .replace(/Factory/g, "Supplier")
        .replace(/factories/g, "suppliers")
        .replace(/factory/g, "supplier");
    expect(pairs.filter(([old, now]) => swap(old) !== now || newName(old) !== now || oldName(now) !== old)).toEqual([]);
    // No new name is listed twice (two old names for one new name could not be told apart on the way back).
    expect(new Set(pairs.map(([, now]) => now)).size).toBe(225);
  });

  it("a body from an old phone app: the name it knows is the one it means", () => {
    // It got both names, changed the one it knows, and sent the other back as it was.
    expect(withNewNames({ factoryQuoteId: "edited", supplierQuoteId: "as it got it" }, "old")).toEqual({ supplierQuoteId: "edited" });
    expect(withNewNames({ supplierQuoteId: "q1", note: "x" }, "old")).toEqual({ supplierQuoteId: "q1", note: "x" });
    // A name that always said supplier has no old twin to give way to, and an answer does not invent one.
    expect(withNewNames({ supplierCode: "SUP-0007", factoryCode: "never ours" }, "old")).toEqual({
      supplierCode: "SUP-0007",
      factoryCode: "never ours",
    });
    expect(withOldNamesToo({ supplierCode: "SUP-0007", supplierRef: "INV-9" })).toEqual({ supplierCode: "SUP-0007", supplierRef: "INV-9" });
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
