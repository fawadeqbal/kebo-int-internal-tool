import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { INQUIRY, INQUIRY_STAGE_TONE } from "@kebo/shared";

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

  it("one set of change words: no hand-made Save N changes, Changed · was, or empty/none as a value", () => {
    expect(found(/`Save \$\{|: `Save \d/g).filter((m) => !m.includes("change-words.tsx"))).toEqual([]);
    expect(found(/Changed · was \{/g).filter((m) => !m.includes("change-words.tsx"))).toEqual([]);
    expect(found(/function (WasHint|ChangeLine)\(/g)).toEqual([]);
    expect(found(/\$\{c\.label\}:? \$\{c\.from\} → /g)).toEqual([]);
    expect(found(/\|\| "empty"/g)).toEqual([]);
  });

  it("one app frame, no help line under a page's title, settings in one 720 column", () => {
    expect(found(/max-w-\[1400px\]|lg:px-8/g)).toEqual([]);
    expect(found(/<main id="main" className=\{cn\(RULES\.page\.frame/g)).toHaveLength(2);
    expect(found(/data-page-desc|<PageHeader\b[^>]*\sdescription=|<PageHeader\b[^>]*\ssummary="/g)).toEqual([]);
    expect(found(/<SettingsPage\b[^>]*description=/g)).toEqual([]);
    expect(found(/<div className=\{RULES\.page\.column\}>/g).length).toBeGreaterThanOrEqual(4);
  });

  it("one record body: every record's panel is RecordBody's 320, no hand-typed page grid, no second RecordFrame", () => {
    // Left on purpose: a report's own side (charts) and a role's access map, which takes its panel only from 1280.
    const own = ["insights/report-page.tsx", "access/roles/[key]/page.tsx"];
    expect(found(/grid-cols-\[minmax\(0,1fr\)_\d+px\]/g).filter((m) => !m.includes("rules.ts") && !own.some((o) => m.includes(o)))).toEqual([]);
    expect(found(/export function RecordFrame\(/g)).toHaveLength(1);
    expect(found(/withSheetPanel|SIDE_COLUMNS/g)).toEqual([]);
  });

  it("one list facts line, one pager, one set of stage colours", () => {
    // A list's figures are the one FactsLine (StatRow facts), never tiles; the old phone-only line mode is gone.
    expect(found(/phone="line"|data-stat-row/g)).toEqual([]);
    expect(found(/export function (FactLine|FactsLine)\(/g)).toHaveLength(1);
    expect(found(/export function Pagination\(|<Pagination\b/g).filter((m) => !m.includes("pagination.tsx"))).toEqual([]);
    // Every inquiry stage pill reads the record type's colours.
    for (const [stage, tone] of Object.entries(INQUIRY_STAGE_TONE)) expect(INQUIRY.states[stage as keyof typeof INQUIRY.states].tone).toBe(tone);
  });

  it("one list top: every list page's PageHeader is kind=\"list\" (no icon tile), its counts in the facts line", () => {
    const lists = SOURCES.filter(({ file }) => /\/\(list\)\/page\.tsx$|\/(follow-ups|audit|approvals|notifications|money\/due|money\/company-costs|finance\/ledger|access\/sessions|access\/sign-ins|access\/roles|platform\/\(admin\)\/(companies|leads|log|plans))\/page\.tsx$/.test(file));
    expect(lists.length).toBeGreaterThanOrEqual(18);
    for (const { file, text } of lists)
      for (const m of text.matchAll(/<PageHeader\b[\s\S]*?\/>/g)) {
        expect(m[0], file).toMatch(/kind="list"/);
        // A list's top says no sentence of its own: its figures are the facts line (payments keep "For <record>").
        if (!file.includes("payments/")) expect(m[0], file).not.toMatch(/\ssummary=/);
      }
  });

  it("every record draws the one record top that stays and folds (RecordTop in RecordFrame or RecordShell)", () => {
    const records = [
      "inquiries/[id]/layout.tsx",
      "orders/[id]/layout.tsx",
      "customers/[id]/layout.tsx",
      "suppliers/[id]/layout.tsx",
      "purchase-orders/[order]/[supplier]/page.tsx",
      "payments/[kind]/[id]/page.tsx",
      "users/[id]/page.tsx",
      "platform/(admin)/leads/[id]/page.tsx",
    ];
    for (const r of records) {
      const src = SOURCES.find(({ file }) => file.endsWith(r));
      expect(src, r).toBeTruthy();
      expect(src!.text, r).toMatch(/<Record(Frame|Shell)\b/);
      expect(src!.text, r).not.toMatch(/<PageHeader\b/);
    }
  });

  it("lists draw the one table and phone rows; a list inside a record is TabList", () => {
    for (const f of ["components/security/sign-in-list.tsx", "components/security/session-list.tsx", "(app)/notifications/page.tsx"]) {
      const src = SOURCES.find(({ file }) => file.endsWith(f))!;
      expect(src.text, f).toMatch(/<(Table|DataTable)\b/);
      expect(src.text, f).toMatch(/<PhoneList\b/);
    }
    for (const f of ["customers/[id]/inquiries/page.tsx", "customers/[id]/orders/page.tsx", "suppliers/[id]/offers/page.tsx", "components/common/record.tsx"])
      expect(SOURCES.find(({ file }) => file.endsWith(f))!.text, f).toMatch(/<TabList\b/);
  });

  it("one steps footer: no steps window types its own footer bar", () => {
    expect(found(/function OnePartFooter\(/g)).toEqual([]);
    expect(found(/data-window-footer="" className="sticky bottom-0/g).filter((m) => !m.includes("steps-frame.tsx"))).toEqual([]);
    expect(found(/const bar = "sticky bottom-0/g)).toEqual([]);
  });

  it("no second copy of a shared piece: one window opener, one password form, no hand-made menu counts", () => {
    expect(found(/export function PanelButton\(/g).filter((m) => !m.includes("orders/step-view.tsx"))).toEqual([]);
    expect(found(/export function PasswordForm\(/g)).toHaveLength(1);
    expect(found(/<span className="[^"]*rounded-full bg-warn-soft px-1\.5/g)).toEqual([]);
    expect(found(/<button[^>]*className="[^"]*rounded-(?:lg|xl)[^"]*(?:border border-line-strong|bg-action-solid)/g)).toEqual([]);
  });

  it("one switch and one row of tabs: list stages are tabs, every switch draws segmentClass, a page has one row", () => {
    // Chips are only for a filter inside a box (look="chips"); a page's stages and views are LinkTabs' tabs.
    expect(found(/look="chips"/g).filter((f) => !f.includes("companies/[id]/sections.tsx"))).toEqual([]);
    // Segmented, SegmentedChoice, ViewSwitch and the order's Documents switch draw the one segment.
    expect(found(/rounded-lg px-2\.5 text-xs font-medium whitespace-nowrap|rounded-xl bg-surface-3 p-1/g)).toEqual([]);
    expect(found(/segmentClass\(/g).length).toBeGreaterThanOrEqual(3);
    // A page's views go beside its title (PageHeader views), not as a second row over the tabs.
    expect(found(/label="(?:Which side|Boards|Whose)"\s+className="mb-4"/g)).toEqual([]);
    // No icons inside a list's tabs (they read as chips; Inquiries has none).
    expect(found(/label: <><\w+ aria-hidden \/> /g)).toEqual([]);
  });

  it("one way for each action: quiet ✎ Edit, outline + in a box, blue next step, orange only to create, delete in ⋯", () => {
    // ✎ Edit is EditButton (ghost, small, link colour); it has no size of its own.
    expect(found(/<EditButton[^>]*\ssize=/g)).toEqual([]);
    // No small orange button: orange is a list's create (md); a record's next step and a window's save are blue.
    expect(found(/variant="strong" size="sm"/g)).toEqual([]);
    expect(found(/variant="soft" onClick=\{onNext/g)).toEqual([]);
    // A record's Remove opens from its ⋯ (VoidWindow), not a red button under its boxes (rows and windows keep theirs).
    expect(found(/<VoidForm\b/g).filter((f) => f.includes("app/(app)/payments/"))).toEqual([]);
    // A list's export is ⋯ (Export to Excel, Export as CSV), never a button beside the main one.
    expect(found(/actions=\{<ExportCsv/g)).toEqual([]);
  });

  it("one box: one title style, no table or tiles framed inside a box, figures as the facts line, one details piece", () => {
    // Box and panel titles draw boxTitleClass (not a semibold or base-size copy).
    expect(found(/className="(?:mb-1 )?text-lead font-semibold"|id="details-title" className="text-base/g)).toEqual([]);
    // Read-only lines and performance figures have no frame of their own inside their box.
    expect(found(/overflow-x-auto rounded-lg border border-line focus-visible/g)).toEqual([]);
    expect(found(/block h-full rounded-lg border border-line px-3 py-2\.5/g)).toEqual([]);
    // The ledger's ageing and the roles' figures are the facts line; no hand-made grid of tiles.
    expect(found(/<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">\s*<StatTile/g)).toEqual([]);
    expect(SOURCES.find((f) => f.file.endsWith("ledger/ledger-parts.tsx"))?.text).toContain("<FactsLine");
    // Details: label at the left (DetailsCard, DetailList, BoxFacts), not a "label above value" grid.
    expect(found(/<dt className="text-xs text-muted">/g).filter((f) => f.includes("common/record.tsx") || f.includes("primitives.tsx"))).toEqual([]);
    // One board: the orders board draws the shared Board (no dashed "Nothing here").
    expect(found(/border-2 border-dashed border-line-strong px-3 py-6 text-center text-xs text-muted">Nothing here/g)).toEqual([]);
  });

  it("no page keeps its own small-button class (SMALL, editClass, BTN)", () => {
    expect(found(/const (?:SMALL|editClass|BTN) = /g)).toEqual([]);
  });

  it("colours come from the theme's variables, never typed as #hex in a class", () => {
    expect(found(/(?<![\w-])(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|divide|shadow)-\[#[0-9a-fA-F]{3,8}\]/g)).toEqual([]);
  });
});
