import { HttpException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RateLimiter, verifyTurnstile } from "../src/common/http/rate-limit";

describe("the in-memory limiter", () => {
  it("allows max hits per window, then refuses until the window is over", () => {
    let now = 0;
    const l = new RateLimiter(100, () => now);
    for (let i = 0; i < 3; i++) expect(l.allow("a", 3, 1000)).toBe(true);
    expect(l.allow("a", 3, 1000)).toBe(false);
    expect(l.allow("b", 3, 1000)).toBe(true);
    now = 1000;
    expect(l.allow("a", 3, 1000)).toBe(true);
  });

  it("when full, drops only the keys whose window is over: a live limit survives a flood of new addresses", () => {
    let now = 0;
    const l = new RateLimiter(10, () => now);
    for (let i = 0; i < 5; i++) l.allow("attacker", 5, 60_000);
    expect(l.allow("attacker", 5, 60_000)).toBe(false);
    now = 10;
    for (let i = 0; i < 8; i++) l.allow(`old-${i}`, 5, 1);
    now = 100; // the old ones are over, the attacker's is not
    for (let i = 0; i < 20; i++) l.allow(`new-${i}`, 5, 60_000);
    expect(l.size).toBeLessThanOrEqual(10);
    // Cleared once only live keys were left, so this is the worst case: still bounded.
    const l2 = new RateLimiter(10, () => now);
    for (let i = 0; i < 5; i++) l2.allow("attacker", 5, 60_000);
    for (let i = 0; i < 8; i++) l2.allow(`short-${i}`, 5, 1);
    now = 200;
    l2.allow("newcomer", 5, 60_000); // fills to 10
    l2.allow("another", 5, 60_000); // over: the 8 expired ones go, the attacker stays
    expect(l2.allow("attacker", 5, 60_000)).toBe(false);
    expect(l2.size).toBe(3);
  });

  it("check() answers 429 with the message", () => {
    const l = new RateLimiter();
    l.check("x", 1, 1000, "Slow down.");
    try {
      l.check("x", 1, 1000, "Slow down.");
      expect.unreachable();
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(429);
      expect((e as HttpException).getResponse()).toEqual({ message: "Slow down." });
    }
  });
});

describe("the bot check (Turnstile)", () => {
  afterEach(() => {
    delete process.env.TURNSTILE_SECRET_KEY;
  });
  const reply = (body: object, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("is not asked when it is not switched on", async () => {
    const f = reply({ success: false });
    expect(await verifyTurnstile(undefined, "1.2.3.4", f)).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it("follows Cloudflare's answer; no token is a no", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    expect(await verifyTurnstile("tok", "1.2.3.4", reply({ success: true }))).toBe(true);
    expect(await verifyTurnstile("tok", "1.2.3.4", reply({ success: false }))).toBe(false);
    expect(await verifyTurnstile("", "1.2.3.4", reply({ success: true }))).toBe(false);
  });

  it("refuses with a clear message when Cloudflare cannot be reached (never lets the form through)", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret";
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    for (const f of [down, reply({ error: "x" }, 502)]) {
      const err = await verifyTurnstile("tok", "1.2.3.4", f).catch((e: HttpException) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(503);
      expect(JSON.stringify((err as HttpException).getResponse())).toMatch(/could not check that you are not a robot/);
    }
  });
});
