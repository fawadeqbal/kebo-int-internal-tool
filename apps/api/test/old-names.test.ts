import { describe, expect, it } from "vitest";
import { isOldPhone, newName, newNames, oldName, oldPhoneNames, withNewNames, withOldNamesToo } from "../src/common/names/old-names";

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

  it("knows an old phone app by Dart's user agent, until the app says it knows the new names", () => {
    expect(isOldPhone({ "user-agent": "Dart/3.5 (dart:io)" })).toBe(true);
    expect(isOldPhone({ "user-agent": "Dart/3.5 (dart:io)", "x-names": "supplier" })).toBe(false);
    expect(isOldPhone({ "user-agent": "Mozilla/5.0" })).toBe(false);
    expect(isOldPhone({})).toBe(false);
  });

  it("for an old phone app: body and query read as new names, the answer with both; others untouched", () => {
    const run = (headers: Record<string, string>, url: string, body: unknown) => {
      const req = { headers, url, body };
      let sent: unknown;
      const res = { json: (b: unknown) => (sent = b) };
      oldPhoneNames()(req, res, () => undefined);
      res.json({ supplierId: "f1" });
      return { url: req.url, body: req.body, sent };
    };
    const phone = run({ "user-agent": "Dart/3.5 (dart:io)" }, "/api/expenses?factoryId=f1&q=film+factory", { factoryIds: ["f1"] });
    expect(phone).toEqual({
      url: "/api/expenses?supplierId=f1&q=film+factory",
      body: { supplierIds: ["f1"] },
      sent: { supplierId: "f1", factoryId: "f1" },
    });
    const web = run({ "user-agent": "Mozilla/5.0" }, "/api/expenses?factoryId=f1", { factoryIds: ["f1"] });
    expect(web).toEqual({ url: "/api/expenses?factoryId=f1", body: { factoryIds: ["f1"] }, sent: { supplierId: "f1" } });
  });
});
