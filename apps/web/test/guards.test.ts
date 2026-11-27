import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import known from "./guards.known.json";

/**
 * Habits the design rules and the engineering standards ask us to drop (review 27 Nov 2026), counted in the
 * source. Today's counts are in guards.known.json and may only go down, as with the API's module boundaries:
 * a change that adds one fails here and is told what to use instead; a change that removes some lowers the
 * number in the same change, so the next one cannot bring them back.
 */
const SRC = resolve(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(SRC)
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => ({ name: relative(SRC, f), source: readFileSync(f, "utf8") }));

interface Guard {
  /** What is counted, as the failure says it. */
  what: string;
  /** What to write instead. */
  use: string;
  /** How many of them one file holds. */
  count: (file: { name: string; source: string }) => number;
}

const times = (pattern: RegExp) => (file: { source: string }) => file.source.match(pattern)?.length ?? 0;

/** A page, a layout or a component: it draws, and asks the API through a data file, not by itself. */
const draws = (name: string) => name.startsWith("components/") || /^app\/.*\/(page|layout)\.tsx$/.test(name);

const GUARDS: Record<keyof typeof known.counts, Guard> = {
  rawButton: {
    what: "hand-written <button>",
    use: "Button or ButtonLink from @kebo/ui",
    count: times(/<button\b/g),
  },
  rawTable: {
    what: "hand-written <table>",
    use: "ListTable (components/lists), or Table from @kebo/ui",
    count: times(/<table\b/g),
  },
  pixelText: {
    what: "text size in pixels or rem",
    use: "a size of the type scale (text-2xs … text-2xl, packages/ui theme.css)",
    count: times(/\btext-\[[0-9.]+(?:px|rem)\]/g),
  },
  hiddenFailure: {
    what: "read whose failure is shown as nothing (.catch(() => null))",
    use: "optional() for a read the person may not see (403, 404); any other failure belongs on the error page",
    count: times(/\.catch\(\(\) => (?:null|undefined|false|0|\[\]|\{\})\)/g),
  },
  handWiredWindow: {
    what: 'window wired by hand (role="dialog")',
    use: "SidePanel, Modal or BottomSheet (components/common): they keep Tab inside and give the focus back",
    // (An attribute in the markup, not the same words in a selector: '[role="dialog"]'.)
    count: times(/(?<!\[)role="(?:dialog|alertdialog)"/g),
  },
  handDate: {
    what: "date worked out by hand (.setUTCMonth, .setMonth, Date.UTC)",
    use: "addDays, addMonths, monthStart, monthEnd, monthOf, lastMonths or monthsBetween from @kebo/utils: each rule is written once, and tested for month ends and leap years (a new rule about dates goes there too)",
    count: times(/\.set(?:UTC)?Month\(|\bDate\.UTC\(/g),
  },
  apiOutsideData: {
    what: "page, layout or component that calls the API client itself",
    use: "a data file of its feature (lib/order-data.ts, lib/deal-data.ts…), so each read is written once",
    count: (file) => (draws(file.name) && /from "@\/lib\/api"/.test(file.source) ? 1 : 0),
  },
};

const LONG = 1000;

describe("guards: the counts only go down", () => {
  for (const [key, guard] of Object.entries(GUARDS) as [keyof typeof known.counts, Guard][]) {
    const per = files.map((f) => ({ name: f.name, n: guard.count(f) })).filter((f) => f.n > 0);
    const now = per.reduce((sum, f) => sum + f.n, 0);
    const most = per
      .sort((a, b) => b.n - a.n)
      .slice(0, 5)
      .map((f) => `${f.name} ×${f.n}`)
      .join(", ");

    it(`adds no ${guard.what}`, () => {
      expect(now, `${now} now, ${known.counts[key]} allowed. Use ${guard.use}. Most are in: ${most}`).toBeLessThanOrEqual(
        known.counts[key],
      );
    });

    it(`keeps the count true: ${key}`, () => {
      expect(now, `Fewer than before: set "${key}" to ${now} in test/guards.known.json`).toBeGreaterThanOrEqual(known.counts[key]);
    });
  }

  const long = files
    .filter((f) => f.source.split("\n").length > LONG)
    .map((f) => f.name)
    .sort();

  it(`adds no file of more than ${LONG} lines`, () => {
    expect(
      long.filter((f) => !known.longFiles.includes(f)),
      "Split it by what each part does (a component draws one thing; its data and its rules live beside it)",
    ).toEqual([]);
  });

  it("keeps the long files true: a file that got shorter is taken off the list", () => {
    expect(known.longFiles.filter((f) => !long.includes(f))).toEqual([]);
  });
});
