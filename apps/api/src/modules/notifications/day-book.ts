import type { MessageListRow } from "@kebo/shared";

/** The sections of the morning email, in their order. */
export const DAY_SECTIONS = [
  "Missed",
  "Follow-ups today",
  "Money to collect",
  "Pay the factory",
  "Orders waiting on you",
  "Quotations ending",
  "Inquiries waiting",
  "Missed by your team",
  "Late across the team",
] as const;
export type DaySection = (typeof DAY_SECTIONS)[number];

/**
 * The morning's reminders, gathered per person while they are sent, for the one "Your day" email each person
 * gets (claude/messages-design.md). The bell and the phone get each reminder on its own; the email gets them
 * all at once, so nobody receives twenty emails a morning.
 */
export class DayBook {
  private readonly by = new Map<string, Map<DaySection, MessageListRow[]>>();

  add(ids: (string | null | undefined)[], section: DaySection, row: MessageListRow) {
    for (const id of new Set(ids.filter((x): x is string => !!x))) {
      const mine = this.by.get(id) ?? new Map<DaySection, MessageListRow[]>();
      const rows = mine.get(section) ?? [];
      if (!rows.some((r) => r.ref === row.ref && r.what === row.what)) rows.push(row);
      mine.set(section, rows);
      this.by.set(id, mine);
    }
  }

  people() {
    return [...this.by.keys()];
  }

  sections(id: string) {
    const mine = this.by.get(id);
    return DAY_SECTIONS.map((title) => ({ title, rows: [...(mine?.get(title) ?? [])].sort((a, b) => Number(!!b.late) - Number(!!a.late)) }));
  }
}

/** "RFQ-2026-0483 · Lagos Water Ltd" → its number and the rest. */
export const splitLabel = (label: string | null | undefined) => {
  const [ref, ...rest] = (label ?? "").split(" · ");
  return { ref: ref || "—", party: rest.join(" · ") };
};
