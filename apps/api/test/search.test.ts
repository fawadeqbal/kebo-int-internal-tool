import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

type Result = {
  q: string;
  exact: { kind: string; label: string; href: string } | null;
  groups: { kind: string; total: number; items: { kind: string; title: string; sub: string; href: string; badge: { label: string } | null }[] }[];
};

/**
 * Search everything (design "search everything"): one box over every kind, each only as far as the person's own
 * lists show it; a number typed whole is its record.
 */
describe("search everything", () => {
  let app: INestApplication;
  let sana: string;
  let looker: string;
  let manager: string;
  const tag = `srch${Date.now().toString(36)}`;
  // A phone number of this run's own: a known one is refused as a duplicate.
  const phone = `+93 7${String(Date.now()).slice(-8)}`;
  let customerId: string;
  let inquiry: { id: string; refNo: string };
  let factoryId: string;

  const find = async (who: string, q: string, more: Record<string, string> = {}) =>
    (await api(app, who).get(`/search?${new URLSearchParams({ q, ...more })}`).expect(200)).body as Result;
  const group = (r: Result, kind: string) => r.groups.find((g) => g.kind === kind);

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    const admin = await signIn(app, "admin@example.com", "Admin@12345");
    // Someone who sees only their own deals and no factory money.
    const role = (await api(app, admin).post("/roles", { name: `Look ${tag}`, permissions: ["dashboard.view"] }).expect(201)).body;
    await api(app, admin).post("/users", { name: "Looker", email: `look-${tag}@example.com`, role: role.key, password: "Person@12345" }).expect(201);
    looker = await signIn(app, `look-${tag}@example.com`, "Person@12345");
    customerId = (
      await api(app, sana)
        .post("/customers", { name: `Kabul ${tag} Medical`, country: "AF", contacts: [{ name: "Dr. Nazir", email: `n-${tag}@kabul.test`, phone }] })
        .expect(201)
    ).body.id;
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const made = await api(app, sana)
      .post("/inquiries", { customerId, category: "Machinery", assigneeId: me, items: [{ description: `Tablet press ${tag}`, quantity: 1, unit: "set" }] })
      .expect(201);
    inquiry = { id: made.body.id, refNo: made.body.refNo };
    factoryId = (await api(app, manager).post("/factories", { name: `Jinan ${tag} Works` }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("finds the customer and the inquiry by name, a word of an item, or a phone number", async () => {
    const r = await find(sana, tag);
    expect(group(r, "customers")).toMatchObject({ total: 1, items: [{ title: `Kabul ${tag} Medical`, href: `/customers/${customerId}` }] });
    expect(group(r, "customers")!.items[0]!.sub).toContain("Afghanistan");
    expect(group(r, "inquiries")).toMatchObject({ total: 1, items: [{ href: `/inquiries/${inquiry.id}`, badge: { tone: expect.any(String) } }] });
    expect(group(r, "inquiries")!.items[0]!.title).toBe(`${inquiry.refNo} · Tablet press ${tag}`);
    expect(r.exact).toBeNull();
    // By the contact's phone, however it is typed.
    expect(group(await find(sana, `${phone.slice(-8, -4)} ${phone.slice(-4)}`), "customers")?.items.some((i) => i.href === `/customers/${customerId}`)).toBe(true);
  });

  it("opens a number typed whole: the inquiry's own, in any case", async () => {
    expect((await find(sana, inquiry.refNo.toLowerCase())).exact).toEqual({ kind: "inquiries", label: inquiry.refNo, href: `/inquiries/${inquiry.id}` });
    expect((await find(sana, "RFQ-1999-9999")).exact).toBeNull();
  });

  it("finds only what the person's lists show: not someone else's deal, suppliers only with supplier money", async () => {
    const other = await find(looker, tag);
    expect(group(other, "inquiries")).toBeUndefined();
    expect(group(other, "customers")).toBeUndefined();
    expect((await find(looker, inquiry.refNo)).exact).toBeNull();
    expect(group(await find(looker, `Jinan ${tag}`), "suppliers")).toBeUndefined();
    expect(group(await find(sana, `Jinan ${tag}`), "suppliers")).toMatchObject({ total: 1, items: [{ href: `/factories/${factoryId}` }] });
    // The same as the inquiries list says for the same words.
    const listed = (await api(app, sana).get(`/inquiries?${new URLSearchParams({ q: tag })}`).expect(200)).body;
    expect(group(await find(sana, tag), "inquiries")!.total).toBe(listed.total ?? listed.items?.length ?? listed.length);
  });

  it("gives one kind on its own, only counts with limit 0, and nothing for a single letter", async () => {
    const one = await find(manager, tag, { kind: "customers", limit: "10" });
    expect(one.groups.map((g) => g.kind)).toEqual(["customers"]);
    const counts = await find(manager, tag, { limit: "0" });
    expect(group(counts, "inquiries")).toMatchObject({ total: 1, items: [] });
    expect((await find(manager, "k")).groups).toEqual([]);
  });
});
