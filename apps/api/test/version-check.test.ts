import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/** A save sends the version it started from (If-Match): one over someone else's change is refused, never silent. */
describe("saves check the version they started from", () => {
  let app: INestApplication;
  let sana: string;
  let manager: string;
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
  });
  afterAll(async () => {
    await app?.close();
  });

  it("a customer: the manager's change first, then Sana's from her older copy is refused, with who and when", async () => {
    const made = (await api(app, sana).post("/customers", { name: `Version Pharma ${tag}`, country: "PK", contacts: [{ name: "Ali", email: `ali-${tag}@v.test` }] }).expect(201)).body;
    const opened = (await api(app, sana).get(`/customers/${made.id}`).expect(200)).body;
    const body = (c: typeof opened, address: string) => ({
      type: c.type,
      name: c.name,
      country: c.country,
      address,
      defaultCurrency: c.defaultCurrency,
      contacts: c.contacts.map((x: { id: string; name: string; email: string | null }) => ({ id: x.id, name: x.name, email: x.email, isPrimary: true })),
    });
    // The manager opened it at the same time, and saves first.
    await api(app, manager).put(`/customers/${made.id}`, body(opened, "Plot 9, Lahore")).set("if-match", opened.updatedAt).expect(200);
    const late = await api(app, sana).put(`/customers/${made.id}`, body(opened, "Plot 1, Lahore")).set("if-match", opened.updatedAt).expect(409);
    expect(late.body.code).toBe("stale");
    expect(late.body.error).toMatch(/^\S.* changed this while you had it open \((just now|\d+ minutes? ago)\)\. Reload to see their change, then make yours again\.$/);
    expect((await api(app, sana).get(`/customers/${made.id}`).expect(200)).body.address).toBe("Plot 9, Lahore");
    // Reloaded: her save goes through. Without a version, as before.
    const fresh = (await api(app, sana).get(`/customers/${made.id}`).expect(200)).body;
    await api(app, sana).put(`/customers/${made.id}`, body(fresh, "Plot 1, Lahore")).set("if-match", fresh.updatedAt).expect(200);
    await api(app, sana).put(`/customers/${made.id}`, body(fresh, "Plot 2, Lahore")).expect(200);
  });
});
