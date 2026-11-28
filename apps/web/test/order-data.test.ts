import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));
// The real one: notFound() and unstable_rethrow() are part of what is tested.
vi.mock("next/navigation", async (real) => await real());

import { api, ApiError } from "@/lib/api";
import { optional, part } from "@/lib/part";
import { orderAloneOf, orderMoneyOf, orderOf, orderPapersOf, orderPeopleOf } from "@/lib/order-data";

afterEach(() => vi.restoreAllMocks());

const order = { id: "o1", refNo: "SO-1", customer: { id: "c1" } };
/** What GET /orders/:id/page answers: here the money is not this person's (null) and the papers failed. */
const page = { order, money: null, papers: { failed: true, what: "the papers" }, people: [{ id: "u1", name: "Sana" }] };

/**
 * The order's pages take each part from the one read (lib/order-data.ts), and each part answers its callers the way
 * its own endpoint did: optional() and part() leave out a part that is not this person's, part() says "Could not
 * load" for one the API could not read, and optional() sends that on to the error page.
 */
describe("the order page's parts", () => {
  it("reads the page, and gives a part its data", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue(page);
    expect(await orderOf("o1")).toEqual(order);
    expect(await orderPeopleOf("o1")).toEqual(page.people);
    expect(get).toHaveBeenCalledWith("/orders/o1/page");
  });

  it("a part that is not this person's is a 403: left out by optional() and part()", async () => {
    vi.spyOn(api, "get").mockResolvedValue(page);
    await expect(orderMoneyOf("o1")).rejects.toMatchObject({ status: 403 });
    expect(await optional(() => orderMoneyOf("o1"))).toBeNull();
    expect(await part("the money", () => orderMoneyOf("o1"))).toBeNull();
  });

  it("a part the API could not read: part() says so in its place; optional() goes on to the error page", async () => {
    vi.spyOn(api, "get").mockResolvedValue(page);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await part("the papers", () => orderPapersOf("o1"))).toEqual({ failed: true, what: "the papers" });
    expect(log.mock.calls[0]?.[0]).toBe("[part] could not load the papers: 500 part_failed");
    await expect(optional(() => orderPapersOf("o1"))).rejects.toMatchObject({ status: 500, code: "part_failed" });
  });

  it("an order that is not there is the page's not-found; every part fails the same way", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new ApiError(404, "Nothing has this number. Check the link."));
    await expect(orderOf("o1")).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    expect(await optional(() => orderMoneyOf("o1"))).toBeNull();
  });

  it("pages elsewhere read the order alone, not the page", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue(order);
    expect(await orderAloneOf("o1")).toEqual(order);
    expect(get).toHaveBeenCalledWith("/orders/o1");
  });
});
