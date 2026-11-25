import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { paperDetailsOf } from "@kebo/shared";
import { bulletTexts, docItem, docQty, KeboDoc, labelled } from "@/components/print/kebo-doc";
import { copyOf, detailsFor, langFor, paperChoices, pdfOf } from "@/components/print/copies";
import { casesOf } from "@/components/print/cases";
import { docLangOf, zhOf } from "@/components/print/zh";
import type { OrderDocument } from "@/lib/types-orders";

// Papers in the customer's format (25 Nov 2026): English, or English with Chinese beside every label; the
// details under the title; the packing list a row per case with each item over its cases.

const details = (route: "informal" | "letter_of_credit") =>
  paperDetailsOf({
    company: { name: "Shandong Kebo International Trade Co., Ltd.", address: "No.5, Jielu Road, Jining", phone: "+86-151-54754812", taxNo: "91370811MAK4PH5B1N" },
    buyer: { name: "VISION PHARMACEUTICALS PVT LTD", address: "Plot No. 22-23, Islamabad", country: "PK", taxNo: "8890224-6" },
    route,
    withBank: true,
    contract: { number: "LCS/4/76/823", reference: "AD1090926000595", customerBank: "Habib Metropolitan Bank Limited", customerBankAddress: "Karachi 74200", openedOn: "2026-09-02" },
    proformaIssuedOn: "2026-08-21",
    ports: { portOfLoading: "Qingdao, China", portOfDischarge: "Karachi Port, Pakistan" },
    hsCodes: [
      { customer: "8422.30", china: null },
      { customer: "8422.30", china: "8422.3090" },
      { customer: null, china: null },
    ],
  });

const sheet = (d: ReturnType<typeof details>, lang: "en" | "zh") =>
  render(
    <KeboDoc
      company={{ name: "Shandong Kebo International Trade Co., Ltd.", taxNo: "91370811MAK4PH5B1N" } as never}
      customer={{ name: "VISION PHARMACEUTICALS PVT LTD", country: "PK" } as never}
      title="PACKING  LIST"
      numberLabel="Packing List NO."
      number="PL-2026-0572"
      date="2026-11-09"
      columns={[{ label: "Case No.", width: 34, render: () => "1" }]}
      rows={[{}]}
      bullets={[]}
      details={d}
      lang={lang}
    />,
  );

describe("the papers' language", () => {
  it("English unless chosen; the labels' Chinese from one dictionary", () => {
    expect(docLangOf(undefined)).toBe("en");
    expect(docLangOf("fr")).toBe("en");
    expect(docLangOf("zh")).toBe("zh");
    expect(zhOf("Packing List")).toBe("装箱单");
    expect(zhOf("Case No.")).toBe("箱号");
    expect(zhOf("Port of loading:")).toBe("装运港");
    expect(zhOf("Total CFR Karachi Port")).toBe("合计");
    // Words people typed are not labels: no Chinese for them.
    expect(zhOf("Vial capping machine")).toBeNull();
  });

  it("an LC order: the Notify bank with its number, reference, the proforma's date, the day issued and the bank", () => {
    sheet(details("letter_of_credit"), "en");
    expect(screen.getByText("Notify bank")).toBeTruthy();
    expect(screen.getByText("LCS/4/76/823")).toBeTruthy();
    expect(screen.getByText("AD1090926000595")).toBeTruthy();
    expect(screen.getByText("21 Aug 2026")).toBeTruthy();
    expect(screen.getByText("Habib Metropolitan Bank Limited")).toBeTruthy();
    // The buyer's tax number as Pakistan names it; one HS code for goods that share it.
    expect(screen.getByText("N.T.N No.")).toBeTruthy();
    expect(screen.getByText("8422.30")).toBeTruthy();
    expect(screen.queryByText(/装箱单/)).toBeNull();
  });

  it("an informal order prints no bank; with Chinese, each label carries its Chinese", () => {
    sheet(details("informal"), "zh");
    expect(screen.queryByText(/Notify bank/)).toBeNull();
    expect(screen.queryByText("LCS/4/76/823")).toBeNull();
    expect(screen.getByText("装箱单")).toBeTruthy();
    expect(screen.getByText("发货人")).toBeTruthy();
    expect(screen.getByText("箱号")).toBeTruthy();
  });
});

describe("the packing list case by case", () => {
  type Line = OrderDocument["lines"][number];
  const c = (caseNo: string | null) => ({ caseNo, count: 1, packageType: "Wooden case", lengthMm: 1000, widthMm: 800, heightMm: 600, netWeightKg: "10.00", grossWeightKg: "12.00", cbm: "0.480" });
  const line = (no: string, cases: ReturnType<typeof c>[]) =>
    ({ id: no, no, description: `Item ${no}`, quantity: "1", unit: "set", packing: { packages: cases.length, packageType: null, netWeightKg: null, grossWeightKg: null, cbm: null, cases } }) as unknown as Line;

  it("each item over its cases; the same case number on its next rows is one cell, as the customer writes it", () => {
    const rows = casesOf([line("1", [c("1"), c("1")]), line("2", [c("3"), c("4"), c(null)]), line("3", [])]);
    expect(rows.map((r) => [r.line.no, r.caseNo, r.lineSpan, r.caseSpan])).toEqual([
      ["1", "1", 2, 2],
      ["1", "1", 0, 0],
      ["2", "3", 3, 1],
      ["2", "4", 0, 1],
      // No case number: the item's own.
      ["2", "2", 0, 1],
      // Not packed yet: one row for the item.
      ["3", "3", 1, 1],
    ]);
  });
});

describe("papers in Chinese and the China customs copy (25 Nov 2026)", () => {
  it("an item's Chinese under its name, the unit's after the quantity, only in English + 中文", () => {
    const item = (lang: "en" | "zh") => render(<div data-testid={lang}>{docItem("Blister machine\nSpeed 60/min", "DPP-260", "泡罩包装机\n速度 60次/分钟", lang)}</div>);
    item("en");
    expect(screen.getByTestId("en").textContent).not.toContain("泡罩包装机");
    item("zh");
    expect(screen.getByTestId("zh").textContent).toContain("泡罩包装机");
    expect(screen.getByTestId("zh").textContent).toContain("速度 60次/分钟");
    expect(screen.getByTestId("zh").textContent).toContain("型号");
    expect(docQty("2", "sets")).toBe("2 sets");
    // As the client's packing list: "1套" over "1 set", the item's Chinese over its English.
    render(<div data-testid="qty">{docQty("1", "set", "zh")}</div>);
    expect(screen.getByTestId("qty").textContent).toBe("1套1 set");
    expect(screen.getByTestId("zh").textContent!.indexOf("泡罩包装机")).toBeLessThan(screen.getByTestId("zh").textContent!.indexOf("Blister machine"));
  });

  it("the details: ports and origin in Chinese, our Chinese name and address; China's HS codes on the customs copy", () => {
    const d = details("informal");
    d.shipper = { ...d.shipper, nameLocal: "山东科波国际贸易有限公司", addressLocal: "济宁市解放路5号" };
    expect(d.shipping).toMatchObject({ hsCode: "8422.30", hsCodeCn: "8422.30, 8422.3090" });
    expect(detailsFor(d, "customer")!.shipping.hsCode).toBe("8422.30");
    expect(detailsFor(d, "customs")!.shipping.hsCode).toBe("8422.30, 8422.3090");
    sheet(detailsFor(d, "customs")!, "zh");
    expect(screen.getByText("山东科波国际贸易有限公司")).toBeTruthy();
    expect(screen.getByText("济宁市解放路5号")).toBeTruthy();
    expect(screen.getByText("青岛，中国")).toBeTruthy();
    expect(screen.getByText("卡拉奇港，巴基斯坦")).toBeTruthy();
    expect(screen.getByText("8422.30, 8422.3090")).toBeTruthy();
  });

  it("one set of switches: the copies a paper has, the language (none on the customs copy), the PDF as shown", () => {
    expect(copyOf("packing-list", "customs")).toBe("customs");
    expect(copyOf("packing-list", "internal")).toBe("customer");
    expect(copyOf("proforma", "internal")).toBe("internal");
    expect(copyOf("bill-of-exchange", "customs")).toBe("customer");
    expect(langFor("customs", "en")).toBe("zh");
    const sp = { back: "/orders/1", v: "2" };
    const [copies, lang] = paperChoices("/print/orders/1/packing-list", sp, "packing-list", "customer", "en");
    expect(copies!.options.map((o) => [o.word, o.href, o.on])).toEqual([
      ["Customer copy", "/print/orders/1/packing-list?back=%2Forders%2F1&v=2", true],
      ["China customs", "/print/orders/1/packing-list?back=%2Forders%2F1&v=2&copy=customs", false],
    ]);
    expect(lang!.options.map((o) => o.word)).toEqual(["English", "English + 中文"]);
    // The customs copy is always in both languages: no language switch.
    expect(paperChoices("/print/orders/1/packing-list", { copy: "customs" }, "packing-list", "customs", "zh").map((c) => c.label)).toEqual(["Which copy"]);
    // A paper with one copy: the language only.
    expect(paperChoices("/print/orders/1/bill-of-exchange", {}, "bill-of-exchange", "customer", "zh").map((c) => c.label)).toEqual(["Language"]);
    expect(pdfOf("/pdf/packing-list/1?v=2", "customs", "zh")).toBe("/pdf/packing-list/1?v=2&copy=customs");
    expect(pdfOf("/pdf/proforma/1", "internal", "zh")).toBe("/pdf/proforma/1?copy=internal&lang=zh");
    expect(pdfOf("/pdf/proforma/1", "customer", "en")).toBe("/pdf/proforma/1");
  });
});

describe("typed texts in Chinese, from the translator's memory (25 Nov 2026)", () => {
  const bullets = [
    "Goods of Chinese origin.",
    labelled("Payment:", "30% deposit, balance before shipment", "zh"),
    labelled("Shipping marks:", "VISION PHARMA\nKARACHI", "zh"),
    labelled("B/L No.:", "QDLOS-77", "zh"),
  ];
  it("asks for sentences and terms, never for marks, numbers or codes", () => {
    expect(bulletTexts(bullets)).toEqual(["Goods of Chinese origin.", "30% deposit, balance before shipment"]);
  });

  it("prints the Chinese it has under each, only in English + 中文", () => {
    const tr = { "Goods of Chinese origin.": "货物原产于中国。", "30% deposit, balance before shipment": "30%定金，余款发货前支付", "LIQUID FILLING LINE": "液体灌装线" };
    const sheet = (lang: "en" | "zh") =>
      render(
        <div data-testid={lang}>
          <KeboDoc
            company={{ name: "Kebo" } as never}
            customer={{ name: "Vision" } as never}
            title="PACKING  LIST"
            number="PL-1"
            date="2026-11-25"
            heading="LIQUID FILLING LINE"
            columns={[{ label: "No.", render: () => "1" }]}
            rows={[{}]}
            bullets={bullets}
            lang={lang}
            tr={tr}
          />
        </div>,
      );
    sheet("zh");
    const zh = screen.getByTestId("zh").textContent!;
    expect(zh).toContain("货物原产于中国。");
    expect(zh).toContain("30%定金，余款发货前支付");
    expect(zh).toContain("液体灌装线");
    sheet("en");
    expect(screen.getByTestId("en").textContent).not.toContain("货物原产于中国。");
  });
});
