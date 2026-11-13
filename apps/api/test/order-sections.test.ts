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

  it("says where each stage of a new order stands, in the tabs' order", async () => {
    const v = (await api(app, sana).get(`/orders/${orderId}/sections`).expect(200)).body as {
      stages: string[];
      tabs: Record<string, string>;
      stands: { stage: string; label: string; word: string; tone: string; fact: string; missing: string }[];
    };
    expect(v.stages).toEqual(["payment", "factory", "production", "shipping", "delivery", "documents"]);
    expect(v.stands.map((s) => s.label)).toEqual(["Payment", "Factory order", "Production", "Shipping", "Delivery & SAT", "Documents"]);
    expect(v.stands[0]).toMatchObject({ word: "Nothing in", tone: "warn" });
    expect(v.stands[1]).toMatchObject({ word: "Not sent", tone: "neutral" });
    expect(v.stands[1]!.fact).toContain(`Sections Works ${tag}`);
    expect(v.stands[2]).toMatchObject({ word: "Not started", fact: "No ready date yet" });
    expect(v.stands[4]).toMatchObject({ word: "Not yet", fact: "After arrival" });
    expect(v.tabs).toMatchObject({ payment: "nothing in", factory: "not sent", production: "", shipping: "" });
    // Someone who may not see the order gets nothing.
    await api(app, bilal).get(`/orders/${orderId}/sections`).expect(404);
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

  it("keeps Production's facts per factory: how the ready date was told, the factory test, where the goods came in", async () => {
    type View = { production: { factory: { id: string; name: string } | null; readyToldOn: string | null; readyToldVia: string | null; fat: { plannedOn: string | null; doneOn: string | null; result: string | null; attendedBy: { name: string } | null; remarks: string | null }; goodsReceivedAt: string | null }[] };
    const before = (await api(app, sana).get(`/orders/${orderId}/sections`).expect(200)).body as View;
    expect(before.production).toHaveLength(1);
    expect(before.production[0]!.factory!.name).toBe(`Sections Works ${tag}`);
    expect(before.production[0]!.fat).toEqual({ plannedOn: null, attendedBy: null, doneOn: null, result: null, remarks: null });

    const me = (await api(app, sana).get("/auth/me")).body.id;
    const planned = (await api(app, sana).put(`/orders/${orderId}/factory-facts`, { readyToldOn: "2026-11-20", readyToldVia: "wechat", fatPlannedOn: "2026-12-03", fatAttendedById: me }).expect(200)).body as View;
    expect(planned.production[0]).toMatchObject({ readyToldOn: "2026-11-20", readyToldVia: "wechat", fat: { plannedOn: "2026-12-03", doneOn: null, result: null } });
    expect(planned.production[0]!.fat.attendedBy).toBeTruthy();
    // Only the fields sent change.
    const done = (await api(app, sana).put(`/orders/${orderId}/factory-facts`, { fatDoneOn: "2026-12-03", fatResult: "passed_with_remarks", fatRemarks: "Small leak fixed on the spot", goodsReceivedAt: "Forwarder's warehouse" }).expect(200)).body as View;
    expect(done.production[0]).toMatchObject({
      readyToldVia: "wechat",
      fat: { plannedOn: "2026-12-03", doneOn: "2026-12-03", result: "passed_with_remarks", remarks: "Small leak fixed on the spot" },
      goodsReceivedAt: "Forwarder's warehouse",
    });
    // A result needs its day; a factory that is not on the order, a made-up result and a made-up channel are refused.
    await api(app, sana).put(`/orders/${orderId}/factory-facts`, { fatDoneOn: "", fatResult: "passed" }).expect(422);
    await api(app, sana).put(`/orders/${orderId}/factory-facts`, { fatResult: "wonderful", fatDoneOn: "2026-12-03" }).expect(422);
    await api(app, sana).put(`/orders/${orderId}/factory-facts`, { readyToldVia: "pigeon" }).expect(422);
    await api(app, sana).put(`/orders/${orderId}/factory-facts`, { factoryId: "00000000-0000-4000-8000-000000000000", fatPlannedOn: "2026-12-03" }).expect(400);
    await api(app, bilal).put(`/orders/${orderId}/factory-facts`, { fatPlannedOn: "2026-12-04" }).expect(404);
    // The history says it in words, and the FAT report prints from it.
    const h = (await api(app, sana).get(`/history?type=order&id=${orderId}`).expect(200)).body as { action: string; summary: string }[];
    expect(h.some((e) => e.action === "flow.production" && e.summary.includes("factory test passed with remarks on 2026-12-03"))).toBe(true);
    const papers = (await api(app, sana).get(`/orders/${orderId}/papers`).expect(200)).body.papers as { kind: string; state: string }[];
    expect(papers.some((p) => p.kind === "fat-report")).toBe(true);
    const checks = (await api(app, sana).get(`/orders/${orderId}/papers/fat-report/checks`).expect(200)).body as { checks: { key: string; ok: boolean; value: string }[] };
    expect(checks.checks.find((c) => c.key === "done")).toMatchObject({ ok: true });
    // The stage's line says the test, too.
    const stand = ((await api(app, sana).get(`/orders/${orderId}/sections`).expect(200)).body.stands as { stage: string; fact: string }[]).find((x) => x.stage === "production")!;
    expect(stand.fact).toContain("factory test passed with remarks 3 Dec");
  });

  it("a shipment keeps how the freight is paid and what the goods are insured for", async () => {
    const flow = (await api(app, sana).get(`/orders/${orderId}/flow`).expect(200)).body as { shipping: { shipments: { id: string }[] } };
    let id = flow.shipping.shipments[0]?.id;
    if (!id) id = ((await api(app, sana).post(`/orders/${orderId}/shipments`, { mode: "sea" }).expect(201)).body.shipping.shipments as { id: string }[])[0]!.id;
    const after = (await api(app, sana).patch(`/shipments/${id}`, { freightAmount: "6400", freightCurrency: "usd", freightTerms: "prepaid", insuredValue: "202,620" }).expect(200)).body as { shipping: { shipments: { id: string; freightTerms: string | null; insuredValue: string | null }[] } };
    expect(after.shipping.shipments.find((s) => s.id === id)).toMatchObject({ freightTerms: "prepaid", insuredValue: "202620" });
    await api(app, sana).patch(`/shipments/${id}`, { freightTerms: "later" }).expect(422);
    const cleared = (await api(app, sana).patch(`/shipments/${id}`, { freightTerms: "" }).expect(200)).body as { shipping: { shipments: { id: string; freightTerms: string | null; insuredValue: string | null }[] } };
    expect(cleared.shipping.shipments.find((s) => s.id === id)).toMatchObject({ freightTerms: null, insuredValue: "202620" });
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
