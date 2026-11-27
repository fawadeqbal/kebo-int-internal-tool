import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "token-1" }) }),
  headers: async () => new Headers({ "user-agent": "Mozilla/5.0" }),
}));

afterEach(() => vi.unstubAllGlobals());

describe("the web's calls to the API", () => {
  it("say they read the new field names, so answers carry no old name beside them", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const { api, apiFetch } = await import("@/lib/api");
    await api.get("/orders/o1");
    await api.post("/expenses", { supplierId: "s1" });
    // A caller's own header cannot turn it off.
    await apiFetch("/history", { headers: { "x-names": "factory" } });
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [, init] of fetch.mock.calls as unknown as [string, RequestInit][]) {
      expect(new Headers(init.headers).get("x-names")).toBe("supplier");
    }
  });
});
