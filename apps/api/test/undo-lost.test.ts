import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/**
 * "Mark as lost" has an Undo in its note (design "knowing what happened"): whoever marked it can take it back
 * for two minutes, while nothing else moved its stage; the inquiry goes back to the stage it had. Later, or by
 * anyone else, it is a manager's Reopen with a reason.
 */
describe("undoing Mark as lost", () => {
  let app: INestApplication;
  let sana: string;
  let bilal: string;
  let manager: string;
  const tag = Date.now().toString(36);
  let customerId: string;

  const newInquiry = async () => {
    const me = (await api(app, sana).get("/auth/me")).body.id;
    return (
      await api(app, sana)
        .post("/inquiries", { customerId, category: "Machinery", assigneeId: me, items: [{ description: `Valve ${tag}`, quantity: 2, unit: "pcs" }] })
        .expect(201)
    ).body.id as string;
  };
  const stageOf = async (id: string) => (await api(app, manager).get(`/inquiries/${id}`).expect(200)).body.stage as string;

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    bilal = await signIn(app, "bilal@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    customerId = (
      await api(app, sana)
        .post("/customers", { name: `Undo Co ${tag}`, country: "KE", contacts: [{ name: "Achieng", email: `a-${tag}@undo.test` }] })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("puts the inquiry back to the stage it had, and keeps both moves in its history", async () => {
    const id = await newInquiry();
    const before = await stageOf(id);
    await api(app, sana).post(`/inquiries/${id}/stage`, { to: "lost", lostReason: "price_too_high" }).expect(200);
    expect(await stageOf(id)).toBe("lost");
    const back = await api(app, sana).post(`/inquiries/${id}/undo-lost`, {}).expect(200);
    expect(back.body.stage).toBe(before);
    expect(back.body.lostReason ?? null).toBeNull();
    // Not lost now: nothing to undo.
    await api(app, sana).post(`/inquiries/${id}/undo-lost`, {}).expect(400);
  });

  it("opens again the system's own follow-ups that Mark as lost ended", async () => {
    const id = await newInquiry();
    // Open follow-ups on it (the system sets one for a new inquiry).
    const open = async () => ((await api(app, manager).get(`/follow-ups?inquiryId=${id}&open=true`).expect(200)).body as { total: number }).total;
    const before = await open();
    expect(before).toBeGreaterThan(0);
    await api(app, sana).post(`/inquiries/${id}/stage`, { to: "lost", lostReason: "no_reply" }).expect(200);
    // The follow-ups close as the event is handled (just after the save).
    await new Promise((r) => setTimeout(r, 300));
    expect(await open()).toBe(0);
    await api(app, sana).post(`/inquiries/${id}/undo-lost`, {}).expect(200);
    expect(await open()).toBe(before);
  });

  it("is only for whoever marked it, and only while that is the last move", async () => {
    const id = await newInquiry();
    await api(app, sana).post(`/inquiries/${id}/stage`, { to: "lost", lostReason: "no_reply" }).expect(200);
    // Someone else: a manager's Reopen is the way.
    await api(app, manager).post(`/inquiries/${id}/undo-lost`, {}).expect(400);
    // Reopened and lost again by the manager: the last move is not Sana's any more.
    await api(app, manager).post(`/inquiries/${id}/stage`, { to: "sourcing", note: "Back on" }).expect(200);
    await api(app, manager).post(`/inquiries/${id}/stage`, { to: "lost", lostReason: "no_reply" }).expect(200);
    await api(app, sana).post(`/inquiries/${id}/undo-lost`, {}).expect(400);
    expect(await stageOf(id)).toBe("lost");
    // Someone who may not work on it at all is refused before that.
    const other = await api(app, bilal).post(`/inquiries/${id}/undo-lost`, {});
    expect([400, 403, 404]).toContain(other.status);
  });
});
