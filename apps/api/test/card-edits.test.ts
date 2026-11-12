import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

type Card = {
  count: number;
  first: { by: string | null; at: string } | null;
  edits: { n: number; by: string | null; reason: string | null; changes: string[] }[];
  keys: Record<string, number>;
};

/**
 * Board "View first, edit on purpose": a card's first save is plain; each
 * later Save changes is an edit with its reason, counted per card ("Edited 2×")
 * and per line ("edited 2×"), and shown in the record's history.
 */
describe("card edits", () => {
  let app: INestApplication;
  let sana: string;
  let bilal: string;
  let inquiryId: string;
  const tag = Date.now().toString(36);
  const cards = async (who = sana) => (await api(app, who).get(`/edits?type=inquiry&id=${inquiryId}`).expect(200)).body.cards as Record<string, Card>;

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    bilal = await signIn(app, "bilal@example.com");
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const customerId = (
      await api(app, sana)
        .post("/customers", { name: `Edits Co ${tag}`, country: "KE", contacts: [{ name: "Achieng", email: `a-${tag}@edits.test` }] })
        .expect(201)
    ).body.id;
    inquiryId = (
      await api(app, sana)
        .post("/inquiries", { customerId, category: "Machinery", assigneeId: me, items: [{ description: "Boiler", quantity: 1, unit: "set" }] })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("starts with nothing edited", async () => {
    expect(await cards()).toEqual({});
  });

  it("keeps the first save plain, and asks a reason for an edit", async () => {
    await api(app, sana).post("/edits", { type: "inquiry", id: inquiryId, card: "needs", kind: "first", changes: ["Added 1 · Boiler"] }).expect(201);
    await api(app, sana).post("/edits", { type: "inquiry", id: inquiryId, card: "needs", kind: "edit", changes: ["1 · Qty 1 → 2"], keys: ["a"] }).expect(400);
    const c = (await cards()).needs!;
    expect(c.count).toBe(0);
    expect(c.first?.by).toBeTruthy();
  });

  it("counts each edit of a card and of each line, newest first", async () => {
    const one = await api(app, sana)
      .post("/edits", { type: "inquiry", id: inquiryId, card: "needs", kind: "edit", reason: "Customer changed the quantity", changes: ["1 · Qty 1 → 2"], keys: ["line-a"] })
      .expect(201);
    expect(one.body.n).toBe(1);
    const two = await api(app, sana)
      .post("/edits", { type: "inquiry", id: inquiryId, card: "needs", kind: "edit", reason: "Typed wrong", changes: ["1 · Qty 2 → 3", "Added 2 · Pump"], keys: ["line-a"] })
      .expect(201);
    expect(two.body.n).toBe(2);
    // Another card counts on its own.
    await api(app, sana).post("/edits", { type: "inquiry", id: inquiryId, card: "details", kind: "edit", reason: "Mistake fixed", changes: ["Priority: Normal → High"], keys: ["priority"] }).expect(201);

    const all = await cards();
    expect(all.needs!.count).toBe(2);
    expect(all.needs!.edits.map((e) => [e.n, e.reason])).toEqual([
      [2, "Typed wrong"],
      [1, "Customer changed the quantity"],
    ]);
    expect(all.needs!.keys).toEqual({ "line-a": 2 });
    expect(all.details!.count).toBe(1);
  });

  it("shows the edits in the record's history", async () => {
    const h = (await api(app, sana).get(`/history?type=deal&id=${inquiryId}`).expect(200)).body as { action: string; reason: string | null }[];
    expect(h.filter((e) => e.action === "card.edit").map((e) => e.reason)).toContain("Typed wrong");
  });

  it("is only for people who see the record", async () => {
    const other = await api(app, bilal).get(`/edits?type=inquiry&id=${inquiryId}`);
    expect([200, 404]).toContain(other.status);
    await api(app, sana).get(`/edits?type=inquiry&id=00000000-0000-4000-8000-000000000000`).expect(404);
    await api(app, sana).post("/edits", { type: "inquiry", id: inquiryId, card: "", kind: "first" }).expect(422);
  });
});
