import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One of each (canvas "RFQ Desk — the pieces", consistency plan): the app's pages and pieces take their sizes and
 * colours from the theme (packages/ui/src/styles/theme.css), never typed in a class. Each check here fails when a
 * copy comes back, and names the file and the class to change.
 *
 * Not checked: the printed papers (components/print, app/print) and the marketing site (components/site), which
 * draw on white paper in their own brand; the platform's dev-tools console, which is a terminal on purpose.
 */
// Tests run in apps/web.
const ROOTS = [resolve(process.cwd(), "src"), resolve(process.cwd(), "../../packages/ui/src")];
const SKIP = ["/print/", "/site/", "/dev-tools/live-log.tsx", "/dev-tools/speed.tsx", "/platform/preview/"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(tsx?|ts)$/.test(name) ? [path] : [];
  });
}

const SOURCES = ROOTS.flatMap(files)
  .filter((f) => !SKIP.some((s) => f.replaceAll("\\", "/").includes(s)))
  .map((f) => ({ file: relative(resolve(process.cwd(), "../.."), f), text: readFileSync(f, "utf8") }));

/** Every match of `pattern` in the app's sources, as "file: match". */
function found(pattern: RegExp): string[] {
  return SOURCES.flatMap(({ file, text }) => [...text.matchAll(pattern)].map((m) => `${file}: ${m[0]}`));
}

describe("one of each", () => {
  it("reads every source file", () => {
    expect(SOURCES.length).toBeGreaterThan(300);
  });

  it("text sizes come from the theme's scale (text-2xs … text-2xl), never typed in px", () => {
    expect(found(/(?<![\w-])text-\[\d+(?:\.\d+)?px\]/g)).toEqual([]);
  });

  it("buttons take their height from their size (sm 32 · md 40 · lg 44), never typed beside it", () => {
    // A button, a link drawn as one, or buttonClass(): a height, min-height or square size in its own classes is a copy.
    const tags = /<(?:Button|ButtonLink|SubmitButton|ConfirmSubmit|OpenPanelButton|PanelButton|WindowCancel)\b(?:[^>{]|\{(?:[^{}]|\{[^{}]*\})*\})*>|buttonClass\([^)]*\)/g;
    const height = /(?<![\w&:[-])(?:[a-z-]+:)*(?:h|min-h|size)-(?:\d+|\[[^\]]+\])(?![\w-])/;
    const copies = SOURCES.flatMap(({ file, text }) =>
      [...text.matchAll(tags)].filter((m) => height.test(m[0].replace(/\[&_svg\]:size-[\w.[\]]+/g, ""))).map((m) => `${file}: ${m[0].slice(0, 120)}`),
    );
    expect(copies).toEqual([]);
  });

  it("fields take their height from their size (md 40 · sm 32 in a table), never typed beside it", () => {
    const tags = /<(?:Input|Select|MoneyInput|AutoSelect)\b(?:[^>{]|\{(?:[^{}]|\{[^{}]*\})*\})*>/g;
    const height = /(?<![\w&:[-])(?:[a-z-]+:)*h-(?:\d+|\[[^\]]+\])(?![\w-])/;
    const copies = SOURCES.flatMap(({ file, text }) => [...text.matchAll(tags)].filter((m) => height.test(m[0])).map((m) => `${file}: ${m[0].slice(0, 120)}`));
    expect(copies).toEqual([]);
  });

  it("one picker, one AutoSelect: the copies stay deleted", () => {
    const names = SOURCES.map((s) => s.file);
    expect(names.filter((f) => /common\/(auto-select|percent-choice)\.tsx$/.test(f))).toEqual([]);
    // The customer and the supplier pickers draw the one Picker; the port box (any port typed, the usual ones suggested) is the only other.
    expect(found(/role="combobox"/g).filter((f) => /customer-picker/.test(f))).toEqual([]);
    expect(found(/role="combobox"/g).filter((f) => /factory-quote-form/.test(f))).toHaveLength(1);
  });

  it("one choice: a pick-one is ChoiceChips, a view switch SegmentedChoice — no radio group drawn by hand", () => {
    // The order's payment cards carry a line under each choice (option cards) and the filter sheet is step 5's.
    const allowed = /choice-chips\.tsx|packages\/ui\/src\/client\.tsx|orders\/\[id\]\/forms\.tsx|filter-card\.tsx/;
    expect(found(/role="radiogroup"/g).filter((f) => !allowed.test(f))).toEqual([]);
  });

  it("one way to add a file: the drop zone (a button that picks a file is fine, a bare file box is not)", () => {
    expect(found(/<Input\b[^>]*type="file"/g)).toEqual([]);
    const bare = SOURCES.flatMap(({ file, text }) =>
      [...text.matchAll(/<input\b[^>]*type="file"[^>]*>/g)].filter((m) => !/\bhidden\b|sr-only/.test(m[0]) && !/file-zone\.tsx/.test(file)).map((m) => `${file}: ${m[0].slice(0, 100)}`),
    );
    expect(bare).toEqual([]);
    expect(SOURCES.filter((s) => /deals\/documents-panel\.tsx$/.test(s.file))).toEqual([]);
  });

  it("one filter row and one tab row: the second strip, the unused navs and the reports' own side list stay deleted", () => {
    expect(found(/export function (?:ListToolbar|FilterBar|SearchField|SectionNav)\b/g)).toEqual([]);
    expect(found(/<ListToolbar\b/g)).toEqual([]);
    expect(found(/export function SectionList\b/g).filter((f) => !f.includes("packages/ui"))).toEqual([]);
    // TabRow lives in ui; the app re-exports it, and LinkTabs' "tabs" look draws it.
    expect(found(/export function TabRow\b/g).filter((f) => !f.includes("packages/ui"))).toEqual([]);
  });

  it("a table never forces a width, and never sits in a second sideways scroll box", () => {
    expect(found(/(?<![\w-])min-w-\[(?:5[0-9]\d|[6-9]\d\d|1\d{3})px\]/g)).toEqual([]);
    expect(found(/<div className="[^"]*overflow-x-auto[^"]*">\s*<Table\b/g)).toEqual([]);
  });

  it("one totals block: the order's money is Totals, not its own line", () => {
    expect(found(/^function Totals\(/gm)).toEqual([]);
  });

  it("one notice: no Alert or Banner, and no hand-made coloured notice box", () => {
    expect(found(/<(Alert|Banner)\b/g)).toEqual([]);
    expect(found(/<(p|div)(?: role="(?:alert|status)")? className="[^"]*rounded-(?:xl|lg)[^"]*border border-(?:ok|bad|info)\/\d+ bg-(?:ok|bad|info)-soft[^"]*">/g).filter((m) => !m.includes("shadow-pop"))).toEqual([]);
  });

  it("one pill: no hand-made rounded-full label span", () => {
    expect(found(/<span className="[^"]*rounded-full bg-(?:primary|warn|ok|bad|info)-soft px-2[^"]*text-(?:2xs|xs)[^"]*">/g)).toEqual([]);
  });

  it("one empty line, one box head, one side section", () => {
    expect(found(/<p className="(?:p-4 )?text-sm text-muted">(?:No |Nothing )/g)).toEqual([]);
    expect(found(/function RecordEmpty\(/g)).toEqual([]);
    expect(found(/<div className="flex min-h-14 items-start justify-between gap-3 border-b border-line/g)).toEqual([]);
    expect(found(/<h3 className="text-lead font-semibold">\{title\}<\/h3>/g)).toEqual([]);
  });

  it("one window: three widths, the app's own confirm, one footer, one UrlWindow", () => {
    // Widths are RULES.window (part 640 · wideRows 720 · items 1180); the bottom sheet is not a window.
    expect(found(/md:w-\[\d+px\]/g).filter((m) => !m.includes("bottom-sheet.tsx") && !m.includes("rules.ts"))).toEqual([]);
    expect(found(/\b(?:window\.)?(?:confirm|alert)\((?!\))/g).filter((m) => !m.includes("website-form/card.tsx"))).toEqual([]);
    expect(found(/<(PanelActions|PanelFooter)\b|function (PanelActions|PanelFooter)\(/g)).toEqual([]);
    expect(found(/function UrlWindow\(/g)).toHaveLength(1);
  });

  it("no page keeps its own small-button class (SMALL, editClass, BTN)", () => {
    expect(found(/const (?:SMALL|editClass|BTN) = /g)).toEqual([]);
  });

  it("colours come from the theme's variables, never typed as #hex in a class", () => {
    expect(found(/(?<![\w-])(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|divide|shadow)-\[#[0-9a-fA-F]{3,8}\]/g)).toEqual([]);
  });
});
