import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { api, signIn, startApp } from "./app";
import { PrismaService } from "../src/database/prisma.service";
import { Clock } from "../src/common/time/clock.service";
import { CompaniesService } from "../src/common/company/companies.service";
import { CompanyContext } from "../src/common/company/company-context";
import { DocumentsService } from "../src/modules/orders/documents.service";

/**
 * Single source of truth, PR 2: papers that never move.
 *  - receipt and payment-request numbers are stored: a void, a back-dated payment or a rebuilt plan moves none;
 *  - the proforma is final when issued (a snapshot): a later route change does not move it; Make again is v2;
 *  - the buyer is frozen at the order: a customer edit reaches the papers only through "Refresh from customer";
 *  - the payment terms are worded from the route; the quotation's own text only while the route is the accepted one;
 *  - the document set never takes hand-made rows of kinds the app makes;
 *  - proformas issued before snapshots were kept are rebuilt from the data, printing what they printed.
 */
describe("papers that never move", () => {
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
  const day = (n: number) => addDays(today, n);

  type Row = { key: string; kind: string; number: string | null; ref: string | null; state: string; version: number | null; sub: string };
  const papers = async (id: string) => (await api(app, sana).get(`/orders/${id}/papers`).expect(200)).body.papers as Row[];
  const numbers = async (id: string, kind: string) => (await papers(id)).filter((p) => p.kind === kind).map((p) => p.number);
  const paperDoc = async (id: string, kind: string, q = "") => (await api(app, sana).get(`/orders/${id}/papers/${kind}/doc${q}`).expect(200)).body;
  const proforma = async (id: string, q = "") => (await api(app, sana).get(`/orders/${id}/documents/proforma${q}`).expect(200)).body;
  const asCompany = async <T>(fn: () => Promise<T>) => CompanyContext.run((await app.get(CompaniesService).byId(FIRST_COMPANY_ID))!, fn);

  /** A new deal for the customer, quoted (USD, 30% deposit, "By T/T" in the quotation's text) and accepted: its order. */
  const newOrder = async (paymentTerms = "By T/T within 7 days.") => {
    const inquiry = (
      await api(app, sana)
        .post("/inquiries", { customerId, category: "Machinery", assigneeId: me, items: [{ description: "Capsule filler", quantity: 1 }] })
        .expect(201)
    ).body;
    const item = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, {
        factoryId,
        receivedOn: day(-5),
        currency: "CNY",
        lines: [{ requestedItemId: item.id, description: "NJP-800", quantity: 1, unitPrice: 200000, taxRate: 0 }],
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiry.id}/quotation/draft`)).body;
    const r = (
      await api(app, sana)
        .post(`/inquiries/${inquiry.id}/quotation/revisions`, { ...draft, depositPercent: 30, currency: "USD", balanceTerms: "before_shipment", paymentTerms })
        .expect(201)
    ).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "accepted" }).expect(200);
    const o = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.orders[0];
    return { id: o.id as string, refNo: o.refNo as string };
  };
  const pay = async (id: string, amount: string, paidOn: string) =>
    (await api(app, manager).post(`/orders/${id}/payments`, { kind: "deposit", amount, currency: "USD", paidOn }).expect(201)).body;
  const paymentsOf = async (id: string) =>
    (await api(app, manager).get(`/orders/${id}/payments`).expect(200)).body.payments as { id: string; amount: string; voidedAt: string | null }[];
  const setCustomer = async (patch: Record<string, unknown>) => {
    const c = (await api(app, sana).get(`/customers/${customerId}`).expect(200)).body;
    await api(app, sana)
      .put(`/customers/${customerId}`, {
        name: c.name,
        country: c.country,
        address: c.address,
        taxNo: c.taxNo,
        regNo: c.regNo,
        contacts: c.contacts.map((x: Record<string, unknown>) => ({ id: x.id, name: x.name, email: x.email })),
        ...patch,
      })
      .expect(200);
  };

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    today = app.get(Clock).today();
    sana = await signIn(app, "sana@example.com");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    me = (await api(app, sana).get("/auth/me")).body.id;
    customerId = (
      await api(app, sana)
        .post("/customers", {
          name: `Steady Pharma ${tag}`,
          country: "PK",
          address: "Plot 1, Old Industrial Area, Lahore",
          contacts: [{ name: "Hina", email: `hina-${tag}@steady.test` }],
        })
        .expect(201)
    ).body.id;
    factoryId = (await api(app, sana).post("/factories", { name: `Steady Works ${tag}` }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("keeps receipt numbers through a void and a back-dated payment", async () => {
    const o = await newOrder();
    await pay(o.id, "1000.00", day(-3));
    await pay(o.id, "2000.00", day(-2));
    const tail = o.refNo.replace(/^SO-/, "");
    expect(await numbers(o.id, "payment-receipt")).toEqual([`RC-${tail}-1`, `RC-${tail}-2`]);
    const second = (await paymentsOf(o.id)).find((p) => p.amount === "2000.00")!;
    const before = await paperDoc(o.id, "payment-receipt", `?ref=${second.id}`);
    expect(before.doc.number).toBe(`RC-${tail}-2`);

    // The first one voided, then one recorded with an earlier date: RC-2 is still the 2,000, the new one is RC-3.
    const first = (await paymentsOf(o.id)).find((p) => p.amount === "1000.00")!;
    await api(app, manager).post(`/payments/${first.id}/void`, { reason: "Typed on the wrong order" }).expect(200);
    const late = await pay(o.id, "500.00", day(-10));
    const rows = (await papers(o.id)).filter((p) => p.kind === "payment-receipt");
    expect(rows.map((r) => r.number)).toEqual([`RC-${tail}-3`, `RC-${tail}-2`]);
    expect((await paperDoc(o.id, "payment-receipt", `?ref=${second.id}`)).doc.number).toBe(`RC-${tail}-2`);
    const lateId = (await paymentsOf(o.id)).find((p) => p.amount === "500.00")?.id ?? late.id;
    expect((await paperDoc(o.id, "payment-receipt", `?ref=${lateId}`)).doc.number).toBe(`RC-${tail}-3`);
  });

  it("keeps payment-request numbers when the plan is rebuilt; new rows get the next number", async () => {
    const o = await newOrder();
    const tail = o.refNo.replace(/^SO-/, "");
    expect(await numbers(o.id, "payment-request")).toEqual([`PR-${tail}-1`, `PR-${tail}-2`]);
    const plan = (await api(app, manager).get(`/orders/${o.id}/money`).expect(200)).body.plan.items as { id: string; amount: string }[];
    // The deposit paid in full: a route change keeps it (and its number); the balance is rebuilt as PR-3.
    await pay(o.id, plan[0]!.amount, day(-1));
    await api(app, sana).patch(`/orders/${o.id}/route`, { route: "letter_of_credit", lcTerms: "at_sight" }).expect(200);
    expect(await numbers(o.id, "payment-request")).toEqual([`PR-${tail}-1`, `PR-${tail}-3`]);
    // Changed by hand: the rows kept keep theirs, a new one is next.
    const now = (await api(app, manager).get(`/orders/${o.id}/money`).expect(200)).body.plan.items as { id: string; label: string; amount: string }[];
    const half = (Number(now[1]!.amount) / 2).toFixed(2);
    const rest = (Number(now[1]!.amount) - Number(half)).toFixed(2);
    await api(app, manager)
      .put(`/orders/${o.id}/payment-plan`, {
        items: [
          { id: now[0]!.id, label: now[0]!.label, amount: now[0]!.amount },
          { id: now[1]!.id, label: now[1]!.label, amount: half },
          { label: "Final part", amount: rest },
        ],
        reason: "Split as agreed",
      })
      .expect(200);
    expect(await numbers(o.id, "payment-request")).toEqual([`PR-${tail}-1`, `PR-${tail}-3`, `PR-${tail}-4`]);
  });

  it("keeps the issued proforma as it was printed when the route changes; Make again is version 2", async () => {
    const o = await newOrder();
    await api(app, sana).patch(`/orders/${o.id}/route`, { route: "informal", balanceWhen: "before_shipment" }).expect(200);
    const draft = await proforma(o.id);
    expect(draft).toMatchObject({ draft: true, number: null, final: false });
    await api(app, manager).post(`/orders/${o.id}/proforma`).expect(200);
    const issued = await proforma(o.id);
    expect(issued).toMatchObject({ draft: false, final: true, paper: { version: 1, status: "final" } });
    expect(issued.paymentSentence).toBe("Our usual payment is made by 30% Advance deposit and 70% before shipment.");
    expect(issued.paymentTermsText).toBe("By T/T within 7 days.");

    // The route changes: the issued PI still says what the customer received.
    await api(app, sana).patch(`/orders/${o.id}/route`, { route: "letter_of_credit", lcTerms: "at_sight" }).expect(200);
    const again = await proforma(o.id);
    expect(again.number).toBe(issued.number);
    expect(again.paymentSentence).toBe(issued.paymentSentence);
    expect(again.paymentTermsText).toBe("By T/T within 7 days.");
    expect(again.lines.map((l: { description: string }) => l.description)).toEqual(issued.lines.map((l: { description: string }) => l.description));
    // The order's own terms stay as accepted.
    expect((await api(app, sana).get(`/orders/${o.id}`).expect(200)).body.balanceTerms).toBe("before_shipment");

    // Make again: version 2, a draft with the same number worded from the route now; issuing it makes it final.
    await api(app, manager).post(`/orders/${o.id}/proforma`).expect(400);
    await api(app, manager).post(`/orders/${o.id}/documents/proforma/again`).expect(200);
    const v2 = await proforma(o.id);
    expect(v2).toMatchObject({ number: issued.number, draft: true, final: false, watermark: "DRAFT", paper: { version: 2, status: "draft" } });
    expect(v2.paymentSentence).toBe("Our usual payment is made by 30% Advance deposit and 70% by irrevocable letter of credit at sight.");
    expect(v2.paymentTermsText).toBeNull();
    await api(app, manager).post(`/orders/${o.id}/proforma`).expect(200);
    const final2 = await proforma(o.id);
    expect(final2).toMatchObject({ final: true, paper: { version: 2, status: "final" } });
    expect(final2.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    expect((await proforma(o.id, "?v=1")).paymentSentence).toBe(issued.paymentSentence);
    const row = (await papers(o.id)).find((p) => p.kind === "proforma")!;
    expect(row).toMatchObject({ state: "ready", version: 2, number: issued.number });
  });

  it("prints the buyer as on the order until it is refreshed from the customer, with a reason", async () => {
    const o = await newOrder();
    await setCustomer({ address: "Plot 9, New Industrial Area, Lahore", taxNo: "NTN-4455" });
    const sc = await paperDoc(o.id, "sales-contract");
    expect(sc.doc.party).toMatchObject({ address: "Plot 1, Old Industrial Area, Lahore", taxNo: null });
    const checks = (await api(app, sana).get(`/orders/${o.id}/papers/sales-contract/checks`).expect(200)).body;
    expect(checks.buyer.buyer).toMatchObject({ address: "Plot 1, Old Industrial Area, Lahore" });
    expect(checks.buyer.changes).toEqual(["address", "tax no."]);
    expect(checks.canRefreshBuyer).toBe(true);
    // The proforma issued now keeps this buyer.
    await api(app, manager).post(`/orders/${o.id}/proforma`).expect(200);

    await api(app, sana).post(`/orders/${o.id}/buyer`, {}).expect(422);
    const refreshed = (await api(app, sana).post(`/orders/${o.id}/buyer`, { reason: "Moved to the new plant" }).expect(200)).body;
    expect(refreshed).toMatchObject({ buyer: { address: "Plot 9, New Industrial Area, Lahore", taxNo: "NTN-4455", from: "customer" }, changes: [] });
    expect((await paperDoc(o.id, "sales-contract")).doc.party).toMatchObject({ address: "Plot 9, New Industrial Area, Lahore", taxNo: "NTN-4455" });
    // Final papers keep the buyer they were printed with.
    expect((await proforma(o.id)).customer).toMatchObject({ address: "Plot 1, Old Industrial Area, Lahore" });
    const h = (await api(app, manager).get(`/history?type=order&id=${o.id}`).expect(200)).body;
    const items = (Array.isArray(h) ? h : h.items) as { summary: string; reason: string | null }[];
    expect(items.find((x) => x.summary.includes("buyer on the papers refreshed"))).toMatchObject({ reason: "Moved to the new plant" });
    expect(items.find((x) => x.summary.includes("buyer on the papers refreshed"))!.summary).toContain("address, tax no.");
    await setCustomer({ address: "Plot 1, Old Industrial Area, Lahore", taxNo: null });
  });

  it("words the payment terms from the route, and the quotation's text only while it still holds", async () => {
    const o = await newOrder();
    const terms = async (kind = "sales-contract") => (await paperDoc(o.id, kind)).doc.bullets.filter((b: unknown) => typeof b === "string") as string[];
    // No route yet: as accepted, with the quotation's text.
    expect(await terms()).toEqual(
      expect.arrayContaining(["Our usual payment is made by 30% Advance deposit and 70% before shipment.", "By T/T within 7 days."]),
    );
    await api(app, sana).patch(`/orders/${o.id}/route`, { route: "informal", balanceWhen: "against_bl_copy" }).expect(200);
    expect(await terms()).toContain("Our usual payment is made by 30% Advance deposit and 70% against B/L copy.");
    expect(await terms()).not.toContain("By T/T within 7 days.");
    await api(app, sana).patch(`/orders/${o.id}/route`, { route: "letter_of_credit", lcTerms: "deferred", lcDays: 60 }).expect(200);
    const lc = "Our usual payment is made by 30% Advance deposit and 70% by irrevocable letter of credit, payable 60 days after the documents reach the buyer's bank.";
    expect(await terms()).toContain(lc);
    expect(await terms("payment-request")).toContain(lc);
    await api(app, sana).patch(`/orders/${o.id}/route`, { route: "bank_contract" }).expect(200);
    expect(await terms()).toContain("Our usual payment is made by 30% Advance deposit and 70% through the banks against the shipping documents.");

    // The Make page's check, and the choice to print the quotation's text anyway.
    const checks = (await api(app, sana).get(`/orders/${o.id}/papers/sales-contract/checks`).expect(200)).body;
    expect(checks.terms).toEqual({ quoted: "By T/T within 7 days.", route: "Bank contract, through the banks", printed: false });
    await api(app, sana).post(`/orders/${o.id}/quoted-terms`, { print: true }).expect(200);
    expect(await terms()).toContain("By T/T within 7 days.");
    expect((await api(app, sana).get(`/orders/${o.id}/papers/sales-contract/checks`).expect(200)).body.terms.printed).toBe(true);
    await api(app, sana).post(`/orders/${o.id}/quoted-terms`, { print: false }).expect(200);
    // Back to the accepted route: the quotation's text again, no check.
    await api(app, sana).patch(`/orders/${o.id}/route`, { route: "informal", balanceWhen: "before_shipment" }).expect(200);
    expect(await terms()).toContain("By T/T within 7 days.");
    expect((await api(app, sana).get(`/orders/${o.id}/papers/sales-contract/checks`).expect(200)).body.terms).toBeNull();
  });

  it("makes the packing list final once shipped and packed; Make again for a correction", async () => {
    const o = await newOrder();
    const move = (body: object) => api(app, sana).post(`/orders/${o.id}/stage`, body);
    await move({ to: "in_production", confirm: true }).expect(200);
    const goods = (await api(app, sana).get(`/orders/${o.id}`).expect(200)).body.lines.find((l: { type: string }) => l.type === "goods");
    await api(app, sana).put(`/orders/${o.id}/receipt`, { lines: [{ lineId: goods.id, receivedQty: 1 }] }).expect(200);
    await api(app, sana)
      .put(`/orders/${o.id}/packing`, { containerNo: "MSKU 100200-3", lines: [{ lineId: goods.id, packages: "2", packageType: "Wooden case", grossWeightKg: "900" }] })
      .expect(200);
    const pl = async (q = "") => (await api(app, sana).get(`/orders/${o.id}/documents/packing-list${q}`).expect(200)).body;
    expect(await pl()).toMatchObject({ final: false, paper: null, watermark: null });
    await move({ to: "shipped", confirm: true, shippedOn: today, blNo: "MEDU123" }).expect(200);
    const shipped = await pl();
    expect(shipped).toMatchObject({ final: true, paper: { version: 1, status: "final", rebuiltOn: null }, order: { blNo: "MEDU123" } });
    // The B/L corrected afterwards: the packing list printed stays as it was; version 2 takes the correction.
    await api(app, sana).patch(`/orders/${o.id}/details`, { blNo: "MEDU124", reason: "Typo on the B/L" }).expect(200);
    expect((await pl()).order.blNo).toBe("MEDU123");
    await api(app, manager).post(`/orders/${o.id}/documents/packing-list/again`).expect(200);
    expect(await pl()).toMatchObject({ final: false, watermark: "DRAFT", order: { blNo: "MEDU124" }, paper: { version: 2, status: "draft" } });
    await api(app, manager).post(`/orders/${o.id}/documents/packing-list/final`).expect(200);
    expect(await pl()).toMatchObject({ final: true, order: { blNo: "MEDU124" }, paper: { version: 2 } });
    expect((await pl("?v=1")).order.blNo).toBe("MEDU123");
    await api(app, manager).delete(`/orders/${o.id}/documents/packing-list/draft`).expect(400);
  });

  it("refuses hand-made rows of the papers the app makes", async () => {
    const o = await newOrder();
    for (const kind of ["proforma_invoice", "packing_list", "sales_contract", "commercial_invoice"]) {
      const res = await api(app, manager).post(`/orders/${o.id}/document-set`, { kind, status: "ready", number: "X-1" }).expect(400);
      expect(res.body.error).toMatch(/made by the app/);
    }
    await api(app, manager).post(`/orders/${o.id}/document-set`, { kind: "certificate_of_origin", status: "ready", number: "CO-1" }).expect(201);
    const flow = (await api(app, manager).get(`/orders/${o.id}/flow`).expect(200)).body;
    expect(JSON.stringify(flow)).not.toContain("X-1");
  });

  it("rebuilds the snapshot of a proforma issued before snapshots were kept, printing what it printed", async () => {
    const o = await newOrder();
    await api(app, manager).post(`/orders/${o.id}/proforma`).expect(200);
    const printed = await proforma(o.id);
    // As before this change: issued, no version kept.
    await asCompany(() => prisma.db.orderPaper.deleteMany({ where: { orderId: o.id, kind: "proforma" } }));
    expect(await app.get(DocumentsService).rebuildAll()).toBeGreaterThanOrEqual(1);
    const rebuilt = await proforma(o.id);
    expect(rebuilt).toMatchObject({ final: true, paper: { version: 1, rebuiltOn: today } });
    const strip = (d: Record<string, unknown>) => ({ ...d, paper: null, versions: null, rebuiltOn: null });
    expect(strip(rebuilt)).toEqual(strip(printed));
    expect((await papers(o.id)).find((p) => p.kind === "proforma")!.sub).toContain(`rebuilt from the data on ${today}`);
    // Run again: nothing more to do for it.
    await app.get(DocumentsService).rebuildAll();
    expect((await proforma(o.id)).versions).toHaveLength(1);
  });
});
