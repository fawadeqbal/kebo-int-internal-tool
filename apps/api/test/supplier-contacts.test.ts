import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";
import { PrismaService } from "../src/database/prisma.service";
import { FIRST_COMPANY_ID } from "@kebo/database";

/** Contacts for every party (step 6): a supplier's main contact is its primary person, shown on the supplier as before. */
describe("supplier contacts", () => {
  let app: INestApplication;
  let manager: string;
  let prisma: PrismaService;
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    manager = await signIn(app, "manager@example.com", "Manager@12345");
  });

  afterAll(async () => {
    await app?.close();
  });

  it("keeps the main contact as the supplier's primary person; the form and the list read it as before", async () => {
    const made = (
      await api(app, manager)
        .post("/factories", {
          name: `Contact Works ${tag}`,
          contactPerson: `Mr Li ${tag}`,
          phone: "+86 138 0000 1111",
          wechat: "li_works",
          email: null,
        })
        .expect(201)
    ).body as { id: string; contactPerson: string; phone: string; wechat: string };
    expect(made).toMatchObject({ contactPerson: `Mr Li ${tag}`, phone: "+8613800001111", wechat: "li_works" });
    const rows = await prisma.company(FIRST_COMPANY_ID).contact.findMany({ where: { partyId: made.id, deletedAt: null } });
    expect(rows).toEqual([expect.objectContaining({ name: `Mr Li ${tag}`, isPrimary: true, wechat: "li_works" })]);

    const changed = (
      await api(app, manager)
        .put(`/factories/${made.id}`, {
          name: `Contact Works ${tag}`,
          contactPerson: `Ms Wang ${tag}`,
          phone: null,
          wechat: "wang_works",
          email: "wang@example.com",
        })
        .expect(200)
    ).body;
    expect(changed).toMatchObject({ contactPerson: `Ms Wang ${tag}`, phone: null, wechat: "wang_works", email: "wang@example.com" });
    expect(await prisma.company(FIRST_COMPANY_ID).contact.count({ where: { partyId: made.id, deletedAt: null } })).toBe(1);

    const found = (
      await api(app, manager)
        .get(`/factories?q=${encodeURIComponent(`Ms Wang ${tag}`)}`)
        .expect(200)
    ).body as { rows: { id: string; contactPerson: string }[] };
    expect(found.rows).toEqual([expect.objectContaining({ id: made.id, contactPerson: `Ms Wang ${tag}` })]);
    expect((await api(app, manager).get(`/factories/${made.id}`).expect(200)).body).toMatchObject({ email: "wang@example.com" });
  });

  it("makes no contact when none is typed", async () => {
    const made = (
      await api(app, manager)
        .post("/factories", { name: `Quiet Works ${tag}` })
        .expect(201)
    ).body as { id: string; contactPerson: string | null };
    expect(made.contactPerson).toBeNull();
    expect(await prisma.company(FIRST_COMPANY_ID).contact.count({ where: { partyId: made.id } })).toBe(0);
  });
});
