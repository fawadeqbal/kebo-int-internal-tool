import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

type Row = { id: string; description: string; customer: { id: string; name: string } | null; order: { id: string } | null; category: string };

/** Expenses spent on a customer (dinners, tickets…), totals by kind and by customer, and receipts. */
describe("expenses", () => {
  let app: INestApplication;
  let sana: string;
  let manager: string;
  let customerId: string;
  let order: { id: string; customer: { id: string; name: string } };
  const tag = Date.now().toString(36);
  const today = new Date().toISOString().slice(0, 10);
  const list = async (q: string) => (await api(app, manager).get(`/expenses?from=${today}&to=${today}&${q}`).expect(200)).body;
  const receipt = (token: string, id: string) => request(app.getHttpServer()).post(`/api/expenses/${id}/receipt`).set("authorization", `Bearer ${token}`);

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    customerId = (
      await api(app, sana)
        .post("/customers", { name: `Lahore Dairy ${tag}`, country: "PK", contacts: [{ name: "Usman", email: `usman-${tag}@ld.test` }] })
        .expect(201)
    ).body.id;
    const orders = (await api(app, manager).get("/orders?status=open").expect(200)).body as { id: string; customer: { id: string; name: string } }[];
    order = orders.find((o) => o.customer.id !== customerId)!;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("keeps an expense on a customer, and an order's expense on the order's customer", async () => {
    const dinner = (
      await api(app, manager)
        .post("/expenses", { customerId, category: "meals", description: `Dinner with Lahore Dairy ${tag}`, amount: 14000, currency: "PKR", rate: 280, spentOn: today })
        .expect(201)
    ).body;
    expect(dinner).toMatchObject({ customer: { id: customerId }, order: null, inMain: "50.00", receipt: null });

    const freight = (
      await api(app, manager)
        .post("/expenses", { orderId: order.id, category: "travel", description: `Tickets to visit ${tag}`, amount: 300, currency: "USD", spentOn: today })
        .expect(201)
    ).body;
    expect(freight).toMatchObject({ customer: { id: order.customer.id }, order: { id: order.id } });

    // An order of another customer is refused; so is a customer not in the system.
    const bad = await api(app, manager)
      .post("/expenses", { orderId: order.id, customerId, category: "meals", description: "Lunch", amount: 10, currency: "USD", spentOn: today })
      .expect(400);
    expect(bad.body.error).toMatch(/is for another customer/);
    await api(app, manager)
      .post("/expenses", { customerId: "00000000-0000-4000-8000-000000000000", category: "meals", description: "Lunch", amount: 10, currency: "USD", spentOn: today })
      .expect(400);
    // Staff cannot add one.
    await api(app, sana).post("/expenses", { customerId, category: "meals", description: "Lunch", amount: 10, currency: "USD", spentOn: today }).expect(403);

    // Moving the dinner to the company clears the customer (and says why).
    await api(app, manager)
      .patch(`/expenses/${dinner.id}`, { category: "meals", description: `Dinner with Lahore Dairy ${tag}`, amount: 14000, currency: "PKR", spentOn: today, reason: "Team dinner" })
      .expect(200)
      .expect((r) => expect(r.body.customer).toBeNull());
    await api(app, manager)
      .patch(`/expenses/${dinner.id}`, { customerId, category: "meals", description: `Dinner with Lahore Dairy ${tag}`, amount: 14000, currency: "PKR", spentOn: today, reason: "It was with them" })
      .expect(200)
      .expect((r) => expect(r.body.customer).toMatchObject({ id: customerId }));
  });

  it("totals by kind and by customer, and filters by customer, kind and company", async () => {
    await api(app, manager)
      .post("/expenses", { customerId, category: "travel", description: `Taxi to Lahore Dairy ${tag}`, amount: 2800, currency: "PKR", rate: 280, spentOn: today })
      .expect(201);
    await api(app, manager)
      .post("/expenses", { category: "rent", description: `Office rent ${tag}`, amount: 280000, currency: "PKR", rate: 280, spentOn: today })
      .expect(201);

    const mine = await list(`customerId=${customerId}`);
    expect(mine.rows.map((r: Row) => r.description).sort()).toEqual([`Dinner with Lahore Dairy ${tag}`, `Taxi to Lahore Dairy ${tag}`]);
    expect(mine).toMatchObject({ total: "60.00", count: 2, customers: "60.00", company: "0.00" });
    // By kind follows the customer filter.
    expect(mine.byCategory).toEqual([
      { category: "meals", total: "50.00", count: 1 },
      { category: "travel", total: "10.00", count: 1 },
    ]);
    // By customer leaves out the customer filter, so every customer is still there.
    expect(mine.byCustomer.map((c: { customer: { id: string } }) => c.customer.id)).toEqual(expect.arrayContaining([customerId, order.customer.id]));
    expect(mine.byCustomer.find((c: { customer: { id: string } }) => c.customer.id === customerId)).toMatchObject({ total: "60.00", count: 2, orders: 0 });

    const meals = await list(`customerId=${customerId}&category=meals`);
    expect(meals.rows).toHaveLength(1);
    expect(meals.total).toBe("50.00");
    // By kind leaves out the kind filter.
    expect(meals.byCategory.map((c: { category: string }) => c.category)).toEqual(["meals", "travel"]);

    const company = await list("kind=general");
    expect(company.rows.every((r: Row) => r.customer === null && r.order === null)).toBe(true);
    expect(company.rows.map((r: Row) => r.description)).toContain(`Office rent ${tag}`);
    const onCustomers = await list("kind=customer");
    expect(onCustomers.rows.every((r: Row) => r.customer !== null)).toBe(true);
    expect(Number(onCustomers.total)).toBe(Number(onCustomers.customers));
  });

  it("lists customers by name for pickers", async () => {
    const names = (await api(app, manager).get("/customers/names").expect(200)).body as { id: string; name: string }[];
    expect(names.find((n) => n.id === customerId)).toEqual({ id: customerId, name: `Lahore Dairy ${tag}` });
    expect(names.map((n) => n.name)).toEqual([...names.map((n) => n.name)].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("keeps a receipt with the expense, for managers only", async () => {
    const e = (
      await api(app, manager)
        .post("/expenses", { customerId, category: "hotel", description: `Hotel in Lahore ${tag}`, amount: 21000, currency: "PKR", rate: 280, spentOn: today })
        .expect(201)
    ).body;
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    await receipt(sana, e.id).attach("file", png, { filename: "hotel.png", contentType: "image/png" }).expect(403);
    await receipt(manager, e.id)
      .attach("file", Buffer.from("MZ"), { filename: "virus.exe", contentType: "application/octet-stream" })
      .expect(400)
      .expect((r) => expect(r.body.error).toMatch(/photo .* or a PDF/));
    const withReceipt = (await receipt(manager, e.id).attach("file", png, { filename: "hotel.png", contentType: "image/png" }).expect(201)).body;
    expect(withReceipt.receipt).toEqual({ name: "hotel.png", type: "image/png", size: png.length });

    const got = await api(app, manager).get(`/expenses/${e.id}/receipt`).buffer(true).expect(200);
    expect(got.headers["content-type"]).toMatch(/^image\/png/);
    expect(Buffer.from(got.body).equals(png)).toBe(true);
    await api(app, sana).get(`/expenses/${e.id}/receipt`).expect(403);

    // A new one replaces it; removing leaves none.
    const pdf = (await receipt(manager, e.id).attach("file", Buffer.from("%PDF-1.4 bill"), { filename: "bill.pdf", contentType: "application/pdf" }).expect(201))
      .body;
    expect(pdf.receipt.name).toBe("bill.pdf");
    await api(app, manager).delete(`/expenses/${e.id}/receipt`).expect(200);
    await api(app, manager).get(`/expenses/${e.id}/receipt`).expect(404);
    const row = (await list(`customerId=${customerId}&category=hotel`)).rows[0];
    expect(row.receipt).toBeNull();
  });
});
