import { describe, expect, it } from "vitest";
import { COLOUR_SETS } from "@kebo/shared";
import { savedColours } from "@/lib/colours";
import { initialsOf } from "@/lib/initials";

describe("sign-in in the company's colours", () => {
  it("takes the set remembered on this device", () => {
    for (const set of COLOUR_SETS) expect(savedColours(set)).toBe(set);
  });
  it("is Green with nothing remembered or a value that is not a set", () => {
    expect(savedColours(undefined)).toBe("green");
    expect(savedColours("")).toBe("green");
    expect(savedColours("purple")).toBe("green");
    expect(savedColours('graphite"><script>')).toBe("green");
  });
});

describe("the company's initials on the sign-in card", () => {
  it("is the first letters of the first two words, or the first two letters of one", () => {
    expect(initialsOf("Kebo International")).toBe("KI");
    expect(initialsOf("  acme  ")).toBe("AC");
    expect(initialsOf("RFQ Desk")).toBe("RD");
    expect(initialsOf("")).toBe("K");
  });
});

describe("white label: the company's welcome", () => {
  it("shows once, then leaves the sign-in and remembers it on this device", async () => {
    const { render, screen, act } = await import("@testing-library/react");
    const { vi } = await import("vitest");
    const { Splash } = await import("@/app/login/splash");
    vi.useFakeTimers();
    document.cookie = "kebo-welcomed=; max-age=0; path=/";
    render(
      <Splash footer="© 2026 Kebo International. All rights reserved.">
        <p>Kebo International</p>
      </Splash>,
    );
    expect(screen.getByText("Kebo International")).toBeTruthy();
    expect(document.cookie).toContain("kebo-welcomed=1");
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText("Kebo International")).toBeNull();
    vi.useRealTimers();
  });

  it("is skipped by any key", async () => {
    const { render, screen, act, fireEvent } = await import("@testing-library/react");
    const { Splash } = await import("@/app/login/splash");
    render(
      <Splash footer="© 2026 Kebo International. All rights reserved.">
        <p>Welcome mark</p>
      </Splash>,
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByText("Welcome mark")).toBeNull();
  });
});

describe("welcome back: the account this device remembers", () => {
  it("reads back what was remembered, with or without a name", async () => {
    const { rememberValue, rememberedAccount } = await import("@/lib/remembered");
    expect(rememberedAccount(rememberValue({ email: "fawad@keboint.com", name: "Fawad Iqbal" }))).toEqual({ email: "fawad@keboint.com", name: "Fawad Iqbal" });
    expect(rememberedAccount(rememberValue({ email: "a@b.co", name: null }))).toEqual({ email: "a@b.co", name: null });
  });
  it("is none for nothing, junk or a value that is not an email", async () => {
    const { rememberedAccount } = await import("@/lib/remembered");
    expect(rememberedAccount(undefined)).toBeNull();
    expect(rememberedAccount("not-base64-json")).toBeNull();
    expect(rememberedAccount(Buffer.from(JSON.stringify({ e: '<script>"' })).toString("base64url"))).toBeNull();
    expect(rememberedAccount("x".repeat(700))).toBeNull();
  });
});
