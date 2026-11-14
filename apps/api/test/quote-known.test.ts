import type { INestApplication } from "@nestjs/common";
import { leadDays, readyAgainst } from "@kebo/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, signIn, startApp } from "./app";

/**
 * Reuse along the deal: a first quotation starts from what is already known — the customer's own currency,
 * the delivery terms of the last quotation sent to them — and the window is told the day the customer wants
 * the goods, the price they hope for and the warranty each factory gives. Everything can be typed over.
 */
describe("a quotation starts from what is known", () => {
  let app: INestApplication;
  let sana: string;
  let me: string;
  let customerId: string;
  let first: { id: string; refNo: string };
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    me = (await api(app, sana).get("/auth/me")).body.id;
    customerId = (
      await api(app, sana)
        .post("/customers", { name: `Yuan Buyer ${tag}`, country: "NG", defaultCurrency: "CNY", contacts: [{ name: "Ade", email: `yb-${tag}@yb.test` }] })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  const inquiry = async (requiredBy?: string) =>
    (
      await api(app, sana)
        .post("/inquiries", {
          customerId,
          category: "Machinery",
          assigneeId: me,
          ...(requiredBy ? { requiredBy } : {}),
          items: [
            { description: `Filler ${tag}`, quantity: 2, unit: "set", targetPrice: "85000" },
            { description: `Capper ${tag}`, quantity: 1, unit: "set" },
          ],
        })
        .expect(201)
    ).body as { id: string; refNo: string };
  const offer = async (inquiryId: string, name: string, extra: object = {}) => {
    const items = (await api(app, sana).get(`/inquiries/${inquiryId}`).expect(200)).body.items as { id: string; description: string; quantity: string }[];
    await api(app, sana)
      .post(`/inquiries/${inquiryId}/factory-quotes`, {
        newFactoryName: `${name} ${tag}`,
        receivedOn: "2026-11-01",
        currency: "CNY",
        lines: items.map((i) => ({ requestedItemId: i.id, description: i.description, quantity: Number(i.quantity), unitPrice: "1000" })),
        ...extra,
      })
      .expect(201);
  };

  it("reads a lead time as days, against the day the customer wants it", () => {
    expect(leadDays("45 days after the deposit")).toBe(45);
    expect(leadDays("soon")).toBeNull();
    expect(readyAgainst("45 days", "2026-11-14", "2026-12-20")).toEqual({ days: 45, readyOn: "2026-12-29", late: 9 });
    expect(readyAgainst("30 days", "2026-11-14", "2026-12-20")).toEqual({ days: 30, readyOn: "2026-12-14", late: -6 });
    expect(readyAgainst("30 days", "2026-11-14", null)).toBeNull();
    expect(readyAgainst("ASAP", "2026-11-14", "2026-12-20")).toBeNull();
  });

  it("starts R1 in the customer's currency and says so", async () => {
    first = await inquiry("2026-12-20");
    await offer(first.id, "Jiangsu Known", { leadTime: "45 days", warranty: "12 months" });
    const draft = (await api(app, sana).get(`/inquiries/${first.id}/quotation/draft`).expect(200)).body;
    expect(draft).toMatchObject({ number: 1, currency: "CNY" });
    expect(draft.from).toMatchObject({ customer: `Yuan Buyer ${tag}`, currency: "customer", delivery: "settings", lastQuotation: null });
  });

  it("tells the window the wanted day, the target price and the factory's warranty", async () => {
    const o = (await api(app, sana).get(`/inquiries/${first.id}/quotation/offers?currency=CNY`).expect(200)).body;
    expect(o.wantedBy).toBe("2026-12-20");
    expect(o.today).toMatch(/^\d{4}-\d\d-\d\d$/);
    expect(o.offers[0]).toMatchObject({ leadTime: "45 days", warranty: "12 months" });
    expect(o.items.map((i: { targetPrice: string | null }) => i.targetPrice)).toEqual(["85000", null]);
  });

  it("starts the next quotation to that customer with the delivery terms of the last one sent", async () => {
    const draft = (await api(app, sana).get(`/inquiries/${first.id}/quotation/draft`).expect(200)).body;
    const r1 = (await api(app, sana).post(`/inquiries/${first.id}/quotation/revisions`, { ...draft, incoterm: "CIF", incotermPlace: "Apapa, Lagos" }).expect(201)).body;
    // Still a draft: nothing was said to the customer yet, so it is not "the last quotation to them".
    const second = await inquiry();
    await offer(second.id, "Henan Known");
    let next = (await api(app, sana).get(`/inquiries/${second.id}/quotation/draft`).expect(200)).body;
    expect(next.from).toMatchObject({ delivery: "settings", lastQuotation: null });
    expect(next.incotermPlace).toBeNull();

    await api(app, sana).post(`/revisions/${r1.id}/status`, { to: "sent" }).expect(200);
    next = (await api(app, sana).get(`/inquiries/${second.id}/quotation/draft`).expect(200)).body;
    expect(next).toMatchObject({ number: 1, currency: "CNY", incoterm: "CIF", incotermPlace: "Apapa, Lagos" });
    expect(next.from).toMatchObject({ delivery: "last_quotation", lastQuotation: first.refNo });
    // No wanted day on this one.
    const o = (await api(app, sana).get(`/inquiries/${second.id}/quotation/offers?currency=CNY`).expect(200)).body;
    expect(o.wantedBy).toBeNull();
    // It is only where the window starts: the person saves what they choose.
    const saved = (await api(app, sana).post(`/inquiries/${second.id}/quotation/revisions`, { ...next, incoterm: "FOB", incotermPlace: "Qingdao" }).expect(201)).body;
    expect(saved).toMatchObject({ incoterm: "FOB", incotermPlace: "Qingdao" });
  });

  it("a revision of a quotation stays a copy of the last revision", async () => {
    const draft = (await api(app, sana).get(`/inquiries/${first.id}/quotation/draft`).expect(200)).body;
    expect(draft).toMatchObject({ number: 2, currency: "CNY", incoterm: "CIF", incotermPlace: "Apapa, Lagos" });
    expect(draft.from).toBeUndefined();
  });
});
