import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatTile } from "@kebo/ui";
import { homeSpan, how, reportSpan, sixMonthsBack } from "@/lib/figures";

// Every figure on Home and Reports says how it is made, behind its ⓘ (audit plan item 13): a tile added without
// its rule fails here.
const FIGURE_FILES = [
  "src/components/home/board.tsx",
  "src/components/insights/overview.tsx",
  "src/components/insights/profit-section.tsx",
  "src/components/insights/cash-section.tsx",
  "src/components/insights/parties-sections.tsx",
  "src/components/insights/spending-section.tsx",
];

/** Each `<StatTile …/>` in a file, whole: braces are counted so a `delta={<Delta … />}` inside does not end it. */
function tilesOf(source: string): string[] {
  const out: string[] = [];
  for (let at = source.indexOf("<StatTile"); at >= 0; at = source.indexOf("<StatTile", at + 1)) {
    let depth = 0;
    for (let i = at; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (depth === 0 && source.startsWith("/>", i)) {
        out.push(source.slice(at, i + 2));
        break;
      }
    }
  }
  return out;
}

describe("the figures of Home and Reports", () => {
  it("each tile has its rule (how=…)", () => {
    const missing: string[] = [];
    let tiles = 0;
    for (const file of FIGURE_FILES) {
      const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
      for (const t of tilesOf(source)) {
        tiles++;
        if (!/\bhow=\{/.test(t)) missing.push(`${file}: ${t.slice(0, 80).replace(/\s+/g, " ")}`);
      }
    }
    expect(tiles).toBeGreaterThan(20);
    expect(missing).toEqual([]);
  });

  it("say the days they count, and what the arrow compares them with", () => {
    const home = homeSpan("2026-11-15", "November", "October");
    expect(home).toEqual({ days: "from 1 to 15 November", vs: "the same days of October (1 to 15 October)" });
    // A shorter month before: its last day.
    expect(homeSpan("2026-03-31", "March", "February").vs).toBe("the same days of February (1 to 28 February)");
    expect(homeSpan("2026-11-01", "November", "October").days).toBe("on 1 November");

    const q = reportSpan({ from: "2026-09-01", to: "2026-11-30", prevFrom: "2026-06-01", prevTo: "2026-08-31" });
    expect(q.days).toBe("from 1 Sep to 30 Nov 2026");
    expect(how.sold(q, "USD")).toContain("order date from 1 Sep to 30 Nov 2026");
    expect(how.sold(q, "USD")).toContain("the same length of time just before (1 Jun to 31 Aug 2026)");
    expect(reportSpan({ from: "2025-12-01", to: "2026-02-28", prevFrom: "2025-09-01", prevTo: "2025-11-30" }).days).toBe(
      "from 1 Dec 2025 to 28 Feb 2026",
    );
    expect(sixMonthsBack("2026-11-15")).toBe("1 May 2026");
    expect(sixMonthsBack("2026-03-02")).toBe("1 Sep 2025");
  });

  it("never print a missing value", () => {
    const s = reportSpan({ from: "2026-09-01", to: "2026-11-30", prevFrom: "2026-06-01", prevTo: "2026-08-31" });
    const texts = [
      how.sold(s, "USD"),
      how.collected(s, "USD"),
      how.collectedOnOrders(s, "USD"),
      how.paidOut(s, "USD"),
      how.profit(s, "USD"),
      how.profit(s, "USD", "October"),
      how.grossProfit(s, "USD"),
      how.grossProfit(s, "USD", "October"),
      how.cashNow("USD"),
      how.costsOfOrders(s, "USD"),
      how.companyCosts(s),
      how.profitOfReport(s, "USD"),
      how.cameIn(s, "USD"),
      how.wentOut(s, "USD"),
      how.net(s),
      how.customersWhoOrdered(s),
      how.repeatShare(s),
      how.averageOrder(s, "USD"),
      how.sleeping("1 May 2026", "USD"),
      how.winRate(s),
      how.spentToSell(s, "USD"),
      how.onDealsWon(s),
      how.lostDeals(s),
      how.per100(s, "USD"),
      how.owedBack("USD"),
      how.standsOut,
      how.nextWeeks("USD"),
      how.byMonth("USD", true),
      how.byMonth("USD", false, "The 12 months up to the end of the period."),
      how.ordersNow("USD"),
      how.inquiriesNow,
      how.customersOwe,
      how.toPaySoon,
      how.thinOfPeriod(s),
      how.thinProfit,
    ];
    // Every rule is in the list above.
    expect(texts.length).toBeGreaterThanOrEqual(Object.keys(how).length);
    for (const t of texts) expect(t).not.toMatch(/undefined|NaN|\[object/);
  });

  it("open from an ⓘ beside the tile, not inside its link", () => {
    render(<StatTile label="Sold this month" value="USD 12,400" href="/reports/profit" how={"First line.\nSecond line."} />);
    const button = screen.getByRole("button", { name: "How Sold this month is worked out" });
    expect(button.closest("a")).toBeNull();
    const note = document.getElementById(button.getAttribute("popovertarget")!)!;
    expect(note.getAttribute("popover")).toBe("auto");
    expect(note.textContent).toContain("First line.");
    expect(note.querySelectorAll("p").length).toBeGreaterThanOrEqual(4);
    // The tile is still one link with the figure in it.
    expect(screen.getByRole("link").textContent).toContain("USD 12,400");
  });
});
