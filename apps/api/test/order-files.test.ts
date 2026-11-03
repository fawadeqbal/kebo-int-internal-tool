import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { STEP_OF_ACTION } from "@kebo/shared";
import { api, signIn, startApp } from "./app";
import { PrismaService } from "../src/database/prisma.service";
import { CompaniesService } from "../src/common/company/companies.service";

type File = {
  id: string;
  source: string;
  sourceId: string;
  name: string;
  kind: string | null;
  note: string | null;
  attachedTo: { link: string; label: string; href: string };
  step: string | null;
  group: string;
  version: number;
  versions: { id: string; version: number }[];
  viewHref: string | null;
  can: { rename: boolean; describe: boolean; attach: boolean; replace: boolean; remove: boolean };
};
type Files = {
  canUpload: boolean;
  groups: { key: string; count: number }[];
  files: File[];
  targets: { to: string; target: string; label: string; step: string }[];
};

/**
 * Documents v3: every file of an order in one list (the deal's files, a paper's file, a checklist
 * item's file, a step's file, a payment's proof), with the same tools on each: rename, say what it
 * is, attach to, replace (keeping the old as a version), delete, many at once in a zip, and noting
 * a share. Changing follows what the file is attached to; every change is in the order's history.
 */
describe("order files", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sana: string;
  let bilal: string;
  let admin: string;
  let manager: string;
  let me: string;
  let dealId: string;
  let orderId: string;
  let refNo: string;
  const tag = Date.now().toString(36);
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const pdf = (s: string) => Buffer.from(`%PDF-1.4 ${s}`);
  const upload = (token: string, path: string) => request(app.getHttpServer()).post(`/api${path}`).set("authorization", `Bearer ${token}`);
  const list = async (who = sana) => (await api(app, who).get(`/orders/${orderId}/files`).expect(200)).body as Files;
  const byName = async (name: string, who = sana) => (await list(who)).files.find((f) => f.name === name);
  const papers = async () =>
    (await api(app, sana).get(`/orders/${orderId}/papers`).expect(200)).body.papers as {
      key: string;
      kind: string;
      state: string;
      paperId?: string | null;
      draft?: boolean;
      doc: { file: { id: string } | null } | null;
    }[];
  const history = async (step?: string) =>
    (
      await api(app, sana)
        .get(`/history?type=order&id=${orderId}${step ? `&step=${step}` : ""}`)
        .expect(200)
    ).body as {
      action: string;
      summary: string;
      step: string | null;
    }[];

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    sana = await signIn(app, "sana@example.com");
    bilal = await signIn(app, "bilal@example.com");
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    me = (await api(app, sana).get("/auth/me")).body.id;
    await prisma.platform.company.update({ where: { id: FIRST_COMPANY_ID }, data: { featuresOff: [] } });
    app.get(CompaniesService).forget(FIRST_COMPANY_ID);
    const customerId = (
      await api(app, sana)
        .post("/customers", { name: `Files Pharma ${tag}`, country: "PK", contacts: [{ name: "Ali", email: `ali-${tag}@fp.test` }] })
        .expect(201)
    ).body.id;
    const factoryId = (
      await api(app, sana)
        .post("/factories", { name: `Files Works ${tag}`, address: "Ningbo" })
        .expect(201)
    ).body.id;
    const inquiry = (
      await api(app, sana)
        .post("/inquiries", {
          customerId,
          category: "Machinery",
          assigneeId: me,
          items: [{ description: "Blister packing machine", quantity: 1 }],
        })
        .expect(201)
    ).body;
    dealId = inquiry.id;
    const item = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, {
        factoryId,
        receivedOn: day(-5),
        currency: "CNY",
        lines: [{ requestedItemId: item.id, description: "DPP-260", quantity: 1, unitPrice: 300000 }],
      })
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

  it("lists the deal's files and files added on the order, each once, with where it is attached", async () => {
    expect(STEP_OF_ACTION("file.rename", { step: "shipping" })).toBe("shipping");
    await upload(sana, `/inquiries/${dealId}/files`)
      .field("kind", "urs")
      .attach("file", pdf("urs"), { filename: `URS ${tag}.pdf`, contentType: "application/pdf" })
      .expect(201);
    const urs = (await byName(`URS ${tag}.pdf`))!;
    expect(urs).toMatchObject({ source: "attachment", kind: "urs", step: null, group: "customer", version: 1 });
    expect(urs.attachedTo).toMatchObject({ link: "inquiry", label: "Inquiry · URS", href: `/inquiries/${dealId}` });
    expect(urs.can).toEqual({ rename: true, describe: true, attach: true, replace: true, remove: true });
    expect(urs.viewHref).toBe(`/files/${urs.sourceId}?view=1`);

    // Added on the order: to a step, and to a paper in one go.
    const added = (
      await upload(sana, `/orders/${orderId}/files`)
        .field("step", "shipping")
        .attach("file", pdf("photos"), { filename: "Loading photos.pdf", contentType: "application/pdf" })
        .expect(201)
    ).body;
    expect(added.id).toMatch(/^attachment:/);
    const step = (await byName("Loading photos.pdf"))!;
    expect(step).toMatchObject({ step: "shipping", group: "shipping", attachedTo: { link: "step", label: "Step · Shipping" } });
    await upload(sana, `/orders/${orderId}/files`)
      .field("step", "shipping")
      .field("attachTo", "paper:bill_of_lading")
      .attach("file", pdf("bl"), { filename: "BL copy.pdf", contentType: "application/pdf" })
      .expect(201);
    const bl = (await byName("BL copy.pdf"))!;
    expect(bl.attachedTo).toMatchObject({ link: "paper", label: "Paper · Bill of lading (B/L)" });
    expect(bl).toMatchObject({ step: "shipping", group: "shipping" });
    expect((await papers()).find((p) => p.kind === "bill_of_lading")).toMatchObject({ state: "up", doc: { file: { id: bl.sourceId } } });

    const l = await list();
    expect(l.canUpload).toBe(true);
    expect(new Set(l.files.map((f) => f.id)).size).toBe(l.files.length);
    expect(l.groups.find((g) => g.key === "shipping")!.count).toBe(2);
    expect(l.targets.some((t) => t.to === "paper" && t.label === "Bill of lading (B/L)")).toBe(true);
    expect(l.targets.some((t) => t.to === "step" && t.target === "documents")).toBe(true);
    // The deal's own page still shows its files (one of each, newest version only).
    const dealFiles = (await api(app, sana).get(`/inquiries/${dealId}`).expect(200)).body.attachments as { fileName: string }[];
    expect(dealFiles.filter((f) => f.fileName === "BL copy.pdf")).toHaveLength(1);
  });

  it("renames (keeping the type), says what it is, and attaches to a checklist item or a step", async () => {
    const urs = (await byName(`URS ${tag}.pdf`))!;
    await api(app, sana).patch(`/orders/${orderId}/files/attachment/${urs.sourceId}`, {}).expect(422);
    const after = (
      await api(app, sana)
        .patch(`/orders/${orderId}/files/attachment/${urs.sourceId}`, { name: `URS rev B ${tag}` })
        .expect(200)
    ).body as Files;
    expect(after.files.find((f) => f.sourceId === urs.sourceId)!.name).toBe(`URS rev B ${tag}.pdf`);
    await api(app, sana)
      .patch(`/orders/${orderId}/files/attachment/${urs.sourceId}`, { kind: "specification", note: "Customer's URS, rev B" })
      .expect(200);
    expect(await byName(`URS rev B ${tag}.pdf`)).toMatchObject({ kind: "specification", note: "Customer's URS, rev B" });

    const l = await list();
    const item = l.targets.find((t) => t.to === "checklist" && t.step === "shipping")!;
    expect(item).toBeDefined();
    const photos = (await byName("Loading photos.pdf"))!;
    await api(app, sana)
      .post(`/orders/${orderId}/files/attachment/${photos.sourceId}/attach`, { to: "checklist", target: item.target })
      .expect(200);
    expect((await byName("Loading photos.pdf"))!.attachedTo).toMatchObject({ link: "checklist", label: `Checklist · ${item.label}` });
    const steps = (await api(app, sana).get(`/orders/${orderId}/steps`)).body.items as {
      key: string | null;
      id: string | null;
      file: { id: string } | null;
    }[];
    expect(steps.find((i) => (i.key ?? i.id) === item.target)!.file!.id).toBe(photos.sourceId);

    await api(app, sana)
      .post(`/orders/${orderId}/files/attachment/${urs.sourceId}/attach`, { to: "step", target: "production" })
      .expect(200);
    expect(await byName(`URS rev B ${tag}.pdf`)).toMatchObject({ step: "production", group: "factory", attachedTo: { link: "step" } });
    await api(app, sana).post(`/orders/${orderId}/files/attachment/${urs.sourceId}/attach`, { to: "step", target: "nowhere" }).expect(422);
    await api(app, sana)
      .post(`/orders/${orderId}/files/attachment/${urs.sourceId}/attach`, { to: "checklist", target: "doc:bill_of_lading" })
      .expect(400);

    const h = await history("shipping");
    expect(h.some((e) => e.action === "file.upload" && /Loading photos\.pdf/.test(e.summary))).toBe(true);
    expect(h.some((e) => e.action === "file.attach" && /Loading photos\.pdf/.test(e.summary))).toBe(true);
    expect(
      (await history()).some((e) => e.action === "file.rename" && e.summary.includes(`renamed URS ${tag}.pdf to URS rev B ${tag}.pdf`)),
    ).toBe(true);
  });

  it("replaces with a newer one, keeping the old as a version and moving what it was attached to", async () => {
    const bl = (await byName("BL copy.pdf"))!;
    await upload(sana, `/orders/${orderId}/files/attachment/${bl.sourceId}/replace`)
      .attach("file", pdf("bl v2"), { filename: "BL copy v2.pdf", contentType: "application/pdf" })
      .expect(200);
    const l = await list();
    expect(l.files.find((f) => f.name === "BL copy.pdf")).toBeUndefined();
    const v2 = l.files.find((f) => f.name === "BL copy v2.pdf")!;
    expect(v2).toMatchObject({ version: 2, attachedTo: { link: "paper" }, versions: [{ id: bl.sourceId, version: 1 }] });
    expect((await papers()).find((p) => p.kind === "bill_of_lading")!.doc!.file!.id).toBe(v2.sourceId);
    // The old one still downloads.
    const old = await api(app, sana).get(`/files/${bl.sourceId}`).buffer(true).expect(200);
    expect(Buffer.from(old.body).toString()).toBe("%PDF-1.4 bl");
    expect((await history("shipping")).some((e) => e.action === "file.replace")).toBe(true);
  });

  it("downloads many at once in a zip, and notes a share without sending anything", async () => {
    const l = await list();
    const all = await api(app, sana)
      .get(`/orders/${orderId}/files/zip`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(all.headers["content-type"]).toMatch(/application\/zip/);
    const names = Object.keys(unzipSync(new Uint8Array(all.body as Buffer)));
    expect(names).toContain("Shipping/BL copy v2.pdf");
    expect(names).toHaveLength(l.files.length);
    const two = l.files.filter((f) => f.group === "shipping").map((f) => f.id);
    const some = await api(app, sana)
      .get(`/orders/${orderId}/files/zip?files=${two.join(",")}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(Object.keys(unzipSync(new Uint8Array(some.body as Buffer)))).toHaveLength(2);
    await api(app, sana).get(`/orders/${orderId}/files/zip?files=attachment:00000000-0000-4000-8000-000000000000`).expect(404);
    await api(app, sana).get(`/orders/${orderId}/files/zip?files=nope`).expect(422);

    await api(app, sana).post(`/orders/${orderId}/files/share`, { files: [], papers: [], via: "share" }).expect(422);
    await api(app, sana)
      .post(`/orders/${orderId}/files/share`, { files: ["attachment:00000000-0000-4000-8000-000000000000"], via: "share" })
      .expect(404);
    const ci = (await papers()).find((p) => p.kind === "commercial-invoice")!;
    await api(app, sana)
      .post(`/orders/${orderId}/files/share`, { files: two, papers: [ci.key], via: "download", message: `Papers for ${refNo}` })
      .expect(200);
    const shared = (await history()).find((e) => e.action === "file.share")!;
    expect(shared.summary).toMatch(/shared 3 files .*downloaded to send/);
  });

  it("each source keeps its own rule: payments for accounts, papers for documents, nothing for viewers", async () => {
    // A payment's proof shows under Money; only those who record payments change it.
    const currency = (await api(app, manager).get(`/orders/${orderId}`).expect(200)).body.currency as string;
    const pay = (
      await api(app, manager)
        .post(`/orders/${orderId}/payments`, { kind: "deposit", amount: 10, currency, paidOn: day(0), reference: `SLIP-${tag}` })
        .expect(201)
    ).body;
    expect(pay.createdId).toBeTruthy();
    {
      await upload(manager, `/payments/${pay.createdId}/file`)
        .attach("file", Buffer.from("89504e470d0a1a0a", "hex"), { filename: "slip.png", contentType: "image/png" })
        .expect(201);
      const slip = (await byName("slip.png", manager))!;
      expect(slip).toMatchObject({ source: "payment", group: "money", step: "payment", attachedTo: { link: "payment" } });
      expect(slip.can.rename).toBe(true);
      expect((await byName("slip.png", sana))!.can).toMatchObject({ rename: false, remove: false });
      await api(app, sana).patch(`/orders/${orderId}/files/payment/${slip.sourceId}`, { name: "x" }).expect(403);
      await api(app, manager).patch(`/orders/${orderId}/files/payment/${slip.sourceId}`, { name: "bank slip" }).expect(200);
      expect(await byName("bank slip.png", manager)).toBeDefined();
      await api(app, manager)
        .post(`/orders/${orderId}/files/payment/${slip.sourceId}/attach`, { to: "step", target: "shipping" })
        .expect(400);
      await api(app, manager).delete(`/orders/${orderId}/files/payment/${slip.sourceId}`).expect(200);
      expect(await byName("bank slip.png", manager)).toBeUndefined();
    }

    // Someone who only sees: the list, no tools.
    const role = (
      await api(app, admin)
        .post("/roles", { name: `Files viewer ${tag}`, permissions: ["dashboard.view", "inquiries.viewAll"] })
        .expect(201)
    ).body;
    const email = `files-${tag}@example.com`;
    await api(app, admin).post("/users", { name: "Files viewer", email, role: role.key, password: "Person@12345" }).expect(201);
    const viewer = await signIn(app, email, "Person@12345");
    const seen = await list(viewer);
    expect(seen.canUpload).toBe(false);
    expect(seen.targets.filter((t) => t.to !== "step")).toHaveLength(0);
    const v2 = seen.files.find((f) => f.name === "BL copy v2.pdf")!;
    expect(v2.can).toEqual({ rename: false, describe: false, attach: false, replace: false, remove: false });
    await api(app, viewer).patch(`/orders/${orderId}/files/attachment/${v2.sourceId}`, { name: "x" }).expect(403);
    await api(app, viewer).delete(`/orders/${orderId}/files/attachment/${v2.sourceId}`).expect(403);
    await upload(viewer, `/orders/${orderId}/files`)
      .attach("file", pdf("x"), { filename: "x.pdf", contentType: "application/pdf" })
      .expect(403);
    await api(app, viewer).get(`/orders/${orderId}/files/zip`).expect(200);

    // Someone who does not see the order: not there at all.
    await api(app, bilal)
      .get(`/orders/${orderId}/files`)
      .expect((r) => expect([403, 404]).toContain(r.status));
    await api(app, bilal)
      .get(`/orders/${orderId}/files/zip`)
      .expect((r) => expect([403, 404]).toContain(r.status));
  });

  it("deletes with the paper falling back to missing; a draft paper can be deleted, a final one cannot", async () => {
    const v2 = (await byName("BL copy v2.pdf"))!;
    await api(app, sana).delete(`/orders/${orderId}/files/attachment/${v2.sourceId}`).expect(200);
    expect(await byName("BL copy v2.pdf")).toBeUndefined();
    expect((await papers()).find((p) => p.kind === "bill_of_lading")!.state).toBe("miss");
    expect((await history("shipping")).some((e) => e.action === "file.delete" && /BL copy v2\.pdf/.test(e.summary))).toBe(true);
    await api(app, sana).delete(`/orders/${orderId}/files/attachment/${v2.sourceId}`).expect(404);

    await api(app, sana).post(`/orders/${orderId}/papers/sales-contract`, {}).expect(201);
    const sc = (await papers()).find((p) => p.kind === "sales-contract")!;
    expect(sc).toMatchObject({ draft: true });
    await api(app, bilal)
      .delete(`/papers/${sc.paperId}`)
      .expect((r) => expect([403, 404]).toContain(r.status));
    await api(app, sana).delete(`/papers/${sc.paperId}`).expect(200);
    expect((await papers()).find((p) => p.kind === "sales-contract")!.paperId).toBeNull();
    await api(app, sana).delete(`/papers/${sc.paperId}`).expect(404);
    expect((await history()).some((e) => e.action === "paper.delete")).toBe(true);
  });

  it("another company sees none of the order's files and cannot link to them", async () => {
    const other = await prisma.platform.company.create({ data: { slug: `of-${tag}`.slice(0, 30), name: `Files other ${tag}` } });
    try {
      const db = prisma.company(other.id);
      expect(await db.attachment.count({ where: { inquiryId: dealId } })).toBe(0);
      const mine = await prisma.company(FIRST_COMPANY_ID).attachment.findFirstOrThrow({ where: { inquiryId: dealId } });
      expect((await db.attachment.updateMany({ where: { id: mine.id }, data: { fileName: "hacked" } })).count).toBe(0);
      // A file of another company cannot point at this order.
      await expect(
        db.$executeRawUnsafe(
          `insert into attachments (id, inquiry_id, order_id, file_name, mime_type, size, storage_key, uploaded_by) values (gen_random_uuid(), $1::uuid, $2::uuid, 'x', 'x', 1, 'x', $3::uuid)`,
          dealId,
          orderId,
          me,
        ),
      ).rejects.toThrow(/another company|foreign key/);
    } finally {
      await prisma.platform.company.delete({ where: { id: other.id } });
    }
  });
});
