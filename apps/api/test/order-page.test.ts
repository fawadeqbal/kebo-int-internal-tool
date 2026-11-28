import type { INestApplication } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { api, signIn, startApp } from "./app";
import { PrismaService } from "../src/database/prisma.service";
import { CompaniesService } from "../src/common/company/companies.service";
import { PapersService } from "../src/modules/papers/papers.service";
import { MoneyService } from "../src/modules/money/money.service";

type Page = Record<string, unknown> & { order: { id: string; customer: { id: string } } };

/**
 * GET /orders/:id/page: everything an order's pages show, in one read. Each part must be exactly what its own
 * endpoint answers for the same person (the web's order pages show the same as when they asked each one), null
 * where that endpoint refuses them (403 or 404), and a part that fails is named while the rest still comes.
 */
describe("the order page in one read", () => {
  let app: INestApplication;
  const people: Record<string, string> = {};
  let orders: { id: string; refNo: string }[] = [];
  // The web asks with the new names only (lib/api.ts); the old endpoints are asked the same way.
  const get = (who: string, path: string) => api(app, people[who]).get(path).set("x-names", "supplier.2");

  /** Each part of the page and the endpoint the web used to ask for it (the customer's contacts: in the customer). */
  const before = (id: string, customerId: string): Record<string, [string, (body: { contacts?: unknown }) => unknown]> => {
    const all = (b: unknown) => b;
    return {
      order: [`/orders/${id}`, all],
      sections: [`/orders/${id}/sections`, all],
      flow: [`/orders/${id}/flow`, all],
      files: [`/orders/${id}/files`, all],
      money: [`/orders/${id}/money`, all],
      costs: [`/orders/${id}/costs`, all],
      papers: [`/orders/${id}/papers`, all],
      notes: [`/orders/${id}/notes`, all],
      purchaseOrders: [`/orders/${id}/purchase-orders`, all],
      followUps: [`/follow-ups?orderId=${id}&open=true`, all],
      customerContacts: [`/customers/${customerId}`, (b) => b.contacts],
      people: ["/users/people", all],
    };
  };

  beforeAll(async () => {
    app = await startApp();
    // Every feature on, so the costs part is read too (managers with the expenses feature).
    await app.get(PrismaService).platform.company.update({ where: { id: FIRST_COMPANY_ID }, data: { featuresOff: [] } });
    app.get(CompaniesService).forget(FIRST_COMPANY_ID);
    people.manager = await signIn(app, "manager@example.com", "Manager@12345");
    people.admin = await signIn(app, "admin@example.com", "Admin@12345");
    people.staff = await signIn(app, "bilal@example.com");
    // The demo's own orders (the first numbers; other tests add more), and one that staff may not open.
    const all = ((await get("manager", "/orders").expect(200)).body as { id: string; refNo: string }[]).sort((a, b) =>
      a.refNo.localeCompare(b.refNo),
    );
    const staffSees = new Set(((await get("staff", "/orders").expect(200)).body as { id: string }[]).map((o) => o.id));
    orders = all.slice(0, 3);
    const notStaffs = all.find((o) => !staffSees.has(o.id));
    if (notStaffs && !orders.includes(notStaffs)) orders.push(notStaffs);
    expect(orders.length).toBeGreaterThan(1);
  });
  afterAll(async () => {
    await app?.close();
  });

  for (const who of ["manager", "admin", "staff"]) {
    it(`each part is what its own endpoint answers (${who})`, async () => {
      let parts = 0;
      let notTheirs = 0;
      let refused = 0;
      for (const { id, refNo } of orders) {
        // An order they may not open: the page answers as the order's own read does (404), with nothing in it.
        const own = await get(who, `/orders/${id}`);
        const res0 = await get(who, `/orders/${id}/page`);
        expect(res0.status, refNo).toBe(own.status);
        if (own.status !== 200) {
          expect(res0.body, refNo).toEqual(own.body);
          notTheirs++;
          continue;
        }
        const page = res0.body as Page;
        expect(Object.keys(page).sort(), refNo).toEqual(Object.keys(before(id, page.order.customer.id)).sort());
        for (const [key, [path, take]] of Object.entries(before(id, page.order.customer.id))) {
          const res = await get(who, path);
          if (res.status === 403 || res.status === 404) {
            expect(page[key], `${refNo} ${key}: ${path} answers ${res.status}`).toBeNull();
            refused++;
          } else {
            expect(res.status, `${refNo} ${path}`).toBe(200);
            expect(page[key], `${refNo} ${key}`).toEqual(take(res.body));
            parts++;
          }
        }
      }
      // Something was compared; for staff, an order was not theirs and a part was refused (the costs, a manager's).
      expect(parts).toBeGreaterThan(6);
      if (who === "staff") expect([notTheirs > 0, refused > 0]).toEqual([true, true]);
    }, 60_000);
  }

  it("an order that is not there is the page's 404", async () => {
    await get("manager", "/orders/00000000-0000-4000-8000-000000000000/page").expect(404);
    // Not an id at all: what every order address answers (the API's "Nothing has this number").
    expect((await get("manager", "/orders/not-an-id/page").expect(404)).body).toEqual(
      (await get("manager", "/orders/not-an-id").expect(404)).body,
    );
    await api(app).get(`/orders/${orders[0]!.id}/page`).expect(401);
  });

  it("a part that fails is named and logged; the rest still comes", async () => {
    const { id } = orders[0]!;
    const log = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    // The papers fail once: the page's own read of them (the files then read them again for themselves).
    const papers = vi.spyOn(app.get(PapersService), "list").mockRejectedValueOnce(new Error("the disk is gone"));
    try {
      const page = (await get("manager", `/orders/${id}/page`).expect(200)).body as Page;
      expect(page.papers).toEqual({ failed: true, what: "the papers" });
      expect(page.order.id).toBe(id);
      expect(page.files).toEqual((await get("manager", `/orders/${id}/files`).expect(200)).body);
      expect(page.flow).toEqual((await get("manager", `/orders/${id}/flow`).expect(200)).body);
      expect(log).toHaveBeenCalledWith(expect.stringContaining(`could not read the papers of order ${id}`), expect.anything());
    } finally {
      papers.mockRestore();
      log.mockRestore();
    }
  });

  it("the money is read once for the page; the stages' words take theirs from it", async () => {
    const { id } = orders[0]!;
    const money = vi.spyOn(app.get(MoneyService), "forOrder");
    try {
      await get("manager", `/orders/${id}/page`).expect(200);
      expect(money).toHaveBeenCalledTimes(1);
    } finally {
      money.mockRestore();
    }
  });
});
