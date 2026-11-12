import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/** "@Name" in a note: the person named gets an alert (Alerts › Mentions) that opens the record. */
describe("mentions in notes", () => {
  let app: INestApplication;
  let admin: string;
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    app = await startApp();
    admin = await signIn(app, "admin@example.com", "Admin@12345");
  });

  afterAll(async () => {
    await app?.close();
  });

  it("alerts the person named after @, not the writer and not someone else", async () => {
    const first = `Zed${tag}`;
    const email = `mention-${tag}@example.com`;
    await api(app, admin).post("/users", { name: `${first} Khan`, email, role: "admin", password: "Welcome123x" }).expect(201);
    const them = await signIn(app, email, "Welcome123x");
    const customers = (await api(app, admin).get("/customers?pageSize=1").expect(200)).body;
    const customer = (Array.isArray(customers) ? customers : customers.rows)[0] as { id: string };
    await api(app, admin).post(`/customers/${customer.id}/notes`, { body: `@${first.toLowerCase()} can you call them back tomorrow?` }).expect(201);
    const mine = (await api(app, them).get("/notifications?group=mentions").expect(200)).body as { items: { type: string; title: string; link: string }[] };
    expect(mine.items[0]).toMatchObject({ type: "mention.customer", link: `/customers/${customer.id}/notes` });
    expect(mine.items[0]!.title).toContain("can you call them back");
    // A note without their name says nothing to them.
    await api(app, admin).post(`/customers/${customer.id}/notes`, { body: "@nobody-here hello" }).expect(201);
    expect(((await api(app, them).get("/notifications?group=mentions").expect(200)).body as { items: unknown[] }).items).toHaveLength(1);
  });
});
