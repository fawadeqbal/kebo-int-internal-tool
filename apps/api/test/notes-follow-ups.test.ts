import type { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FIRST_COMPANY_ID, seedCompanyBase, isSupplier } from "@kebo/database";
import { addDays } from "@kebo/utils";
import { api, signIn, startApp } from "./app";
import { PrismaService } from "../src/database/prisma.service";
import { Clock } from "../src/common/time/clock.service";
import { CompanyContext } from "../src/common/company/company-context";
import { toInfo } from "../src/common/company/companies.service";
import { RemindersService } from "../src/modules/notifications/reminders.service";
import { momentIn } from "../src/modules/notes/follow-ups.service";

type Note = {
  id: string;
  target: { type: string; id: string; label: string };
  kind: string;
  body: string;
  at: string;
  contact: { id: string; name: string } | null;
  author: { id: string; name: string };
  createdAt: string;
  editedAt: string | null;
  can: { edit: boolean; delete: boolean };
};
type FollowUp = {
  id: string;
  title: string;
  kind: string;
  dueOn: string;
  dueAt: string | null;
  place: string | null;
  note: string | null;
  target: { type: string; id: string; label: string } | null;
  link: string;
  assignee: { id: string; name: string };
  createdBy: { id: string; name: string };
  done: boolean;
  doneAt: string | null;
  doneBy: { id: string; name: string } | null;
  doneNote: string | null;
  late: boolean;
  can: { edit: boolean; done: boolean; delete: boolean };
};
type FollowUpList = { rows: FollowUp[]; total: number; counts: { open: number; done: number; late: number }; canViewAll: boolean };
type Today = { today: string; now: string; total: number; late: number; rows: FollowUp[] };
type History = { action: string; summary: string }[];

/**
 * Notes and call logs on inquiries, orders, customers and factories, and follow-ups (planned calls and
 * visits): who sees, adds, changes and removes them; Home's "today" list; the reminders, sent once; inquiry
 * notes as they always were; and another company reaches none of it.
 */
describe("notes and follow-ups", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let clock: Clock;
  let sana: string;
  let bilal: string;
  let manager: string;
  let admin: string;
  let sanaId: string;
  let bilalId: string;
  let managerId: string;
  let inquiryId: string;
  let orderId: string;
  let refNo: string;
  let customerId: string;
  let contactId: string;
  let factoryId: string;
  let otherContactId: string;
  const tag = Date.now().toString(36);
  const password = "Notes@12345678";
  const customerName = `Notes Co ${tag}`;
  const db = () => prisma.company(FIRST_COMPANY_ID);
  const person = async (name: string, permissions: string[]) => {
    const role = (await api(app, admin).post("/roles", { name: `${name} ${tag}`, permissions }).expect(201)).body;
    const email = `${name.toLowerCase().replace(/\W/g, "")}-${tag}@example.com`;
    await api(app, admin).post("/users", { name, email, role: role.key, password }).expect(201);
    const token = await signIn(app, email, password);
    const id = (await api(app, token).get("/auth/me").expect(200)).body.id as string;
    return { token, id };
  };
  const history = async (who: string, type: string, id: string) => (await api(app, who).get(`/history?type=${type}&id=${id}`).expect(200)).body as History;
  const notificationsOf = (userId: string, type: string) => db().notification.findMany({ where: { userId, type }, orderBy: { createdAt: "asc" } });

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    clock = app.get(Clock);
    sana = await signIn(app, "sana@example.com");
    bilal = await signIn(app, "bilal@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    sanaId = (await api(app, sana).get("/auth/me")).body.id;
    bilalId = (await api(app, bilal).get("/auth/me")).body.id;
    managerId = (await api(app, manager).get("/auth/me")).body.id;
    // Sana's customer, inquiry and order (Bilal, staff, sees none of them).
    const customer = (
      await api(app, sana)
        .post("/customers", { name: customerName, country: "PK", contacts: [{ name: "Ali Raza", email: `ali-${tag}@notes.test` }] })
        .expect(201)
    ).body;
    customerId = customer.id;
    contactId = (await api(app, sana).get(`/customers/${customerId}`).expect(200)).body.contacts[0].id;
    const other = (
      await api(app, manager)
        .post("/customers", { name: `Other Co ${tag}`, country: "AE", contacts: [{ name: "Omar", email: `omar-${tag}@notes.test` }] })
        .expect(201)
    ).body;
    otherContactId = (await api(app, manager).get(`/customers/${other.id}`).expect(200)).body.contacts[0].id;
    const inquiry = (
      await api(app, sana)
        .post("/inquiries", { customerId, category: "Machinery", assigneeId: sanaId, items: [{ description: "Valve", quantity: 10 }] })
        .expect(201)
    ).body;
    inquiryId = inquiry.id;
    const item = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body.items[0];
    const fq = (
      await api(app, sana)
        .post(`/inquiries/${inquiryId}/factory-quotes`, {
          newFactoryName: `Notes Valves ${tag}`,
          receivedOn: "2026-10-01",
          currency: "CNY",
          lines: [{ requestedItemId: item.id, description: "Valve", quantity: 10, unitPrice: 1000 }],
        })
        .expect(201)
    ).body;
    factoryId = fq.factoryId ?? fq.factory?.id;
    const draft = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/draft`)).body;
    const options = [{ ...draft.options[0], prices: draft.options[0].prices.map((p: Record<string, unknown>) => ({ ...p, unitPrice: 300 })) }];
    const r = (await api(app, sana).post(`/inquiries/${inquiryId}/quotation/revisions`, { ...draft, currency: "USD", options }).expect(201)).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "accepted" }).expect(200);
    const deal = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body;
    orderId = deal.orders[0].id;
    refNo = deal.orders[0].refNo;
    if (!factoryId) factoryId = (await db().party.findFirstOrThrow({ where: { ...isSupplier, name: `Notes Valves ${tag}` } })).id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
  });

  /* ---------------------------------------------------------------- inquiry notes */

  it("inquiry notes: the old body still works and answers as before; kind, contact and when are new and optional", async () => {
    const plain = await api(app, sana).post(`/inquiries/${inquiryId}/notes`, { body: "Customer wants delivery before March" }).expect(201);
    expect(plain.body).toMatchObject({ inquiryId, body: "Customer wants delivery before March", authorId: sanaId, kind: "note", contactId: null, editedAt: null });
    expect(Object.keys(plain.body)).toEqual(expect.arrayContaining(["id", "companyId", "inquiryId", "body", "authorId", "createdAt"]));
    expect(Math.abs(Date.parse(plain.body.at) - Date.parse(plain.body.createdAt))).toBeLessThan(5000);
    // As long as it always was (5,000 characters).
    await api(app, sana).post(`/inquiries/${inquiryId}/notes`, { body: "x".repeat(4500) }).expect(201);
    await api(app, sana).post(`/inquiries/${inquiryId}/notes`, { body: "x".repeat(5001) }).expect(422);
    await api(app, sana).post(`/inquiries/${inquiryId}/notes`, { body: "  " }).expect(422);

    const at = new Date(Date.now() - 3 * 3600_000).toISOString();
    const call = await api(app, sana).post(`/inquiries/${inquiryId}/notes`, { body: "Ali wants a better price", kind: "call", contactId, at }).expect(201);
    expect(call.body).toMatchObject({ kind: "call", contactId });
    expect(new Date(call.body.at).toISOString()).toBe(at);
    // Only the inquiry customer's contacts; a time in the future is refused.
    expect((await api(app, sana).post(`/inquiries/${inquiryId}/notes`, { body: "x", kind: "call", contactId: otherContactId }).expect(422)).body.fieldErrors).toHaveProperty("contactId");
    const future = new Date(Date.now() + 3600_000).toISOString();
    expect((await api(app, sana).post(`/inquiries/${inquiryId}/notes`, { body: "x", at: future }).expect(422)).body.fieldErrors).toHaveProperty("at");
    await api(app, sana).post(`/inquiries/${inquiryId}/notes`, { body: "x", kind: "fax" }).expect(422);
    // Bilal does not see Sana's inquiry.
    await api(app, bilal).post(`/inquiries/${inquiryId}/notes`, { body: "x" }).expect(404);
    await api(app, bilal).get(`/inquiries/${inquiryId}/notes`).expect(404);

    // GET /inquiries/:id still lists them (newest first), with the new fields.
    const deal = (await api(app, sana).get(`/inquiries/${inquiryId}`).expect(200)).body;
    expect(deal.notes[0]).toMatchObject({ id: call.body.id, body: "Ali wants a better price", kind: "call", contactId });
    expect(deal.people[sanaId]).toBe("Sana");
    // And like every other record's notes, by when they happened.
    const list = (await api(app, sana).get(`/inquiries/${inquiryId}/notes`).expect(200)).body as Note[];
    expect(list.map((n) => n.id)).toContain(call.body.id);
    const shown = list.find((n) => n.id === call.body.id)!;
    expect(shown).toMatchObject({
      target: { type: "inquiry", id: inquiryId },
      kind: "call",
      contact: { id: contactId, name: "Ali Raza" },
      author: { id: sanaId, name: "Sana" },
      can: { edit: true, delete: true },
    });
    expect(shown.target.label).toMatch(new RegExp(`^RFQ-\\d{4}-\\d{4} · ${customerName}$`));
    // In its history.
    const h = await history(sana, "deal", inquiryId);
    expect(h.find((e) => e.action === "note.added" && e.summary.includes("logged a call with Ali Raza"))).toBeTruthy();

    // Changed and removed through /notes/:id like the others.
    const edited = (await api(app, sana).patch(`/notes/${plain.body.id}`, { body: "Delivery before April" }).expect(200)).body as Note;
    expect(edited).toMatchObject({ body: "Delivery before April", kind: "note" });
    expect(edited.editedAt).not.toBeNull();
    await api(app, manager).patch(`/notes/${plain.body.id}`, { body: "Mine now" }).expect(403);
    await api(app, sana).delete(`/notes/${plain.body.id}`).expect(200);
    expect((await api(app, sana).get(`/inquiries/${inquiryId}`).expect(200)).body.notes.map((n: { id: string }) => n.id)).not.toContain(plain.body.id);
  });

  /* ---------------------------------------------------------------- order, customer and factory notes */

  it("order notes: whoever sees the order reads them, who moves orders adds them, the author changes them for a day", async () => {
    const at = new Date(Date.now() - 60_000).toISOString();
    const added = await api(app, sana).post(`/orders/${orderId}/notes`, { body: "Ali says the bank will pay on Thursday.", kind: "call", contactId, at }).expect(201);
    const note = added.body as Note;
    expect(note).toMatchObject({
      target: { type: "order", id: orderId, label: `${refNo} · ${customerName}` },
      kind: "call",
      body: "Ali says the bank will pay on Thursday.",
      contact: { id: contactId, name: "Ali Raza" },
      author: { id: sanaId, name: "Sana" },
      editedAt: null,
      can: { edit: true, delete: true },
    });
    expect(new Date(note.at).toISOString()).toBe(at);
    // Not given: a plain note, now.
    const plain = (await api(app, sana).post(`/orders/${orderId}/notes`, { body: "Packing list checked" }).expect(201)).body as Note;
    expect(plain).toMatchObject({ kind: "note", contact: null });

    // The checks.
    await api(app, sana).post(`/orders/${orderId}/notes`, {}).expect(422);
    await api(app, sana).post(`/orders/${orderId}/notes`, { body: "x".repeat(4001) }).expect(422);
    await api(app, sana).post(`/orders/${orderId}/notes`, { body: "x".repeat(4000) }).expect(201);
    await api(app, sana).post(`/orders/${orderId}/notes`, { body: "x", kind: "letter" }).expect(422);
    await api(app, sana).post(`/orders/${orderId}/notes`, { body: "x", contactId: otherContactId }).expect(422);
    await api(app, sana).post(`/orders/${orderId}/notes`, { body: "x", at: "yesterday" }).expect(422);
    await api(app, sana).post(`/orders/${orderId}/notes`, { body: "x", at: new Date(Date.now() + 86_400_000).toISOString() }).expect(422);

    // Listed by when it happened, the latest first.
    const list = (await api(app, manager).get(`/orders/${orderId}/notes`).expect(200)).body as Note[];
    expect(list.map((n) => n.id).indexOf(plain.id)).toBeLessThan(list.map((n) => n.id).indexOf(note.id));
    expect(list.find((n) => n.id === note.id)!.can).toEqual({ edit: false, delete: true });

    // Bilal does not see the order; a person who sees every order but cannot move them reads only.
    await api(app, bilal).get(`/orders/${orderId}/notes`).expect(404);
    await api(app, bilal).post(`/orders/${orderId}/notes`, { body: "x" }).expect(404);
    const reader = await person("Reader", ["dashboard.view", "inquiries.viewAll"]);
    expect(((await api(app, reader.token).get(`/orders/${orderId}/notes`).expect(200)).body as Note[]).length).toBeGreaterThan(1);
    await api(app, reader.token).post(`/orders/${orderId}/notes`, { body: "x" }).expect(403);
    await api(app, reader.token).delete(`/notes/${note.id}`).expect(403);

    // In the order's history (and so in its inquiry's).
    const h = await history(sana, "order", orderId);
    const entry = h.find((e) => e.action === "note.added" && e.summary.includes("Ali says the bank"));
    expect(entry?.summary).toBe(`${refNo} · ${customerName}: Sana logged a call with Ali Raza: "Ali says the bank will pay on Thursday."`);

    // The author changes it within 24 hours; nobody else; not after.
    const edited = (await api(app, sana).patch(`/notes/${note.id}`, { body: "The bank pays Friday.", kind: "whatsapp", contactId: null }).expect(200)).body as Note;
    expect(edited).toMatchObject({ body: "The bank pays Friday.", kind: "whatsapp", contact: null });
    expect(edited.editedAt).not.toBeNull();
    await api(app, sana).patch(`/notes/${note.id}`, {}).expect(422);
    await api(app, manager).patch(`/notes/${note.id}`, { body: "x" }).expect(403);
    await api(app, bilal).patch(`/notes/${note.id}`, { body: "x" }).expect(404);
    await db().note.update({ where: { id: note.id }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    expect((await api(app, sana).get(`/orders/${orderId}/notes`).expect(200)).body.find((n: Note) => n.id === note.id).can.edit).toBe(false);
    const late = await api(app, sana).patch(`/notes/${note.id}`, { body: "x" }).expect(403);
    expect(late.body.code).toBe("too_late");
    expect((await history(sana, "order", orderId)).some((e) => e.action === "note.edited")).toBe(true);

    // Removing: Bilal is told it is not there; the author removes theirs; a manager (orders.manage) anyone's.
    await api(app, bilal).delete(`/notes/${note.id}`).expect(404);
    await api(app, manager).delete(`/notes/${note.id}`).expect(200);
    await api(app, sana).delete(`/notes/${plain.id}`).expect(200);
    await api(app, sana).delete(`/notes/${plain.id}`).expect(404);
    const after = (await api(app, sana).get(`/orders/${orderId}/notes`).expect(200)).body as Note[];
    expect(after.map((n) => n.id)).not.toContain(note.id);
    expect((await history(sana, "order", orderId)).some((e) => e.action === "note.removed" && e.summary.includes("removed a note by Sana"))).toBe(true);
  });

  it("customer notes: who manages customers adds them; who deletes customers removes anyone's", async () => {
    const note = (await api(app, sana).post(`/customers/${customerId}/notes`, { body: "Asked for a second line next year", kind: "visit", contactId }).expect(201)).body as Note;
    expect(note.target).toEqual({ type: "customer", id: customerId, label: customerName });
    expect((await api(app, sana).get(`/customers/${customerId}/notes`).expect(200)).body[0].id).toBe(note.id);
    await api(app, sana).post(`/customers/${customerId}/notes`, { body: "x", contactId: otherContactId }).expect(422);
    await api(app, bilal).get(`/customers/${customerId}/notes`).expect(404);
    // Sees every customer and adds to them, but cannot delete customers: cannot remove Sana's note.
    const clerk = await person("Clerk", ["dashboard.view", "inquiries.viewAll", "customers.manage"]);
    const own = (await api(app, clerk.token).post(`/customers/${customerId}/notes`, { body: "Sent the catalogue", kind: "email" }).expect(201)).body as Note;
    await api(app, clerk.token).delete(`/notes/${note.id}`).expect(403);
    await api(app, clerk.token).delete(`/notes/${own.id}`).expect(200);
    const reader = await person("Viewer", ["dashboard.view", "inquiries.viewAll"]);
    await api(app, reader.token).get(`/customers/${customerId}/notes`).expect(200);
    await api(app, reader.token).post(`/customers/${customerId}/notes`, { body: "x" }).expect(403);
    expect((await history(manager, "customer", customerId)).some((e) => e.action === "note.added" && e.summary.includes("logged a visit with Ali Raza"))).toBe(true);
    await api(app, manager).delete(`/notes/${note.id}`).expect(200);
  });

  it("factory notes: who sees factories reads and adds them; no contact to choose; managers remove anyone's", async () => {
    const note = (await api(app, sana).post(`/factories/${factoryId}/notes`, { body: "Saw the valves on the test bench", kind: "visit" }).expect(201)).body as Note;
    expect(note.target).toEqual({ type: "factory", id: factoryId, label: `Notes Valves ${tag}` });
    expect((await api(app, sana).post(`/factories/${factoryId}/notes`, { body: "x", contactId }).expect(422)).body.fieldErrors).toHaveProperty("contactId");
    expect(((await api(app, bilal).get(`/factories/${factoryId}/notes`).expect(200)).body as Note[])[0]).toMatchObject({ id: note.id, can: { edit: false, delete: false } });
    await api(app, bilal).delete(`/notes/${note.id}`).expect(403);
    const noFactories = await person("No factories", ["dashboard.view", "inquiries.viewAll"]);
    await api(app, noFactories.token).get(`/factories/${factoryId}/notes`).expect(403);
    await api(app, noFactories.token).post(`/factories/${factoryId}/notes`, { body: "x" }).expect(403);
    await api(app, noFactories.token).delete(`/notes/${note.id}`).expect(404);
    expect((await history(manager, "factory", factoryId)).some((e) => e.action === "note.added")).toBe(true);
    await api(app, manager).delete(`/notes/${note.id}`).expect(200);
  });

  /* ---------------------------------------------------------------- follow-ups */

  it("one table for every note: each is on exactly one record", async () => {
    // A note on an inquiry, an order, a customer and a factory: four rows of the same table.
    const ids: string[] = [];
    for (const path of [`/inquiries/${inquiryId}`, `/orders/${orderId}`, `/customers/${customerId}`, `/factories/${factoryId}`])
      ids.push((await api(app, manager).post(`${path}/notes`, { body: `One table ${tag}` }).expect(201)).body.id as string);
    const rows = await db().note.findMany({ where: { id: { in: ids } }, select: { inquiryId: true, orderId: true, customerId: true, factoryId: true } });
    expect(rows.map((r) => Object.values(r).filter(Boolean).length)).toEqual([1, 1, 1, 1]);
    expect(new Set(rows.flatMap((r) => Object.values(r).filter(Boolean)))).toEqual(new Set([inquiryId, orderId, customerId, factoryId]));
    // The database refuses a note on no record, and one on two.
    const insert = (columns: string, values: string, ...args: string[]) =>
      db().$executeRawUnsafe(`insert into notes (id, body, author_id${columns}) values (gen_random_uuid(), 'x', $1::uuid${values})`, sanaId, ...args);
    await expect(insert("", "")).rejects.toThrow(/notes_one_record_check/);
    await expect(insert(", inquiry_id, order_id", ", $2::uuid, $3::uuid", inquiryId, orderId)).rejects.toThrow(/notes_one_record_check/);
  });

  it("follow-ups: added on records people see, for anyone; who it is for is told; labels and links", async () => {
    expect((await api(app, manager).get("/auth/me")).body.permissions).toContain("followups.viewAll");
    expect((await api(app, sana).get("/auth/me")).body.permissions).not.toContain("followups.viewAll");

    const today = clock.today();
    const mine = (
      await api(app, sana)
        .post("/follow-ups", { title: "Call Ali about the LC balance", kind: "call", dueOn: today, dueAt: "11:00", orderId })
        .expect(201)
    ).body as FollowUp;
    expect(mine).toMatchObject({
      title: "Call Ali about the LC balance",
      kind: "call",
      dueOn: today,
      dueAt: "11:00",
      place: null,
      target: { type: "order", id: orderId, label: `${refNo} · ${customerName}` },
      link: `/orders/${orderId}`,
      assignee: { id: sanaId, name: "Sana" },
      createdBy: { id: sanaId, name: "Sana" },
      done: false,
      doneBy: null,
      can: { edit: true, done: true, delete: true },
    });
    // Nobody is told about their own.
    expect(await db().notification.count({ where: { type: "followUp.assigned", body: { contains: refNo }, userId: sanaId } })).toBe(0);

    // The checks.
    await api(app, sana).post("/follow-ups", { title: "x", dueOn: today, orderId, customerId }).expect(422);
    await api(app, sana).post("/follow-ups", { title: "x", dueOn: today, dueAt: "25:00" }).expect(422);
    await api(app, sana).post("/follow-ups", { title: "x", dueOn: "2026-02-30" }).expect(422);
    await api(app, sana).post("/follow-ups", { title: "", dueOn: today }).expect(422);
    await api(app, sana).post("/follow-ups", { title: "x".repeat(201), dueOn: today }).expect(422);
    await api(app, sana).post("/follow-ups", { title: "x", dueOn: today, kind: "lunch" }).expect(422);
    await api(app, sana).post("/follow-ups", { title: "x", dueOn: today, place: "x".repeat(161) }).expect(422);
    await api(app, sana).post("/follow-ups", { title: "x", dueOn: today, note: "x".repeat(2001) }).expect(422);
    await api(app, sana).post("/follow-ups", { title: "x", dueOn: today, assigneeId: randomUUID() }).expect(400);
    // Only on records they see.
    await api(app, bilal).post("/follow-ups", { title: "x", dueOn: today, orderId }).expect(404);
    await api(app, bilal).post("/follow-ups", { title: "x", dueOn: today, customerId }).expect(404);

    // For someone else: they are told, with a link to the record (or to the list when it is on none).
    const forBilal = (
      await api(app, sana).post("/follow-ups", { title: "Visit the factory with Ali", kind: "visit", dueOn: addDays(today, 1), dueAt: "14:00", place: "Wenzhou", orderId, assigneeId: bilalId }).expect(201)
    ).body as FollowUp;
    expect(forBilal.assignee).toEqual({ id: bilalId, name: "Bilal" });
    const told = (await notificationsOf(bilalId, "followUp.assigned")).find((n) => n.title.includes("Visit the factory with Ali"));
    expect(told).toMatchObject({ title: "Sana gave you a follow-up: Visit the factory with Ali", link: `/orders/${orderId}` });
    expect(told!.body).toContain(`14:00 · ${refNo} · ${customerName} · Wenzhou`);
    const general = (await api(app, bilal).post("/follow-ups", { title: "Send Sana the price list", dueOn: today, assigneeId: sanaId }).expect(201)).body as FollowUp;
    expect(general).toMatchObject({ target: null, link: "/follow-ups", kind: "other" });
    expect((await notificationsOf(sanaId, "followUp.assigned")).find((n) => n.title === "Bilal gave you a follow-up: Send Sana the price list")?.link).toBe("/follow-ups");

    // Bilal does not see the order, but the follow-up is his: he reads it and ticks it.
    expect((await api(app, bilal).get(`/follow-ups/${forBilal.id}`).expect(200)).body.target.label).toBe(`${refNo} · ${customerName}`);
    expect((await api(app, bilal).get("/follow-ups?mine=true").expect(200)).body.rows.map((r: FollowUp) => r.id)).toContain(forBilal.id);
    await api(app, bilal).get(`/follow-ups?orderId=${orderId}`).expect(404);
    // But not Sana's own on the order.
    await api(app, bilal).get(`/follow-ups/${mine.id}`).expect(404);
    await api(app, bilal).post(`/follow-ups/${mine.id}/done`).expect(404);

    // A manager's own on Sana's order: Sana sees it with the order, read only.
    const managers = (await api(app, manager).post("/follow-ups", { title: "Check the LC wording", dueOn: today, orderId }).expect(201)).body as FollowUp;
    const onOrder = (await api(app, sana).get(`/follow-ups?orderId=${orderId}`).expect(200)).body as FollowUpList;
    expect(onOrder.rows.map((r) => r.id)).toEqual(expect.arrayContaining([mine.id, forBilal.id, managers.id]));
    expect(onOrder.rows.find((r) => r.id === managers.id)!.can).toEqual({ edit: false, done: false, delete: false });
    await api(app, sana).get(`/follow-ups/${managers.id}`).expect(200);
    await api(app, sana).patch(`/follow-ups/${managers.id}`, { title: "x" }).expect(403);
    await api(app, sana).post(`/follow-ups/${managers.id}/done`).expect(403);
    await api(app, sana).delete(`/follow-ups/${managers.id}`).expect(403);

    // Lists: Sana sees hers (for her or made by her); the manager everyone's.
    const sanas = (await api(app, sana).get("/follow-ups?pageSize=200").expect(200)).body as FollowUpList;
    expect(sanas.canViewAll).toBe(false);
    expect(sanas.rows.map((r) => r.id)).toEqual(expect.arrayContaining([mine.id, forBilal.id, general.id]));
    expect(sanas.rows.map((r) => r.id)).not.toContain(managers.id);
    expect(sanas.rows.every((r) => r.assignee.id === sanaId || r.createdBy.id === sanaId)).toBe(true);
    const sanaMine = (await api(app, sana).get("/follow-ups?mine=true&pageSize=200").expect(200)).body as FollowUpList;
    expect(sanaMine.rows.map((r) => r.id)).not.toContain(forBilal.id);
    const all = (await api(app, manager).get("/follow-ups?pageSize=200").expect(200)).body as FollowUpList;
    expect(all.canViewAll).toBe(true);
    expect(all.rows.map((r) => r.id)).toEqual(expect.arrayContaining([mine.id, forBilal.id, general.id, managers.id]));
    // By day.
    const tomorrow = (await api(app, manager).get(`/follow-ups?on=${addDays(today, 1)}&pageSize=200`).expect(200)).body as FollowUpList;
    expect(tomorrow.rows.map((r) => r.id)).toContain(forBilal.id);
    expect(tomorrow.rows.every((r) => r.dueOn === addDays(today, 1))).toBe(true);
    const range = (await api(app, manager).get(`/follow-ups?from=${today}&to=${today}&pageSize=200`).expect(200)).body as FollowUpList;
    expect(range.rows.every((r) => r.dueOn === today)).toBe(true);
    await api(app, manager).get("/follow-ups?on=tomorrow").expect(422);
    await api(app, manager).get(`/follow-ups?orderId=${orderId}&customerId=${customerId}`).expect(422);

    // Done, again (no change), reopened; the list by open and done.
    const done = (await api(app, bilal).post(`/follow-ups/${forBilal.id}/done`, { note: "Packing starts Monday" }).expect(200)).body as FollowUp;
    expect(done).toMatchObject({ done: true, doneBy: { id: bilalId, name: "Bilal" }, doneNote: "Packing starts Monday", late: false });
    const again = (await api(app, bilal).post(`/follow-ups/${forBilal.id}/done`, { note: "other" }).expect(200)).body as FollowUp;
    expect([again.doneAt, again.doneNote]).toEqual([done.doneAt, "Packing starts Monday"]);
    const doneList = (await api(app, sana).get(`/follow-ups?orderId=${orderId}&open=false`).expect(200)).body as FollowUpList;
    expect(doneList.rows.map((r) => r.id)).toEqual([forBilal.id]);
    expect(doneList.counts.done).toBe(1);
    expect((await api(app, sana).get(`/follow-ups?orderId=${orderId}&open=true`).expect(200)).body.rows.map((r: FollowUp) => r.id)).not.toContain(forBilal.id);
    const reopened = (await api(app, sana).post(`/follow-ups/${forBilal.id}/reopen`).expect(200)).body as FollowUp;
    expect(reopened).toMatchObject({ done: false, doneAt: null, doneBy: null, doneNote: null });
    await api(app, sana).post(`/follow-ups/${forBilal.id}/reopen`).expect(200);
    expect((await history(sana, "order", orderId)).map((e) => e.action)).toEqual(expect.arrayContaining(["follow_up.added", "follow_up.done", "follow_up.reopened"]));

    // Changing: the fields sent; a new person is told; another record (one they see).
    const moved = (await api(app, sana).patch(`/follow-ups/${mine.id}`, { dueAt: null, place: "Their office", assigneeId: bilalId, customerId }).expect(200)).body as FollowUp;
    expect(moved).toMatchObject({ title: "Call Ali about the LC balance", dueAt: null, place: "Their office", assignee: { id: bilalId }, target: { type: "customer", id: customerId, label: customerName }, link: `/customers/${customerId}` });
    expect((await notificationsOf(bilalId, "followUp.assigned")).some((n) => n.title === "Sana gave you a follow-up: Call Ali about the LC balance" && n.link === `/customers/${customerId}`)).toBe(true);
    const general2 = (await api(app, sana).patch(`/follow-ups/${mine.id}`, { customerId: null }).expect(200)).body as FollowUp;
    expect(general2).toMatchObject({ target: null, link: "/follow-ups" });
    const elsewhere = (await api(app, manager).post("/customers", { name: `Elsewhere ${tag}`, country: "KE", contacts: [{ name: "X", email: `x-${tag}@notes.test` }] }).expect(201)).body;
    await api(app, sana).patch(`/follow-ups/${mine.id}`, { customerId: elsewhere.id }).expect(404);
    await api(app, sana).patch(`/follow-ups/${mine.id}`, { orderId, customerId }).expect(422);
    await api(app, sana).patch(`/follow-ups/${mine.id}`, { title: "" }).expect(422);
    // A stranger (sees none of it) is told it is not there.
    const stranger = await person("Stranger", ["dashboard.view"]);
    await api(app, stranger.token).get(`/follow-ups/${mine.id}`).expect(404);
    await api(app, stranger.token).patch(`/follow-ups/${mine.id}`, { title: "x" }).expect(404);
    await api(app, stranger.token).delete(`/follow-ups/${mine.id}`).expect(404);
    expect((await api(app, stranger.token).get("/follow-ups").expect(200)).body.rows).toEqual([]);

    // Removing: who made it, who it is for, or a manager.
    await api(app, bilal).delete(`/follow-ups/${mine.id}`).expect(200);
    await api(app, sana).delete(`/follow-ups/${general.id}`).expect(200);
    await api(app, manager).delete(`/follow-ups/${forBilal.id}`).expect(200);
    await api(app, manager).delete(`/follow-ups/${managers.id}`).expect(200);
    await api(app, manager).get(`/follow-ups/${managers.id}`).expect(404);
  });

  it("GET /me/today: my open ones due today or before, by day and time, the late ones marked", async () => {
    const me = await person("Today", ["dashboard.view"]);
    const day = "2026-11-20";
    const tz = clock.timeZone;
    vi.spyOn(clock, "now").mockReturnValue(momentIn(day, "10:00", tz));
    expect(clock.today()).toBe(day);
    const add = async (title: string, dueOn: string, dueAt?: string) =>
      (await api(app, me.token).post("/follow-ups", { title, dueOn, ...(dueAt ? { dueAt } : {}) }).expect(201)).body as FollowUp;
    const at11 = await add("At eleven", day, "11:00");
    const yesterday = await add("Yesterday", addDays(day, -1));
    const at9 = await add("At nine", day, "09:00");
    const someTime = await add("Some time today", day);
    await add("Tomorrow", addDays(day, 1));
    const finished = await add("Finished", day, "08:00");
    await api(app, me.token).post(`/follow-ups/${finished.id}/done`).expect(200);
    // Someone else's, due today: not mine.
    await api(app, manager).post("/follow-ups", { title: "Not hers", dueOn: day }).expect(201);

    const t = (await api(app, me.token).get("/me/today").expect(200)).body as Today;
    expect(t).toMatchObject({ today: day, now: "10:00", total: 4, late: 2 });
    expect(t.rows.map((r) => [r.title, r.late])).toEqual([
      ["Yesterday", true],
      ["Some time today", false],
      ["At nine", true],
      ["At eleven", false],
    ]);
    expect(t.rows.map((r) => r.id)).toEqual([yesterday.id, someTime.id, at9.id, at11.id]);
    // The list says the same, with counts.
    const list = (await api(app, me.token).get(`/follow-ups?mine=true&to=${day}&open=true`).expect(200)).body as FollowUpList;
    expect(list.rows.map((r) => r.id)).toEqual([yesterday.id, someTime.id, at9.id, at11.id]);
    expect(list.counts).toEqual({ open: 4, done: 1, late: 2 });
    // The list's filters: only the late ones, words, who it is for, what it is about.
    const ids = async (qs: string) => ((await api(app, me.token).get(`/follow-ups?mine=true&${qs}`).expect(200)).body as FollowUpList).rows.map((r) => r.id);
    expect(await ids("late=true")).toEqual([yesterday.id, at9.id]);
    expect(await ids("q=eleven")).toEqual([at11.id]);
    expect(await ids(`who=${me.id}&open=true&to=${day}`)).toHaveLength(4);
    expect(await ids("about=order")).toEqual([]);
    expect(await ids(`about=none&open=true&to=${day}`)).toHaveLength(4);
    await api(app, me.token).get("/follow-ups?about=planet").expect(422);
    // At noon, eleven o'clock is late too.
    vi.spyOn(clock, "now").mockReturnValue(momentIn(day, "12:00", tz));
    expect(((await api(app, me.token).get("/me/today").expect(200)).body as Today).late).toBe(3);
  });

  it("reminders: on the day and 30 minutes before the time, to the person it is for, once each", async () => {
    const me = await person("Reminded", ["dashboard.view"]);
    const day = "2026-12-03";
    const tz = clock.timeZone;
    const company = await prisma.platform.company.findUniqueOrThrow({ where: { id: FIRST_COMPANY_ID } });
    const run = () => CompanyContext.run(toInfo(company), () => app.get(RemindersService).followUps());
    const setNow = (time: string, on = day) => vi.spyOn(clock, "now").mockReturnValue(momentIn(on, time, tz));
    const due = () => notificationsOf(me.id, "followUp.due");

    setNow("12:00", addDays(day, -1));
    const add = async (title: string, dueAt?: string, extra: object = {}) =>
      (await api(app, manager).post("/follow-ups", { title, dueOn: day, assigneeId: me.id, ...(dueAt ? { dueAt } : {}), ...extra }).expect(201)).body as FollowUp;
    const allDay = await add("Call Kofi", undefined, { orderId });
    const early = await add("Factory visit", "08:20", { place: "Wenzhou" });
    const later = await add("Meet the bank", "09:00");
    const finished = await add("Already done");
    await api(app, me.token).post(`/follow-ups/${finished.id}/done`).expect(200);
    // The day before: nothing yet.
    await run();
    expect(await due()).toEqual([]);

    // 08:00 on the day: the day's reminders; the 08:20 one only "in 20 min" (no day reminder on top).
    setNow("08:00");
    const sent = await run();
    // (Others' missed follow-ups are reminded in the same run: only this person's are counted below.)
    expect(sent).toBeGreaterThanOrEqual(3);
    const first = await due();
    expect(first.map((n) => n.title).sort()).toEqual(["At 08:20: Factory visit", "Today: Call Kofi", "Today: Meet the bank · 09:00"]);
    expect(first.find((n) => n.title === "Today: Call Kofi")).toMatchObject({ link: `/orders/${orderId}`, body: `${refNo} · ${customerName}` });
    expect(first.find((n) => n.title === "At 08:20: Factory visit")).toMatchObject({ link: "/follow-ups", body: "in 20 min · Wenzhou" });
    // Running again (the worker runs every few minutes, the hourly job too) sends nothing twice.
    expect(await run()).toBe(0);
    expect((await due()).length).toBe(3);

    // 08:35: half an hour before 09:00.
    setNow("08:35");
    expect(await run()).toBe(1);
    expect((await due()).at(-1)).toMatchObject({ title: "At 09:00: Meet the bank", body: "in 25 min" });
    expect(await run()).toBe(0);
    // After its time, nothing more; moving it to another time reminds again, once.
    setNow("09:10");
    expect(await run()).toBe(0);
    await api(app, me.token).patch(`/follow-ups/${later.id}`, { dueAt: "09:30" }).expect(200);
    expect(await run()).toBe(1);
    expect(await run()).toBe(0);
    // One made on the day itself gets no "today" reminder (it was just made).
    await add("Made today");
    expect(await run()).toBe(0);
    expect((await due()).every((n) => n.userId === me.id)).toBe(true);
    // Each reminder once.
    const keys = (await due()).map((n) => n.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining([`followup:${allDay.id}:day:${day}`, `followup:${early.id}:at:${day}T08:20`, `followup:${later.id}:at:${day}T09:30`]));
  });

  it("another company reaches none of it, by any route", async () => {
    const note = (await api(app, sana).post(`/orders/${orderId}/notes`, { body: "Ours" }).expect(201)).body as Note;
    const inqNote = (await api(app, sana).post(`/inquiries/${inquiryId}/notes`, { body: "Ours too" }).expect(201)).body as { id: string };
    const fu = (await api(app, sana).post("/follow-ups", { title: "Ours", dueOn: clock.today(), orderId }).expect(201)).body as FollowUp;
    const company = await prisma.platform.company.create({ data: { slug: `nf-${tag}`.slice(0, 30), name: `Notes other ${tag}` } });
    const email = `boss@nf-${tag}.test`;
    await seedCompanyBase(prisma.company(company.id), { admin: { email, name: "Boss", role: "admin", passwordHash: await bcrypt.hash(password, 10) } });
    const boss = await signIn(app, email, password);
    const b = api(app, boss);
    for (const path of [
      `/inquiries/${inquiryId}/notes`,
      `/orders/${orderId}/notes`,
      `/customers/${customerId}/notes`,
      `/factories/${factoryId}/notes`,
      `/follow-ups/${fu.id}`,
      `/follow-ups?orderId=${orderId}`,
      `/follow-ups?customerId=${customerId}`,
      `/follow-ups?factoryId=${factoryId}`,
      `/follow-ups?inquiryId=${inquiryId}`,
    ])
      await b.get(path).expect(404);
    await b.post(`/inquiries/${inquiryId}/notes`, { body: "x" }).expect(404);
    await b.post(`/orders/${orderId}/notes`, { body: "x" }).expect(404);
    await b.post(`/customers/${customerId}/notes`, { body: "x" }).expect(404);
    await b.post(`/factories/${factoryId}/notes`, { body: "x" }).expect(404);
    await b.patch(`/notes/${note.id}`, { body: "x" }).expect(404);
    await b.patch(`/notes/${inqNote.id}`, { body: "x" }).expect(404);
    await b.delete(`/notes/${note.id}`).expect(404);
    await b.delete(`/notes/${inqNote.id}`).expect(404);
    for (const target of [{ orderId }, { customerId }, { factoryId }, { inquiryId }])
      await b.post("/follow-ups", { title: "x", dueOn: "2026-01-01", ...target }).expect(404);
    await b.post("/follow-ups", { title: "x", dueOn: "2026-01-01", assigneeId: sanaId }).expect(400);
    await b.patch(`/follow-ups/${fu.id}`, { title: "x" }).expect(404);
    await b.post(`/follow-ups/${fu.id}/done`).expect(404);
    await b.post(`/follow-ups/${fu.id}/reopen`).expect(404);
    await b.delete(`/follow-ups/${fu.id}`).expect(404);
    expect((await b.get("/follow-ups").expect(200)).body.rows).toEqual([]);
    expect((await b.get("/me/today").expect(200)).body.rows).toEqual([]);

    // In the database: not seen, not changed, and no link to our rows.
    const theirs = prisma.company(company.id);
    expect(await theirs.note.findUnique({ where: { id: note.id } })).toBeNull();
    expect(await theirs.followUp.findUnique({ where: { id: fu.id } })).toBeNull();
    expect((await theirs.followUp.updateMany({ where: { id: fu.id }, data: { title: "taken" } })).count).toBe(0);
    const bossId = (await theirs.user.findFirstOrThrow({ where: { email } })).id;
    await expect(
      theirs.$executeRawUnsafe(`insert into notes (id, order_id, body, author_id) values (gen_random_uuid(), $1::uuid, 'x', $2::uuid)`, orderId, bossId),
    ).rejects.toThrow(/another company|foreign key/);
    await expect(
      theirs.$executeRawUnsafe(
        `insert into follow_ups (id, title, due_on, customer_id, assignee_id, created_by, updated_at) values (gen_random_uuid(), 'x', '2026-01-01', $1::uuid, $2::uuid, $2::uuid, now())`,
        customerId,
        bossId,
      ),
    ).rejects.toThrow(/another company|foreign key/);
    await expect(
      theirs.$executeRawUnsafe(
        `insert into follow_ups (id, title, due_on, assignee_id, created_by, updated_at) values (gen_random_uuid(), 'x', '2026-01-01', $1::uuid, $2::uuid, now())`,
        sanaId,
        bossId,
      ),
    ).rejects.toThrow(/another company|foreign key/);
    expect((await db().followUp.findUniqueOrThrow({ where: { id: fu.id } })).title).toBe("Ours");
    expect((await db().note.findUniqueOrThrow({ where: { id: note.id } })).body).toBe("Ours");
    void managerId;
  });
});
