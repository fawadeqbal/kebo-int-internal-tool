import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { messageLine, type Message } from "@kebo/shared";
import { api, signIn, startApp } from "./app";
import { PrismaService } from "../src/database/prisma.service";
import { CompanyMail } from "../src/common/notify/company-mail";
import { Clock } from "../src/common/time/clock.service";
import { renderMessageEmail } from "../src/common/notify/message-email";
import { CompanyContext } from "../src/common/company/company-context";
import { toInfo } from "../src/common/company/companies.service";
import { RemindersService } from "../src/modules/notifications/reminders.service";
import { factoryPayment, orderWaiting, paymentDue, yourDay } from "../src/modules/notifications/messages";
import type { OrderFacts } from "../src/modules/notifications/facts";
import type { MailMessage } from "../src/common/notify/mailer";

type Row = { type: string; title: string; body: string; link: string; message: Message | null };

/**
 * Every message has one shape (claude/messages-design.md): what happened, where, who it concerns, the money,
 * what to do next, and the button. The bell, the phone and the email are made from it, and the email goes to
 * the people it concerns, not only to the admin list.
 */
describe("messages", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sana: string;
  let manager: string;
  let sanaId: string;
  let managerId: string;
  let sent: MailMessage[] = [];
  const tag = Date.now().toString(36);
  const customer = `Lagos Water ${tag}`;
  const phone = `+23480${String(Date.now()).slice(-7)}`;
  const bell = async (token: string, type: string) =>
    ((await api(app, token).get("/notifications?take=200").expect(200)).body.items as Row[]).filter((n) => n.type === type && n.title.includes(tag));
  const mailTo = (email: string, subject: RegExp) => sent.filter((m) => [m.to].flat().includes(email) && subject.test(m.subject));

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    sana = await signIn(app, "sana@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    sanaId = (await api(app, sana).get("/auth/me")).body.id;
    managerId = (await api(app, manager).get("/auth/me")).body.id;
    // Email is set up: what is sent is kept here.
    vi.spyOn(app.get(CompanyMail), "mailer").mockResolvedValue({ enabled: true, send: async (m: MailMessage) => void sent.push(m) });
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
  });

  it("an email says what happened, where, who, the money, what to do next, and why you get it", () => {
    const m: Message = {
      kind: "quotation.accepted",
      group: "sales",
      tag: "Customer accepted",
      subject: "Lagos Water accepted quotation QUO-2026-0531 R1 — USD 119,500",
      sentence: "Lagos Water accepted quotation QUO-2026-0531 R1.",
      where: { ref: "RFQ-2026-0483", title: "Complete water bottling plant" },
      people: [{ label: "Customer", value: "Lagos Water · Nigeria" }],
      money: [{ label: "Order value", value: "USD 119,500 · CIF Apapa" }],
      next: "Send the proforma invoice & ask for the deposit.",
      button: "Open the sales order",
      link: "/orders/1",
      urgent: true,
    };
    const e = renderMessageEmail(m, { company: "Kebo International", origin: "https://kebo.rfq.test", at: "14 Nov 2026, 09:12", why: "who handles it" });
    expect(e.subject).toBe(m.subject);
    for (const part of ["Customer accepted", "Needs action today", "Lagos Water accepted quotation", "RFQ-2026-0483", "Who it concerns", "Lagos Water · Nigeria", "The money", "USD 119,500 · CIF Apapa", "What to do next", "Open the sales order", "You get this as who handles it.", "Kebo International"])
      expect(e.html).toContain(part);
    expect(e.html).toContain('href="https://kebo.rfq.test/orders/1"');
    // Text is escaped in the HTML.
    expect(e.html).toContain("proforma invoice &amp; ask");
    expect(e.text).toContain("What to do next: Send the proforma invoice & ask for the deposit.");
    expect(e.text).toContain("Open the sales order: https://kebo.rfq.test/orders/1");
    expect(messageLine(m)).toBe("RFQ-2026-0483 · Send the proforma invoice & ask for the deposit.");
  });

  it("follows a deal: new inquiry, quotation sent, accepted, payment in — each to the right people, by bell and email", async () => {
    sent = [];
    const managerEmail = (await prisma.company(FIRST_COMPANY_ID).user.findUniqueOrThrow({ where: { id: managerId } })).email!;
    const sanaEmail = (await prisma.company(FIRST_COMPANY_ID).user.findUniqueOrThrow({ where: { id: sanaId } })).email!;
    const customerId = (
      await api(app, sana)
        .post("/customers", { name: customer, country: "NG", contacts: [{ name: "Ade Bello", phone, email: `ade-${tag}@lw.test` }] })
        .expect(201)
    ).body.id;
    const inquiry = (
      await api(app, sana).post("/inquiries", { customerId, category: "Machinery", assigneeId: sanaId, requiredBy: "2026-12-20", items: [{ description: "Filler", quantity: 1, unit: "set" }] }).expect(201)
    ).body;

    // New inquiry: to the managers, in full.
    const [created] = await bell(manager, "inquiry.created");
    expect(created).toMatchObject({ title: `New inquiry from ${customer}: Filler`, link: `/inquiries/${inquiry.id}` });
    expect(created!.message).toMatchObject({ group: "sales", tag: "New inquiry", where: { ref: inquiry.refNo, title: "Filler · 1 item · needed by 20 Dec 2026" } });
    expect(created!.message!.people).toEqual([
      { label: "Customer", value: `${customer} · Nigeria` },
      { label: "Contact", value: `Ade Bello · ${phone} · ade-${tag}@lw.test` },
      { label: "Handled by", value: "Sana" },
    ]);
    expect(created!.body).toBe(`${inquiry.refNo} · Sana replies to the customer within a day.`);
    const mail = mailTo(managerEmail, /^New inquiry from Lagos Water/);
    expect(mail).toHaveLength(1);
    expect(mail[0]!.html).toContain("You get this as a manager.");
    expect(mail[0]!.html).toContain(`Ade Bello · ${phone}`);
    // Nobody is told about their own action.
    expect(await bell(sana, "inquiry.created")).toHaveLength(0);

    // A quotation, sent: the managers hear what was quoted.
    const item = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, {
        newFactoryName: `Jiangsu ${tag}`,
        receivedOn: "2026-11-01",
        currency: "CNY",
        lines: [{ requestedItemId: item.id, description: "Filler", quantity: 1, unitPrice: 700000 }],
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiry.id}/quotation/draft`)).body;
    const options = [{ ...draft.options[0], prices: draft.options[0].prices.map((p: Record<string, unknown>) => ({ ...p, unitPrice: 119500 })) }];
    const r = (await api(app, sana).post(`/inquiries/${inquiry.id}/quotation/revisions`, { ...draft, currency: "USD", options }).expect(201)).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent", via: "email" }).expect(200);
    const [quoted] = await bell(manager, "quotation.sent");
    expect(quoted!.title).toMatch(new RegExp(`^Quotation QUO-\\d{4}-\\d{4} R1 sent to ${customer} — USD 119,500$`));
    expect(quoted!.message!.sentence).toMatch(/^Sana sent quotation QUO-.* by email\.$/);

    // Accepted (by the manager): Sana, who handles it and made the quotation, hears it — one message, with the order's money.
    sent = [];
    await api(app, manager).post(`/revisions/${r.id}/status`, { to: "accepted", customerRef: `LW-PO-${tag}` }).expect(200);
    const order = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.orders[0] as { id: string; refNo: string };
    const [won] = await bell(sana, "quotation.accepted");
    expect(won).toMatchObject({ title: expect.stringMatching(new RegExp(`^${customer} accepted quotation QUO-.* R1 — USD 119,500$`)), link: `/orders/${order.id}` });
    expect(won!.message!.sentence).toContain(`Their order number is LW-PO-${tag}. The inquiry is won and sales order ${order.refNo} is made.`);
    expect(won!.message!.money![0]).toEqual({ label: "Order value", value: expect.stringMatching(/^USD 119,500/) });
    expect(won!.message!.money!.at(-1)).toEqual({ label: "Paid so far", value: "Nothing" });
    expect(won!.message!.next).toBe("Send the proforma invoice and ask for the deposit.");
    expect(mailTo(sanaEmail, /accepted quotation/)[0]!.html).toContain("You get this as who handles it.");
    // Not three messages for one answer.
    expect(await bell(sana, "order.created")).toHaveLength(0);

    // Money in: from whom, how much, what is still to come.
    const today = app.get(Clock).today();
    await api(app, manager).post(`/orders/${order.id}/payments`, { kind: "deposit", amount: 35850, currency: "USD", paidOn: today }).expect(201);
    const [paid] = await bell(sana, "payment.in");
    expect(paid!.title).toBe(`Payment in: USD 35,850 from ${customer} (${order.refNo})`);
    expect(paid!.message!.sentence).toBe(`${customer} paid USD 35,850 on ${order.refNo}, received ${new Date(`${today}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}.`);
    expect(paid!.message!.money).toEqual(
      expect.arrayContaining([
        { label: "Received", value: "USD 35,850" },
        { label: "Paid so far", value: "USD 35,850 of USD 119,500" },
      ]),
    );
  });

  it("reminders say who, how much and what to do, in trade words", () => {
    const o = {
      id: "o1",
      refNo: "SO-2026-0412",
      title: "Complete water bottling plant",
      currency: "USD",
      customerName: "Lagos Water",
      customer: "Lagos Water · Nigeria",
      contact: "Ade Bello · +2348035550142",
      handler: "Sana",
      factories: ["Jiangsu Filling"],
      value: "USD 119,500",
      paidSoFar: "USD 35,850 of USD 119,500",
    } as unknown as OrderFacts;
    const lateMoney = paymentDue(o, { label: "Balance", openMinor: 8365000, dueOn: "2026-12-05" }, 4);
    expect(lateMoney).toMatchObject({ tag: "Payment late", urgent: true, subject: "Late: Lagos Water has not paid USD 83,650 (balance, SO-2026-0412)", link: "/orders/o1/payment" });
    expect(lateMoney.sentence).toBe("The balance of SO-2026-0412 was due on 5 Dec 2026. It is 4 days late.");
    expect(paymentDue(o, { label: "Balance", openMinor: 8365000, dueOn: "2026-12-05" }, null).subject).toBe("Lagos Water owes USD 83,650 (balance, SO-2026-0412) by 5 Dec 2026");
    const pay = factoryPayment(o, { factory: "Jiangsu Filling", contact: "Mr Wang · WeChat wang88", currency: "CNY", owed: "760000.00", paid: "0.00" }, { label: "Advance", open: "304000.00", due: "2026-11-14", lateBy: null });
    expect(pay).toMatchObject({ tag: "Pay the factory", subject: "Pay Jiangsu Filling: CNY 304,000 advance (SO-2026-0412) — due 14 Nov 2026", button: "Pay the factory", link: "/orders/o1/factory" });
    expect(pay.money).toContainEqual({ label: "Paid to the factory", value: "CNY 0 of CNY 760,000" });
    const ready = orderWaiting(o, { title: "Ask the factory for the ready date", due: "2026-11-10", lateBy: 4 });
    expect(ready).toMatchObject({ tag: "Ready date missing", next: "Ask the factory when the goods will be ready and enter the date.", link: "/orders/o1/production", urgent: true });
    const day = yourDay("Sana Khan", [
      { title: "Missed", rows: [{ ref: "RFQ-1", party: "Lagos Water", what: "Call Ade", when: "missed 2 days", late: true }] },
      { title: "Money to collect", rows: [{ ref: "SO-1", party: "Lagos Water", what: "Balance USD 83,650", when: "due 2026-12-05" }, { ref: "SO-2", party: "Plan Foods", what: "Balance USD 41,000", when: "9 days late", late: true }] },
      { title: "Pay the factory", rows: [] },
    ]);
    expect(day).toMatchObject({ tag: "Your day", subject: "Good morning Sana: 1 missed, 2 payments to collect" });
    expect(day.tiles).toEqual([
      { value: "1", label: "missed", bad: true },
      { value: "2", label: "payments to collect", bad: false },
    ]);
    expect(day.sections!.map((x) => x.title)).toEqual(["Missed", "Money to collect"]);
  });

  it("a quotation that ends without an answer: the bell and phone at once, and the morning email lists it", async () => {
    const customerId = (await api(app, sana).post("/customers", { name: `Quiet Buyer ${tag}`, country: "KE", contacts: [{ name: "Wanjiru", email: `wq-${tag}@qb.test` }] }).expect(201)).body.id;
    const inquiry = (await api(app, sana).post("/inquiries", { customerId, category: "Machinery", assigneeId: sanaId, items: [{ description: "Capper", quantity: 1, unit: "set" }] }).expect(201)).body;
    const item = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, { newFactoryName: `Henan ${tag}`, receivedOn: "2026-11-01", currency: "CNY", lines: [{ requestedItemId: item.id, description: "Capper", quantity: 1, unitPrice: 50000 }] })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiry.id}/quotation/draft`)).body;
    const r = (await api(app, sana).post(`/inquiries/${inquiry.id}/quotation/revisions`, draft).expect(201)).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await prisma.company(FIRST_COMPANY_ID).quotationRevision.update({ where: { id: r.id }, data: { validUntil: new Date(Date.now() - 3 * 86_400_000) } });
    sent = [];
    const company = await prisma.platform.company.findUniqueOrThrow({ where: { id: FIRST_COMPANY_ID } });
    await CompanyContext.run(toInfo(company), () => app.get(RemindersService).run(true));
    const mine = ((await api(app, sana).get("/notifications?take=200").expect(200)).body.items as Row[]).filter((n) => n.type === "reminder.quotationExpired" && n.title.includes(`Quiet Buyer ${tag}`));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: expect.stringMatching(new RegExp(`^Quotation to Quiet Buyer ${tag} ended without an answer \\(QUO-`)), message: expect.objectContaining({ tag: "Quotation ended", urgent: true }) });
    // Not emailed on its own: it is in the one morning email.
    const sanaEmail = (await prisma.company(FIRST_COMPANY_ID).user.findUniqueOrThrow({ where: { id: sanaId } })).email!;
    expect(mailTo(sanaEmail, /ended without an answer/)).toHaveLength(0);
    const day = mailTo(sanaEmail, /^Good morning Sana/);
    expect(day).toHaveLength(1);
    expect(day[0]!.html).toContain("Quotations ending");
    expect(day[0]!.html).toContain(`Quiet Buyer ${tag}`);
  });
});
