import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CompanyMail } from "../src/common/notify/company-mail";
import type { MailMessage } from "../src/common/notify/mailer";
import { api, signIn, startApp } from "./app";

type Made = { id: string; refNo: string; letter: string; revisionId: string };

/**
 * Build step 4 of "one way, any number": several quotations of one inquiry go to the customer in one email,
 * each with its PDF; or are marked sent together when they went another way.
 */
describe("sending several quotations at once", () => {
  let app: INestApplication;
  let sana: string;
  let inquiryId: string;
  let made: Made[] = [];
  const sent: MailMessage[] = [];
  // The managers hear of each quotation sent by the same mail: only the customer's emails are counted.
  const toBuyer = () => sent.filter((m) => [m.to].flat().includes("buyer@mp.test"));
  const tag = Date.now().toString(36);
  const validUntil = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  const status = async (revisionId: string) => (await api(app, sana).get(`/revisions/${revisionId}`).expect(200)).body as { status: string; sentVia: string | null };
  const emailMany = (fields: Record<string, string>, files: { name: string; bytes: string }[] = []) => {
    let r = request(app.getHttpServer()).post(`/api/inquiries/${inquiryId}/quotations/email`).set("authorization", `Bearer ${sana}`);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    for (const f of files) r = r.attach("pdfs", Buffer.from(f.bytes), { filename: f.name, contentType: "application/pdf" });
    return r;
  };

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const customer = (await api(app, sana).post("/customers", { name: `Muscat Pack ${tag}`, country: "OM", contacts: [{ name: "Huda", email: `h-${tag}@mp.test` }] }).expect(201)).body;
    inquiryId = (
      await api(app, sana)
        .post("/inquiries", { customerId: customer.id, category: "Machinery", assigneeId: me, items: [{ description: `Cartoner ${tag}`, quantity: 1, unit: "set" }] })
        .expect(201)
    ).body.id;
    const item = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body.items[0].id;
    const offer = async (name: string, price: string) =>
      (
        await api(app, sana)
          .post(`/inquiries/${inquiryId}/factory-quotes`, {
            newSupplierName: `${name} ${tag}`,
            receivedOn: "2026-11-12",
            currency: "USD",
            lines: [{ requestedItemId: item, description: "Cartoner CT-80", quantity: 1, unitPrice: price, taxRate: 0 }],
          })
          .expect(201)
      ).body.id as string;
    const x = await offer("Ruian", "9000.00");
    const y = await offer("Wenzhou", "8500.00");
    const make = async (offers: (string | null)[]) =>
      (await api(app, sana).post(`/inquiries/${inquiryId}/quotations`, { offers, currency: "USD", validUntil, margin: 20 }).expect(201)).body.quotations as Made[];
    made = [...(await make([x, y, null])), ...(await make([x, y]))];
    expect(made.map((q) => q.letter)).toEqual(["A", "B", "C", "D", "E"]);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
  });

  it("asks for email to be set up first", async () => {
    vi.spyOn(app.get(CompanyMail), "mailer").mockResolvedValueOnce({ enabled: false, send: async () => undefined });
    const res = await emailMany({ revisionIds: `${made[0]!.revisionId},${made[1]!.revisionId}`, to: "buyer@mp.test", subject: "Quotations" }).expect(400);
    expect(res.body.error).toMatch(/Email is not set up/);
  });

  it("sends several in one email, each with its PDF, and marks each sent by email", async () => {
    vi.spyOn(app.get(CompanyMail), "mailer").mockResolvedValue({ enabled: true, send: async (m: MailMessage) => void sent.push(m) });
    const [a, b] = made;
    const res = await emailMany(
      { revisionIds: `${a!.revisionId},${b!.revisionId}`, to: "buyer@mp.test, boss@mp.test", cc: "", subject: `Quotations ${a!.refNo} and B`, message: "Please find our quotations." },
      // Named here for each quotation, whatever the files were called; in the order of revisionIds.
      [
        { name: "1.pdf", bytes: "%PDF-1.4 A" },
        { name: "2.pdf", bytes: "%PDF-1.4 B" },
      ],
    ).expect(200);
    expect(res.body.sent).toEqual([`${a!.refNo} R1`, `${b!.refNo} R1`]);
    expect(toBuyer()).toHaveLength(1);
    expect(toBuyer()[0]).toMatchObject({ to: ["buyer@mp.test", "boss@mp.test"], subject: `Quotations ${a!.refNo} and B`, text: "Please find our quotations." });
    expect(toBuyer()[0]!.attachments?.map((f) => [f.filename, String(f.content)])).toEqual([
      [`${a!.refNo} R1.pdf`, "%PDF-1.4 A"],
      [`${b!.refNo} R1.pdf`, "%PDF-1.4 B"],
    ]);
    for (const q of [a!, b!]) expect(await status(q.revisionId)).toMatchObject({ status: "sent", sentVia: "email" });
    // Sent ones are not sent again this way.
    await emailMany({ revisionIds: a!.revisionId, to: "buyer@mp.test", subject: "Again" }).expect(409);
  });

  it("does not send one that comes to 0, and sends nothing then", async () => {
    const own = made[2]!;
    const d = made[3]!;
    const res = await emailMany({ revisionIds: `${d.revisionId},${own.revisionId}`, to: "buyer@mp.test", subject: "Quotations" }).expect(400);
    expect(res.body.error).toMatch(/comes to 0/);
    expect(toBuyer()).toHaveLength(1);
    expect((await status(d.revisionId)).status).toBe("draft");
    await emailMany({ revisionIds: "", to: "buyer@mp.test", subject: "Quotations" }).expect(422);
  });

  it("marks several sent at once when they went another way", async () => {
    const [d, e] = [made[3]!, made[4]!];
    // Not on a day still to come: then none of them is marked.
    const later = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    expect((await api(app, sana).post(`/inquiries/${inquiryId}/quotations/sent`, { revisionIds: [d.revisionId, e.revisionId], on: later }).expect(400)).body.error).toMatch(/future/);
    expect((await status(d.revisionId)).status).toBe("draft");
    const res = await api(app, sana).post(`/inquiries/${inquiryId}/quotations/sent`, { revisionIds: [d.revisionId, e.revisionId], via: "whatsapp" }).expect(200);
    expect(res.body.sent).toEqual([`${d.refNo} R1`, `${e.refNo} R1`]);
    for (const q of [d, e]) expect(await status(q.revisionId)).toMatchObject({ status: "sent", sentVia: "whatsapp" });

    expect((await api(app, sana).get(`/inquiries/${inquiryId}`)).body.stage).toBe("quoted");
  });
});
