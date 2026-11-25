import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { KeboDoc } from "@/components/print/kebo-doc";

// The signature block (25 Nov 2026): who signs and for whom, room to sign, Name / Title / Date, our seal over our
// signature (not beside the bank), kept on one page with the bank details so it never starts a page alone.

const sheet = (signatures: { left: string; right: string } | null) =>
  render(
    <KeboDoc
      company={{ name: "Shandong Kebo International Trade Co., Ltd.", stamp: "data:image/png;base64,AAAA" } as never}
      customer={{ name: "Vision Pharmaceuticals Pvt. Ltd", country: "PK" } as never}
      title="SALES  CONTRACT"
      numberLabel="Contract No."
      number="SC-2026-0001"
      date="2026-11-22"
      columns={[{ label: "Item", render: () => "1" }]}
      rows={[{}]}
      bullets={["Our usual payment is made by 30% deposit and 70% before shipment."]}
      bank="ACCOUNT NAME: SHANDONG KEBO INTERNATIONAL TRADE CO., LTD."
      signatures={signatures}
    />,
  );

describe("the signature block", () => {
  it("both sides: who signs and for whom, Name, Title and Date; our seal over our signature, kept with the bank details", () => {
    const { container } = sheet({ left: "For the seller · Shandong Kebo International Trade Co., Ltd.", right: "For the buyer · Vision Pharmaceuticals Pvt. Ltd" });
    expect(screen.getByText("For the seller")).toBeTruthy();
    // For whom, under who signs (the customer's name is also in the box at the top).
    expect(within(screen.getByText("For the buyer").parentElement!).getByText("Vision Pharmaceuticals Pvt. Ltd")).toBeTruthy();
    expect(screen.getAllByText("Name:")).toHaveLength(2);
    expect(screen.getAllByText("Title:")).toHaveLength(2);
    expect(screen.getAllByText("Date:")).toHaveLength(2);
    // One seal, on our side, not beside the bank.
    const seals = screen.getAllByAltText("Company stamp");
    expect(seals).toHaveLength(1);
    const ours = screen.getByText("For the seller").parentElement!;
    expect(within(ours).getByAltText("Company stamp")).toBeTruthy();
    // The bank details and the signatures are one block that does not break across pages.
    const bank = screen.getByText(/ACCOUNT NAME/);
    const keep = bank.closest("div[style*='break-inside: avoid']")!.parentElement!;
    expect(keep.style.breakInside).toBe("avoid");
    expect(within(keep).getByText("For the buyer")).toBeTruthy();
    expect(container.textContent).not.toContain("Name, signature and date");
  });

  it("a paper only we sign: one block, ours", () => {
    sheet({ left: "For and on behalf of · Shandong Kebo International Trade Co., Ltd.", right: "" });
    expect(screen.getByText("For and on behalf of")).toBeTruthy();
    expect(screen.getAllByText("Name:")).toHaveLength(1);
  });

  it("an unsigned paper keeps the seal beside the bank details", () => {
    sheet(null);
    expect(screen.queryByText("Name:")).toBeNull();
    expect(screen.getAllByAltText("Company stamp")).toHaveLength(1);
  });
});
