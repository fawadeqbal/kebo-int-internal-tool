import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { api, signIn, startApp } from "./app";
import { PrismaService } from "../src/database/prisma.service";
import { DomainLookup, OwnDomainService, type Lookup } from "../src/common/company/own-domain.service";
import { AccountsService } from "../src/platform/accounts.service";

/**
 * A company's own domain (claude/custom-domain-plan.md): the company keeps its address under ours, or
 * connects a domain it owns with one record. The internet is stood in for: what the look-up finds is set
 * by each test.
 */
describe("a company's own domain", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let domains: OwnDomainService;
  let admin: string;
  let manager: string;
  let found: Lookup = "not_ours";
  const tag = Date.now().toString(36);
  const domain = `erp.acme-${tag}.com`;
  const pub = (path: string) => request(app.getHttpServer()).get(`/api/platform/public/${path}`);
  const view = async () => (await api(app, admin).get("/company/domain").expect(200)).body;
  const slug = async () => (await prisma.platform.company.findUniqueOrThrow({ where: { id: FIRST_COMPANY_ID } })).slug;

  beforeAll(async () => {
    process.env.BASE_DOMAIN = "rfq.test";
    app = await startApp();
    prisma = app.get(PrismaService);
    domains = app.get(OwnDomainService);
    vi.spyOn(app.get(DomainLookup), "find").mockImplementation(async () => found);
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
  });
  afterEach(() => {
    process.env.OWN_DOMAINS = "true";
  });
  afterAll(async () => {
    await domains.remove(FIRST_COMPANY_ID);
    delete process.env.BASE_DOMAIN;
    delete process.env.OWN_DOMAINS;
    await app?.close();
  });

  it("is offered only where the server is ready for it", async () => {
    delete process.env.OWN_DOMAINS;
    expect(await view()).toMatchObject({ enabled: false, domain: null, status: null, record: null });
    expect((await api(app, admin).put("/company/domain", { domain }).expect(400)).body.error).toMatch(/not switched on/);
    await pub(`company-at?host=${domain}`).expect(404);
  });

  it("takes a part of a domain the company owns, from the admin only", async () => {
    process.env.OWN_DOMAINS = "true";
    const ours = `${await slug()}.rfq.test`;
    expect(await view()).toMatchObject({ enabled: true, canChange: true, ours, domain: null });
    const refused = async (typed: string) => (await api(app, admin).put("/company/domain", { domain: typed }).expect(400)).body.error as string;
    expect(await refused("acme.com")).toBe("Use a part of your domain, like erp.acme.com.");
    expect(await refused("not a domain")).toMatch(/like erp\.yourcompany\.com/);
    expect(await refused(`shop.rfq.test`)).toMatch(/one of our own addresses/);
    await api(app, manager).put("/company/domain", { domain }).expect(403);
    await api(app, manager).get("/company/domain").expect(403);
    expect((await view()).domain).toBeNull();
  });

  it("waits for the record: the record to add is shown, and the domain is nobody's address yet", async () => {
    found = "not_ours";
    // Typed with https:// and capitals: kept tidy.
    const v = (await api(app, admin).put("/company/domain", { domain: `HTTPS://${domain.toUpperCase()}/` }).expect(200)).body;
    expect(v).toMatchObject({ domain, status: "waiting", problem: "no_record", since: null });
    expect(v.record).toEqual({ type: "CNAME", name: "erp", value: "connect.rfq.test", zone: `acme-${tag}.com` });
    expect(v.checkedAt).toBeTruthy();
    await pub(`company-at?host=${domain}`).expect(404);
    expect((await pub(`company?slug=${await slug()}`).expect(200)).body.domain).toBeUndefined();
    // A certificate may be made for it (its first visit), not for a domain nobody connected.
    await pub(`domain-check?domain=${domain}`).expect(200);
    await pub("domain-check?domain=erp.nobody.com").expect(404);
    // A look-up that fails says nothing: no change.
    found = "unknown";
    expect((await api(app, admin).post("/company/domain/check").expect(200)).body).toMatchObject({ status: "waiting", checkedAt: v.checkedAt });
  });

  it("is connected once the record is found: the domain is the company's address", async () => {
    found = "ours";
    const v = (await api(app, admin).post("/company/domain/check").expect(200)).body;
    expect(v).toMatchObject({ domain, status: "connected", problem: null, lostAt: null });
    expect(v.since).toBeTruthy();
    const s = await slug();
    expect((await pub(`company-at?host=${domain}`).expect(200)).body).toEqual({ slug: s });
    expect((await pub(`company?slug=${s}`).expect(200)).body).toMatchObject({ slug: s, domain });
    // Links in emails go there.
    const me = (await api(app, admin).get("/auth/me").expect(200)).body.id as string;
    expect(await app.get(AccountsService).setPasswordLink(FIRST_COMPANY_ID, me)).toMatch(new RegExp(`^https://${domain.replace(/\./g, "\\.")}/set-password\\?token=`));
    // Nobody else can take it.
    const other = await prisma.platform.company.create({ data: { slug: `other-${tag}`, name: `Other ${tag}` } });
    await expect(domains.connect(other.id, domain)).rejects.toThrow(/connected to another company/);
    await prisma.platform.company.delete({ where: { id: other.id } });
    // In the platform log.
    const log = await prisma.platform.platformLog.findMany({ where: { companyId: FIRST_COMPANY_ID, summary: { contains: domain } } });
    expect(log.map((l) => l.summary).join("\n")).toMatch(/is connected to/);
  });

  it("a record that goes away is looked up twice before people are sent back; when it returns it is connected again", async () => {
    const before = await view();
    const at = (minutes: number) => new Date(Date.now() + minutes * 60_000);
    found = "not_ours";
    // The connected ones are looked up once a day; a first miss changes nothing people see.
    expect(await domains.sweep(at(60))).toBe(0);
    expect(await domains.sweep(at(25 * 60))).toBe(1);
    expect(await view()).toMatchObject({ status: "connected", problem: "no_record" });
    expect((await pub(`company-at?host=${domain}`).expect(200)).body.slug).toBe(await slug());
    // An hour later it is still gone: lost. The company is at its address under ours again.
    expect(await domains.sweep(at(25 * 60 + 30))).toBe(0);
    expect(await domains.sweep(at(26 * 60 + 5))).toBe(1);
    const lost = await view();
    expect(lost).toMatchObject({ status: "lost", since: before.since });
    expect(lost.lostAt).toBeTruthy();
    await pub(`company-at?host=${domain}`).expect(404);
    expect((await pub(`company?slug=${await slug()}`).expect(200)).body.domain).toBeUndefined();
    // The record is back.
    found = "ours";
    expect(await domains.sweep(at(27 * 60 + 10))).toBe(1);
    expect(await view()).toMatchObject({ status: "connected", problem: null, lostAt: null, since: before.since });
  });

  it("removing it goes back to the address under ours", async () => {
    const v = (await api(app, admin).delete("/company/domain").expect(200)).body;
    expect(v).toMatchObject({ domain: null, status: null, record: null });
    await pub(`company-at?host=${domain}`).expect(404);
    await pub(`domain-check?domain=${domain}`).expect(404);
    const history = await prisma.company(FIRST_COMPANY_ID).auditLog.findMany({ where: { summary: { contains: domain } }, orderBy: { createdAt: "asc" } });
    expect(history.map((h) => h.summary)).toEqual([expect.stringMatching(/^Connected the company's own domain/), expect.stringMatching(/^Removed the company's own domain/)]);
  });

  it("a waiting domain is looked up again every ten minutes", async () => {
    found = "not_ours";
    await api(app, admin).put("/company/domain", { domain }).expect(200);
    const at = (minutes: number) => new Date(Date.now() + minutes * 60_000);
    expect(await domains.sweep(at(5))).toBe(0);
    expect(await domains.sweep(at(11))).toBe(1);
    found = "ours";
    expect(await domains.sweep(at(22))).toBe(1);
    expect((await view()).status).toBe("connected");
  });
});
