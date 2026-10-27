import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

type OrderRow = { id: string; currency: string };
type Pay = { id: string; file: { name: string; type: string; size: number } | null };

/** A photo or PDF kept with a payment as proof: money in from customers and out to factories. */
describe("payment files", () => {
  let app: INestApplication;
  let manager: string;
  let sana: string;
  const today = new Date().toISOString().slice(0, 10);
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const upload = (token: string, path: string) => request(app.getHttpServer()).post(`/api${path}`).set("authorization", `Bearer ${token}`);

  beforeAll(async () => {
    app = await startApp();
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    sana = await signIn(app, "sana@example.com");
  });

  afterAll(async () => {
    await app?.close();
  });

  it("keeps the bank slip with a customer payment; a new one replaces it", async () => {
    const orders = (await api(app, manager).get("/orders?status=open").expect(200)).body as OrderRow[];
    let target: { order: OrderRow; due: number } | null = null;
    for (const o of orders) {
      const p = (await api(app, manager).get(`/orders/${o.id}/payments`).expect(200)).body;
      if (Number(p.due) >= 1) {
        target = { order: o, due: Number(p.due) };
        break;
      }
    }
    expect(target).not.toBeNull();
    const { order } = target!;
    const made = (
      await api(app, manager)
        .post(`/orders/${order.id}/payments`, { kind: "balance", amount: 1, currency: order.currency, paidOn: today, reference: "SLIP-1" })
        .expect(201)
    ).body;
    expect(made.createdId).toMatch(/^[0-9a-f-]{36}$/);
    const id = made.createdId as string;
    expect((made.payments as Pay[]).find((p) => p.id === id)!.file).toBeNull();

    await upload(sana, `/payments/${id}/file`).attach("file", png, { filename: "slip.png", contentType: "image/png" }).expect(403);
    await upload(manager, `/payments/${id}/file`)
      .attach("file", Buffer.from("MZ"), { filename: "slip.exe", contentType: "application/octet-stream" })
      .expect(400)
      .expect((r) => expect(r.body.error).toMatch(/photo .* or a PDF/));
    const saved = (
      await upload(manager, `/payments/${id}/file`).attach("file", png, { filename: "slip.png", contentType: "image/png" }).expect(201)
    ).body;
    expect(saved.file).toEqual({ name: "slip.png", type: "image/png", size: png.length });

    const got = await api(app, manager).get(`/payments/${id}/file`).buffer(true).expect(200);
    expect(got.headers["content-type"]).toMatch(/^image\/png/);
    expect(Buffer.from(got.body).equals(png)).toBe(true);
    const list = (await api(app, manager).get(`/orders/${order.id}/payments`).expect(200)).body.payments as Pay[];
    expect(list.find((p) => p.id === id)!.file).toEqual({ name: "slip.png", type: "image/png", size: png.length });

    await upload(manager, `/payments/${id}/file`)
      .attach("file", Buffer.from("%PDF-1.4 slip"), { filename: "advice.pdf", contentType: "application/pdf" })
      .expect(201);
    expect((await api(app, manager).get(`/payments/${id}/file`).buffer(true).expect(200)).headers["content-type"]).toMatch(
      /^application\/pdf/,
    );
    await api(app, sana).delete(`/payments/${id}/file`).expect(403);
    await api(app, manager).delete(`/payments/${id}/file`).expect(200);
    await api(app, manager).get(`/payments/${id}/file`).expect(404);

    const audit = (await api(app, manager).get(`/audit?entityType=order&entityId=${order.id}&pageSize=20`).expect(200)).body.rows as {
      summary: string;
    }[];
    expect(audit.some((a) => /added the proof of a payment from the customer \(slip\.png\)/.test(a.summary))).toBe(true);
  });

  it("keeps the proof with a payment to a factory", async () => {
    const orders = (await api(app, manager).get("/orders?status=open").expect(200)).body as OrderRow[];
    let found: { orderId: string; pay: Pay } | null = null;
    for (const o of orders) {
      const m = (await api(app, manager).get(`/orders/${o.id}/money`).expect(200)).body;
      const pay = (m.factories?.payments as (Pay & { voided: unknown })[] | undefined)?.find((p) => !p.voided);
      if (pay) {
        found = { orderId: o.id, pay };
        break;
      }
    }
    expect(found).not.toBeNull();
    const { pay, orderId } = found!;
    const saved = (
      await upload(manager, `/factory-payments/${pay.id}/file`)
        .attach("file", Buffer.from("%PDF-1.4 tt"), { filename: "tt-copy.pdf", contentType: "application/pdf" })
        .expect(201)
    ).body;
    expect(saved.file.name).toBe("tt-copy.pdf");
    const m = (await api(app, manager).get(`/orders/${orderId}/money`).expect(200)).body;
    expect((m.factories.payments as Pay[]).find((p) => p.id === pay.id)!.file).toMatchObject({
      name: "tt-copy.pdf",
      type: "application/pdf",
    });
    await api(app, manager).get(`/factory-payments/${pay.id}/file`).expect(200);
    // Opening it follows the order's money page: whoever sees the factory payments there.
    const seen = (await api(app, sana).get(`/orders/${orderId}/money`)).body?.factories?.payments as Pay[] | undefined;
    await api(app, sana)
      .get(`/factory-payments/${pay.id}/file`)
      .expect(seen?.some((p) => p.id === pay.id) ? 200 : 404);
    await upload(sana, `/factory-payments/${pay.id}/file`).attach("file", png, { filename: "x.png", contentType: "image/png" }).expect(403);
    await api(app, manager).delete(`/factory-payments/${pay.id}/file`).expect(200);
  });
});
