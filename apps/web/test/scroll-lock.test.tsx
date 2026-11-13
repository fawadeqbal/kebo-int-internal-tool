import { beforeEach, describe, expect, it, vi } from "vitest";

/** The page's scroll lock is counted: two windows open at once can close in any order. */
describe("lockScroll", () => {
  const style = { overflow: "" };
  beforeEach(() => {
    style.overflow = "";
    vi.resetModules();
    vi.stubGlobal("document", { body: { style } });
  });

  it("locks while a window is open and frees the page when it closes", async () => {
    const { lockScroll } = await import("@/lib/scroll-lock");
    const unlock = lockScroll();
    expect(style.overflow).toBe("hidden");
    unlock();
    expect(style.overflow).toBe("");
  });

  it("frees the page when the first window to open is the first to close", async () => {
    const { lockScroll } = await import("@/lib/scroll-lock");
    const first = lockScroll();
    const second = lockScroll();
    first();
    expect(style.overflow).toBe("hidden");
    second();
    expect(style.overflow).toBe("");
  });

  it("counts a window once, however often it says it closed", async () => {
    const { lockScroll } = await import("@/lib/scroll-lock");
    const first = lockScroll();
    const second = lockScroll();
    first();
    first();
    expect(style.overflow).toBe("hidden");
    second();
    expect(style.overflow).toBe("");
  });
});
