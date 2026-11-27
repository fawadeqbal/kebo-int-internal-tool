import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buyerTaxLabel, caseTotals, caseVolume, paymentLineOf } from "@kebo/shared";
import { api, signIn, startApp } from "./app";

/**
 * Papers in the customer's format (25 Nov 2026): every trade paper prints the shipper, the buyer (with the
 * N.T.N in Pakistan), the bank as the payment route has it (none on an informal order; an LC's "Notify bank"
 * with its number, the bank's reference, the proforma's date, the day it was issued and the bank's address) and
 * the shipping. The packing list prints each case with its size and weights; the items' totals follow the cases.
 */
describe("papers in the customer's format", () => {
  let app: INestApplication;
  let sana: string;
  let orderId: string;
  let lineId: string;
  const tag = Date.now().toString(36);
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const packingList = async () => (await api(app, sana).get(`/orders/${orderId}/documents/packing-list`).expect(200)).body;
  const order = async () => (await api(app, sana).get(`/orders/${orderId}`).expect(200)).body;

  beforeAll(async () => {
    app = await startApp();
    sana = await signIn(app, "sana@example.com");
    const me = (await api(app, sana).get("/auth/me")).body.id;
    const customerId = (
      await api(app, sana)
        .post("/customers", {
          name: `Vision Pharma ${tag}`,
          country: "PK",
          address: "Plot No. 22-23, Industrial Triangle, Kahuta Road, Islamabad",
          taxNo: "8890224-6",
          contacts: [{ name: "Ali", email: `ali-${tag}@vp.test` }],
        })
        .expect(201)
    ).body.id;
    const supplierId = (await api(app, sana).post("/factories", { name: `Capping Works ${tag}`, address: "Jining" }).expect(201)).body.id;
    const inquiry = (
      await api(app, sana)
        .post("/inquiries", { customerId, category: "Machinery", assigneeId: me, items: [{ description: "Vial capping machine RHZ-8", quantity: 1 }] })
        .expect(201)
    ).body;
    const item = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.items[0];
    await api(app, sana)
      .post(`/inquiries/${inquiry.id}/factory-quotes`, {
        supplierId,
        receivedOn: day(-5),
        currency: "CNY",
        lines: [{ requestedItemId: item.id, description: "RHZ-8", quantity: 1, unitPrice: 200000 }],
      })
      .expect(201);
    const draft = (await api(app, sana).get(`/inquiries/${inquiry.id}/quotation/draft`)).body;
    const r = (await api(app, sana).post(`/inquiries/${inquiry.id}/quotation/revisions`, draft).expect(201)).body;
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "sent" }).expect(200);
    await api(app, sana).post(`/revisions/${r.id}/status`, { to: "accepted" }).expect(200);
    orderId = (await api(app, sana).get(`/inquiries/${inquiry.id}`)).body.orders[0].id;
    lineId = (await order()).lines.find((l: { type: string }) => l.type === "goods").id;
    await api(app, sana)
      .post(`/orders/${orderId}/shipments`, { mode: "sea", status: "booked", portOfLoading: "Qingdao, China", portOfDischarge: "Karachi Port, Pakistan" })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("works out a case's volume and an item's totals", () => {
    // The customer's own figures: 2400 × 1190 × 1960 mm is 5.598 m³, 1430 × 1130 × 690 mm is 1.115 m³.
    const big = { caseNo: "1", count: 1, packageType: "Wooden case", lengthMm: 2400, widthMm: 1190, heightMm: 1960, netWeightKg: 600, grossWeightKg: 700, cbm: null };
    const small = { ...big, lengthMm: 1430, widthMm: 1130, heightMm: 690, netWeightKg: 100, grossWeightKg: 150 };
    expect(caseVolume(big)).toBe(5.598);
    expect(caseVolume(small)).toBe(1.115);
    // Three identical cases: each one's size, the row's volume.
    expect(caseVolume({ ...small, count: 3 })).toBe(3.345);
    // No size: the volume typed.
    expect(caseVolume({ ...big, lengthMm: null, cbm: 4.2 })).toBe(4.2);
    expect(caseTotals([big, small])).toEqual({ packages: 2, packageType: "Wooden case", netWeightKg: 700, grossWeightKg: 850, cbm: 6.713 });
    expect(caseTotals([big, { ...small, packageType: "Carton" }]).packageType).toBe("Wooden case + Carton");
    expect(caseTotals([])).toEqual({ packages: null, packageType: null, netWeightKg: null, grossWeightKg: null, cbm: null });
    expect(buyerTaxLabel("PK")).toBe("N.T.N No.");
    expect(buyerTaxLabel("AE")).toBe("Tax No.");
  });

  it("writes the packing list's payment line as the customer's papers do", () => {
    const lc = { route: "letter_of_credit" as const, balanceWhen: null, lcTerms: "at_sight" as const, lcDays: null };
    const base = { plainPlan: true, termsText: "Letter of credit", sentence: "Payment: 100% by irrevocable letter of credit at sight." };
    expect(paymentLineOf({ ...base, depositPercent: 0, terms: lc, contract: { number: "LCS/4/76/823", reference: "AD1090926000595" } })).toBe(
      "100% irrevocable LC at sight (LC No. LCS/4/76/823) Ref. No. AD1090926000595",
    );
    expect(paymentLineOf({ ...base, depositPercent: 30, terms: lc, contract: null })).toBe("30% deposit, 70% irrevocable LC at sight");
    const informal = { route: "informal" as const, balanceWhen: "before_shipment" as const, lcTerms: null, lcDays: null };
    expect(paymentLineOf({ ...base, termsText: "30% deposit, balance before shipment", depositPercent: 30, terms: informal, contract: null })).toBe(
      "30% deposit, balance before shipment",
    );
  });

  it("an informal order's papers print no bank: shipper, buyer with the N.T.N, and the shipping", async () => {
    await api(app, sana).patch(`/orders/${orderId}/route`, { route: "informal", balanceWhen: "before_shipment" }).expect(200);
    const pl = await packingList();
    expect(pl.details).toMatchObject({
      buyer: { name: `Vision Pharma ${tag}`, taxLabel: "N.T.N No.", taxNo: "8890224-6" },
      bank: null,
      shipping: { portOfLoading: "Qingdao, China", portOfDischarge: "Karachi Port, Pakistan", origin: "China" },
    });
    expect(pl.details.shipper.name).toBeTruthy();
    expect(pl.paymentLine).not.toMatch(/LC/);
  });

  it("an LC order's packing list prints the Notify bank: number, reference, proforma date, issued on, bank and address", async () => {
    await api(app, sana).patch(`/orders/${orderId}/route`, { route: "letter_of_credit" }).expect(200);
    const issued = (await api(app, sana).post(`/orders/${orderId}/proforma`).expect(200)).body.proforma;
    await api(app, sana)
      .put(`/orders/${orderId}/bank-contract`, {
        number: "LCS/4/76/823",
        reference: "AD1090926000595",
        status: "opened",
        customerBank: "Habib Metropolitan Bank Limited",
        customerBankAddress: "CPU Import, 1st Floor, Spencer Building, I.I. Chundrigar Road, Karachi 74200",
        openedOn: day(-3),
      })
      .expect(200);
    const pl = await packingList();
    expect(pl.details.bank).toEqual({
      kind: "lc",
      number: "LCS/4/76/823",
      refNo: "AD1090926000595",
      invoiceDate: issued.issuedOn,
      issuedOn: day(-3),
      name: "Habib Metropolitan Bank Limited",
      address: "CPU Import, 1st Floor, Spencer Building, I.I. Chundrigar Road, Karachi 74200",
    });
    expect(pl.order.proformaNo).toBe(issued.number);
    expect(pl.paymentLine).toMatch(/irrevocable LC at sight \(LC No\. LCS\/4\/76\/823\) Ref\. No\. AD1090926000595$/);
    // The proforma is what the LC is opened against: no bank part on it.
    const pi = (await api(app, sana).get(`/orders/${orderId}/documents/proforma`).expect(200)).body;
    expect(pi.details.bank).toBeNull();
    // A form that does not send the new fields keeps them.
    await api(app, sana)
      .put(`/orders/${orderId}/bank-contract`, { number: "LCS/4/76/823", status: "opened", customerBank: "Habib Metropolitan Bank Limited", openedOn: day(-3) })
      .expect(200);
    expect((await packingList()).details.bank).toMatchObject({ refNo: "AD1090926000595", address: expect.stringContaining("Spencer Building") });
    // The commercial invoice carries the same details; the LC number is not repeated beside the date once known.
    const ci = (await api(app, sana).get(`/orders/${orderId}/papers/commercial-invoice/doc`).expect(200)).body.doc;
    expect(ci.details.bank).toMatchObject({ kind: "lc", number: "LCS/4/76/823" });
    expect(ci.meta.map((m: { label: string }) => m.label)).not.toContain("LC No.");
  });

  it("the packing case by case: each case's size and weights, the item's totals following", async () => {
    const two = [
      { caseNo: "1", count: 1, packageType: "Fumigated solid wooden case (IPPC)", lengthMm: 2400, widthMm: 1190, heightMm: 1960, netWeightKg: 600, grossWeightKg: 700 },
      { caseNo: "1", count: 1, packageType: "Fumigated solid wooden case (IPPC)", lengthMm: 1430, widthMm: 1130, heightMm: 690, netWeightKg: 100, grossWeightKg: 150 },
    ];
    await api(app, sana).put(`/orders/${orderId}/cases`, { lines: [{ lineId, cases: two }] }).expect(200);
    const line = (await order()).lines.find((l: { id: string }) => l.id === lineId);
    expect(line.packing).toMatchObject({ packages: 2, packageType: "Fumigated solid wooden case (IPPC)", netWeightKg: "700.00", grossWeightKg: "850.00", cbm: "6.713" });
    expect(line.packing.cases.map((c: { cbm: string }) => c.cbm)).toEqual(["5.598", "1.115"]);
    const pl = await packingList();
    expect(pl.lines[0].packing.cases).toHaveLength(2);
    expect(pl.packing.totals).toMatchObject({ packages: 2, cbm: "6.713", netWeightKg: "700.00", grossWeightKg: "850.00" });

    // Given as the item's totals (the Excel file of before, an older client): the cases stay when they add up to them…
    await api(app, sana)
      .put(`/orders/${orderId}/packing`, { shippingMarks: null, lines: [{ lineId, packages: 2, packageType: "Fumigated solid wooden case (IPPC)", netWeightKg: 700, grossWeightKg: 850, cbm: 6.713 }] })
      .expect(200);
    expect((await order()).lines.find((l: { id: string }) => l.id === lineId).packing.cases).toHaveLength(2);
    // …and become one row of those totals when they do not.
    await api(app, sana)
      .put(`/orders/${orderId}/packing`, { shippingMarks: null, lines: [{ lineId, packages: 3, packageType: "Carton", netWeightKg: 50, grossWeightKg: 60, cbm: 1.2 }] })
      .expect(200);
    const after = (await order()).lines.find((l: { id: string }) => l.id === lineId).packing;
    expect(after).toMatchObject({ packages: 3, cbm: "1.200" });
    expect(after.cases).toEqual([expect.objectContaining({ count: 3, packageType: "Carton", lengthMm: null, cbm: "1.200" })]);

    // A gross weight under the net is refused; no cases: the item is not packed.
    await api(app, sana)
      .put(`/orders/${orderId}/cases`, { lines: [{ lineId, cases: [{ ...two[0], grossWeightKg: 500 }] }] })
      .expect(422);
    await api(app, sana).put(`/orders/${orderId}/cases`, { lines: [{ lineId, cases: [] }] }).expect(200);
    expect((await order()).lines.find((l: { id: string }) => l.id === lineId).packing).toMatchObject({ packages: null, cbm: null, cases: [] });
  });
});
