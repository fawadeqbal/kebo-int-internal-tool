import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import bcrypt from "bcryptjs";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { dnsProvider, type DomainDiagnosis } from "@kebo/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { currentStep, newTotpSecret, sealSecret, totpAt } from "../src/common/auth/totp";
import { DomainLookup, OwnDomainService, verdictOf, type Lookup } from "../src/common/company/own-domain.service";
import { PrismaService } from "../src/database/prisma.service";
import { signIn, startApp, api } from "./app";

/**
 * Why a company's own domain is not connected yet (claude/own-domains-admin-design.md): the look-up step
 * by step, on the platform's company page and on connect.<BASE_DOMAIN>'s check. The internet is stood in for.
 */
describe("what a domain's look-up says", () => {
  const target = "connect.rfq.test";
  const ours = ["145.241.156.60"];
  const v = (f: Partial<Parameters<typeof verdictOf>[0]>) =>
    verdictOf({ cname: [], addresses: [], ourAddresses: ours, provider: null, target, ...f });

  it("names the reason", () => {
    expect(v({ cname: ["connect.rfq.test."] })).toBe("right");
    // A provider that flattens the record: every address is ours.
    expect(v({ cname: [], addresses: ours })).toBe("right");
    expect(v({})).toBe("no_record");
    expect(v({ cname: ["keboint.com"], addresses: ["91.108.101.226"] })).toBe("wrong_target");
    expect(v({ addresses: ["104.21.1.1"], provider: "Cloudflare" })).toBe("proxied");
    expect(v({ addresses: ["91.108.101.226"] })).toBe("other_address");
    expect(v({ cname: null, addresses: null })).toBe("unknown");
    // Half the look-up failed and nothing else is known: not "no record".
    expect(v({ cname: [], addresses: null })).toBe("unknown");
  });

  it("knows the usual DNS providers by their nameservers", () => {
    expect(dnsProvider(["kia.ns.cloudflare.com.", "rob.ns.cloudflare.com"])).toBe("Cloudflare");
    expect(dnsProvider(["ns1.dns-parking.com"])).toBe("Hostinger");
    expect(dnsProvider(["ns07.domaincontrol.com"])).toBe("GoDaddy");
    expect(dnsProvider(["dns1.registrar-servers.com"])).toBe("Namecheap");
    expect(dnsProvider(["ns1.example.net"])).toBeNull();
  });
});

describe("a company's own domain, from the platform and connect.<BASE_DOMAIN>", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let platform: string;
  let found: Lookup = "not_ours";
  const tag = Date.now().toString(36);
  const domain = `staff.diag-${tag}.com`;
  const secret = newTotpSecret();
  const pub = (path: string) => request(app.getHttpServer()).get(`/api/platform/public/${path}`);
  const plat = (token = platform) => {
    const server = app.getHttpServer();
    const auth = (r: request.Test) => r.set("authorization", `Bearer ${token}`);
    return {
      get: (url: string) => auth(request(server).get(`/api/platform${url}`)),
      post: (url: string, body?: object) => auth(request(server).post(`/api/platform${url}`)).send(body ?? {}),
      put: (url: string, body?: object) => auth(request(server).put(`/api/platform${url}`)).send(body ?? {}),
      delete: (url: string) => auth(request(server).delete(`/api/platform${url}`)).send({}),
    };
  };
  const diagnosis = (d: string, verdict: DomainDiagnosis["verdict"]): DomainDiagnosis => ({
    domain: d,
    zone: d.split(".").slice(1).join("."),
    target: "connect.rfq.test",
    checkedAt: new Date().toISOString(),
    verdict,
    zoneAddresses: ["91.108.101.226"],
    cname: [],
    addresses: [],
    ourAddresses: ["145.241.156.60"],
    nameservers: ["ns1.dns-parking.com"],
    provider: "Hostinger",
  });

  beforeAll(async () => {
    process.env.BASE_DOMAIN = "rfq.test";
    process.env.OWN_DOMAINS = "true";
    app = await startApp();
    prisma = app.get(PrismaService);
    const lookup = app.get(DomainLookup);
    vi.spyOn(lookup, "find").mockImplementation(async () => found);
    vi.spyOn(lookup, "diagnose").mockImplementation(async (d) => diagnosis(d, found === "ours" ? "right" : "no_record"));
    const email = `platform-diag-${tag}@example.com`;
    await prisma.platform.platformAdmin.create({
      data: {
        email,
        name: "Fawad Test",
        passwordHash: await bcrypt.hash("Platform12345", 10),
        totpSecret: sealSecret(secret, process.env.AUTH_SECRET!),
        totpEnabledAt: new Date(),
      },
    });
    const login = (
      await request(app.getHttpServer()).post("/api/platform/auth/login").send({ email, password: "Platform12345" }).expect(200)
    ).body;
    await request(app.getHttpServer())
      .post("/api/platform/auth/two-step")
      .set("authorization", `Bearer ${login.token}`)
      .send({ code: totpAt(secret, currentStep()) })
      .expect(200);
    platform = login.token;
  });

  afterAll(async () => {
    await app.get(OwnDomainService).remove(FIRST_COMPANY_ID);
    delete process.env.BASE_DOMAIN;
    delete process.env.OWN_DOMAINS;
    await app?.close();
  });

  it("gives connect.<BASE_DOMAIN> a certificate, while the feature is on", async () => {
    await pub("domain-check?domain=connect.rfq.test").expect(200);
    delete process.env.OWN_DOMAINS;
    await pub("domain-check?domain=connect.rfq.test").expect(404);
    process.env.OWN_DOMAINS = "true";
  });

  it("checks any domain on connect.<BASE_DOMAIN>, without saying whose it is", async () => {
    const d = (await pub(`connect-check?domain=${encodeURIComponent("HTTPS://Staff.Example-Shop.com/")}`).expect(200)).body;
    expect(d).toMatchObject({
      domain: "staff.example-shop.com",
      zone: "example-shop.com",
      target: "connect.rfq.test",
      verdict: "no_record",
      provider: "Hostinger",
    });
    expect(d).not.toHaveProperty("company");
    expect((await pub("connect-check?domain=example-shop.com").expect(400)).body.error).toMatch(/Use a part of your domain/);
    expect((await pub("connect-check?domain=shop.rfq.test").expect(400)).body.error).toMatch(/one of our own addresses/);
  });

  it("shows the platform admin a company's address and why its domain is not connected", async () => {
    const slug = (await prisma.platform.company.findUniqueOrThrow({ where: { id: FIRST_COMPANY_ID } })).slug;
    const none = (await plat().get(`/companies/${FIRST_COMPANY_ID}/domain`).expect(200)).body;
    expect(none).toMatchObject({ enabled: true, ours: `${slug}.rfq.test`, domain: null, diagnosis: null });

    found = "not_ours";
    const waiting = (await plat().put(`/companies/${FIRST_COMPANY_ID}/domain`, { domain }).expect(200)).body;
    expect(waiting).toMatchObject({ domain, status: "waiting" });
    expect(waiting.diagnosis).toMatchObject({ domain, verdict: "no_record", provider: "Hostinger" });
    expect(waiting.record).toMatchObject({ name: "staff", value: "connect.rfq.test" });

    found = "ours";
    const connected = (await plat().post(`/companies/${FIRST_COMPANY_ID}/domain/check`).expect(200)).body;
    expect(connected).toMatchObject({ status: "connected" });
    expect(connected.diagnosis.verdict).toBe("right");

    const gone = (await plat().delete(`/companies/${FIRST_COMPANY_ID}/domain`).expect(200)).body;
    expect(gone).toMatchObject({ domain: null, status: null, diagnosis: null });

    // Written in the company's history.
    const log = await prisma.platform.platformLog.findMany({
      where: { companyId: FIRST_COMPANY_ID, summary: { contains: domain } },
      select: { summary: true },
    });
    expect(log.map((l) => l.summary).join("\n")).toMatch(/Connected .* own domain/);
    expect(log.map((l) => l.summary).join("\n")).toMatch(/Removed .* own domain/);
  });

  it("is for platform admins only", async () => {
    await request(app.getHttpServer()).get(`/api/platform/companies/${FIRST_COMPANY_ID}/domain`).expect(401);
    const manager = await signIn(app, "manager@example.com", "Manager@12345");
    await plat(manager).get(`/companies/${FIRST_COMPANY_ID}/domain`).expect(401);
    await api(app, manager).get("/company/domain").expect(403);
  });
});
