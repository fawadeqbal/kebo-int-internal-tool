import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { PrismaService } from "../src/database/prisma.service";
import { CompaniesService } from "../src/common/company/companies.service";

type File = { sourceId: string; name: string; step: string | null; section: string | null; sectionLabel: string | null; attachedTo: { link: string; label: string; href: string } };

/**
 * The order without checklists, step 0: a file belongs to one section of the order's page, and the
 * reminders read what the sections hold (the ready date, the factory test, the ship-by date).
 */
describe("order sections: files and reminders", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sana: string;
  let bilal: string;
  let orderId: string;
  let refNo: string;
  const tag = Date.now().toString(36);
  const ago = (n: number) => new Date(Date.now() - n * 86_400_000);
  const pdf = (s: string) => Buffer.from(`%PDF-1.4 ${s}`);
  const upload = (token: string, path: string) => request(app.getHttpServer()).post(`/api${path}`).set("authorization", `Bearer ${token}`);
  const files = async () => (await api(app, sana).get(`/orders/${orderId}/files`).expect(200)).body.files as File[];
  const byName = async (name: string) => (await files()).find((f) => f.name === name);
  const mine = async (who = sana) =>
    ((await api(app, who).get("/reminders").expect(200)).body.items as { title: string; key: string; href: string; detail: string }[]).filter((i) => i.title.startsWith(`${refNo}:`));

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    sana = await signIn(app, "sana@example.com");
    bilal = await signIn(app, "bilal@example.com");
    const me = (await api(app, sana).get("/auth/me")).body.id;
    await prisma.platform.company.update({ where: { id: FIRST_COMPANY_ID }, data: { featuresOff: [] } });
    app.get(CompaniesService).forget(FIRST_COMPANY_ID);
    const customerId = (await api(app, sana).post("/customers", { name: `Sections Water ${tag}`, country: "NG", contacts: [{ name: "Ade", email: `ade-${tag}@sw.test` }] }).expect(201)).body.id;
    const factoryId = (await api(app, sana).post("/factories", { name: `Sections Works ${tag}`, address: "Zhangjiagang" }).expect(201)).body.id;
    const inquiry = (await api(app, sana).post("/inquiries", { customerId, category: "Machinery", assigneeId: me, items: [{ description: "Filler", quantity: 1 }] }).expect(201)).body;
    const item = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, { factoryId, receivedOn: ago(5).toISOString().slice(0, 10), currency: "CNY", lines: [{ requestedItemId: item.id, description: "RFC-32", quantity: 1, unitPrice: 300000 }] })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiry.id}/quotation/draft`)).body;
    const r = (await api(app, sana).post(`/inquiries/${inquiry.id}/quotation/revisions`, draft).expect(201)).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "accepted" }).expect(200);
    const deal = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body;
    orderId = deal.orders[0].id;
    refNo = deal.orders[0].refNo;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("a file added in a section's window is that section's file, under the section's stage", async () => {
    await upload(sana, `/orders/${orderId}/files`)
      .field("section", "booking")
      .attach("file", pdf("booking"), { filename: `Booking ${tag}.pdf`, contentType: "application/pdf" })
      .expect(201);
    expect(await byName(`Booking ${tag}.pdf`)).toMatchObject({
      step: "shipping",
      section: "booking",
      sectionLabel: "Booking",
      attachedTo: { link: "section", label: "Booking", href: `/orders/${orderId}/shipping` },
    });
    // The order's own section has no stage.
    await upload(sana, `/orders/${orderId}/files`)
      .field("section", "order")
      .attach("file", pdf("po"), { filename: `Customer PO ${tag}.pdf`, contentType: "application/pdf" })
      .expect(201);
    expect(await byName(`Customer PO ${tag}.pdf`)).toMatchObject({ step: null, section: "order", attachedTo: { link: "section", label: "The order", href: `/orders/${orderId}` } });
    await upload(sana, `/orders/${orderId}/files`)
      .field("section", "nowhere")
      .attach("file", pdf("x"), { filename: `Nowhere ${tag}.pdf`, contentType: "application/pdf" })
      .expect(422);
    const h = (await api(app, sana).get(`/history?type=order&id=${orderId}`).expect(200)).body as { action: string; summary: string }[];
    expect(h.some((e) => e.action === "file.upload" && e.summary.includes(`added Booking ${tag}.pdf to Booking`))).toBe(true);
  });

  it("moves a file to another section, and back to a stage as a whole", async () => {
    const f = (await byName(`Booking ${tag}.pdf`))!;
    await api(app, sana).post(`/orders/${orderId}/files/attachment/${f.sourceId}/attach`, { to: "section", target: "fat" }).expect(200);
    expect(await byName(`Booking ${tag}.pdf`)).toMatchObject({ step: "production", section: "fat", sectionLabel: "Factory test (FAT)" });
    await api(app, sana).post(`/orders/${orderId}/files/attachment/${f.sourceId}/attach`, { to: "section", target: "kitchen" }).expect(422);
    await api(app, sana).post(`/orders/${orderId}/files/attachment/${f.sourceId}/attach`, { to: "step", target: "delivery" }).expect(200);
    expect(await byName(`Booking ${tag}.pdf`)).toMatchObject({ step: "delivery", section: null, attachedTo: { link: "step" } });
  });

  it("reminds when the ready date passed and the goods are not in, a planned factory test has no result, and the ship-by date passed", async () => {
    expect((await mine()).filter((i) => i.key.startsWith("section:"))).toEqual([]);
    // The factory's row of the order (made the first time something is kept for it).
    const line = await prisma.platform.orderLine.findFirstOrThrow({ where: { orderId, type: "goods" }, select: { factoryId: true, companyId: true } });
    await prisma.platform.orderFactory.deleteMany({ where: { orderId } });
    await prisma.platform.orderFactory.create({ data: { orderId, companyId: line.companyId, factoryId: line.factoryId, readyOn: ago(5), fatPlannedOn: ago(4) } });
    await prisma.platform.order.update({ where: { id: orderId }, data: { shipBy: ago(6) } });
    // All three are days late, so they are among the most urgent the list keeps.
    const got = (await mine()).filter((i) => i.key.startsWith("section:"));
    expect(got.map((i) => i.key.split(":")[2]).sort()).toEqual(["fat_late", "goods_late", "ship_late"]);
    expect(got.find((i) => i.key.includes("goods_late"))).toMatchObject({ href: `/orders/${orderId}/production`, detail: "Production · 5 days late" });
    expect(got.find((i) => i.key.includes("goods_late"))!.title).toMatch(/Goods were to be ready .*: 0 of 1 received/);
    expect(got.find((i) => i.key.includes("ship_late"))).toMatchObject({ href: `/orders/${orderId}/shipping`, detail: "Shipping · 6 days late" });
    // Someone who does not see the order is not reminded of it.
    expect(await mine(bilal)).toEqual([]);
    // The test done: that reminder goes; the others stay.
    await prisma.platform.orderFactory.updateMany({ where: { orderId }, data: { fatDoneOn: ago(1), fatResult: "passed" } });
    // The list is kept for a moment per person; another change makes it fresh.
    await api(app, sana).post(`/orders/${orderId}/notes`, { body: "Factory test passed." });
    const after = (await mine()).filter((i) => i.key.startsWith("section:")).map((i) => i.key.split(":")[2]).sort();
    expect(after.includes("goods_late") && after.includes("ship_late")).toBe(true);
  });
});
