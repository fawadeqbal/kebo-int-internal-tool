import type { INestApplication } from "@nestjs/common";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";
import { CompaniesService } from "../src/common/company/companies.service";
import { CompanyContext } from "../src/common/company/company-context";
import { PrismaService } from "../src/database/prisma.service";

/**
 * Rows saved before "factory" became "supplier" in the code's names (27 Nov 2026) hold the old names inside
 * their JSON. They are read with today's names (@kebo/shared old-names): nothing saved is lost or shown bare.
 * Each test writes a row the way the code before the change wrote it, then reads it through the API.
 */
describe("rows saved before the rename are read with today's names", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let manager: string;
  let sana: string;
  const tag = Date.now().toString(36);
  const today = new Date().toISOString().slice(0, 10);
  const inCompany = async <T>(fn: () => Promise<T>) => CompanyContext.run((await app.get(CompaniesService).byId(FIRST_COMPANY_ID))!, fn);

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    sana = await signIn(app, "sana@example.com");
  });

  afterAll(async () => {
    await app?.close();
  });

  it("an expense waiting for approval that says factoryId keeps its supplier: shown, and saved on approval", async () => {
    const supplier = (
      await api(app, manager)
        .post("/factories", { name: `Old Names Works ${tag}` })
        .expect(201)
    ).body as { id: string };
    const description = `Samples by courier ${tag}`;
    const sent = (
      await api(app, sana)
        .post("/submissions", {
          kind: "expense",
          body: { category: "travel", description, currency: "USD", spentOn: today, amount: 12, supplierId: supplier.id },
        })
        .expect(201)
    ).body as { id: string };
    // As the code before the change saved it: the same body, the old name.
    await inCompany(async () => {
      const row = await prisma.db.moneySubmission.findUniqueOrThrow({ where: { id: sent.id } });
      const { supplierId, ...rest } = row.body as Record<string, unknown>;
      expect(supplierId).toBe(supplier.id);
      // Saved today it carries both names, so the API from before the change could still read it after a fallback.
      expect(rest.factoryId).toBe(supplier.id);
      await prisma.db.moneySubmission.update({ where: { id: sent.id }, data: { body: rest as object } });
    });
    const shown = (await api(app, manager).get(`/submissions/${sent.id}`).expect(200)).body as { body: Record<string, unknown> };
    expect(shown.body.supplierId).toBe(supplier.id);
    await api(app, manager).post(`/submissions/${sent.id}/approve`).expect(200);
    const saved = await inCompany(() => prisma.db.expense.findFirstOrThrow({ where: { description }, select: { supplierId: true } }));
    expect(saved.supplierId).toBe(supplier.id);
  });

  it("the history shows a change saved as factoryOrderNo under today's name", async () => {
    const order = await inCompany(() => prisma.db.order.findFirstOrThrow({ select: { id: true } }));
    const summary = `their order number changed ${tag}`;
    await inCompany(() =>
      prisma.db.auditLog.create({
        data: {
          action: "order.update",
          entityType: "order",
          entityId: order.id,
          summary,
          oldValues: { factoryOrderNo: "PO-1" },
          newValues: { factoryOrderNo: "PO-2", factory: "Jiangsu" },
        },
      }),
    );
    const history = (await api(app, manager).get(`/history?type=order&id=${order.id}`).expect(200)).body as {
      summary: string;
      changes: { field: string; from: string | null; to: string | null }[];
    }[];
    const entry = history.find((e) => e.summary === summary)!;
    // The compound name is today's; the bare word is unchanged (it was not renamed).
    expect(entry.changes).toEqual([
      { field: "supplierOrderNo", from: "PO-1", to: "PO-2" },
      { field: "factory", from: null, to: "Jiangsu" },
    ]);
  });

  it('follow-ups filtered by each kind of record answer (a supplier\'s are stored as "factory")', async () => {
    for (const about of ["inquiry", "order", "customer", "factory", "none"])
      await api(app, manager).get(`/follow-ups?about=${about}`).expect(200);
    await api(app, manager).get("/follow-ups?about=supplier").expect(422);
  });
});
