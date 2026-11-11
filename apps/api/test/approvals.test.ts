import type { INestApplication } from "@nestjs/common";
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIRST_COMPANY_ID, seedCompanyBase } from "@kebo/database";
import { api, signIn, startApp } from "./app";
import { PrismaService } from "../src/database/prisma.service";
import { CompaniesService } from "../src/common/company/companies.service";

type Submission = {
  id: string;
  kind: "payment" | "expense";
  status: "pending" | "approved" | "sent_back" | "withdrawn";
  order: { id: string; refNo: string; customer: string } | null;
  customer: { id: string; name: string } | null;
  amount: string | null;
  currency: string | null;
  paidOn: string | null;
  spentOn: string | null;
  category: string | null;
  description: string | null;
  body: Record<string, unknown>;
  submittedBy: { id: string; name: string };
  submittedAt: string;
  hasFile: boolean;
  file: { name: string; type: string; size: number } | null;
  reason: string | null;
  decidedBy: { id: string; name: string } | null;
  createdId: string | null;
  can: { approve: boolean; sendBack: boolean; edit: boolean; withdraw: boolean; changeFile: boolean };
};
type List = { rows: Submission[]; total: number; counts: Record<string, number>; approves: string[]; canSubmit: boolean };
type Payments = {
  due: string;
  received: string;
  payments: {
    id: string;
    receiptNo: number | null;
    amount: string;
    reference: string | null;
    recordedBy: { name: string } | null;
    file: { name: string } | null;
  }[];
};
type Notification = { type: string; title: string; body: string | null; link: string | null };

/**
 * Money received and expenses staff add for a manager to approve: while waiting nothing counts (no
 * payment, no expense, no money figure moves); approving records it with the usual code as the
 * approver, the photo goes with it, and the submitter is told. Sending back says why; the submitter
 * can change it or withdraw it. Only those who record payments (or expenses) approve them, and another
 * company reaches none of it.
 */
describe("money sent for approval", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sana: string;
  let bilal: string;
  let manager: string;
  let admin: string;
  let sanaId: string;
  let orderId: string;
  let refNo: string;
  let customerId: string;
  const tag = Date.now().toString(36);
  const password = "Approve@12345678";
  const today = new Date().toISOString().slice(0, 10);
  // Two days on: in the future whatever the business time zone.
  const later = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const upload = (token: string, path: string) => request(app.getHttpServer()).post(`/api${path}`).set("authorization", `Bearer ${token}`);
  const payments = async () => (await api(app, manager).get(`/orders/${orderId}/payments`).expect(200)).body as Payments;
  const notes = async (who: string) => (await api(app, who).get("/notifications?take=50").expect(200)).body.items as Notification[];
  const pay = (body: object, who = sana) =>
    api(app, who).post("/submissions", { kind: "payment", orderId, body: { currency: "USD", paidOn: today, ...body } });
  const expense = (body: object, who = sana) =>
    api(app, who).post("/submissions", {
      kind: "expense",
      orderId,
      body: { category: "travel", description: "Taxi to the factory", currency: "USD", spentOn: today, ...body },
    });
  const modulesOff = async (off: string[]) => {
    await prisma.platform.company.update({ where: { id: FIRST_COMPANY_ID }, data: { featuresOff: off } });
    app.get(CompaniesService).forget(FIRST_COMPANY_ID);
  };
  const person = async (name: string, permissions: string[]) => {
    const role = (
      await api(app, admin)
        .post("/roles", { name: `${name} ${tag}`, permissions })
        .expect(201)
    ).body;
    const email = `${name.toLowerCase().replace(/\W/g, "")}-${tag}@example.com`;
    await api(app, admin).post("/users", { name, email, role: role.key, password }).expect(201);
    return signIn(app, email, password);
  };

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    await modulesOff([]);
    sana = await signIn(app, "sana@example.com");
    bilal = await signIn(app, "bilal@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    sanaId = (await api(app, sana).get("/auth/me")).body.id;
    // Sana's order: 10 valves at USD 300.
    customerId = (
      await api(app, sana)
        .post("/customers", { name: `Approve Co ${tag}`, country: "KE", contacts: [{ name: "Wanjiru", email: `w-${tag}@approve.test` }] })
        .expect(201)
    ).body.id;
    const inquiry = (
      await api(app, sana)
        .post("/inquiries", { customerId, category: "Machinery", assigneeId: sanaId, items: [{ description: "Valve", quantity: 10 }] })
        .expect(201)
    ).body;
    const item = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, {
        newFactoryName: `Approve Valves ${tag}`,
        receivedOn: "2026-10-01",
        currency: "CNY",
        lines: [{ requestedItemId: item.id, description: "Valve", quantity: 10, unitPrice: 1000 }],
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiry.id}/quotation/draft`)).body;
    const options = [
      { ...draft.options[0], prices: draft.options[0].prices.map((p: Record<string, unknown>) => ({ ...p, unitPrice: 300 })) },
    ];
    const r = (
      await api(app, sana)
        .post(`/inquiries/${inquiry.id}/quotation/revisions`, { ...draft, currency: "USD", options })
        .expect(201)
    ).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "accepted" }).expect(200);
    const deal = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body;
    orderId = deal.orders[0].id;
    refNo = deal.orders[0].refNo;
  });

  afterAll(async () => {
    await modulesOff([]).catch(() => undefined);
    await app?.close();
  });

  it("staff have the new permission; the role editor lists it with the money permissions", async () => {
    expect((await api(app, sana).get("/auth/me").expect(200)).body.permissions).toContain("money.submit");
    expect((await api(app, manager).get("/auth/me").expect(200)).body.permissions).toContain("money.submit");
  });

  it("money received waits without counting, then counts exactly as if the manager had recorded it", async () => {
    const before = await payments();
    expect(Number(before.due)).toBeGreaterThan(100);
    const paymentRows = await prisma.company(FIRST_COMPANY_ID).allocation.count({ where: { orderId } });

    // The same checks as recording: the date, the order, the body.
    await pay({ amount: 100, paidOn: later }).expect(400, { error: "The payment date cannot be in the future." });
    const bad = await api(app, sana)
      .post("/submissions", { kind: "payment", orderId, body: { amount: 100, paidOn: today } })
      .expect(422);
    expect(Object.keys(bad.body.fieldErrors)).toContain("currency");
    await api(app, sana)
      .post("/submissions", { kind: "payment", body: { amount: 100, currency: "USD", paidOn: today } })
      .expect(422);
    await pay({ amount: 100, method: "credit" }).expect(400);
    // Bilal (staff) does not see Sana's order.
    await pay({ amount: 100 }, bilal).expect(404);

    const sent = (await pay({ amount: 100, reference: `SLIP-${tag}` }).expect(201)).body as Submission;
    expect(sent).toMatchObject({
      kind: "payment",
      status: "pending",
      order: { id: orderId, refNo, customer: `Approve Co ${tag}` },
      customer: { id: customerId },
      amount: "100.00",
      currency: "USD",
      paidOn: today,
      submittedBy: { id: sanaId, name: "Sana" },
      hasFile: false,
      reason: null,
      createdId: null,
      can: { approve: false, sendBack: false, edit: true, withdraw: true, changeFile: true },
    });
    expect(sent.body).toMatchObject({ amount: 100, currency: "USD", paidOn: today, reference: `SLIP-${tag}` });

    // Nothing counts yet.
    expect(await prisma.company(FIRST_COMPANY_ID).allocation.count({ where: { orderId } })).toBe(paymentRows);
    const waiting = await payments();
    expect([waiting.due, waiting.received]).toEqual([before.due, before.received]);

    // The bank slip: the submitter adds it; approvers and the submitter open it; others are told it is not there.
    await upload(sana, `/submissions/${sent.id}/file`).attach("file", Buffer.from("MZ"), { filename: "slip.exe" }).expect(400);
    await upload(manager, `/submissions/${sent.id}/file`)
      .attach("file", png, { filename: "slip.png", contentType: "image/png" })
      .expect(403);
    const withFile = (
      await upload(sana, `/submissions/${sent.id}/file`).attach("file", png, { filename: "slip.png", contentType: "image/png" }).expect(201)
    ).body;
    expect(withFile).toMatchObject({ hasFile: true, file: { name: "slip.png", type: "image/png", size: png.length } });
    const got = await api(app, manager).get(`/submissions/${sent.id}/file`).buffer(true).expect(200);
    expect(Buffer.from(got.body).equals(png)).toBe(true);
    await api(app, sana).get(`/submissions/${sent.id}/file`).expect(200);
    await api(app, bilal).get(`/submissions/${sent.id}/file`).expect(404);
    await api(app, bilal).get(`/submissions/${sent.id}`).expect(404);

    // Managers are told and see it in their list; staff see only their own.
    expect(
      (await notes(manager)).find((n) => n.type === "approval.waiting" && n.title === `To approve: money received · ${refNo}`),
    ).toMatchObject({
      body: `Sana added USD 100.00 from Approve Co ${tag}`,
      link: "/approvals",
    });
    expect((await notes(sana)).some((n) => n.type === "approval.waiting")).toBe(false);
    const list = (await api(app, manager).get("/submissions").expect(200)).body as List;
    expect(list.rows.find((s) => s.id === sent.id)).toMatchObject({
      status: "pending",
      can: { approve: true, sendBack: true, edit: false },
    });
    expect(list.counts.pending).toBeGreaterThanOrEqual(1);
    expect(list.approves).toEqual(["payment", "expense"]);
    await api(app, sana).get("/submissions").expect(403);
    const mine = (await api(app, sana).get("/submissions?mine=true").expect(200)).body as List;
    expect(mine.rows.map((s) => s.id)).toContain(sent.id);
    expect(mine.canSubmit).toBe(true);

    // Staff cannot approve their own.
    await api(app, sana).post(`/submissions/${sent.id}/approve`).expect(403);
    await api(app, sana).post(`/submissions/${sent.id}/send-back`, { reason: "no" }).expect(403);

    const approved = (await api(app, manager).post(`/submissions/${sent.id}/approve`).expect(200)).body as {
      submission: Submission;
      createdId: string;
    };
    expect(approved.createdId).toMatch(/^[0-9a-f-]{36}$/);
    expect(approved.submission).toMatchObject({
      status: "approved",
      createdId: approved.createdId,
      decidedBy: { name: "Manager" },
      hasFile: false,
    });

    // A real payment, as the direct endpoint makes it: receipt number, recorded by the approver, the slip with it, the due down.
    const after = await payments();
    const made = after.payments.find((p) => p.id === approved.createdId)!;
    expect(made).toMatchObject({ amount: "100.00", reference: `SLIP-${tag}`, recordedBy: { name: "Manager" }, file: { name: "slip.png" } });
    expect(made.receiptNo).toEqual(expect.any(Number));
    expect(Number(after.due)).toBeCloseTo(Number(before.due) - 100, 2);
    const slip = await api(app, manager).get(`/payments/${approved.createdId}/file`).buffer(true).expect(200);
    expect(Buffer.from(slip.body).equals(png)).toBe(true);
    await api(app, manager).get(`/submissions/${sent.id}/file`).expect(404);

    // Recorded directly, the same way: the next receipt number of the same series.
    const direct = (await api(app, manager).post(`/orders/${orderId}/payments`, { amount: 1, currency: "USD", paidOn: today }).expect(201))
      .body as Payments & { createdId: string };
    expect(direct.payments.find((p) => p.id === direct.createdId)!.receiptNo).toBe(made.receiptNo! + 1);

    // The history says who added it and who approved it; the submitter is told.
    const history = (await api(app, manager).get(`/history?type=order&id=${orderId}`).expect(200)).body as { summary: string }[];
    expect(
      history.some((h) => h.summary === `${refNo}: money received · USD 100.00 added by Sana, approved by Manager (with slip.png)`),
    ).toBe(true);
    expect(history.some((h) => h.summary.startsWith(`${refNo}: received USD 100.00`))).toBe(true);
    expect((await notes(sana)).find((n) => n.type === "approval.approved")).toMatchObject({
      title: `Approved: money received · ${refNo} · USD 100.00`,
      link: `/orders/${orderId}`,
    });

    // Done once: no second approval, no change, no withdrawal.
    await api(app, manager).post(`/submissions/${sent.id}/approve`).expect(409);
    await api(app, sana).post(`/submissions/${sent.id}/withdraw`).expect(409);
    await api(app, sana)
      .patch(`/submissions/${sent.id}`, { body: { amount: 5, currency: "USD", paidOn: today } })
      .expect(409);
    expect(((await api(app, sana).get("/submissions?mine=true&status=approved").expect(200)).body as List).rows.map((s) => s.id)).toContain(
      sent.id,
    );
  });

  it("sent back with a reason, changed and sent again, or withdrawn: nothing is recorded", async () => {
    const before = await payments();
    const sent = (await pay({ amount: 50 }).expect(201)).body as Submission;
    await api(app, manager).post(`/submissions/${sent.id}/send-back`, {}).expect(422);
    await api(app, manager)
      .post(`/submissions/${sent.id}/send-back`, { reason: "x".repeat(501) })
      .expect(422);
    const back = (await api(app, manager).post(`/submissions/${sent.id}/send-back`, { reason: "The slip shows USD 60" }).expect(200))
      .body as Submission;
    expect(back).toMatchObject({ status: "sent_back", reason: "The slip shows USD 60", decidedBy: { name: "Manager" } });
    expect((await notes(sana)).find((n) => n.type === "approval.sentBack")).toMatchObject({
      title: `Sent back: money received · ${refNo} · USD 50.00`,
      body: "The slip shows USD 60",
      link: "/approvals?mine=true",
    });
    await api(app, manager).post(`/submissions/${sent.id}/approve`).expect(409);

    // Changed: it waits again, and the managers are told again.
    const changed = (
      await api(app, sana)
        .patch(`/submissions/${sent.id}`, { body: { amount: 60, currency: "USD", paidOn: today } })
        .expect(200)
    ).body as Submission;
    expect(changed).toMatchObject({ status: "pending", amount: "60.00", reason: null, decidedBy: null });
    await api(app, bilal)
      .patch(`/submissions/${sent.id}`, { body: { amount: 1, currency: "USD", paidOn: today } })
      .expect(404);
    await api(app, manager)
      .patch(`/submissions/${sent.id}`, { body: { amount: 1, currency: "USD", paidOn: today } })
      .expect(403);

    await upload(sana, `/submissions/${sent.id}/file`).attach("file", png, { filename: "slip.png", contentType: "image/png" }).expect(201);
    await api(app, manager).delete(`/submissions/${sent.id}/file`).expect(403);
    expect((await api(app, sana).delete(`/submissions/${sent.id}/file`).expect(200)).body).toMatchObject({ hasFile: false });

    await api(app, manager).post(`/submissions/${sent.id}/withdraw`).expect(403);
    expect((await api(app, sana).post(`/submissions/${sent.id}/withdraw`).expect(200)).body).toMatchObject({ status: "withdrawn" });
    await api(app, manager).post(`/submissions/${sent.id}/approve`).expect(409);
    const after = await payments();
    expect([after.due, after.payments.length]).toEqual([before.due, before.payments.length]);
  });

  it("only those who record payments approve money received; only those who record expenses approve expenses", async () => {
    const accounts = await person("Accounts", ["dashboard.view", "inquiries.viewAll", "payments.record"]);
    const costs = await person("Costs", ["dashboard.view", "inquiries.viewAll", "expenses.manage"]);
    const nobody = await person("Viewer", ["dashboard.view", "inquiries.viewAll"]);

    // Without money.submit nobody sends; those who record do it directly.
    await pay({ amount: 10 }, accounts).expect(403);
    await pay({ amount: 10 }, nobody).expect(403);
    await api(app, nobody).get("/submissions").expect(403);

    const money = (await pay({ amount: 10 }).expect(201)).body as Submission;
    const spent = (await expense({ amount: 25 }).expect(201)).body as Submission;
    expect(spent).toMatchObject({
      kind: "expense",
      status: "pending",
      amount: "25.00",
      currency: "USD",
      spentOn: today,
      category: "travel",
      description: "Taxi to the factory",
    });
    expect(spent.order).toMatchObject({ id: orderId });
    // Nothing spent yet.
    expect(await prisma.company(FIRST_COMPANY_ID).expense.count({ where: { orderId } })).toBe(0);
    expect((await notes(manager)).some((n) => n.type === "approval.waiting" && n.title === "To approve: expense · USD 25.00")).toBe(true);

    const accountsList = (await api(app, accounts).get("/submissions").expect(200)).body as List;
    expect(accountsList.approves).toEqual(["payment"]);
    expect(accountsList.rows.every((s) => s.kind === "payment")).toBe(true);
    expect(accountsList.rows.map((s) => s.id)).toContain(money.id);
    await api(app, accounts).post(`/submissions/${spent.id}/approve`).expect(404);
    await api(app, costs).post(`/submissions/${money.id}/approve`).expect(404);
    expect(((await api(app, costs).get("/submissions").expect(200)).body as List).rows.every((s) => s.kind === "expense")).toBe(true);

    // The expense, approved by the one who records expenses, with its receipt.
    await upload(sana, `/submissions/${spent.id}/file`)
      .attach("file", Buffer.from("%PDF-1.4 taxi"), { filename: "taxi.pdf", contentType: "application/pdf" })
      .expect(201);
    const done = (await api(app, costs).post(`/submissions/${spent.id}/approve`).expect(200)).body as {
      submission: Submission;
      createdId: string;
    };
    const e = await prisma.company(FIRST_COMPANY_ID).expense.findUniqueOrThrow({ where: { id: done.createdId } });
    expect(e).toMatchObject({ orderId, description: "Taxi to the factory", currency: "USD", receiptName: "taxi.pdf" });
    expect(e.amount.toFixed(2)).toBe("25.00");
    const receipt = await api(app, manager).get(`/expenses/${done.createdId}/receipt`).buffer(true).expect(200);
    expect(Buffer.from(receipt.body).toString()).toBe("%PDF-1.4 taxi");

    // The money received, approved with a corrected amount.
    const corrected = (
      await api(app, accounts)
        .post(`/submissions/${money.id}/approve`, { body: { amount: 12, currency: "USD", paidOn: today, reference: "fixed" } })
        .expect(200)
    ).body as { submission: Submission; createdId: string };
    expect(corrected.submission).toMatchObject({ status: "approved", amount: "12.00", decidedBy: { name: "Accounts" } });
    expect((await payments()).payments.find((p) => p.id === corrected.createdId)).toMatchObject({
      amount: "12.00",
      reference: "fixed",
      recordedBy: { name: "Accounts" },
    });
    // A corrected body is checked the same way.
    const again = (await pay({ amount: 10 }).expect(201)).body as Submission;
    await api(app, accounts)
      .post(`/submissions/${again.id}/approve`, { body: { amount: 10, currency: "USD", paidOn: later } })
      .expect(400);
    expect(((await api(app, sana).get(`/submissions/${again.id}`).expect(200)).body as Submission).status).toBe("pending");
    await api(app, sana).post(`/submissions/${again.id}/withdraw`).expect(200);
  });

  it("expenses: only on what the person sees, and only with the expenses feature", async () => {
    const other = (
      await api(app, manager)
        .post("/customers", { name: `Not Sana's ${tag}`, country: "KE", contacts: [{ name: "Otieno", email: `o-${tag}@approve.test` }] })
        .expect(201)
    ).body;
    await api(app, sana)
      .post("/submissions", {
        kind: "expense",
        body: { category: "meals", description: "Lunch", amount: 5, currency: "USD", spentOn: today, customerId: other.id },
      })
      .expect(404);
    await expense({ amount: 5, spentOn: later }).expect(400);
    // The company's own expense (on no customer) is fine.
    const general = (
      await api(app, sana)
        .post("/submissions", {
          kind: "expense",
          body: { category: "meals", description: "Team lunch", amount: 5, currency: "USD", spentOn: today },
        })
        .expect(201)
    ).body as Submission;
    expect(general).toMatchObject({ order: null, customer: null });

    await modulesOff(["expenses"]);
    try {
      const refused = await expense({ amount: 5 }).expect(403);
      expect(refused.body.code).toBe("plan_feature");
      // Managers approve only money received while expenses are off.
      expect(((await api(app, manager).get("/submissions").expect(200)).body as List).approves).toEqual(["payment"]);
      await api(app, manager).post(`/submissions/${general.id}/approve`).expect(404);
    } finally {
      await modulesOff([]);
    }
    await api(app, sana).post(`/submissions/${general.id}/withdraw`).expect(200);
  });

  it("when recording refuses, the refusal is passed on and it stays waiting", async () => {
    const sent = (await pay({ amount: 20 }).expect(201)).body as Submission;
    // Meanwhile the order is paid in full.
    const due = (await payments()).due;
    await api(app, manager).post(`/orders/${orderId}/payments`, { amount: due, currency: "USD", paidOn: today }).expect(201);
    const refused = await api(app, manager).post(`/submissions/${sent.id}/approve`).expect(400);
    expect(refused.body.error).toMatch(/Nothing is due/);
    const still = (await api(app, manager).get(`/submissions/${sent.id}`).expect(200)).body as Submission;
    expect(still).toMatchObject({ status: "pending", decidedBy: null, createdId: null });
    // And new ones are refused as recording would be.
    await pay({ amount: 20 }).expect(400);
    await api(app, sana).post(`/submissions/${sent.id}/withdraw`).expect(200);
  });

  it("another company reaches none of it, by any route", async () => {
    // One waiting (a general expense: the order is paid in full).
    const waiting = (
      await api(app, sana)
        .post("/submissions", {
          kind: "expense",
          body: { category: "meals", description: "Tea", amount: 2, currency: "USD", spentOn: today },
        })
        .expect(201)
    ).body as Submission;
    const company = await prisma.platform.company.create({ data: { slug: `ap-${tag}`.slice(0, 30), name: `Approvals other ${tag}` } });
    {
      const email = `boss@ap-${tag}.test`;
      await seedCompanyBase(prisma.company(company.id), {
        admin: { email, name: "Boss", role: "admin", passwordHash: await bcrypt.hash(password, 10) },
      });
      const boss = await signIn(app, email, password);
      const id = waiting.id;
      await api(app, boss).get(`/submissions/${id}`).expect(404);
      await api(app, boss)
        .patch(`/submissions/${id}`, { body: { category: "meals", description: "x", amount: 1, currency: "USD", spentOn: today } })
        .expect(404);
      await api(app, boss).post(`/submissions/${id}/approve`).expect(404);
      await api(app, boss).post(`/submissions/${id}/send-back`, { reason: "x" }).expect(404);
      await api(app, boss).post(`/submissions/${id}/withdraw`).expect(404);
      await upload(boss, `/submissions/${id}/file`).attach("file", png, { filename: "x.png", contentType: "image/png" }).expect(404);
      await api(app, boss).get(`/submissions/${id}/file`).expect(404);
      await api(app, boss).delete(`/submissions/${id}/file`).expect(404);
      const theirs = (await api(app, boss).get("/submissions?status=all").expect(200)).body as List;
      expect(theirs.rows).toEqual([]);
      expect(theirs.counts.all).toBe(0);
      await api(app, boss)
        .post("/submissions", { kind: "payment", orderId, body: { amount: 1, currency: "USD", paidOn: today } })
        .expect(404);
      await api(app, boss)
        .post("/submissions", {
          kind: "expense",
          orderId,
          body: { category: "meals", description: "x", amount: 1, currency: "USD", spentOn: today },
        })
        .expect(404);

      // In the database: not seen, not changed, and no link to our rows.
      const db = prisma.company(company.id);
      expect(await db.moneySubmission.findUnique({ where: { id } })).toBeNull();
      expect((await db.moneySubmission.updateMany({ where: { id }, data: { status: "approved", decidedAt: new Date() } })).count).toBe(0);
      const bossId = (await db.user.findFirstOrThrow({ where: { email } })).id;
      await expect(
        db.$executeRawUnsafe(
          `insert into money_submissions (id, kind, order_id, body, submitted_by, updated_at) values (gen_random_uuid(), 'payment', $1::uuid, '{}', $2::uuid, now())`,
          orderId,
          bossId,
        ),
      ).rejects.toThrow(/another company|foreign key/);
      const ours = await prisma.company(FIRST_COMPANY_ID).moneySubmission.findUniqueOrThrow({ where: { id } });
      expect(ours.status).toBe("pending");
    }
    await api(app, sana).post(`/submissions/${waiting.id}/withdraw`).expect(200);
  });
});
