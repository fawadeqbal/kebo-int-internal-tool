import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { DomainDiagnosis } from "@kebo/shared";
import { proxy } from "@/proxy";
import { diagnosisSteps } from "@/components/domains/diagnosis";

/** connect.<BASE_DOMAIN> (claude/own-domains-admin-design.md): what companies' own domains point to. */
const at = (url: string) => proxy(new NextRequest(url, { headers: { host: new URL(url).host } }));
const to = (res: Response) => res.headers.get("location");
const shows = (res: Response) => res.headers.get("x-middleware-rewrite");

describe("connect.<BASE_DOMAIN>", () => {
  beforeEach(() => {
    vi.stubEnv("BASE_DOMAIN", "rfq.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("shows the page that explains it and its check, never a company", async () => {
    expect(shows(await at("https://connect.rfq.test/"))).toBe("https://connect.rfq.test/connect");
    expect(shows(await at("https://connect.rfq.test/check?domain=staff.keboint.com"))).toBe(
      "https://connect.rfq.test/connect/check?domain=staff.keboint.com",
    );
    expect(to(await at("https://connect.rfq.test/login"))).toBe("https://connect.rfq.test/");
    // It never asks the API for a company called "connect".
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("a domain's look-up, in steps", () => {
  const base: DomainDiagnosis = {
    domain: "staff.keboint.com",
    zone: "keboint.com",
    target: "connect.rfq.test",
    checkedAt: "2026-11-20T00:00:00.000Z",
    verdict: "no_record",
    zoneAddresses: ["91.108.101.226"],
    cname: [],
    addresses: [],
    ourAddresses: ["145.241.156.60"],
    nameservers: ["ns1.dns-parking.com", "ns2.dns-parking.com"],
    provider: "Hostinger",
  };
  const marks = (d: DomainDiagnosis) => diagnosisSteps(d).map((s) => s.mark);

  it("no record yet: the domain works, the record is missing, the rest not reached", () => {
    expect(marks(base)).toEqual(["ok", "bad", "wait", "wait", "info"]);
    const steps = diagnosisSteps(base);
    expect(steps[1]!.found).toBe("staff.keboint.com: does not exist");
    expect(steps[4]!.found).toBe("ns1.dns-parking.com, ns2.dns-parking.com → Hostinger");
  });

  it("right: every step passes", () => {
    expect(marks({ ...base, verdict: "right", cname: ["connect.rfq.test"], addresses: ["145.241.156.60"] })).toEqual([
      "ok",
      "ok",
      "ok",
      "ok",
      "info",
    ]);
  });

  it("points elsewhere, or behind a proxy: the failing step says what it found", () => {
    const wrong = diagnosisSteps({ ...base, verdict: "wrong_target", cname: ["keboint.com"], addresses: ["91.108.101.226"] });
    expect(wrong[2]).toMatchObject({ mark: "bad", found: "points to keboint.com" });
    const proxied = diagnosisSteps({
      ...base,
      verdict: "proxied",
      addresses: ["104.21.1.1"],
      nameservers: ["kia.ns.cloudflare.com"],
      provider: "Cloudflare",
    });
    expect(proxied[3]!.mark).toBe("bad");
    expect(proxied[3]!.found).toMatch(/104\.21\.1\.1 \(ours: 145\.241\.156\.60\) · Cloudflare's proxy/);
  });
});
