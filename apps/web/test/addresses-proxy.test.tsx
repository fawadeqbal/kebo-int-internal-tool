import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

/**
 * The three kinds of address: the plain one is the marketing site, admin. is the platform area, and every
 * other name in front is a company. (get., the marketing site's old address, sends people on.)
 */
const at = (url: string, headers: Record<string, string> = {}) => proxy(new NextRequest(url, { headers: { host: new URL(url).host, ...headers } }));
const to = (res: Response) => res.headers.get("location");
const shows = (res: Response) => res.headers.get("x-middleware-rewrite");
const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("addresses", () => {
  beforeEach(() => {
    vi.stubEnv("BASE_DOMAIN", "rfq.test");
    vi.stubEnv("ROOT_COMPANY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("slug=acme")) return new Response(JSON.stringify({ slug: "acme" }));
        // Lahore Pharma connected its own domain.
        if (u.includes("slug=lahore")) return new Response(JSON.stringify({ slug: "lahore", domain: "erp.lahorepharma.com" }));
        if (u.includes("host=erp.lahorepharma.com")) return new Response(JSON.stringify({ slug: "lahore" }));
        return new Response("{}", { status: 404 });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("the plain address is the marketing site", async () => {
    expect(shows(await at("https://rfq.test/"))).toBe("https://rfq.test/site");
    expect(shows(await at("https://www.rfq.test/"))).toBe("https://www.rfq.test/site");
    expect(shows(await at("https://rfq.test/sign-in?email=a%40b.c"))).toBe("https://rfq.test/site/sign-in?email=a%40b.c");
    expect(passes(await at("https://rfq.test/request-a-demo"))).toBe(true);
    expect(passes(await at("https://rfq.test/sign-up/confirm?token=x"))).toBe(true);
    // Its pages have short paths only.
    expect(to(await at("https://rfq.test/site/sign-in"))).toBe("https://rfq.test/sign-in");
    // Not a page of the site: back to it.
    expect(to(await at("https://rfq.test/orders/1"))).toBe("https://rfq.test/");
  });

  it("with a first company set, links kept from before the addresses open there; the site stays at the plain address", async () => {
    vi.stubEnv("ROOT_COMPANY", "kebo");
    expect(to(await at("https://rfq.test/orders/1?tab=money"))).toBe("https://kebo.rfq.test/orders/1?tab=money");
    expect(shows(await at("https://rfq.test/"))).toBe("https://rfq.test/site");
    // Older emails' set-password links and the phone app's PDFs are served at the plain address.
    expect(passes(await at("https://rfq.test/set-password?token=x"))).toBe(true);
    expect(passes(await at("https://rfq.test/pdf/quotation/1", { authorization: "Bearer x" }))).toBe(true);
  });

  it("the marketing site's old address sends people on, to the same page", async () => {
    expect(to(await at("https://get.rfq.test/"))).toBe("https://rfq.test/");
    expect(to(await at("https://get.rfq.test/request-a-demo?from=ad"))).toBe("https://rfq.test/request-a-demo?from=ad");
    expect(to(await at("https://get.rfq.test/site"))).toBe("https://rfq.test/");
  });

  it("admin. is the platform area", async () => {
    expect(to(await at("https://admin.rfq.test/"))).toBe("https://admin.rfq.test/platform");
    expect(passes(await at("https://admin.rfq.test/platform/companies"))).toBe(true);
    expect(to(await at("https://acme.rfq.test/platform"))).toBe("https://admin.rfq.test/platform");
  });

  it("any other name in front is a company: a real one opens, an unknown one says so", async () => {
    const res = await at("https://acme.rfq.test/orders", { "x-company": "someone-else" });
    expect(passes(res)).toBe(true);
    expect(res.headers.get("x-middleware-request-x-company")).toBe("acme");
    expect(shows(await at("https://nobody.rfq.test/orders"))).toBe("https://nobody.rfq.test/no-company");
    // The marketing site is not at a company's address.
    expect(to(await at("https://acme.rfq.test/site"))).toBe("https://rfq.test/");
  });

  it("a company's own domain is its address while it is connected; its address under ours sends people on", async () => {
    const res = await at("https://erp.lahorepharma.com/orders?tab=money", { "x-company": "someone-else" });
    expect(passes(res)).toBe(true);
    expect(res.headers.get("x-middleware-request-x-company")).toBe("lahore");
    expect(to(await at("https://lahore.rfq.test/orders?tab=money"))).toBe("https://erp.lahorepharma.com/orders?tab=money");
    // The platform area stays at admin.
    expect(to(await at("https://erp.lahorepharma.com/platform"))).toBe("https://admin.rfq.test/platform");
    // A domain nobody connected (or one still waiting for its record) is no company's.
    expect(shows(await at("https://erp.someone-else.com/login"))).toBe("https://erp.someone-else.com/no-company");
  });
});
