import { describe, expect, it } from "vitest";
import { deliveryConditionOf } from "../src";

const line = (quantity: number, deliveredQty: number, deliveredCondition: string | null) => ({ quantity, deliveredQty, deliveredCondition });

describe("the condition a delivery arrived in is its lines'", () => {
  it("is nothing until a line has been checked", () => {
    expect(deliveryConditionOf([])).toBeNull();
    expect(deliveryConditionOf([line(5, 0, null), line(2, 0, null)])).toBeNull();
  });

  it("is the worst line: damaged, then partly delivered, then minor damage, then good", () => {
    expect(deliveryConditionOf([line(5, 5, "good"), line(2, 2, "good")])).toBe("good");
    expect(deliveryConditionOf([line(5, 5, "good"), line(2, 2, "minor_damage")])).toBe("minor_damage");
    expect(deliveryConditionOf([line(5, 4, "good"), line(2, 2, "minor_damage")])).toBe("partial"); // one short
    expect(deliveryConditionOf([line(5, 0, "missing"), line(2, 2, "good")])).toBe("partial");
    expect(deliveryConditionOf([line(5, 4, "good"), line(2, 2, "damaged")])).toBe("damaged");
  });

  it("does not count lines not yet checked", () => {
    expect(deliveryConditionOf([line(5, 5, "good"), line(2, 0, null)])).toBe("good");
  });

  it("reads decimal quantities as Prisma gives them", () => {
    const dec = (v: string) => ({ toString: () => v });
    expect(deliveryConditionOf([{ quantity: dec("2.500"), deliveredQty: dec("2.5"), deliveredCondition: "good" }])).toBe("good");
    expect(deliveryConditionOf([{ quantity: dec("2.500"), deliveredQty: dec("2.4"), deliveredCondition: "good" }])).toBe("partial");
  });
});
