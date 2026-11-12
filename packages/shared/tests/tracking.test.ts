import { describe, expect, it } from "vitest";
import { trackingLink } from "../src/workflows/tracking";

describe("trackingLink", () => {
  it("opens the shipping line's own page from the container's owner code", () => {
    expect(trackingLink({ mode: "sea", containerNo: "MSKU 774120-3" })).toMatchObject({ carrier: "Maersk", number: "MSKU7741203" });
    expect(trackingLink({ containerNo: "cbhu1234567" })!.url).toContain("coscoshipping.com");
  });

  it("falls back to the B/L's prefix, then to a general tracker", () => {
    expect(trackingLink({ containerNo: "TGHU 482193-0", blNo: "MEDU1234567" })).toMatchObject({ carrier: "MSC", number: "MEDU1234567" });
    expect(trackingLink({ containerNo: "TGHU 482193-0" })).toMatchObject({ carrier: "Track-trace", number: "TGHU4821930" });
  });

  it("tracks an air waybill on the air cargo tracker, and nothing without a number", () => {
    expect(trackingLink({ mode: "air", blNo: "999-12345675" })!.url).toContain("aircargo");
    expect(trackingLink({ mode: "sea" })).toBeNull();
  });
});
