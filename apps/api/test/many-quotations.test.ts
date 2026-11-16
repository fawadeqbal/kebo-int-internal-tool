import type { INestApplication } from "@nestjs/common";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/database/prisma.service";
import { api, signIn, startApp } from "./app";

/**
 * Build step 1 of "one way, any number": an inquiry holds any number of quotations, A, B, C…, each with its own
 * revisions, and everything that reads them reads them all. This test puts a second one in the database:
 * quotation B, a copy of A's R1 at a lower price, sent (New quotations has its own test).
 */
describe("many quotations per inquiry", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sana: string;
  let inquiryId: string;
  let refA: string;
  let revA: string;
  let quotationB: string;
  let revB: string;
  const tag = Date.now().toString(36);
  const db = () => prisma.company(FIRST_COMPANY_ID);
  /** The inquiry's QUO number: its quotations carry it with their letter. */
  const base = () => refA.replace(/-A$/, "");

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    sana = await signIn(app, "sana@example.com");
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const customer = (
      await api(app, sana)
        .post("/customers", { name: `Many Quotes Trading ${tag}`, country: "AE", contacts: [{ name: "Omar", email: `o-${tag}@mq.test` }] })
        .expect(201)
    ).body;
    inquiryId = (
      await api(app, sana)
        .post("/inquiries", {
          customerId: customer.id,
          category: "Machinery",
          assigneeId: me,
          items: [{ description: `Carton erector ${tag}`, quantity: 1, unit: "set" }],
        })
        .expect(201)
    ).body.id;
    const itemId = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body.items[0].id;
    await api(app, sana)
      .post(`/inquiries/${inquiryId}/factory-quotes`, {
        newFactoryName: `Foshan Pack ${tag}`,
        receivedOn: "2026-11-10",
        currency: "USD",
        lines: [{ requestedItemId: itemId, description: "Carton erector CE-20", quantity: 1, unitPrice: "10000.00", taxRate: 0 }],
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/draft`).expect(200)).body;
    revA = (await api(app, sana).post(`/inquiries/${inquiryId}/quotation/revisions`, draft).expect(201)).body.id;
    await api(app, sana).post(`/revisions/${revA}/status`, { to: "sent" }).expect(200);
  });

  afterAll(async () => {
    await app?.close();
  });

  /** Quotation B: A's R1 copied (its option, lines and costs) at `factor` of its prices, with B's own number. */
  async function addQuotationB(factor: number) {
    const a = await db().quotation.findFirstOrThrow({
      where: { inquiryId },
      include: { revisions: { include: { options: { include: { lines: true, costs: true } } } } },
    });
    const { id: _id, quotationId: _q, createdAt: _c, updatedAt: _u, options, ...head } = a.revisions[0]!;
    const b = await db().quotation.create({ data: { inquiryId, letter: "B", refNo: `${base()}-B` } });
    const rev = await db().quotationRevision.create({
      data: {
        ...head,
        paymentParts: head.paymentParts ?? undefined,
        customerSnapshot: head.customerSnapshot ?? undefined,
        companySnapshot: head.companySnapshot ?? undefined,
        quotationId: b.id,
      },
    });
    for (const o of options) {
      const { id: _oid, revisionId: _r, lines, costs, subtotal, discount, total, ...opt } = o;
      const option = await db().quotationOption.create({
        data: { ...opt, revisionId: rev.id, subtotal: Number(subtotal) * factor, discount: Number(discount) * factor, total: Number(total) * factor },
      });
      await db().quoteLine.createMany({
        data: lines.map(({ id: _l, revisionId: _lr, optionId: _lo, unitPrice, lineTotal, ...l }) => ({
          ...l,
          unitPrice: Number(unitPrice) * factor,
          lineTotal: Number(lineTotal) * factor,
          revisionId: rev.id,
          optionId: option.id,
        })),
      });
      if (costs.length) await db().optionCost.createMany({ data: costs.map(({ id: _k, optionId: _ko, ...c }) => ({ ...c, optionId: option.id })) });
    }
    return { quotationId: b.id, revisionId: rev.id, refNo: b.refNo };
  }

  it("makes the inquiry's first quotation A, its number with the letter", async () => {
    const page = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation`).expect(200)).body;
    expect(page.quotations).toHaveLength(1);
    expect(page.quotations[0]).toMatchObject({ letter: "A" });
    expect(page.quotation).toMatchObject({ letter: "A", refNo: page.quotations[0].refNo });
    expect(page.quotation.refNo).toMatch(/^QUO-\d{4}-\d{4}-A$/);
    refA = page.quotation.refNo;
    const deal = (await api(app, sana).get(`/inquiries/${inquiryId}`).expect(200)).body;
    expect(deal.quotations.map((q: { letter: string }) => q.letter)).toEqual(["A"]);
    expect(deal.quotation.refNo).toBe(refA);
  });

  it("reads every quotation: the deal speaks with the lowest one still waiting", async () => {
    ({ quotationId: quotationB, revisionId: revB } = await addQuotationB(0.9));
    const deal = (await api(app, sana).get(`/inquiries/${inquiryId}`).expect(200)).body;
    expect(deal.quotations.map((q: { letter: string; refNo: string }) => [q.letter, q.refNo])).toEqual([
      ["A", refA],
      ["B", `${base()}-B`],
    ]);
    expect(deal.quotation.refNo).toBe(`${base()}-B`);
    expect(deal.quotations[1].revisions[0]).toMatchObject({ number: 1, status: "sent" });

    const list = (await api(app, sana).get(`/inquiries?${new URLSearchParams({ q: tag })}`).expect(200)).body;
    const row = list.rows.find((r: { id: string }) => r.id === inquiryId);
    expect(row).toMatchObject({ quotations: 2, quotation: { refNo: `${base()}-B`, latest: { number: 1, status: "sent" } } });
    expect(Number(row.quotation.latest.total)).toBeLessThan(Number(deal.quotations[0].revisions[0].total));

    const page = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation`).expect(200)).body;
    expect(page.quotations.map((q: { letter: string }) => q.letter)).toEqual(["A", "B"]);
    expect(page.quotations[1].revisions[0]).toMatchObject({ id: revB, status: "sent", canAnswer: true, editable: false });
    // Until the page lists them all, it works on the first.
    expect(page.quotation.letter).toBe("A");
    expect(page.revisions[0].id).toBe(revA);
  });

  it("finds a quotation by its number with its letter, and the inquiry's by its number alone", async () => {
    const find = async (q: string) => (await api(app, sana).get(`/search?${new URLSearchParams({ q })}`).expect(200)).body.exact;
    expect(await find(`${base()}-B`)).toMatchObject({ kind: "quotations", label: `${base()}-B`, href: `/inquiries/${inquiryId}/quotation` });
    expect(await find(`${base()}-b r1`)).toMatchObject({ label: `${base()}-B` });
    // The inquiry's number alone: its first quotation.
    expect(await find(base())).toMatchObject({ label: refA });
  });

  it("accepts one quotation per deal", async () => {
    await db().quotationRevision.update({ where: { id: revB }, data: { status: "accepted" } });
    try {
      const refused = await api(app, sana).post(`/revisions/${revA}/status`, { to: "accepted" }).expect(409);
      expect(refused.body.error).toContain(`${base()}-B R1`);
      const deal = (await api(app, sana).get(`/inquiries/${inquiryId}`).expect(200)).body;
      expect(deal.quotation.refNo).toBe(`${base()}-B`);
    } finally {
      await db().quotationRevision.update({ where: { id: revB }, data: { status: "sent" } });
    }
  });

  it("says every quotation's revisions in the deal's history", async () => {
    await db().auditLog.create({
      data: { action: "create", entityType: "quotation", entityId: revB, summary: `${base()}-B R1 drafted ${tag}` },
    });
    const history = (await api(app, sana).get(`/history?${new URLSearchParams({ type: "deal", id: inquiryId })}`).expect(200)).body;
    const rows = (history.rows ?? history) as { summary: string | null }[];
    expect(rows.some((h) => h.summary === `${base()}-B R1 drafted ${tag}`)).toBe(true);
  });

  it("keeps the second quotation's own number free of the first's (one letter per inquiry)", async () => {
    await expect(db().quotation.create({ data: { inquiryId, letter: "B", refNo: `${base()}-B2` } })).rejects.toThrow();
    expect(quotationB).toBeTruthy();
  });
});
