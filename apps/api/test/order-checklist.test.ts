import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { DEFAULT_CHECKLIST } from "@kebo/shared";
import { api, signIn, startApp } from "./app";
import { PrismaService } from "../src/database/prisma.service";
import { CompaniesService } from "../src/common/company/companies.service";

/**
 * Order flow v3: an order's six steps, each a checklist. Automatic items tick
 * themselves from the data; the company's own list is copied into an order the
 * first time it is read; items are added, ticked with what they collected,
 * unticked, skipped and deleted; changes need orders.update and go into the
 * order's history under their step.
 */
describe("order checklist", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sana: string;
  let bilal: string;
  let admin: string;
  let manager: string;
  let me: string;
  let customerId: string;
  let factoryId: string;
  let orderId: string;
  const tag = Date.now().toString(36);
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  type Item = {
    id: string | null;
    key: string | null;
    auto: boolean;
    step: string;
    title: string;
    done: boolean;
    skipped: boolean;
    late: boolean;
    dueOn: string | null;
    data: [string, string][];
    needs: string | null;
    route: string | null;
  };
  type Steps = {
    canEdit: boolean;
    steps: { key: string; state: string; done: number; total: number; next: { title: string } | null }[];
    doNow: { step: string; title: string } | null;
    items: Item[];
  };
  const steps = async (who = sana, id = orderId) => (await api(app, who).get(`/orders/${id}/steps`).expect(200)).body as Steps;
  const find = (s: Steps, title: string) => s.items.find((i) => i.title === title);
  const auto = (s: Steps, key: string) => s.items.find((i) => i.key === key);
  const resetList = async () => {
    const db = prisma.company(FIRST_COMPANY_ID);
    await db.checklistTemplate.deleteMany({});
    await db.setting.deleteMany({ where: { key: "order_checklist" } });
  };
  const modulesOff = async (off: string[]) => {
    await prisma.platform.company.update({ where: { id: FIRST_COMPANY_ID }, data: { featuresOff: off } });
    app.get(CompaniesService).forget(FIRST_COMPANY_ID);
  };

  /** A new deal for the customer, quoted and accepted: its order's id. */
  const newOrder = async () => {
    const inquiry = (
      await api(app, sana)
        .post("/inquiries", {
          customerId,
          category: "Machinery",
          assigneeId: me,
          items: [{ description: "Cartoning machine", quantity: 1 }],
        })
        .expect(201)
    ).body;
    const item = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, {
        factoryId,
        receivedOn: day(-5),
        currency: "CNY",
        lines: [{ requestedItemId: item.id, description: "ZH-120", quantity: 1, unitPrice: 71000 }],
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiry.id}/quotation/draft`)).body;
    const r = (await api(app, sana).post(`/inquiries/${inquiry.id}/quotation/revisions`, draft).expect(201)).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "accepted" }).expect(200);
    return (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.orders[0].id as string;
  };

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    sana = await signIn(app, "sana@example.com");
    bilal = await signIn(app, "bilal@example.com");
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    me = (await api(app, sana).get("/auth/me")).body.id;
    await resetList();
    customerId = (
      await api(app, sana)
        .post("/customers", { name: `Checklist Pharma ${tag}`, country: "PK", contacts: [{ name: "Ali", email: `ali-${tag}@cl.test` }] })
        .expect(201)
    ).body.id;
    factoryId = (
      await api(app, sana)
        .post("/factories", { name: `Checklist Works ${tag}` })
        .expect(201)
    ).body.id;
    orderId = await newOrder();
  });

  afterAll(async () => {
    if (prisma) {
      await resetList();
      await modulesOff([]);
    }
    await app?.close();
  });

  it("is copied from the default list the first time, once", async () => {
    const s = await steps();
    expect(s.canEdit).toBe(true);
    expect(s.steps.map((x) => x.key)).toEqual(["payment", "factory", "production", "shipping", "documents", "delivery"]);
    expect(s.steps[0]).toMatchObject({ state: "now" });
    expect(s.doNow).toMatchObject({ step: "payment" });
    const production = s.items.filter((i) => i.step === "production").map((i) => i.title);
    expect(production).toEqual([
      "Ready date from the factory",
      "Factory test run (FAT) with video",
      "Balance paid to the factory",
      "Goods received from the factory",
    ]);
    // Limited to a bank route: not on an order without one.
    expect(find(s, "Pre-shipment inspection")).toBeUndefined();
    expect(find(s, "Sales contract signed by both")).toBeUndefined();
    const again = await steps();
    expect(again.items.filter((i) => !i.auto)).toHaveLength(s.items.filter((i) => !i.auto).length);
    expect(await prisma.company(FIRST_COMPANY_ID).orderChecklistItem.count({ where: { orderId, key: null } })).toBe(6);
    // Someone who does not handle the deal does not see it.
    await api(app, bilal).get(`/orders/${orderId}/steps`).expect(404);
  });

  it("automatic items tick themselves from the data", async () => {
    let s = await steps();
    expect(auto(s, "deposit_in")).toMatchObject({ done: false, needs: expect.stringContaining("%") });
    const order = (await api(app, manager).get(`/orders/${orderId}`).expect(200)).body;
    await api(app, manager)
      .post(`/orders/${orderId}/payments`, { kind: "deposit", amount: order.money.deposit, currency: order.currency, paidOn: day(-1) })
      .expect(201);
    await api(app, sana).patch(`/orders/${orderId}/route`, { route: "informal" }).expect(200);
    s = await steps();
    expect(auto(s, "deposit_in")).toMatchObject({ done: true, doneOn: day(-1) });
    expect(auto(s, "route")).toMatchObject({ done: true, data: [["Route", "Informal"]] });
    expect(s.steps[0]).toMatchObject({ key: "payment", state: "done" });
    expect(s.steps[1]).toMatchObject({ key: "factory", state: "now" });
    await api(app, sana)
      .patch(`/orders/${orderId}/factory-order`, { factoryOrderedOn: day(0) })
      .expect(200);
    s = await steps();
    expect(auto(s, "factory_ordered")).toMatchObject({ done: true, data: [["Ordered", day(0)]] });
    // Sana sees factory money: the advance to the factory is next.
    expect(s.doNow).toMatchObject({ step: "factory", title: "Advance paid to the factory" });
    // Own items copied from the list have their row.
    const fat = find(s, "Factory test run (FAT) with video")!;
    expect(fat.id).toBeTruthy();
  });

  it("own items: add, tick with data, untick, skip, delete", async () => {
    const added = (
      await api(app, sana)
        .post(`/orders/${orderId}/checklist`, {
          step: "production",
          title: "Paint colour confirmed",
          tool: "fill",
          fields: [{ key: "colour", label: "Colour", type: "text" }],
          dueOn: day(2),
        })
        .expect(201)
    ).body as Steps;
    const item = find(added, "Paint colour confirmed")!;
    expect(item).toMatchObject({ auto: false, done: false, late: false, needs: "colour", dueOn: day(2) });
    // A fill item needs its fields.
    await api(app, sana).post(`/checklist/${item.id}/tick`, { data: {} }).expect(400);
    let s = (
      await api(app, sana)
        .post(`/checklist/${item.id}/tick`, { data: { colour: "RAL 5015", other: "dropped" } })
        .expect(200)
    ).body as Steps;
    expect(find(s, "Paint colour confirmed")).toMatchObject({ done: true, data: [["Colour", "RAL 5015"]], needs: null });
    s = (await api(app, sana).post(`/checklist/${item.id}/untick`).expect(200)).body;
    expect(find(s, "Paint colour confirmed")).toMatchObject({ done: false, data: [["Colour", "RAL 5015"]] });
    await api(app, sana).post(`/checklist/${item.id}/skip`, { reason: "" }).expect(422);
    s = (await api(app, sana).post(`/checklist/${item.id}/skip`, { reason: "Customer takes the standard colour" }).expect(200)).body;
    expect(find(s, "Paint colour confirmed")).toMatchObject({ skipped: true, skipReason: "Customer takes the standard colour" });
    s = (await api(app, sana).patch(`/checklist/${item.id}`, { title: "Paint colour agreed", note: "see WeChat" }).expect(200)).body;
    expect(find(s, "Paint colour agreed")).toMatchObject({ note: "see WeChat" });
    // Ticking a "Mark done" item is one click.
    s = (await api(app, sana).post(`/orders/${orderId}/checklist`, { step: "production", title: `Machining ${tag}`, tool: "done" }).expect(201)).body;
    const machining = find(s, `Machining ${tag}`)!;
    s = (await api(app, sana).post(`/checklist/${machining.id}/tick`, {}).expect(200)).body;
    expect(find(s, `Machining ${tag}`)).toMatchObject({ done: true, doneBy: { id: me } });
    s = (await api(app, sana).delete(`/checklist/${item.id}`).expect(200)).body;
    expect(find(s, "Paint colour agreed")).toBeUndefined();
    // Others cannot change it: not their deal, or no permission.
    await api(app, bilal).post(`/checklist/${machining.id}/untick`).expect(404);
    await api(app, bilal).post(`/orders/${orderId}/checklist`, { step: "production", title: "x" }).expect(404);
  });

  it("automatic items take a due date, a person and a skip; late ones are red", async () => {
    let s = (
      await api(app, sana)
        .put(`/orders/${orderId}/checklist/auto/ready_date`, { dueOn: day(-2), assigneeId: me })
        .expect(200)
    ).body as Steps;
    expect(auto(s, "ready_date")).toMatchObject({ dueOn: day(-2), late: true, assignee: { id: me } });
    expect(s.steps.find((x) => x.key === "production")).toMatchObject({ state: "late" });
    expect(s.steps.find((x) => x.key === "production")?.next).toMatchObject({ title: "Ready date from the factory", late: true });
    // It comes up on Home.
    const reminders = (await api(app, sana).get("/reminders").expect(200)).body.items as { title: string }[];
    expect(reminders.map((r) => r.title)).toContainEqual(expect.stringContaining(`"Ready date from the factory" was due ${day(-2)}`));
    await api(app, sana).put(`/orders/${orderId}/checklist/auto/booked`, { skipped: true }).expect(422);
    s = (
      await api(app, sana)
        .put(`/orders/${orderId}/checklist/auto/booked`, { skipped: true, skipReason: "Customer books the ship" })
        .expect(200)
    ).body;
    expect(auto(s, "booked")).toMatchObject({ skipped: true, skipReason: "Customer books the ship" });
    s = (await api(app, sana).put(`/orders/${orderId}/checklist/auto/booked`, { skipped: false }).expect(200)).body;
    expect(auto(s, "booked")).toMatchObject({ skipped: false });
    await api(app, sana)
      .put(`/orders/${orderId}/checklist/auto/nothing_like_this`, { dueOn: day(1) })
      .expect(404);
    // Automatic items tick from the data only.
    const ready = auto(s, "ready_date")!;
    await api(app, sana).post(`/checklist/${ready.id}/tick`, {}).expect(400);
    await api(app, sana).delete(`/checklist/${ready.id}`).expect(400);
    await api(app, sana).put(`/orders/${orderId}/checklist/auto/ready_date`, { dueOn: "" }).expect(200);
  });

  it("an own item late or due soon is on my to-do", async () => {
    await api(app, sana)
      .post(`/orders/${orderId}/checklist`, { step: "factory", title: `Send drawings ${tag}`, dueOn: day(-1) })
      .expect(201);
    const todo = (await api(app, sana).get("/me/todo").expect(200)).body as { id: string; needs: { title: string; late: boolean } }[];
    expect(todo.find((t) => t.id === orderId)?.needs).toMatchObject({ title: `Send drawings ${tag}`, late: true });
  });

  it("items limited to a route appear with that route", async () => {
    await api(app, sana).patch(`/orders/${orderId}/route`, { route: "letter_of_credit" }).expect(200);
    const s = await steps();
    expect(find(s, "Pre-shipment inspection")).toMatchObject({ route: "letter_of_credit", step: "production" });
    expect(find(s, "Sales contract signed by both")).toMatchObject({ step: "payment" });
    expect(auto(s, "contract")).toMatchObject({ title: "LC opened and checked against the order", done: false });
    expect(s.items.filter((i) => i.key?.startsWith("bank:"))).toHaveLength(6);
    expect(auto(s, "balance_in")).toBeUndefined();
    await api(app, sana).patch(`/orders/${orderId}/route`, { route: "informal" }).expect(200);
  });

  it("modules switched off take their items and steps away", async () => {
    await modulesOff(["delivery_sat", "shipping", "bank_documents"]);
    try {
      const s = await steps();
      expect(s.steps.map((x) => x.key)).toEqual(["payment", "factory", "production", "shipping", "documents"]);
      expect(auto(s, "booked")).toBeUndefined();
      expect(auto(s, "shipped")).toMatchObject({ step: "shipping" });
      expect(auto(s, "closed")).toMatchObject({ step: "shipping" });
      expect(s.items.filter((i) => i.step === "documents" && i.auto)).toEqual([]);
    } finally {
      await modulesOff([]);
    }
  });

  it("the company's own list: only for settings.manage, copied into new orders only", async () => {
    await api(app, sana).get("/settings/checklist").expect(403);
    const before = (await api(app, admin).get("/settings/checklist").expect(200)).body;
    expect(before).toMatchObject({ saved: false });
    expect(before.items.length).toBeGreaterThan(0);
    await api(app, sana).put("/settings/checklist", { items: [], hidden: [] }).expect(403);
    await api(app, admin)
      .put("/settings/checklist", { items: [], hidden: ["closed"] })
      .expect(422);
    const saved = (
      await api(app, admin)
        .put("/settings/checklist", {
          items: [{ step: "production", title: `Our QC ${tag}`, tool: "done", fields: [], route: null, dueDays: 5 }],
          hidden: ["booked"],
        })
        .expect(200)
    ).body;
    expect(saved).toMatchObject({ saved: true, hidden: ["booked"], items: [{ title: `Our QC ${tag}`, dueDays: 5 }] });
    const second = await newOrder();
    const s = await steps(sana, second);
    const ordered = (await api(app, sana).get(`/orders/${second}`)).body.orderedOn as string;
    const due = new Date(Date.parse(`${ordered}T00:00:00Z`) + 5 * 86_400_000).toISOString().slice(0, 10);
    expect(find(s, `Our QC ${tag}`)).toMatchObject({ dueOn: due });
    expect(find(s, "Factory test run (FAT) with video")).toBeUndefined();
    expect(auto(s, "booked")).toBeUndefined();
    // The first order keeps the list it had.
    expect(find(await steps(), "Factory test run (FAT) with video")).toBeDefined();
    await resetList();
  });

  it("the history shows each step's changes", async () => {
    const production = (await api(app, sana).get(`/history?type=order&id=${orderId}&step=production`).expect(200)).body as {
      action: string;
      step: string;
      summary: string;
    }[];
    expect(production.length).toBeGreaterThan(0);
    expect(production.every((h) => h.step === "production")).toBe(true);
    expect(production.map((h) => h.action)).toEqual(expect.arrayContaining(["checklist.tick", "checklist.add", "checklist.delete"]));
    const payment = (await api(app, sana).get(`/history?type=order&id=${orderId}&step=payment&limit=2`).expect(200)).body as {
      action: string;
    }[];
    expect(payment.length).toBeLessThanOrEqual(2);
    expect(payment.map((h) => h.action).every((a) => a === "payment_in" || a === "flow.route" || a.startsWith("checklist"))).toBe(true);
    await api(app, sana).get(`/history?type=order&id=${orderId}&step=nowhere`).expect(422);
  });

  it("the cleanup migration removes the three old default items only where nobody used them", async () => {
    const db = prisma.company(FIRST_COMPANY_ID);
    const mk = (title: string, extra: Record<string, unknown> = {}) =>
      db.orderChecklistItem.create({ data: { orderId, step: "production", title, tool: "done", createdById: me, sortOrder: 900, ...extra } });
    const untouched = await mk("Materials and parts in");
    const ticked = await mk("Machining and assembly", { doneAt: new Date(), doneById: me });
    const filled = await mk("Drawings approved by the customer", { tool: "fill", data: { approvedBy: "Dr. Imran" } });
    const noted = await mk("Drawings approved by the customer", { note: "waiting for rev C" });
    const skipped = await mk("Machining and assembly", { skippedAt: new Date(), skipReason: "done at the factory" });
    const other = await mk(`Materials and parts in ${tag}`);
    const sql = readFileSync(join(__dirname, "../../../packages/database/prisma/migrations/20261130000000_checklist_cleanup/migration.sql"), "utf8");
    await prisma.platform.$executeRawUnsafe(sql);
    const left = new Set((await db.orderChecklistItem.findMany({ where: { orderId }, select: { id: true } })).map((r) => r.id));
    expect(left.has(untouched.id)).toBe(false);
    expect([ticked, filled, noted, skipped, other].every((r) => left.has(r.id))).toBe(true);
    await db.orderChecklistItem.deleteMany({ where: { id: { in: [ticked.id, filled.id, noted.id, skipped.id, other.id] } } });
    // New orders no longer get them.
    expect(DEFAULT_CHECKLIST.map((i) => i.title)).not.toEqual(expect.arrayContaining(["Materials and parts in"]));
    expect(DEFAULT_CHECKLIST.some((i) => /Drawings approved|Materials and parts in|Machining and assembly/.test(i.title))).toBe(false);
  });

  it("another company cannot read or write the items", async () => {
    const other = await prisma.platform.company.create({ data: { slug: `cl-${tag}`.slice(0, 30), name: `Checklist other ${tag}` } });
    try {
      const db = prisma.company(other.id);
      expect(await db.orderChecklistItem.count()).toBe(0);
      expect(await db.checklistTemplate.count()).toBe(0);
      const mine = await prisma.company(FIRST_COMPANY_ID).orderChecklistItem.findFirstOrThrow({ where: { orderId } });
      expect(await db.orderChecklistItem.findUnique({ where: { id: mine.id } })).toBeNull();
      expect((await db.orderChecklistItem.updateMany({ where: { id: mine.id }, data: { title: "hacked" } })).count).toBe(0);
      await expect(
        db.$executeRawUnsafe(
          `insert into order_checklist_items (id, company_id, order_id, step, created_by, updated_at) values (gen_random_uuid(), $1::uuid, $2::uuid, 'production', $3::uuid, now())`,
          FIRST_COMPANY_ID,
          orderId,
          me,
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        db.$executeRawUnsafe(
          `insert into order_checklist_items (id, order_id, step, created_by, updated_at) values (gen_random_uuid(), $1::uuid, 'production', $2::uuid, now())`,
          orderId,
          me,
        ),
      ).rejects.toThrow(/another company|foreign key/);
    } finally {
      await prisma.platform.company.delete({ where: { id: other.id } });
    }
  });
});
