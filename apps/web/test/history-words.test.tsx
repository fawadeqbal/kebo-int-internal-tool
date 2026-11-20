import { describe, expect, it } from "vitest";
import { readableHistory } from "@/components/insights/readable-dates";

const style = { zone: "Asia/Karachi", dateFormat: "dd MMM yyyy", clock: "24h" } as never;

describe("history reads as words, names and money (live audit 20 Nov)", () => {
  it("groups amounts and leaves years and numbers like RFQ-2026-0011 alone", () => {
    expect(readableHistory("QUO-2026-0011-A R1 edited · Options A 22140.80 → A 4400000.00", style)).toBe("QUO-2026-0011-A R1 edited · Options A 22,140.80 → A 4,400,000.00");
    expect(readableHistory("RFQ-2026-0011: item 1 in 2026", style)).toBe("RFQ-2026-0011: item 1 in 2026");
  });
  it("leaves out a part that only names an id", () => {
    expect(readableHistory("Follow-up set · Assignee — → Fawad Iqbal · Follow Up — → 7f8c7189-f89a-4a49-9c80-e5b6c75faac4", style)).toBe("Follow-up set · Assignee — → Fawad Iqbal");
  });
});
