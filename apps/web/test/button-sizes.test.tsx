import { describe, expect, it } from "vitest";
import { buttonClass, type ButtonSize } from "@kebo/ui";

/**
 * Every button size sets its height and the room either side of its words on a laptop, not only on a phone (the
 * small size once had only its phone classes, so on a laptop it hugged its words).
 */
describe("button sizes", () => {
  const sizes: ButtonSize[] = ["xs", "sm", "md", "lg", "icon", "icon-sm", "icon-xs"];
  for (const size of sizes)
    it(`${size} has a height on every screen`, () => {
      const cls = buttonClass("secondary", size).split(/\s+/);
      expect(cls.some((c) => /^(h|size)-\d/.test(c)), cls.join(" ")).toBe(true);
      if (!size.startsWith("icon")) expect(cls.some((c) => /^px-/.test(c)), cls.join(" ")).toBe(true);
    });
  it("sm is 32px high with 10px either side, 40px on a phone", () => {
    const cls = buttonClass("secondary", "sm");
    for (const c of ["h-8", "px-2.5", "text-md", "max-sm:h-10", "max-sm:px-3.5"]) expect(cls).toContain(c);
  });
});
