import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));
// The real one: redirect() and unstable_rethrow() are what is tested (test/setup.ts mocks it for components).
vi.mock("next/navigation", async (real) => await real());

import { redirect } from "next/navigation";
import { ApiError } from "@/lib/api";
import { dataOf, failedWhat, isFailed, optional, part } from "@/lib/part";

afterEach(() => vi.restoreAllMocks());

/** A part of a page read on its own (lib/part.ts): its data, nothing for "not yours / not there", or "could not load". */
describe("part", () => {
  it("gives the data when the read works", async () => {
    expect(await part("the figures", async () => ({ n: 3 }))).toEqual({ n: 3 });
  });

  it("leaves the part out when this person may not see it, or it is not there (403, 404)", async () => {
    expect(await part("money", () => Promise.reject(new ApiError(403, "No")))).toBeNull();
    expect(await part("the supplier", () => Promise.reject(new ApiError(404, "Not found")))).toBeNull();
  });

  it("says it could not be read for anything else, and logs why (not the person's data)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const down = await part("who owes", () => Promise.reject(new TypeError("fetch failed")));
    const broken = await part("the figures", () => Promise.reject(new ApiError(500, "Boom", { code: "internal" })));
    expect(down).toEqual({ failed: true, what: "who owes" });
    expect(isFailed(down) && isFailed(broken)).toBe(true);
    expect(log.mock.calls.map((c) => c[0])).toEqual([
      "[part] could not load who owes: fetch failed",
      "[part] could not load the figures: 500 internal",
    ]);
  });

  it("lets Next's own redirect through (the two-step set-up), as a page needs it", async () => {
    await expect(part("anything", async () => redirect("/login/set-up-two-step"))).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });

  it("the API client: an empty answer is nothing, words that are not JSON are a failure, a refusal keeps its status", async () => {
    const { api } = await import("@/lib/api");
    const answer = (status: number, text: string) =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(text, { status })),
      );
    answer(200, "");
    expect(await api.post("/x")).toBeNull();
    answer(200, "<html>proxy page</html>");
    await expect(api.get("/x")).rejects.toMatchObject({ status: 502 });
    expect(await part("the figures", () => api.get("/x"))).toEqual({ failed: true, what: "the figures" });
    answer(503, "<html>Service Unavailable</html>");
    await expect(api.get("/x")).rejects.toMatchObject({ status: 503 });
    answer(200, JSON.stringify({ n: 1 }));
    expect(await api.get("/x")).toEqual({ n: 1 });
    vi.unstubAllGlobals();
  });

  it("the API client: an OK answer that broke off is a failure, not nothing", async () => {
    const { api } = await import("@/lib/api");
    const cut = new ReadableStream({
      start: (c) => {
        c.enqueue(new TextEncoder().encode('{"rows":['));
        c.error(new Error("socket hang up"));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(cut, { status: 200 })),
    );
    await expect(api.get("/x")).rejects.toMatchObject({ status: 502 });
    vi.unstubAllGlobals();
  });

  it("optional: nothing for 403 and 404; any other failure goes on to the error page", async () => {
    expect(await optional(async () => 5)).toBe(5);
    expect(await optional(() => Promise.reject(new ApiError(403, "No")))).toBeNull();
    expect(await optional(() => Promise.reject(new ApiError(404, "Not found")))).toBeNull();
    await expect(optional(() => Promise.reject(new ApiError(500, "Boom")))).rejects.toMatchObject({ status: 500 });
  });

  it("logs a network failure's code (ECONNREFUSED), not just 'fetch failed'", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await part("who owes", () => Promise.reject(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } })));
    expect(log.mock.calls[0]?.[0]).toBe("[part] could not load who owes: fetch failed (ECONNREFUSED)");
  });

  it("failedWhat: the failed parts' names said once, or null", () => {
    const f = (what: string) => ({ failed: true as const, what });
    expect(failedWhat(null, { a: 1 })).toBeNull();
    expect(failedWhat(f("who owes"), null)).toBe("who owes");
    expect(failedWhat(f("who owes"), f("the sales"), f("who owes"), f("open inquiries"))).toBe("who owes, the sales and open inquiries");
  });

  it("dataOf: the data, or null for both 'left out' and 'could not load'", () => {
    expect(dataOf({ a: 1 })).toEqual({ a: 1 });
    expect(dataOf(null)).toBeNull();
    expect(dataOf({ failed: true, what: "x" })).toBeNull();
  });
});
