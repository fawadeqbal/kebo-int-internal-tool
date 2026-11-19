/**
 * The numbers of the design rules, in one place (canvas "RFQ Desk — the pieces", board "The rules file"; the words
 * are in the doc "RFQ Desk — design rules"). The pieces read these instead of writing sizes in their own classes,
 * so a rule changes here once and every page follows. The class names are whole strings on purpose: Tailwind finds
 * them in this file (globals.css @source packages/ui/src).
 */
export const RULES = {
  window: {
    /** Edit one part: a smaller window (rule 4). */
    part: "md:w-[640px]",
    /** A part with wide rows, like a payment plan, and any window that sets no width (rule 4). */
    wideRows: "md:w-[720px]",
    /** Items, prices, and every part at once (Edit all, a new record's steps) (rules 4 and 7). */
    items: "md:w-[1180px]",
  },
  /** The steps window's side bar, like a settings window (rule 11). */
  stepsRail: "md:grid-cols-[248px_minmax(0,1fr)]",
  page: {
    /**
     * The one app frame (canvas row "The one of each, frames", AFOne): the company app and the platform alike —
     * 1440px at most, centred, 16px at the sides (24px from 640), 18px under the top bar.
     */
    frame: "mx-auto w-full max-w-[1440px] px-4 pt-[18px] sm:px-6",
    /** The settings pages (and other one-form pages): one centred 720px column (rule 4). */
    column: "mx-auto w-full max-w-[720px]",
    /**
     * A record page (the inquiry, a supplier offer, a quotation): its boxes, and beside them the one side panel,
     * 320px from 1024 on every record and every tab; below that one column, the panel a bar that opens a sheet
     * (rule 3; canvas board "What changes, piece by piece").
     */
    withPanel: "grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_320px]",
    /**
     * An order's page, until it moves onto the record pieces: its panel 380px from 1024, 340px beside the open
     * menu on a laptop, 420px where the page has room; one column below that.
     */
    withSheetPanel: "grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_340px] roomy:grid-cols-[minmax(0,1fr)_420px]",
  },
  choices: {
    /** Past this many choices, a filter's list starts with a box to type in (rule 15). */
    list: 8,
  },
  board: {
    /** Cards a board column shows before "Show N more" (rule 15). */
    perColumn: 12,
  },
} as const;
