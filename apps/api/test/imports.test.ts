import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service";
import { api, signIn, startApp } from "./app";

describe("customers and factories from an Excel file", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let manager: string;
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    manager = await signIn(app, "manager@example.com", "Manager@12345");
  });

  afterAll(async () => {
    await app?.close();
  });

  it("adds only new customers, says why the others were left out, and logs each", async () => {
    const existing = await prisma.db.customer.findFirstOrThrow({ where: { deletedAt: null }, include: { contacts: true } });
    const known = existing.contacts.find((c) => c.email);
    const res = await api(app, manager)
      .post("/customers/import", {
        fileName: "customers.xlsx",
        customers: [
          { name: `Import Co ${tag}`, country: "ng", defaultCurrency: "USD", contacts: [{ name: "Ada", email: `ada-${tag}@example.com` }, { name: "Bayo", phone: "+234 801 000 1111" }] },
          { name: existing.name.toUpperCase(), country: "CN", contacts: [{ name: "Same name", email: `x-${tag}@example.com` }] },
          ...(known ? [{ name: `Other ${tag}`, country: "AE", contacts: [{ name: "Dup", email: known.email }] }] : []),
        ],
      })
      .expect(200);
    expect(res.body.added).toBe(1);
    expect(res.body.skipped.map((s: { reason: string }) => s.reason)).toEqual(["already a customer", ...(known ? [`a contact's email or phone is on ${existing.name}`] : [])]);
    const made = await prisma.db.customer.findFirstOrThrow({ where: { name: `Import Co ${tag}` }, include: { contacts: { orderBy: { name: "asc" } } } });
    expect(made.country).toBe("NG");
    expect(made.contacts.map((c) => [c.name, c.isPrimary])).toEqual([["Ada", true], ["Bayo", false]]);
    const log = await prisma.db.auditLog.findFirst({ where: { entityId: made.id } });
    expect(log?.summary).toContain("from customers.xlsx");
  });

  it("checks every row like the form does; nothing is added when one is wrong", async () => {
    const res = await api(app, manager)
      .post("/customers/import", { customers: [{ name: `Good ${tag}`, country: "NG", contacts: [{ name: "A", email: `g-${tag}@example.com` }] }, { name: `Bad ${tag}`, country: "Nigeria", contacts: [] }] })
      .expect(422);
    expect(JSON.stringify(res.body)).toContain("Choose a country");
    expect(await prisma.db.customer.count({ where: { name: `Good ${tag}` } })).toBe(0);
  });

  it("adds new factories and leaves out names already there", async () => {
    const existing = await prisma.db.factory.findFirstOrThrow({ where: { deletedAt: null } });
    const res = await api(app, manager)
      .post("/factories/import", {
        fileName: "factories.xlsx",
        factories: [{ name: `Ningbo Valves ${tag}`, contactPerson: "Mr Li", phone: "+86 574 1234 5678" }, { name: ` ${existing.name.toLowerCase()} ` }],
      })
      .expect(200);
    expect(res.body).toEqual({ added: 1, skipped: [{ name: existing.name.toLowerCase(), reason: "already a factory" }] });
    const f = await prisma.db.factory.findFirstOrThrow({ where: { name: `Ningbo Valves ${tag}` } });
    expect(f.ownerId).toBeNull();
  });
});
