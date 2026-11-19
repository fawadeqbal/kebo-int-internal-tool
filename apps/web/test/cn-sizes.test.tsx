import { describe, expect, it } from "vitest";
import { cn } from "@kebo/ui";

/** The theme's text sizes are sizes to cn(): a size never removes a colour, and a later size replaces an earlier one. */
describe("cn and the theme's text sizes", () => {
  it.each(["text-2xs", "text-xs", "text-md", "text-sm", "text-lead", "text-base", "text-lg", "text-xl", "text-2xl"])("%s keeps the colour beside it", (size) => {
    expect(cn("text-white", size).split(" ")).toEqual(["text-white", size]);
    expect(cn(size, "text-primary").split(" ")).toEqual([size, "text-primary"]);
  });

  it("a later size replaces an earlier one", () => {
    expect(cn("text-sm", "text-md")).toBe("text-md");
    expect(cn("text-lead", "text-xs")).toBe("text-xs");
  });
});
