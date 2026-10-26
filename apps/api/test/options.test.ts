import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

type Line = { no: string; description: string; model?: string | null; type: string };

/**
 * Step 2b: what we sell is the factories' lines, not the customer's wording.
 * A quotation offers whole factory offers as options A, B…; the customer
 * accepts exactly one, and the order is that option's lines.
 */
describe("quotation options from factory offers", () => {
  let app: INestApplication;
  let sana: string;
  let bilal: string;
  let inquiryId: string;
  let offerX: string;
  let offerY: string;
  let revisionId: string;
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    bilal = await signIn(app, "bilal@example.com");
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const customer = (
      await api(app, sana)
        .post("/customers", { name: `Kampala Juices ${tag}`, country: "UG", contacts: [{ name: "Grace", email: `g-${tag}@kj.test` }] })
        .expect(201)
    ).body;
    inquiryId = (
      await api(app, sana)
        .post("/inquiries", {
          customerId: customer.id,
          category: "Machinery",
          assigneeId: me,
          items: [
            { description: "Steam boiler 1 t/h", quantity: 1, unit: "set" },
            { description: "Juice filling line 4000 bph", quantity: 1, unit: "set" },
          ],
        })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  const items = async () => (await api(app, sana).get(`/inquiries/${inquiryId}`)).body.items as { id: string }[];

  it("keeps each factory's own lines, models and parts, and says which items an offer covers", async () => {
    const [boiler, line] = await items();
    const x = {
      newFactoryName: `Zhangjiagang Complete ${tag}`,
      receivedOn: "2026-10-20",
      currency: "CNY",
      leadTime: "45 days",
      lines: [
        { requestedItemId: boiler!.id, description: "Steam boiler", model: "WNS1-1.0", quantity: 1, unit: "set", unitPrice: 50000 },
        { requestedItemId: line!.id, description: "Juice filling line", quantity: 1, unit: "set", unitPrice: 0 },
        {
          requestedItemId: line!.id,
          partOf: 1,
          description: "Rinsing-filling-capping monoblock",
          model: "RFC-24",
          quantity: 1,
          unit: "set",
          unitPrice: 300000,
        },
        {
          requestedItemId: line!.id,
          partOf: 1,
          description: "Shrink wrapper",
          model: "SW-450",
          quantity: 1,
          unit: "set",
          unitPrice: 80000,
        },
      ],
    };
    // A part of a part, or of a line below it, is refused.
    await api(app, sana)
      .post(`/inquiries/${inquiryId}/factory-quotes`, { ...x, lines: [x.lines[0], { ...x.lines[2], partOf: 2 }] })
      .expect(400);
    offerX = (await api(app, sana).post(`/inquiries/${inquiryId}/factory-quotes`, x).expect(201)).body.id;
    offerY = (
      await api(app, sana)
        .post(`/inquiries/${inquiryId}/factory-quotes`, {
          newFactoryName: `Guangzhou Lines ${tag}`,
          receivedOn: "2026-10-21",
          currency: "CNY",
          leadTime: "60 days",
          lines: [
            { requestedItemId: line!.id, description: "Juice line complete", model: "CGF-18", quantity: 1, unit: "set", unitPrice: 250000 },
          ],
        })
        .expect(201)
    ).body.id;
    const s = (await api(app, sana).get(`/inquiries/${inquiryId}/sourcing`).expect(200)).body;
    const qx = s.quotes.find((q: { id: string }) => q.id === offerX);
    const qy = s.quotes.find((q: { id: string }) => q.id === offerY);
    expect(qx.lines.map((l: Line & { answersNo: string }) => `${l.no} ${l.model ?? ""} → ${l.answersNo}`)).toEqual([
      "1 WNS1-1.0 → 1",
      "2  → 2",
      "2.1 RFC-24 → 2",
      "2.2 SW-450 → 2",
    ]);
    expect(qx.coverage).toEqual({ covered: ["1", "2"], missing: [] });
    expect(qy.coverage).toEqual({ covered: ["2"], missing: ["1"] });
  });

  it("starts R1 from the offer that covers everything, priced at the default margin", async () => {
    const offers = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/offers?currency=USD`).expect(200)).body;
    expect(offers.offers).toHaveLength(2);
    expect(offers.items.map((i: { no: string }) => i.no)).toEqual(["1", "2"]);
    const draft = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/draft`).expect(200)).body;
    expect(draft.options).toHaveLength(1);
    expect(draft.options[0]).toMatchObject({ factoryQuoteId: offerX, leadTime: "45 days" });
    expect(draft.options[0].prices).toHaveLength(4);
  });

  it("offers two factories as Option A and B; lines come from the offers and cannot be changed in the quotation", async () => {
    const draft = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/draft`).expect(200)).body;
    const offers = (await api(app, sana).get(`/inquiries/${inquiryId}/quotation/offers?currency=USD`).expect(200)).body;
    const y = offers.offers.find((o: { factoryQuoteId: string }) => o.factoryQuoteId === offerY);
    const optionB = {
      factoryQuoteId: offerY,
      leadTime: "60 days",
      discount: 0,
      prices: [{ lineId: y.lines[0].id, unitPrice: 42000 }],
      charges: [{ description: "Sea freight to Mombasa", quantity: 1, unit: "lot", unitPrice: 3500 }],
    };
    // The same offer twice, or a line without a price, is refused.
    await api(app, sana)
      .post(`/inquiries/${inquiryId}/quotation/revisions`, { ...draft, options: [draft.options[0], draft.options[0]] })
      .expect(400);
    expect(
      (
        await api(app, sana)
          .post(`/inquiries/${inquiryId}/quotation/revisions`, { ...draft, options: [draft.options[0], { ...optionB, prices: [] }] })
          .expect(400)
      ).body.error,
    ).toMatch(/^Option B: enter a price for "Juice line complete"/);
    // Whatever wording is sent, the lines are the factory's.
    const r = (
      await api(app, sana)
        .post(`/inquiries/${inquiryId}/quotation/revisions`, {
          ...draft,
          options: [draft.options[0], optionB],
          lines: [{ description: "Something else" }],
        })
        .expect(201)
    ).body;
    revisionId = r.id;
    expect(r.options.map((o: { letter: string; status: string }) => `${o.letter}:${o.status}`)).toEqual(["A:open", "B:open"]);
    const [a, b] = r.options;
    expect(a.lines.map((l: Line) => `${l.no} ${l.description}`)).toEqual([
      "1 Steam boiler",
      "2 Juice filling line",
      "2.1 Rinsing-filling-capping monoblock",
      "2.2 Shrink wrapper",
    ]);
    expect(a.factory.name).toBe(`Zhangjiagang Complete ${tag}`);
    expect(b.lines.map((l: Line) => `${l.no} ${l.type} ${l.description}`)).toEqual([
      "1 goods Juice line complete",
      "2 charge Sea freight to Mombasa",
    ]);
    expect(b).toMatchObject({ total: "45500.00", leadTime: "60 days", coverage: { covered: ["2"], missing: ["1"] } });
    expect(r.total).toBe(a.total); // the revision's own figures follow Option A until one is accepted
  });

  it("records the customer's choice of exactly one option; the order is that option", async () => {
    await api(app, sana).post(`/revisions/${revisionId}/status`, { to: "sent" }).expect(200);
    expect((await api(app, sana).post(`/revisions/${revisionId}/status`, { to: "accepted" }).expect(400)).body.error).toBe(
      "Choose the option the customer accepted.",
    );
    const r = (await api(app, sana).get(`/revisions/${revisionId}`).expect(200)).body;
    const b = r.options[1];
    const accepted = (await api(app, sana).post(`/revisions/${revisionId}/status`, { to: "accepted", optionId: b.id }).expect(200)).body;
    expect(accepted.options.map((o: { letter: string; status: string }) => `${o.letter}:${o.status}`)).toEqual([
      "A:not_chosen",
      "B:accepted",
    ]);
    expect(accepted).toMatchObject({ status: "accepted", total: "45500.00", leadTime: "60 days" });

    const deal = (await api(app, sana).get(`/inquiries/${inquiryId}`)).body;
    const order = (await api(app, sana).get(`/orders/${deal.orders[0].id}`).expect(200)).body;
    expect(order.total).toBe("45500.00");
    expect(order.lines.map((l: Line) => `${l.no} ${l.description}`)).toEqual(["1 Juice line complete", "2 Sea freight to Mombasa"]);
    // We owe only the factory of the chosen option.
    const m = (await api(app, sana).get(`/orders/${order.id}/money`).expect(200)).body;
    expect(m.factories.rows.map((f: { factory: { name: string }; owed: string }) => `${f.factory.name} ${f.owed}`)).toEqual([
      `Guangzhou Lines ${tag} 282500.00`,
    ]);
    await api(app, bilal).get(`/revisions/${revisionId}`).expect(404);
  });
});
