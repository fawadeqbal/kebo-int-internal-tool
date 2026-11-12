import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIRST_COMPANY_ID } from "@kebo/database";
import { PAPER_KINDS, paperNumber, STEP_OF_ACTION } from "@kebo/shared";
import { api, signIn, startApp } from "./app";
import { PrismaService } from "../src/database/prisma.service";
import { CompaniesService } from "../src/common/company/companies.service";

/**
 * Order flow v3, papers: the app makes papers from the order in one template.
 * Numbers follow the order; a draft becomes final once its data is in (typed on
 * the Make page, saved where it belongs); final keeps a snapshot that never
 * changes, sets the document set's paper to ready (ticking the checklist) and
 * "Make again" starts version 2. Making needs documents.manage; bank papers need
 * their module and route; the purchase order needs sourcing.manage.
 */
describe("order papers", () => {
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
  let refNo: string;
  const tag = Date.now().toString(36);
  const password = "Person@12345";
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  type Check = { key: string; ok: boolean; required: boolean; fix: string | null; value: string };
  type Checks = {
    number: string;
    state: string;
    ready: boolean;
    canMake: boolean;
    checks: Check[];
    hsLines: { id: string; description: string }[];
    options: { key: string; on: boolean }[];
    paper: { id: string; version: number; status: string; number: string } | null;
    versions: { version: number; status: string }[];
  };
  type Row = {
    key: string;
    kind: string;
    state: string;
    step: string;
    number: string | null;
    inSet: boolean;
    makeable: boolean;
    doc: { status: string } | null;
  };
  const checks = async (kind: string, who = sana) =>
    (await api(app, who).get(`/orders/${orderId}/papers/${kind}/checks`).expect(200)).body as Checks;
  const list = async (who = sana) =>
    (await api(app, who).get(`/orders/${orderId}/papers`).expect(200)).body as { canMake: boolean; papers: Row[] };
  const doc = async (kind: string, q = "") => (await api(app, sana).get(`/orders/${orderId}/papers/${kind}/doc${q}`).expect(200)).body;
  const steps = async () =>
    (await api(app, sana).get(`/orders/${orderId}/steps`).expect(200)).body as {
      items: { key: string | null; title: string; done: boolean; id: string | null }[];
    };
  const modulesOff = async (off: string[]) => {
    await prisma.platform.company.update({ where: { id: FIRST_COMPANY_ID }, data: { featuresOff: off } });
    app.get(CompaniesService).forget(FIRST_COMPANY_ID);
  };

  beforeAll(async () => {
    app = await startApp();
    prisma = app.get(PrismaService);
    sana = await signIn(app, "sana@example.com");
    bilal = await signIn(app, "bilal@example.com");
    admin = await signIn(app, "admin@example.com", "Admin@12345");
    manager = await signIn(app, "manager@example.com", "Manager@12345");
    me = (await api(app, sana).get("/auth/me")).body.id;
    await modulesOff([]);
    customerId = (
      await api(app, sana)
        .post("/customers", {
          name: `Papers Pharma ${tag}`,
          country: "PK",
          address: "Sundar Industrial Estate, Lahore",
          contacts: [{ name: "Ali", email: `ali-${tag}@pp.test` }],
        })
        .expect(201)
    ).body.id;
    factoryId = (
      await api(app, sana)
        .post("/factories", { name: `Papers Works ${tag}`, address: "Ningbo" })
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
    if (prisma) await modulesOff([]);
    await app?.close();
  });

  it("numbers follow the order's", () => {
    expect(paperNumber("SO-2026-0031", "commercial-invoice")).toBe("CI-2026-0031");
    expect(paperNumber("SO-2026-0031", "sales-contract")).toBe("SC-2026-0031");
    expect(paperNumber("SO-2026-0031", "payment-receipt", 2)).toBe("RC-2026-0031-2");
    expect(paperNumber("SO-2026-0031", "sat-certificate")).toBe("SAT-2026-0031");
    expect(STEP_OF_ACTION("paper.final", { step: "shipping" })).toBe("shipping");
  });

  it("lists the order's papers with where each stands", async () => {
    const l = await list();
    expect(l.canMake).toBe(true);
    const ci = l.papers.find((p) => p.kind === "commercial-invoice")!;
    expect(ci).toMatchObject({ step: "shipping", state: "wait", number: refNo.replace(/^SO-/, "CI-"), makeable: true });
    // The route comes from the quotation's terms: the contract can be made at once.
    expect(l.papers.find((p) => p.kind === "sales-contract")).toMatchObject({ step: "payment", state: "can" });
    // A purchase order has its own number (PO-YYYY-NNNN, one per supplier), on the list and on the paper.
    expect(l.papers.find((p) => p.kind === "purchase-order")).toMatchObject({ step: "factory", number: expect.stringMatching(/^PO-\d{4}-\d{4,}$/) });
    expect(l.papers.find((p) => p.kind === "proforma")).toMatchObject({ step: "payment" });
    // LC papers only on an LC order; receipts only for payments made.
    expect(l.papers.find((p) => p.kind === "bill-of-exchange")).toBeUndefined();
    expect(l.papers.find((p) => p.kind === "payment-receipt")).toBeUndefined();
    // Someone who does not handle the deal does not see the order or its papers.
    await api(app, bilal).get(`/orders/${orderId}/papers`).expect(404);
    await api(app, bilal).get(`/orders/${orderId}/papers/commercial-invoice/doc`).expect(404);
  });

  it("the Make page: checks, missing data typed there and saved where it belongs, then final", async () => {
    await api(app, sana).patch(`/orders/${orderId}/route`, { route: "letter_of_credit" }).expect(200);
    await api(app, sana)
      .post(`/orders/${orderId}/shipments`, {
        mode: "sea",
        status: "booked",
        forwarder: "Sino Trans",
        portOfLoading: "Ningbo",
        portOfDischarge: "Karachi",
        etd: day(5),
      })
      .expect(201);
    let c = await checks("commercial-invoice");
    expect(c.state).toBe("wait");
    expect(c.checks.find((x) => x.key === "blNo")).toMatchObject({ ok: false, required: true, fix: "blNo" });
    expect(c.checks.find((x) => x.key === "lc")).toMatchObject({ ok: false, fix: "lcNo" });
    expect(c.options.map((o) => o.key)).toEqual(["prices", "showHs", "lcStatement", "advance", "stamp"]);
    // The preview is a draft, with "needed" where data is missing.
    let d = await doc("commercial-invoice");
    expect(d.watermark).toBe("DRAFT");
    expect(d.doc.meta).toEqual([
      { label: "LC No.", value: null },
      { label: "B/L No.", value: null },
    ]);
    expect(d.doc.rows[0].item.item).toContain("DPP-260");
    expect(d.doc.columns.map((x: { key: string }) => x.key)).toEqual(["no", "item", "qty", "amount"]);

    // Save as draft; final is refused while data is missing.
    const saved = (
      await api(app, sana)
        .post(`/orders/${orderId}/papers/commercial-invoice`, { options: { stamp: true } })
        .expect(201)
    ).body as Checks;
    expect(saved.paper).toMatchObject({ version: 1, status: "draft", number: refNo.replace(/^SO-/, "CI-") });
    const refused = await api(app, sana).post(`/papers/${saved.paper!.id}/final`, {}).expect(400);
    expect(refused.body.error).toMatch(/b\/l number/i);

    // Typed on the Make page: saved on the shipment, the LC and the order line.
    await api(app, sana).post(`/orders/${orderId}/papers/commercial-invoice/fix`, { field: "blNo", value: "COSU6281734510" }).expect(200);
    await api(app, sana).post(`/orders/${orderId}/papers/commercial-invoice/fix`, { field: "vessel", value: "MSC Aurora" }).expect(200);
    await api(app, sana).post(`/orders/${orderId}/papers/commercial-invoice/fix`, { field: "lcNo", value: "LC/HBL/2026/118" }).expect(200);
    c = await checks("commercial-invoice");
    expect(c.hsLines).toHaveLength(1);
    await api(app, sana)
      .post(`/orders/${orderId}/papers/commercial-invoice/fix`, { field: "hs", value: "abc", lineId: c.hsLines[0]!.id })
      .expect(400);
    c = (
      await api(app, sana)
        .post(`/orders/${orderId}/papers/commercial-invoice/fix`, { field: "hs", value: "8422.40", lineId: c.hsLines[0]!.id })
        .expect(200)
    ).body;
    expect(c.ready).toBe(true);
    const flow = (await api(app, sana).get(`/orders/${orderId}/flow`).expect(200)).body;
    expect(flow.shipping.shipments[0]).toMatchObject({ blNo: "COSU6281734510", vessel: "MSC Aurora" });
    expect(flow.payment.bankContract).toMatchObject({ number: "LC/HBL/2026/118" });

    d = await doc("commercial-invoice", "?opts=prices,showHs,lcStatement");
    expect(d.doc.columns.map((x: { key: string }) => x.key)).toEqual(["no", "item", "hs", "qty", "amount"]);
    expect(d.doc.company.stamp).toBeNull();
    expect(d.doc.bullets.at(-1)).toContain("LC/HBL/2026/118");

    const done = (await api(app, sana).post(`/papers/${saved.paper!.id}/final`, {}).expect(200)).body as Checks;
    expect(done).toMatchObject({ state: "ready", paper: { status: "final", version: 1 } });
    // The document set's paper is ready, made by the app, and its checklist item ticks.
    const row = await prisma.company(FIRST_COMPANY_ID).orderDocument.findFirst({ where: { orderId, kind: "commercial_invoice" } });
    expect(row).toMatchObject({ status: "ready", number: saved.paper!.number, paperId: saved.paper!.id });
    expect((await steps()).items.find((i) => i.key === "doc:commercial_invoice")).toMatchObject({ done: true });
    expect((await list()).papers.find((p) => p.kind === "commercial-invoice")).toMatchObject({ state: "ready" });
    // It is in the order's history under Shipping.
    const history = (await api(app, sana).get(`/history?type=order&id=${orderId}&step=shipping`).expect(200)).body;
    expect(JSON.stringify(history)).toContain("made final");
    // Final once only; a draft cannot be saved over it.
    await api(app, sana).post(`/papers/${saved.paper!.id}/final`, {}).expect(400);
    await api(app, sana).post(`/orders/${orderId}/papers/commercial-invoice`, { options: {} }).expect(400);
  });

  it("a final paper keeps its snapshot when the order changes; Make again starts version 2", async () => {
    const before = await doc("commercial-invoice");
    expect(before).toMatchObject({ final: true, watermark: null });
    await api(app, sana).post(`/orders/${orderId}/papers/commercial-invoice/fix`, { field: "blNo", value: "COSU-NEW-1" }).expect(200);
    const after = await doc("commercial-invoice");
    expect(after.doc).toEqual(before.doc);
    expect(after.doc.meta[1]).toEqual({ label: "B/L No.", value: "COSU6281734510" });

    const again = (await api(app, sana).post(`/orders/${orderId}/papers/commercial-invoice/again`, {}).expect(201)).body as Checks;
    expect(again.paper).toMatchObject({ version: 2, status: "draft", number: before.doc.number });
    expect(again.versions.map((v) => v.status)).toEqual(["final", "draft"]);
    const v2 = await doc("commercial-invoice");
    expect(v2).toMatchObject({ final: false, watermark: "DRAFT" });
    expect(v2.doc.meta[1]).toEqual({ label: "B/L No.", value: "COSU-NEW-1" });
    expect((await doc("commercial-invoice", "?v=1")).doc).toEqual(before.doc);
    await api(app, sana).get(`/orders/${orderId}/papers/commercial-invoice/doc?v=9`).expect(404);
    await api(app, sana).post(`/orders/${orderId}/papers/commercial-invoice/again`, {}).expect(400);
    await api(app, sana).post(`/papers/${again.paper!.id}/final`, {}).expect(200);
    // The document row now points at version 2; the checklist stays ticked.
    const row = await prisma.company(FIRST_COMPANY_ID).orderDocument.findFirst({ where: { orderId, kind: "commercial_invoice" } });
    expect(row).toMatchObject({ status: "ready", paperId: again.paper!.id });
    expect(await prisma.company(FIRST_COMPANY_ID).orderDocument.count({ where: { orderId, kind: "commercial_invoice" } })).toBe(1);
  });

  it("an own Send item for the shipping advice ticks when it is made final", async () => {
    const advice = (await steps()).items.find((i) => i.title === "Shipping advice to the customer")!;
    expect(advice).toMatchObject({ done: false });
    const c = await checks("shipping-advice");
    expect(c.ready).toBe(true);
    const saved = (await api(app, sana).post(`/orders/${orderId}/papers/shipping-advice`, {}).expect(201)).body as Checks;
    await api(app, sana).post(`/papers/${saved.paper!.id}/final`, {}).expect(200);
    expect((await steps()).items.find((i) => i.id === advice.id)).toMatchObject({ done: true });
  });

  it("every paper renders for the order (or says why not)", async () => {
    await api(app, manager)
      .post(`/orders/${orderId}/payments`, {
        kind: "deposit",
        amount: 1000,
        currency: (await api(app, sana).get(`/orders/${orderId}`)).body.currency,
        paidOn: day(-1),
      })
      .expect(201);
    const l = await list();
    const receipt = l.papers.find((p) => p.kind === "payment-receipt")!;
    expect(receipt).toMatchObject({ state: "ready", number: `${refNo.replace(/^SO-/, "RC-")}-1` });
    for (const kind of PAPER_KINDS) {
      const res = await api(app, sana).get(
        `/orders/${orderId}/papers/${kind}/doc${kind === "payment-receipt" ? `?ref=${receipt.key.split(":")[1]}` : ""}`,
      );
      expect(res.status, `${kind}: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(200);
      expect(res.body.doc.kind).toBe(kind);
      expect(res.body.doc.company.name).toBeTruthy();
      expect(res.body.doc.party.name).toBeTruthy();
      expect(Array.isArray(res.body.doc.rows)).toBe(true);
      const c = await api(app, sana).get(`/orders/${orderId}/papers/${kind}/checks`);
      expect(c.status, kind).toBe(200);
    }
    const po = await doc("purchase-order");
    expect(po.doc.party.name).toBe(`Papers Works ${tag}`);
    expect(po.doc.number).toBe(l.papers.find((p) => p.kind === "purchase-order")!.number);
    expect(po.doc.total).toMatchObject({ currency: "CNY", amount: "300000.00" });
    // The tax follows the prices frozen on the order: 0% says nothing about tax.
    const taxBullets = (d: { doc: { bullets: unknown[] } }) => d.doc.bullets.filter((b) => typeof b === "string" && /tax/i.test(b));
    expect(taxBullets(po)).toEqual([]);
    expect(po.doc.sums).toEqual([]);
    const freeze = (rate: number, included: boolean) =>
      prisma.company(FIRST_COMPANY_ID).orderLine.updateMany({ where: { orderId, factoryId }, data: { factoryTaxRate: rate, factoryTaxIncluded: included } });
    try {
      // Without tax at 13%: the tax is added on top, and the total is what we owe the factory.
      await freeze(13, false);
      const added = await doc("purchase-order");
      expect(taxBullets(added)).toEqual(["Prices are without tax; 13% tax is added on top."]);
      expect(added.doc.sums).toEqual([
        { label: "Total without tax", value: { money: "300000.00", currency: "CNY" } },
        { label: "Tax 13%", value: { money: "39000.00", currency: "CNY" } },
      ]);
      expect(added.doc.total).toMatchObject({ label: "Total with tax", amount: "339000.00", currency: "CNY" });
      expect((await api(app, sana).get(`/orders/${orderId}/money`).expect(200)).body.factories.rows[0].owed).toBe("339000.00");
      // Tax included: the prices are the total, the tax is only said.
      await freeze(13, true);
      const included = await doc("purchase-order");
      expect(taxBullets(included)).toEqual(["Prices include 13% tax."]);
      expect(included.doc.sums).toEqual([]);
      expect(included.doc.total).toMatchObject({ label: "Total", amount: "300000.00" });
      expect((await api(app, sana).get(`/orders/${orderId}/money`).expect(200)).body.factories.rows[0].owed).toBe("300000.00");
    } finally {
      await freeze(0, false);
    }
    const receiptDoc = await doc("payment-receipt", `?ref=${receipt.key.split(":")[1]}`);
    // Kept when the payment was recorded: the copy, never a draft.
    expect(receiptDoc).toMatchObject({ live: false, kept: true, final: true, watermark: null });
    expect(receiptDoc.doc.total).toMatchObject({ label: "Received", amount: "1000.00" });
    // The commercial invoice was made final before any money came in: it keeps what it said. Made now, it takes
    // what was received off its total and says what is left to pay; the option switches that off.
    expect((await doc("commercial-invoice")).doc.under ?? []).toEqual([]);
    const invoiceNow = await doc("commercial-invoice", "?opts=prices,advance");
    const invoiceTotal = Number(invoiceNow.doc.total.amount);
    expect(invoiceNow.doc.under).toEqual([
      { label: "Less: advance received", value: { money: "-1000.00", currency: invoiceNow.doc.total.currency } },
      { label: "Balance payable", value: { money: (invoiceTotal - 1000).toFixed(2), currency: invoiceNow.doc.total.currency } },
    ]);
    expect((await doc("commercial-invoice", "?opts=prices")).doc.under).toEqual([]);
    // Without the line amounts there is no total to take it from.
    expect((await doc("commercial-invoice", "?opts=advance")).doc.under).toEqual([]);
    // Kept papers are never drafts.
    await api(app, sana).post(`/orders/${orderId}/papers/payment-receipt`, {}).expect(400);
  });

  it("permissions, modules and routes", async () => {
    // A role without documents.manage or sourcing.manage sees papers but makes none, and never the purchase order.
    const role = (
      await api(app, admin)
        .post("/roles", { name: `Papers viewer ${tag}`, permissions: ["dashboard.view", "inquiries.viewAll"] })
        .expect(201)
    ).body;
    const email = `papers-${tag}@example.com`;
    await api(app, admin).post("/users", { name: "Papers viewer", email, role: role.key, password }).expect(201);
    const viewer = await signIn(app, email, password);
    const l = await list(viewer);
    expect(l.canMake).toBe(false);
    expect(l.papers.find((p) => p.kind === "purchase-order")).toBeUndefined();
    await api(app, viewer).get(`/orders/${orderId}/papers/purchase-order/doc`).expect(403);
    await api(app, viewer).get(`/orders/${orderId}/papers/sales-contract/doc`).expect(200);
    await api(app, viewer).post(`/orders/${orderId}/papers/sales-contract`, {}).expect(403);
    await api(app, viewer)
      .post(`/orders/${orderId}/papers/commercial-invoice/fix`, {
        field: "hs",
        value: "8422",
        lineId: (await checks("commercial-invoice")).paper!.id,
      })
      .expect(403);

    // Bank papers: the LC route has them; without the module they are refused.
    expect((await list()).papers.find((p) => p.kind === "bill-of-exchange")).toMatchObject({ inSet: true, step: "documents" });
    await api(app, sana).get(`/orders/${orderId}/papers/bill-of-exchange/doc`).expect(200);
    await modulesOff(["bank_documents"]);
    try {
      expect((await list()).papers.find((p) => p.kind === "bill-of-exchange")).toBeUndefined();
      const refused = await api(app, sana).get(`/orders/${orderId}/papers/bill-of-exchange/doc`).expect(403);
      expect(refused.body.code).toBe("plan_feature");
      // The other papers are core: still made without the module.
      await api(app, sana).get(`/orders/${orderId}/papers/sales-contract/checks`).expect(200);
      expect((await api(app, sana).get("/auth/me")).body.permissions).toContain("documents.manage");
    } finally {
      await modulesOff([]);
    }
    await api(app, sana).patch(`/orders/${orderId}/route`, { route: "informal" }).expect(200);
    await api(app, sana).get(`/orders/${orderId}/papers/bill-of-exchange/doc`).expect(400);
    await api(app, sana).patch(`/orders/${orderId}/route`, { route: "letter_of_credit" }).expect(200);
  });

  it("papers others issue can be kept elsewhere, and count as done", async () => {
    await api(app, sana).post(`/orders/${orderId}/document-set`, { kind: "certificate_of_origin", status: "elsewhere" }).expect(400);
    await api(app, sana)
      .post(`/orders/${orderId}/document-set`, {
        kind: "certificate_of_origin",
        status: "elsewhere",
        keptWhere: "Office file, shelf 3",
        number: "CO-77",
        issuedOn: day(0),
      })
      .expect(201);
    expect((await steps()).items.find((i) => i.key === "doc:certificate_of_origin")).toMatchObject({ done: true });
    const co = (await list()).papers.find((p) => p.kind === "certificate_of_origin")!;
    expect(co).toMatchObject({ state: "else", inSet: true, doc: { status: "elsewhere" } });
    expect((await list()).papers.find((p) => p.kind === "bill_of_lading")).toMatchObject({
      state: "miss",
      source: "upload",
      step: "shipping",
    });
  });

  it("Settings › Papers we use: every paper starts on; one switched off leaves the lists, counts, checklist and warnings, unless already made", async () => {
    // Nothing is hidden by default.
    expect((await api(app, sana).get("/settings").expect(200)).body.papers).toEqual({ off: [] });
    const kinds = async () => (await list()).papers.map((p) => p.kind);
    const before = await kinds();
    expect(before).toEqual(
      expect.arrayContaining(["bill-of-exchange", "beneficiary-certificate", "bank-cover-letter", "insurance", "customer-statement", "commercial-invoice", "certificate_of_origin"]),
    );
    const docItems = async () => (await steps()).items.filter((i) => i.key?.startsWith("doc:")).map((i) => i.key);
    expect(await docItems()).toEqual(expect.arrayContaining(["doc:insurance", "doc:commercial_invoice", "doc:certificate_of_origin"]));
    const flow = async () =>
      (await api(app, sana).get(`/orders/${orderId}/flow`).expect(200)).body as {
        steps: { key: string; sub: string }[];
        documents: { set: { kind: string; required: boolean }[] } | null;
      };
    const papersLine = async () => (await flow()).steps.find((x) => x.key === "documents")!.sub;
    const requiredBefore = Number(/of (\d+) papers/.exec(await papersLine())![1]);

    // Only people with settings.manage switch papers.
    await api(app, sana).put("/settings/papers", { off: ["insurance"] }).expect(403);
    try {
      const saved = (
        await api(app, admin)
          .put("/settings/papers", {
            off: ["bill-of-exchange", "insurance", "customer-statement", "commercial-invoice", "certificate_of_origin", "not-a-paper", "insurance"],
          })
          .expect(200)
      ).body;
      expect(saved).toEqual({ off: ["bill-of-exchange", "insurance", "customer-statement", "commercial-invoice", "certificate_of_origin"] });
      const after = await kinds();
      // Switched off and never made: gone from the list.
      for (const k of ["bill-of-exchange", "insurance", "customer-statement"]) expect(after).not.toContain(k);
      // The other LC papers are ordinary switches, still on.
      expect(after).toEqual(expect.arrayContaining(["beneficiary-certificate", "bank-cover-letter"]));
      // Made (final commercial invoice) or recorded (certificate of origin kept elsewhere): still shown.
      expect(after).toEqual(expect.arrayContaining(["commercial-invoice", "certificate_of_origin"]));
      // The checklist: the switched-off paper that is not in leaves the Documents step; the ones in stay.
      const items = await docItems();
      expect(items).not.toContain("doc:insurance");
      expect(items).toEqual(expect.arrayContaining(["doc:commercial_invoice", "doc:certificate_of_origin"]));
      // The step's numbers: one paper fewer to wait for.
      expect(Number(/of (\d+) papers/.exec(await papersLine())![1])).toBe(requiredBefore - 1);
      expect((await flow()).documents!.set.find((d) => d.kind === "insurance")?.required ?? false).toBe(false);
      // The papers stay reachable for whoever opens one directly (and for older apps).
      await api(app, sana).get(`/orders/${orderId}/papers/bill-of-exchange/doc`).expect(200);
    } finally {
      await api(app, admin).put("/settings/papers", { off: [] }).expect(200);
    }
    expect(await kinds()).toEqual(expect.arrayContaining(["bill-of-exchange", "insurance", "customer-statement"]));
  });

  it("order_papers is a company table", async () => {
    const [row] = await prisma.platform.$queryRawUnsafe<{ rls: boolean; policies: bigint }[]>(
      `select c.relrowsecurity as rls, (select count(*) from pg_policies p where p.tablename = c.relname) as policies from pg_class c where c.relname = 'order_papers'`,
    );
    expect(row).toMatchObject({ rls: true });
    expect(Number(row!.policies)).toBe(1);
    // Another company sees none of them.
    const other = await prisma.platform.company.findFirst({ where: { id: { not: FIRST_COMPANY_ID } }, select: { id: true } });
    if (other) expect(await prisma.company(other.id).orderPaper.count({ where: { orderId } })).toBe(0);
    expect(await prisma.company(FIRST_COMPANY_ID).orderPaper.count({ where: { orderId } })).toBeGreaterThan(0);
  });
});
