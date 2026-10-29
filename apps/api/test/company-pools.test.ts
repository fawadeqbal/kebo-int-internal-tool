import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanyPools } from "../src/database/company-pools";

/** The open company connections: at most max companies, the least recently used closed first, idle ones closed. */
describe("company connection pools", () => {
  let now = 0;
  let made: string[];
  let closed: string[];
  const pools = (max: number) =>
    new CompanyPools<{ id: string }>({
      max,
      idleMs: 10_000,
      graceMs: 1_000,
      now: () => now,
      create: (id) => (made.push(id), { id }),
      close: async (c) => void closed.push(c.id),
    });

  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
    made = [];
    closed = [];
  });
  afterEach(() => vi.useRealTimers());

  it("keeps one connection per company and reuses it", () => {
    const p = pools(3);
    const a = p.get("a");
    expect(p.get("a")).toBe(a);
    expect(made).toEqual(["a"]);
  });

  it("closes the least recently used company to make room, after the grace time", () => {
    const p = pools(2);
    p.get("a");
    p.get("b");
    p.get("a"); // a is used again: b is now the oldest
    p.get("c");
    expect(p.ids()).toEqual(["a", "c"]);
    expect(closed).toEqual([]); // work still using b may finish
    vi.advanceTimersByTime(1_000);
    expect(closed).toEqual(["b"]);
    expect(p.size).toBe(2);
  });

  it("asked for again while closing, the same connection comes back and is not closed", () => {
    const p = pools(1);
    const a = p.get("a");
    p.get("b");
    expect(p.get("a")).toBe(a);
    vi.advanceTimersByTime(5_000);
    expect(made).toEqual(["a", "b"]);
    expect(closed).toEqual(["b"]);
  });

  it("closes companies left unused for the idle time", () => {
    const p = pools(5);
    p.get("a");
    now = 5_000;
    p.get("b");
    now = 10_000;
    p.sweep();
    expect(p.ids()).toEqual(["b"]);
    vi.advanceTimersByTime(1_000);
    expect(closed).toEqual(["a"]);
  });

  it("never holds more than max companies (and a few closing), however many ask", () => {
    const p = pools(3);
    for (let i = 0; i < 50; i++) p.get(`c${i}`);
    expect(p.size).toBe(3);
    expect(p.ids()).toEqual(["c47", "c48", "c49"]);
    // Only the last 5 closed wait out the grace time; the others were closed at once.
    expect(closed).toHaveLength(42);
    expect(made.length - closed.length).toBe(3 + 5);
    vi.advanceTimersByTime(1_000);
    expect(closed).toHaveLength(47);
  });

  it("forget and closeAll close at once", async () => {
    const p = pools(1);
    p.get("a");
    p.get("b"); // a is closing
    await p.forget("a");
    await p.forget("b");
    expect(closed.sort()).toEqual(["a", "b"]);
    p.get("c");
    await p.closeAll();
    expect(closed).toContain("c");
    expect(p.size).toBe(0);
    vi.advanceTimersByTime(5_000);
    expect(closed.filter((c) => c === "a")).toHaveLength(1);
  });
});
