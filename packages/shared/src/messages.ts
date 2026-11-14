/**
 * One message shape for everything the system tells people (claude/messages-design.md): what happened, where,
 * who it concerns, the money, what to do next, and the button. It is written once and shown three ways: an
 * email, a line in the bell, and a push to the phone (later the web browser too), so the words are the same
 * everywhere and nobody has to open the system to understand it.
 */

/** The groups messages belong to (the email's small label is coloured by group). */
export const MESSAGE_GROUPS = ["sales", "money", "orders", "approvals", "followups", "people"] as const;
export type MessageGroup = (typeof MESSAGE_GROUPS)[number];

export const MESSAGE_GROUP_LABEL: Record<MessageGroup, string> = {
  sales: "Inquiries and quotations",
  money: "Customer money",
  orders: "Orders and the factory",
  approvals: "Approvals",
  followups: "Follow-ups",
  people: "People and notes",
};

/** A line of "Who it concerns" or "The money": Customer · Lagos Water Ltd (Nigeria). */
export interface MessageRow {
  label: string;
  value: string;
}

/** A line of a list (orders late, the morning email): SO-2026-0412 · Lagos Water · Balance USD 83,650 · 3 days late. */
export interface MessageListRow {
  ref: string;
  party: string;
  what: string;
  when: string;
  /** Late or missed: drawn in red. */
  late?: boolean;
}

export interface Message {
  /** What kind of message ("quotation.accepted"): stored as the notification's type. */
  kind: string;
  group: MessageGroup;
  /** The small label: "Customer accepted". */
  tag: string;
  /** One line that says it all: the email's subject, the bell's line, the push's title. */
  subject: string;
  /** What happened, in one or two full sentences: who did what. */
  sentence: string;
  /** The record it is about: its number and what it is. */
  where?: { ref: string; title: string } | null;
  /** Who it concerns: the customer, the contact, the factory, who handles it, who did it. */
  people?: MessageRow[];
  /** The money, when money is part of it. */
  money?: MessageRow[];
  /** A short list (orders late, missed follow-ups). */
  list?: MessageListRow[];
  /** Counts at the top of the morning email. */
  tiles?: { value: string; label: string; bad?: boolean }[];
  /** Titled lists (the morning email). */
  sections?: { title: string; rows: MessageListRow[] }[];
  /** What to do now, in trade words. */
  next: string;
  /** The button's words, and where it goes (a path in the web app). */
  button: string;
  link: string;
  /** Needs action today: a red label, first in the bell. */
  urgent?: boolean;
}

/** The bell's second line and the push's body: the record's number and what to do next. */
export const messageLine = (m: Pick<Message, "where" | "next">) => [m.where?.ref, m.next].filter(Boolean).join(" · ");

/** A row that has a value (rows without one are left out). */
export const rowsOf = (rows: [string, string | null | undefined | false][]): MessageRow[] =>
  rows.filter((r): r is [string, string] => !!r[1]).map(([label, value]) => ({ label, value }));

/** "Ade Bello · +234 803 555 0142 · ade@lagoswater.ng" */
export const contactLine = (c: { name: string; phone?: string | null; whatsapp?: string | null; email?: string | null } | null | undefined) =>
  c ? [c.name, c.whatsapp || c.phone, c.email].filter(Boolean).join(" · ") : null;

/** "1 day", "3 days". */
export const daysText = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
