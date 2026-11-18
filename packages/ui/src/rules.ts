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
    /** A record page: its boxes, and the side panel beside them (rule 3). */
    withPanel: "lg:grid-cols-[minmax(0,1fr)_300px]",
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
