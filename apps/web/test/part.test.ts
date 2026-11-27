import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));
// The real one: redirect() and unstable_rethrow() are what is tested (test/setup.ts mocks it for components).
vi.mock("next/navigation", async (real) => await real());

import { redirect } from "next/navigation";
import { ApiError } from "@/lib/api";
import { dataOf, isFailed, part } from "@/lib/part";

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

  it("dataOf: the data, or null for both 'left out' and 'could not load'", () => {
    expect(dataOf({ a: 1 })).toEqual({ a: 1 });
    expect(dataOf(null)).toBeNull();
    expect(dataOf({ failed: true, what: "x" })).toBeNull();
  });
});
