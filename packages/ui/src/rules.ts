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
    /** Lines to edit as a table, like a payment plan's installments (rule 4). */
    table: "md:w-[960px]",
    /** Items, prices, and every part at once (Edit all, a new record's steps) (rules 4 and 7). */
    items: "md:w-[1180px]",
    /** The one inset of a window: its head, its body, its buttons (20px; 24px from 640). */
    inset: "px-5 sm:px-6",
    /** A window's body: the inset at the sides, 20px above and below. */
    body: "p-5 sm:px-6",
  },
  box: {
    /** The one inset of a box: its head, its rows, its tables' first and last cells, its notes (16px; 20px from 640). */
    inset: "px-4 sm:px-5",
    /** A box's own body: the inset at the sides, 16px above and below. */
    body: "px-4 py-4 sm:px-5",
  },
  form: {
    /** A form's fields side by side: as many 14rem columns as fit, one on a phone (a payment in or out alike). */
    fields: "grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3",
  },
  /** The steps window's side bar, like a settings window (rule 11). */
  stepsRail: "md:grid-cols-[248px_minmax(0,1fr)]",
  page: {
    /**
     * How wide the app gets and its sides — the page and the top bar alike, so they line up on any screen: the
     * whole width up to 1920px (a big screen is filled, not a strip in the middle), 16px at the sides on a phone,
     * 24px from 640, 32px from 1280.
     */
    width: "mx-auto w-full max-w-[1920px]",
    sides: "px-4 sm:px-6 xl:px-8",
    /**
     * The one app frame (canvas row "The one of each, frames", AFOne): the company app and the platform alike —
     * the width and sides above, 18px under the top bar, and its parts one under another `gap` apart.
     */
    frame: "mx-auto flex w-full max-w-[1920px] flex-col gap-4 px-4 pt-[18px] sm:px-6 xl:px-8",
    /** The one space between the parts of a page (its header, tabs, filters, boxes), down and across. */
    gap: "gap-4",
    /** Parts one under another, `gap` apart: a page, a column of boxes. */
    stack: "flex min-w-0 flex-col gap-4",
    /**
     * The settings pages (and other one-form pages): one 720px column (rule 4), at the page's left edge like every
     * other page's title and boxes (centred, its title started mid-page: sweep 20 Nov).
     */
    column: "flex w-full max-w-[720px] min-w-0 flex-col gap-4",
    /**
     * A record page (the inquiry, a supplier offer, a quotation): its boxes, and beside them the one side panel,
     * 320px from 1024 on every record and every tab; below that one column, the panel a bar that opens a sheet
     * (rule 3; canvas board "What changes, piece by piece").
     */
    withPanel: "grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_320px]",
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
