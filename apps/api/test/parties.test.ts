import { FIRST_COMPANY_ID } from "@kebo/database";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service";
import { api, signIn, startApp } from "./app";

/**
 * Customers and suppliers are one table, parties, with their role in party_roles
 * (architecture review §6.1). The two lists stay what they were: each shows its own
 * parties with its own fields, and one role is never taken for the other.
 */
describe("parties: customers and suppliers in one table", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let manager: string;
  let customer: Record<string, unknown> & { id: string };
  let supplier: Record<string, unknown> & { id: string };
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    customer = (
      await api(app, manager)
        .post("/customers", { name: `Party Buyer ${tag}`, country: "NG", contacts: [{ name: "Ada", email: `ada-${tag}@party.test` }] })
        .expect(201)
    ).body;
    supplier = (await api(app, manager).post("/factories", { name: `Party Works ${tag}`, contactPerson: "Mr. Li", bankDetails: "ICBC 6222" }).expect(201)).body;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("stores each as one party with its role", async () => {
    const rows = await prisma.company(FIRST_COMPANY_ID).party.findMany({
      where: { id: { in: [customer.id, supplier.id] } },
      select: { id: true, defaultCurrency: true, roles: { select: { role: true } } },
    });
    const of = (id: string) => rows.find((r) => r.id === id)!;
    expect(of(customer.id).roles).toEqual([{ role: "customer" }]);
    expect(of(supplier.id).roles).toEqual([{ role: "supplier" }]);
    // A customer starts in US dollars, as before; a supplier's currency is not known until someone says.
    expect([of(customer.id).defaultCurrency, of(supplier.id).defaultCurrency]).toEqual(["USD", null]);
  });

  it("keeps the two lists apart", async () => {
    const names = async (path: string) =>
      ((await api(app, manager).get(`${path}?q=${tag}&pageSize=100`).expect(200)).body.rows as { name: string }[]).map((r) => r.name);
    const [customers, suppliers] = [await names("/customers"), await names("/factories")];
    expect(customers).toContain(`Party Buyer ${tag}`);
    expect(customers).not.toContain(`Party Works ${tag}`);
    expect(suppliers).toEqual([`Party Works ${tag}`]);
    await api(app, manager).get(`/customers/${supplier.id}`).expect(404);
    await api(app, manager).get(`/factories/${customer.id}`).expect(404);
  });

  it("gives each its own fields, as before", async () => {
    const c = (await api(app, manager).get(`/customers/${customer.id}`).expect(200)).body;
    const f = (await api(app, manager).get(`/factories/${supplier.id}`).expect(200)).body;
    expect(c).toMatchObject({ name: `Party Buyer ${tag}`, country: "NG", defaultCurrency: "USD", type: "company" });
    expect(f).toMatchObject({ name: `Party Works ${tag}`, contactPerson: "Mr. Li", bankDetails: "ICBC 6222", ownerId: null });
    for (const key of ["contactPerson", "phone", "wechat", "email", "bankDetails", "ownerId"]) expect(c).not.toHaveProperty(key);
    for (const key of ["type", "country", "taxNo", "regNo", "defaultCurrency", "initials"]) expect(f).not.toHaveProperty(key);
    for (const key of ["contactPerson", "bankDetails", "ownerId"]) expect(customer).not.toHaveProperty(key);
    for (const key of ["country", "defaultCurrency"]) expect(supplier).not.toHaveProperty(key);
  });

  it("does not take a supplier where a customer is asked for", async () => {
    const res = await api(app, manager).post("/inquiries", { customerId: supplier.id, category: "Machinery", items: [{ description: "Valve", quantity: 1 }] });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("a supplier and a customer may share a name: they are two parties", async () => {
    await api(app, manager).post("/factories", { name: `Party Buyer ${tag}` }).expect(201);
    await api(app, manager).post("/factories", { name: `Party Works ${tag}` }).expect(409);
  });
});
