import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { api, signIn, startApp } from "./app";
import { PrismaService, type Tx } from "../src/database/prisma.service";
import { ErrorFilter } from "../src/common/http/error.filter";
import { Clock } from "../src/common/time/clock.service";

/**
 * History is written once (migration history_append_only), the same rule as the ledger. On the company
 * connection the audit trail, each stage move of an inquiry or an order, and every final version of a made
 * document are added and never changed or deleted. A draft paper still changes and goes. A repair says so
 * inside its transaction (kebo.history_rewrite); the owner's connection (removing a company) is not stopped.
 */
describe("history is written once", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sana: string;
  let manager: string;
  let me: string;
  let customerId: string;
  let factoryId: string;
  let today = "";
  const tag = Date.now().toString(36);
  const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const db = () => prisma.company(FIRST_COMPANY_ID);
  const refused = /never changed or deleted/;
  const finalKept = /final version stays as it was printed/;
  const undo = new Error("undo");

  /** A deal quoted and accepted: its inquiry and order (stage moves and audit rows on the way). */
  const newOrder = async () => {
    const inquiry = (
      await api(app, sana)
        .post("/inquiries", { customerId, category: "Machinery", assigneeId: me, items: [{ description: "Blister packer", quantity: 1 }] })
        .expect(201)
    ).body;
    const item = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, {
        factoryId,
        receivedOn: addDays(today, -3),
        currency: "CNY",
        lines: [{ requestedItemId: item.id, description: "DPP-260", quantity: 1, unitPrice: 150000, taxRate: 0 }],
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiry.id}/quotation/draft`)).body;
    const r = (
      await api(app, sana)
        .post(`/inquiries/${inquiry.id}/quotation/revisions`, { ...draft, depositPercent: 30, currency: "USD", balanceTerms: "before_shipment" })
        .expect(201)
    ).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "accepted" }).expect(200);
    const o = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.orders[0];
    return { inquiryId: inquiry.id as string, orderId: o.id as string };
  };

  /** Runs `fn` in a transaction that is always rolled back. */
  const rolledBack = (client: ReturnType<typeof db>, fn: (tx: Tx) => Promise<unknown>) =>
    expect(
      client.$transaction(async (tx) => {
        await fn(tx);
        throw undo;
      }),
    ).rejects.toBe(undo);

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    today = app.get(Clock).today();
    sana = await signIn(app, "sana@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    me = (await api(app, sana).get("/auth/me")).body.id;
    customerId = (
      await api(app, sana)
        .post("/customers", { name: `Written Once Pharma ${tag}`, country: "PK", contacts: [{ name: "Saad", email: `saad-${tag}@once.test` }] })
        .expect(201)
    ).body.id;
    factoryId = (await api(app, sana).post("/factories", { name: `Written Once Works ${tag}` }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("the audit trail and the stage moves are added, never changed or deleted", async () => {
    const { inquiryId, orderId } = await newOrder();
    await api(app, sana).post(`/orders/${orderId}/stage`, { to: "in_production", confirm: true }).expect(200);

    const audit = await db().auditLog.findFirstOrThrow({ where: { entityId: { in: [orderId, inquiryId, customerId] } } });
    const inquiryMove = await db().inquiryStageChange.findFirstOrThrow({ where: { inquiryId } });
    const orderMove = await db().orderStageChange.findFirstOrThrow({ where: { orderId } });

    await expect(db().auditLog.update({ where: { id: audit.id }, data: { summary: "edited" } })).rejects.toThrow(refused);
    await expect(db().auditLog.delete({ where: { id: audit.id } })).rejects.toThrow(refused);
    await expect(db().$executeRawUnsafe(`update audit_logs set reason = 'edited' where id = '${audit.id}'`)).rejects.toThrow(refused);
    await expect(db().inquiryStageChange.update({ where: { id: inquiryMove.id }, data: { note: "edited" } })).rejects.toThrow(refused);
    await expect(db().inquiryStageChange.deleteMany({ where: { inquiryId } })).rejects.toThrow(refused);
    await expect(db().orderStageChange.update({ where: { id: orderMove.id }, data: { note: "edited" } })).rejects.toThrow(refused);
    await expect(db().orderStageChange.delete({ where: { id: orderMove.id } })).rejects.toThrow(refused);

    // A repair that says so, inside its transaction (rolled back here); and the owner's connection.
    await rolledBack(db(), async (tx) => {
      await tx.$executeRaw`set local kebo.history_rewrite = 'on'`;
      await tx.auditLog.update({ where: { id: audit.id }, data: { summary: "repaired" } });
      await tx.orderStageChange.delete({ where: { id: orderMove.id } });
    });
    await rolledBack(prisma.platform, async (tx) => {
      await tx.inquiryStageChange.delete({ where: { id: inquiryMove.id } });
    });

    // All exactly as they were written.
    expect(await db().auditLog.findUniqueOrThrow({ where: { id: audit.id } })).toEqual(audit);
    expect(await db().inquiryStageChange.findUniqueOrThrow({ where: { id: inquiryMove.id } })).toEqual(inquiryMove);
    expect(await db().orderStageChange.findUniqueOrThrow({ where: { id: orderMove.id } })).toEqual(orderMove);
    // The app still adds to them: the next move is one more row.
    const moves = await db().orderStageChange.count({ where: { orderId } });
    await api(app, sana).post(`/orders/${orderId}/stage`, { to: "confirmed", confirm: true, note: "Back a step" }).expect(200);
    expect(await db().orderStageChange.count({ where: { orderId } })).toBe(moves + 1);
  });

  it("a final paper stays as printed; a draft still changes and goes", async () => {
    const { orderId } = await newOrder();
    await api(app, manager).post(`/orders/${orderId}/proforma`).expect(200);
    const final = await db().orderPaper.findFirstOrThrow({ where: { orderId, kind: "proforma", version: 1 } });
    expect(final.status).toBe("final");
    await expect(db().orderPaper.update({ where: { id: final.id }, data: { snapshot: {} } })).rejects.toThrow(finalKept);
    await expect(db().orderPaper.delete({ where: { id: final.id } })).rejects.toThrow(finalKept);
    await expect(db().$executeRawUnsafe(`update order_papers set number = 'X' where id = '${final.id}'`)).rejects.toThrow(finalKept);

    // Make again: a draft (v2) that is made final (an update of the draft), then a v3 draft deleted.
    await api(app, manager).post(`/orders/${orderId}/documents/proforma/again`).expect(200);
    await api(app, manager).post(`/orders/${orderId}/documents/proforma/final`).expect(200);
    await api(app, manager).post(`/orders/${orderId}/documents/proforma/again`).expect(200);
    await api(app, manager).delete(`/orders/${orderId}/documents/proforma/draft`).expect(200);
    const versions = await db().orderPaper.findMany({ where: { orderId, kind: "proforma" }, orderBy: { version: "asc" }, select: { version: true, status: true } });
    expect(versions).toEqual([
      { version: 1, status: "final" },
      { version: 2, status: "final" },
    ]);
    expect(await db().orderPaper.findUniqueOrThrow({ where: { id: final.id } })).toEqual(final);
  });

  it("a refusal reads as a sentence (409), and is counted as a surprise", async () => {
    const audit = await db().auditLog.findFirstOrThrow({ where: { entityId: customerId } });
    const error = await db()
      .auditLog.delete({ where: { id: audit.id } })
      .then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    const sent: { status?: number; body?: unknown } = {};
    const res = { status: (s: number) => ((sent.status = s), res), json: (b: unknown) => ((sent.body = b), res) };
    const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({}) }) };
    const filter = new ErrorFilter();
    (filter as unknown as { log: { error: () => void } }).log = { error: () => {} };
    const was = ErrorFilter.report;
    const reported: unknown[] = [];
    ErrorFilter.report = (e) => reported.push(e);
    try {
      filter.catch(error, host as never);
    } finally {
      ErrorFilter.report = was;
    }
    expect(sent).toEqual({ status: 409, body: { error: "History is never changed or deleted: it stays as it was written." } });
    expect(reported).toEqual([error]);
  });
});
