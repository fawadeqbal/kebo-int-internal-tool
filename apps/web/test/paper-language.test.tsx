import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { paperDetailsOf } from "@kebo/shared";
import { KeboDoc } from "@/components/print/kebo-doc";
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
    hsCodes: ["8422.30", "8422.30", null],
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
