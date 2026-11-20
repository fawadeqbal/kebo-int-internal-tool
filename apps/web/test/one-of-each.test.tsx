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

  it("one way for each action: quiet ✎ Edit, outline + in a box, one button colour (the theme's), delete in ⋯", () => {
    // ✎ Edit is EditButton (ghost, small, link colour); it has no size of its own.
    expect(found(/<EditButton[^>]*\ssize=/g)).toEqual([]);
    // The big button is a list's create (md), never small; it takes the theme colour like every main button.
    expect(found(/variant="strong" size="sm"/g)).toEqual([]);
    const ui = SOURCES.find(({ file }) => file.endsWith("packages/ui/src/primitives.tsx"))!.text;
    expect(ui.match(/^\s*strong: "([^"]*)"/m)?.[1]).toContain("bg-primary-solid");
    expect(found(/bg-action-solid/g).filter((m) => /<(Link|button)\b|variant/.test(m))).toEqual([]);
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

  it("one page top: no icon tile before a title, no help line on a list, a record titled by its name", () => {
    expect(found(/data-slot="page-icon"|MODULE_ICONS/g)).toEqual([]);
    expect(found(/"Every amount that came in or went out"|"Every account and what is in it"/g)).toEqual([]);
    // The path says the menu's words ("Money", not "Finance").
    expect(found(/\{ label: "Finance" \}/g)).toEqual([]);
    // A role's page is titled by the role (not "Roles").
    expect(found(/title="Roles" \/>/g).filter((f) => f.includes("roles/[key]"))).toEqual([]);
  });

  it("one record: the side panel on every tab, adds open a window, delete in ⋯", () => {
    // Customer and supplier: the panel comes from the layout (every tab), not from one tab's RecordBody.
    expect(found(/<RecordBody\b/g).filter((f) => /\/(customers|suppliers)\/\[id\]\//.test(f))).toEqual([]);
    // No add form always open in a side panel (New contact, Add a note): each opens its window.
    expect(found(/panelLabel="(?:New contact|Add a note)"/g)).toEqual([]);
    // Remove a customer or a supplier from its ⋯ (not a red button under the boxes).
    expect(found(/label="Remove this (?:customer|supplier)"/g)).toEqual([]);
  });

  it("one table: one head (THead, Th, the faint band), one row size, numbers as RefCode", () => {
    expect(found(/\[&_thead_th\]:bg-surface-2/g)).toEqual([]);
    expect(found(/tableClassName="text-md"/g)).toEqual([]);
    // A record's read table draws THead/Th, not a hand-made head (editors in windows keep their grids).
    const read = ["sourcing/page.tsx", "person-spending.tsx", "quotation-tab.tsx", "customer-payments.tsx", "payment-record.tsx", "targets-grid.tsx", "domain-card.tsx", "entry-body.tsx", "lines-sheet.tsx"];
    expect(found(/<thead className="bg-surface-2|<tr className="bg-surface-2 text-(?:left )?text-xs/g).filter((f) => read.some((r) => f.includes(r)))).toEqual([]);
    // Numbers (RFQ-, QUO-, SO-, PO-) are RefCode, not plain mono or bold words.
    expect(found(/cell: \(d\) => d\.refNo \}/g)).toEqual([]);
  });

  it("on a phone: every record's panel folds into its bar, money tables are phone rows, no phone-only chip bar", () => {
    // RecordBody folds a panel into a SideSheet bar unless the panel folds itself (inquiry, order: folds).
    expect(SOURCES.find((f) => f.file.endsWith("records/record-frame.tsx"))?.text).toContain("<SideSheet");
    expect(found(/export function RecordNav\b/g)).toEqual([]);
    // The money lists have their phone rows (or phone-sized columns).
    for (const f of ["finance/ledger/page.tsx", "finance/sections.tsx", "access/roles/page.tsx", "customers/[id]/money/page.tsx", "suppliers/[id]/costs/page.tsx"])
      expect(SOURCES.find((s) => s.file.endsWith(f))?.text, f).toContain("<PhoneList");
    // History is read through readableHistory (ids out, amounts grouped).
    expect(found(/readableDates\(e\.summary\)|readableDates\(r\.summary\)/g)).toEqual([]);
  });

  it("a row that stands for a record opens from a click anywhere on it (Tr href), never only from a link in one cell", () => {
    // A row (<tr>/<Tr>) whose first cells hold a link to a page, with no href on the row itself. Kept: rows whose
    // link opens a file in a new tab (a receipt, an inquiry's files), and the approvals queue (no page of its own).
    const KEPT = ["orders/cost-sheet.tsx", "deals/inquiry-files.tsx", "inquiries/[id]/files/page.tsx", "approvals/page.tsx"];
    const bad = SOURCES.filter(({ file }) => !KEPT.some((k) => file.replaceAll("\\", "/").includes(k))).flatMap(({ file, text }) => {
      const lines = text.split("\n");
      return lines.flatMap((line, i) => {
        if (!/<(tr|Tr)\b(?![^>]*href)[^>]*\bkey=/.test(line)) return [];
        const next = lines.slice(i + 1, i + 7).join("\n");
        return /<Link[^>]*href=|<RefCode href=/.test(next) ? [`${file}:${i + 1}`] : [];
      });
    });
    expect(bad).toEqual([]);
    // One handler for every table (RowClicks, in the app's and the platform's frames), not a link stretched over a row.
    expect(found(/closest[^(]*\(\s*["'`]tr\[data-href\]/g).map((m) => m.split(":")[0])).toEqual(["apps/web/src/components/common/row-clicks.tsx"]);
    expect(found(/<(tr|Tr)\b[^>]*\brelative\b/g)).toEqual([]);
    for (const frame of ["app/(app)/layout.tsx", "app/platform/(admin)/layout.tsx"])
      expect(SOURCES.find(({ file }) => file.replaceAll("\\", "/").endsWith(frame))?.text).toContain("<RowClicks />");
  });

  it("no box inside a box: a box's note is BoxNote, a phone list in a box is rows across it, one inset (px-4 sm:px-5)", () => {
    // A rounded, tinted or framed note inside a box (mx-… rounded-md bg-warn-soft) is a box in a box on a phone.
    expect(found(/mx-\S+ rounded-md bg-(warn|surface-2|info)-soft|mx-\S+ [^"]*rounded-md bg-surface-2/g)).toEqual([]);
    // A phone's list of parts inside a box is not framed again.
    expect(found(/divide-y divide-line rounded-lg border border-line sm:hidden/g)).toEqual([]);
    // A box's own inset is the card's (px-4 sm:px-5), never 18px.
    expect(found(/\b(px|mx|max-sm:px)-\[18px\]/g)).toEqual([]);
  });

  it("nothing is kept that nothing uses: every export of the app and the design system is used somewhere else", () => {
    // Next.js reads these by name from a page, a layout or a route.
    const NEXT = new Set(["default", "metadata", "generateMetadata", "dynamic", "revalidate", "GET", "POST", "PUT", "DELETE", "PATCH", "generateStaticParams", "viewport", "runtime", "config", "proxy"]);
    const TESTS = resolve(process.cwd(), "test");
    const tests = files(TESTS).map((f) => readFileSync(f, "utf8"));
    // Every file reads (the printed papers and the site use the app's pieces too), the tests as well.
    const all = ROOTS.flatMap(files).map((f) => ({ file: relative(resolve(process.cwd(), "../.."), f), text: readFileSync(f, "utf8") }));
    const texts = all.map((x) => x.text).concat(tests);
    const bad = all.flatMap(({ file, text }, i) =>
      [...text.matchAll(/^export (?:async )?(?:function|const|class|interface|type|enum) (\w+)/gm)]
        .map((m) => m[1]!)
        .filter((n) => !NEXT.has(n))
        .filter((n) => {
          const word = new RegExp(`\\b${n}\\b`, "g");
          // Used again in its own file (only the export is extra), or by another file: kept.
          if ((text.match(word) ?? []).length > 1) return false;
          return !texts.some((t, j) => j !== i && new RegExp(`\\b${n}\\b`).test(t));
        })
        .map((n) => `${file}: ${n}`),
    );
    expect(bad).toEqual([]);
  });

  it("one text link (linkClass) and one card look (Card, cardClass): no page types its own", () => {
    // A link in text: text-primary with hover:underline typed by hand (font-medium, -semibold, -normal…).
    expect(found(/className="[^"]*\btext-primary\b[^"]*\bhover:underline\b[^"]*"/g).filter((m) => !/hover:text-/.test(m))).toEqual([]);
    // A box drawn by hand with the card's frame (rounded-xl … shadow-card): Card, or cardClass where it cannot be one.
    expect(found(/rounded-xl border border-line bg-surface shadow-card"/g)).toEqual([]);
  });

  it("one small caps label (capsClass) and one sub-heading (subTitleClass): no page types its own", () => {
    expect(found(/className="[^"]*\btracking-wide\b[^"]*\buppercase\b[^"]*"/g).filter((m) => !m.includes("font-doc-display"))).toEqual([]);
    expect(found(/<h[234]\b[^>]*className="[^"]*\btext-sm\b[^"]*\bfont-(semibold|bold)\b[^"]*"/g).filter((m) => !/text-muted|text-text-2|uppercase/.test(m))).toEqual([]);
  });

  it("one empty dash (Dash), one count bubble (CountDot), one copy of each number helper (lib/format)", () => {
    expect(found(/<span className="(font-normal )?text-muted">—<\/span>/g).filter((m) => !m.startsWith("packages/ui/src/primitives.tsx"))).toEqual([]);
    expect(found(/rounded-full bg-(bad|action|primary)-solid px-1[^"]*text-white/g).filter((m) => !m.startsWith("packages/ui/src/primitives.tsx"))).toEqual([]);
    // Two decimals grouped, whole numbers grouped, files a browser shows: num2, num0, VIEWABLE.
    expect(found(/^const (n2|grouped|n0) = \(v: string( \| number)?\) => (Number|Math)/gm)).toEqual([]);
    expect(found(/^const VIEWABLE = \//gm)).toEqual([]);
  });

  it("spacing is set once (RULES): the frame's width and sides, the gap between a page's parts, a box's and a window's inset", () => {
    // The page and the top bar take RULES.page.width and sides; nothing caps a page at its own width.
    expect(found(/max-w-\[1440px\]/g)).toEqual([]);
    // A page's parts are spaced by the frame or a Stack (RULES.page.gap), not by a margin on each part.
    const pageParts = found(/<(PageHeader|FilterCard|LinkTabs|StatRow|Notice|Card|SelectBar)\b[^>]*className="[^"]*\b(mb|mt)-(4|5|6)\b/g);
    // (The sign-in pages keep their own short card, AuthShell.)
    expect(pageParts.filter((m) => !/src\/app\/(login|connect)\//.test(m))).toEqual([]);
    expect(found(/<header className="mb-4" data-page-label/g)).toEqual([]);
    // A box's inset and a window's inset are typed once (RULES.box, RULES.window).
    expect(found(/className="[^"]*\bpx-4 sm:px-5\b[^"]*"|className="[^"]*\bpx-5 max-sm:px-4\b[^"]*"/g)).toEqual([]);
    expect(found(/className="[^"]*\bp-5 [^"]*sm:px-6\b[^"]*"/g).filter((m) => !/\/(site|print)\//.test(m) && !m.includes("follow-ups") && !m.includes("note-forms"))).toEqual([]);
    // A table's first and last cells line up with its box's title.
    const ui = SOURCES.find(({ file }) => file.endsWith("packages/ui/src/primitives.tsx"))!.text;
    expect(ui).toMatch(/const EDGE = "first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5"/);
  });

  it("no page keeps its own small-button class (SMALL, editClass, BTN)", () => {
    expect(found(/const (?:SMALL|editClass|BTN) = /g)).toEqual([]);
  });

  it("colours come from the theme's variables, never typed as #hex in a class", () => {
    expect(found(/(?<![\w-])(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|divide|shadow)-\[#[0-9a-fA-F]{3,8}\]/g)).toEqual([]);
  });
});
