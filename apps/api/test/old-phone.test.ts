import { createHash } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { FIRST_COMPANY_ID } from "@kebo/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";
import { CompaniesService } from "../src/common/company/companies.service";
import { CompanyContext } from "../src/common/company/company-context";
import { isOldPhone, oldNames } from "../src/common/names/old-names";
import { PrismaService } from "../src/database/prisma.service";

/**
 * A phone app installed before "factory" became "supplier" in the API's field names (27 Nov 2026) still
 * sends `factoryId` and reads `factoryTotal`. The API reads old names as the new ones, and answers with both
 * unless the asker says it reads the new names (src/common/names/old-names.ts). The web from before the change
 * does not say so either: it runs beside the new API for a moment during a deploy.
 */
describe("a phone app from before the rename keeps working", () => {
  let app: INestApplication;
  let sana: string;
  let inquiryId: string;
  let itemId: string;
  let ruian: string;
  let wenling: string;
  const tag = Date.now().toString(36);
  const DART = "Dart/3.5 (dart:io)";
  /** The old phone app: Dart's user agent, the old names. */
  const phone = (method: "get" | "post", url: string, body?: object) => {
    const r = request(app.getHttpServer())[method](`/api${url}`).set("authorization", `Bearer ${sana}`).set("user-agent", DART);
    return body ? r.send(body) : r;
  };

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const customer = (
      await api(app, sana)
        .post("/customers", { name: `Okara Mills ${tag}`, country: "PK", contacts: [{ name: "Imran", email: `imran-${tag}@om.test` }] })
        .expect(201)
    ).body;
    const inquiry = (
      await api(app, sana)
        .post("/inquiries", {
          customerId: customer.id,
          category: "Machinery",
          assigneeId: me,
          items: [{ description: "Flour sifter", quantity: 1 }],
        })
        .expect(201)
    ).body;
    inquiryId = inquiry.id;
    itemId = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body.items[0].id;
    ruian = (
      await api(app, sana)
        .post("/factories", { name: `Ruian Sift ${tag}` })
        .expect(201)
    ).body.id;
    wenling = (
      await api(app, sana)
        .post("/factories", { name: `Wenling Mesh ${tag}` })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("asks suppliers for prices with the old field name", async () => {
    await phone("post", `/inquiries/${inquiryId}/factory-requests`, { factoryIds: [ruian, wenling], channel: "wechat" }).expect(201);
    const list = (await phone("get", `/inquiries/${inquiryId}/factory-requests`).expect(200)).body;
    expect((list.items as { factory: { id: string } }[]).map((r) => r.factory.id).sort()).toEqual([ruian, wenling].sort());
  });

  it("records an offer with the old field name, and reads the old names back beside the new", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const made = (
      await phone("post", `/inquiries/${inquiryId}/factory-quotes`, {
        factoryId: ruian,
        receivedOn: day,
        currency: "CNY",
        lines: [{ requestedItemId: itemId, description: "Flour sifter", quantity: 1, unit: "set", unitPrice: 42000 }],
      }).expect(201)
    ).body;
    // The offer is that supplier's: the old name went in as the new one.
    const sourcing = (await phone("get", `/inquiries/${inquiryId}/sourcing`).expect(200)).body;
    const offer = (sourcing.quotes as { id: string; factory: { id: string }; supplierTotal: string; factoryTotal: string }[]).find(
      (q) => q.id === made.id,
    )!;
    expect(offer.factory.id).toBe(ruian);
    // And the answer says the total both ways, with the same value.
    expect(offer.supplierTotal).toBe("42000.00");
    expect(offer.factoryTotal).toBe(offer.supplierTotal);
    const list = (await phone("get", `/inquiries/${inquiryId}/factory-requests`).expect(200)).body;
    const asked = (list.items as { factory: { id: string }; supplierQuoteId: string | null; factoryQuoteId: string | null }[]).find(
      (r) => r.factory.id === ruian,
    )!;
    expect(asked.supplierQuoteId).toBe(made.id);
    expect(asked.factoryQuoteId).toBe(made.id);
  });

  it("the web from before the change: its old names are read, and its answers carry both (beside the new API, during a deploy)", async () => {
    const extra = (
      await api(app, sana)
        .post("/factories", { name: `Deploy Window ${tag}` })
        .expect(201)
    ).body.id as string;
    await api(app, sana)
      .post(`/inquiries/${inquiryId}/factory-requests`, { factoryIds: [extra] })
      .expect(201);
    const list = (await api(app, sana).get(`/inquiries/${inquiryId}/factory-requests`).expect(200)).body;
    expect((list.items as { factory: { id: string } }[]).some((r) => r.factory.id === extra)).toBe(true);
    // What the old web reads to fill a form is there under the name it knows, so it does not save it back empty.
    const sourcing = (await api(app, sana).get(`/inquiries/${inquiryId}/sourcing`).expect(200)).body;
    const offer = (sourcing.quotes as Record<string, unknown>[])[0]!;
    expect(offer.supplierTotal).toBe("42000.00");
    expect(offer.factoryTotal).toBe("42000.00");
  });

  it("who says it reads the new names gets them alone: today's web, and a phone build that says so (none yet)", async () => {
    for (const agent of ["Mozilla/5.0", DART]) {
      const res = await request(app.getHttpServer())
        .get(`/api/inquiries/${inquiryId}/sourcing`)
        .set("authorization", `Bearer ${sana}`)
        .set("user-agent", agent)
        .set("x-names", "supplier")
        .expect(200);
      const offer = (res.body.quotes as Record<string, unknown>[])[0]!;
      expect(offer.supplierTotal).toBe("42000.00");
      expect("factoryTotal" in offer).toBe(false);
    }
  });

  it("the bare word (step B): its old twin for everyone but the web that says it reads it (supplier.2)", async () => {
    const quoteOf = async (names: string | null) => {
      const req = request(app.getHttpServer())
        .get(`/api/inquiries/${inquiryId}/sourcing`)
        .set("authorization", `Bearer ${sana}`)
        .set("user-agent", DART);
      const res = await (names ? req.set("x-names", names) : req).expect(200);
      return (res.body.quotes as Record<string, unknown>[])[0]!;
    };
    // An old phone, and the web of the day before (during a deploy): `factory` beside `supplier`, the same value.
    for (const names of [null, "supplier"]) {
      const q = await quoteOf(names);
      expect(q.supplier).toEqual(expect.objectContaining({ id: expect.any(String), name: expect.any(String) }));
      expect(q.factory).toEqual(q.supplier);
    }
    // Today's web: the new names alone.
    const q = await quoteOf("supplier.2");
    expect(q.supplier).toEqual(expect.objectContaining({ id: expect.any(String) }));
    expect("factory" in q).toBe(false);
    expect("factoryTotal" in q).toBe(false);
  });

  it("an uploaded form's old field name is read too: an offer's file stays on the offer", async () => {
    const offerId = ((await api(app, sana).get(`/inquiries/${inquiryId}/sourcing`).expect(200)).body.quotes as { id: string }[])[0]!.id;
    await request(app.getHttpServer())
      .post(`/api/inquiries/${inquiryId}/files`)
      .set("authorization", `Bearer ${sana}`)
      .field("kind", "factory_quote")
      .field("factoryQuoteId", offerId)
      .attach("file", Buffer.from("%PDF-1.4 supplier offer"), { filename: "Ruian quote.pdf", contentType: "application/pdf" })
      .expect(201);
    const offer = (await api(app, sana).get(`/factory-quotes/${offerId}`).expect(200)).body as { files: { fileName: string }[] };
    expect(offer.files.map((f) => f.fileName)).toEqual(["Ruian quote.pdf"]);
    // Not among the deal's own documents, which people who do not see supplier prices can open.
    const deal = (await api(app, sana).get(`/inquiries/${inquiryId}`).expect(200)).body as { files?: unknown[]; attachments?: unknown[] };
    expect(deal.files ?? deal.attachments ?? []).toEqual([]);
  });

  it("a money save it repeats is known as the same save: by the body as the phone sent it", async () => {
    const manager = await signIn(app, "manager@example.com", "Manager@12345");
    const prisma = app.get(PrismaService);
    const inCompany = async <T>(fn: () => Promise<T>) => CompanyContext.run((await app.get(CompaniesService).byId(FIRST_COMPANY_ID))!, fn);
    const description = `Courier to the supplier ${tag}`;
    const body = {
      category: "travel",
      description,
      amount: 15,
      currency: "USD",
      spentOn: new Date().toISOString().slice(0, 10),
      factoryId: ruian,
    };
    const key = `old-phone-${tag}`;
    const send = () =>
      request(app.getHttpServer())
        .post("/api/expenses")
        .set("authorization", `Bearer ${manager}`)
        .set("user-agent", DART)
        .set("idempotency-key", key)
        .send(body);
    const first = await send().expect(201);
    const again = await send().expect(201);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.body).toEqual(first.body);
    // One expense, on that supplier: the old name went in as the new one.
    const saved = await inCompany(() => prisma.db.expense.findMany({ where: { description }, select: { supplierId: true } }));
    expect(saved).toEqual([{ supplierId: ruian }]);
    // The save is remembered by the body as it was sent, old names and all: so a save first sent to the API
    // from before the rename, and repeated after it, is still the same save.
    const [row] = await inCompany(
      () => prisma.db.$queryRaw<{ fingerprint: string }[]>`select fingerprint from request_keys where key = ${key}`,
    );
    expect(row!.fingerprint).toBe(createHash("sha256").update(JSON.stringify(body)).digest("hex"));
  });

  it("the layer itself: who is an old phone app, and what it changes for it and for the others", () => {
    expect(isOldPhone({ "user-agent": DART })).toBe(true);
    expect(isOldPhone({ "user-agent": "okhttp/4.12.0" })).toBe(true);
    expect(isOldPhone({ "user-agent": DART, "x-names": "supplier" })).toBe(false);
    expect(isOldPhone({ "user-agent": "Mozilla/5.0" })).toBe(false);
    expect(isOldPhone({})).toBe(false);
    const run = (headers: Record<string, string>, url: string, body: unknown) => {
      const req: { headers: Record<string, string>; url: string; body?: unknown; bodyAsSent?: unknown } = { headers, url, body };
      let sent: unknown;
      const res = { json: (b: unknown) => (sent = b) };
      oldNames()(req, res, () => undefined);
      res.json({ supplierId: "f1" });
      return { url: req.url, body: req.body, asSent: req.bodyAsSent, sent };
    };
    expect(
      run({ "user-agent": DART }, "/api/expenses?factoryId=f1&q=film+factory", {
        factoryIds: ["f1"],
        supplierQuoteId: "as it got it",
        factoryQuoteId: "edited",
      }),
    ).toEqual({
      url: "/api/expenses?supplierId=f1&q=film+factory",
      body: { supplierIds: ["f1"], supplierQuoteId: "edited" },
      asSent: { factoryIds: ["f1"], supplierQuoteId: "as it got it", factoryQuoteId: "edited" },
      sent: { supplierId: "f1", factoryId: "f1" },
    });
    // The web from before the change: old names in are read (new wins when both are there); the answer carries both.
    expect(
      run({ "user-agent": "Mozilla/5.0" }, "/api/expenses?factoryId=f1", {
        factoryIds: ["f1"],
        supplierQuoteId: "new",
        factoryQuoteId: "old",
      }),
    ).toEqual({
      url: "/api/expenses?supplierId=f1",
      body: { supplierIds: ["f1"], supplierQuoteId: "new" },
      asSent: { factoryIds: ["f1"], supplierQuoteId: "new", factoryQuoteId: "old" },
      sent: { supplierId: "f1", factoryId: "f1" },
    });
    // Today's web says it reads the new names: old names in are still read; the answer is left alone.
    expect(run({ "user-agent": "Mozilla/5.0", "x-names": "supplier" }, "/api/expenses?factoryId=f1", { factoryIds: ["f1"] })).toEqual({
      url: "/api/expenses?supplierId=f1",
      body: { supplierIds: ["f1"] },
      asSent: { factoryIds: ["f1"] },
      sent: { supplierId: "f1" },
    });
    // The bare word (step B) is an answer's twin only: never read in a body (Terms' sides and who bears a cost are
    // tables keyed by the stored "factory"), and left alone for the web that says it reads it (supplier.2).
    const answer = { supplier: { id: "f1" }, rows: [{ suppliers: [] }], borneBy: { customer: "a", factory: "b" } };
    for (const headers of [{ "user-agent": DART }, { "user-agent": "Mozilla/5.0", "x-names": "supplier" }]) {
      let sent: unknown;
      const res = { json: (b: unknown) => (sent = b) };
      const req: { headers: Record<string, string>; url: string; body?: unknown } = {
        headers,
        url: "/api/x",
        body: { sides: { factory: "kept" } },
      };
      oldNames()(req, res, () => undefined);
      res.json(answer);
      expect(req.body).toEqual({ sides: { factory: "kept" } });
      expect(sent).toEqual({
        supplier: { id: "f1" },
        factory: { id: "f1" },
        rows: [{ suppliers: [], factories: [] }],
        borneBy: { customer: "a", factory: "b" },
      });
    }
    {
      let sent: unknown;
      const res = { json: (b: unknown) => (sent = b) };
      oldNames()({ headers: { "user-agent": "Mozilla/5.0", "x-names": "supplier.2" }, url: "/api/x" }, res, () => undefined);
      res.json(answer);
      expect(sent).toEqual(answer);
    }
    // A phone build that says it reads the new names is not an old phone: when a body carries both, the new one wins.
    expect(run({ "user-agent": DART, "x-names": "supplier" }, "/api/expenses", { supplierQuoteId: "new", factoryQuoteId: "old" })).toEqual({
      url: "/api/expenses",
      body: { supplierQuoteId: "new" },
      asSent: { supplierQuoteId: "new", factoryQuoteId: "old" },
      sent: { supplierId: "f1" },
    });
  });
});
