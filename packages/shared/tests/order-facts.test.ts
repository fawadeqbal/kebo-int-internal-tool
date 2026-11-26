import { describe, expect, it } from "vitest";
import { itemWhere, warrantyDates, type ItemFacts, type WarrantyDateFacts } from "../src";

const none: WarrantyDateFacts = { typedMonths: null, agreed: null, shippedOn: null, deliveredOn: null, satDoneOn: null };

describe("the order's warranty", () => {
  it("has no dates without months", () => {
    expect(warrantyDates({ ...none, deliveredOn: "2026-11-04" })).toEqual({
      months: null,
      agreedFrom: null,
      startsOn: "2026-11-04",
      endsOn: null,
    });
  });

  it("as agreed, counts from the moment agreed and from that day only", () => {
    const days = { shippedOn: "2026-10-01", deliveredOn: "2026-11-04", satDoneOn: "2026-11-20" } as const;
    expect(warrantyDates({ ...none, ...days, agreed: { months: 12, from: "shipment" } })).toMatchObject({
      startsOn: "2026-10-01",
      endsOn: "2027-10-01",
      agreedFrom: "shipment",
    });
    expect(warrantyDates({ ...none, ...days, agreed: { months: 12, from: "delivery" } })).toMatchObject({
      startsOn: "2026-11-04",
      endsOn: "2027-11-04",
    });
    expect(warrantyDates({ ...none, ...days, agreed: { months: 12, from: "sat" } })).toMatchObject({
      startsOn: "2026-11-20",
      endsOn: "2027-11-20",
    });
  });

  it("counted from the SAT, has not started until the SAT is done (a delivery does not start it)", () => {
    expect(warrantyDates({ ...none, deliveredOn: "2026-11-04", agreed: { months: 12, from: "sat" } })).toMatchObject({
      months: 12,
      startsOn: null,
      endsOn: null,
    });
  });

  it("agreed without saying from when counts from shipment", () => {
    expect(warrantyDates({ ...none, shippedOn: "2026-10-01", agreed: { months: 6, from: null } })).toMatchObject({
      agreedFrom: "shipment",
      endsOn: "2027-04-01",
    });
  });

  it("months typed on the order before win, counted from the SAT day or else the delivery day", () => {
    const agreed = { months: 12, from: "shipment" } as const;
    expect(warrantyDates({ ...none, typedMonths: 24, agreed, shippedOn: "2026-10-01", deliveredOn: "2026-11-04" })).toEqual({
      months: 24,
      agreedFrom: null,
      startsOn: "2026-11-04",
      endsOn: "2028-11-04",
    });
    expect(warrantyDates({ ...none, typedMonths: 24, deliveredOn: "2026-11-04", satDoneOn: "2026-11-20" })).toMatchObject({
      startsOn: "2026-11-20",
      endsOn: "2028-11-20",
    });
  });

  it("ends inside the month it lands in", () => {
    expect(warrantyDates({ ...none, typedMonths: 1, deliveredOn: "2026-01-31" }).endsOn).toBe("2026-02-28");
  });
});

const item: ItemFacts = {
  goods: true,
  quantity: 4,
  deliveredQty: 0,
  deliveredMarked: false,
  packed: false,
  receivedQty: 0,
  receivedOn: null,
};
const confirmed = { word: "Confirmed", poSent: false } as const;

describe("where an item is", () => {
  it("is nowhere for a line that is not goods", () => {
    expect(itemWhere({ ...item, goods: false }, confirmed)).toBeNull();
  });

  it("starts as not ordered, then at the supplier once the purchase order went", () => {
    expect(itemWhere(item, confirmed)).toEqual({ at: "not_ordered" });
    expect(itemWhere(item, { word: "In production", poSent: true })).toEqual({ at: "at_supplier" });
  });

  it("is received in part, then in full with its day", () => {
    expect(itemWhere({ ...item, receivedQty: 1 }, { word: "In production", poSent: true })).toEqual({ at: "part_received", got: 1, of: 4 });
    expect(itemWhere({ ...item, receivedQty: 4, receivedOn: "2026-11-20" }, { word: "In production", poSent: true })).toEqual({
      at: "received",
      on: "2026-11-20",
    });
  });

  it("packed comes before received, the order's own place before both", () => {
    const got = { ...item, receivedQty: 4, packed: true };
    expect(itemWhere(got, { word: "In production", poSent: true })).toEqual({ at: "packed" });
    expect(itemWhere(got, { word: "Shipped", poSent: true })).toEqual({ at: "on_its_way" });
    for (const word of ["Arrived", "Delivered", "Done"] as const) expect(itemWhere(got, { word, poSent: true })).toEqual({ at: "arrived" });
  });

  it("delivered wins over everything: in part, in full, in full with a mark", () => {
    const shipped = { word: "Shipped", poSent: true } as const;
    expect(itemWhere({ ...item, deliveredQty: 3 }, shipped)).toEqual({ at: "part_delivered", got: 3, of: 4 });
    expect(itemWhere({ ...item, deliveredQty: 4 }, shipped)).toEqual({ at: "delivered", marked: false });
    expect(itemWhere({ ...item, deliveredQty: 4, deliveredMarked: true }, shipped)).toEqual({ at: "delivered", marked: true });
  });

  it("a line of nothing is not received in full", () => {
    expect(itemWhere({ ...item, quantity: 0 }, { word: "In production", poSent: true })).toEqual({ at: "at_supplier" });
  });
});
