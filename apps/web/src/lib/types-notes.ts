import type { FollowUpKind, NoteKind, NoteTarget } from "@kebo/shared";

/** A note or call log (GET /orders|customers|factories|inquiries/:id/notes). */
export interface Note {
  id: string;
  target: { type: NoteTarget; id: string; label: string };
  kind: NoteKind;
  body: string;
  /** When it happened. */
  at: string;
  contact: { id: string; name: string } | null;
  author: { id: string; name: string };
  createdAt: string;
  editedAt: string | null;
  can: { edit: boolean; delete: boolean };
}

/** A planned call, visit or meeting (GET /follow-ups, /me/today). */
export interface FollowUp {
  id: string;
  title: string;
  kind: FollowUpKind;
  dueOn: string;
  dueAt: string | null;
  place: string | null;
  note: string | null;
  target: { type: NoteTarget; id: string; label: string } | null;
  link: string;
  assignee: { id: string; name: string };
  createdBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
  done: boolean;
  doneAt: string | null;
  doneBy: { id: string; name: string } | null;
  doneNote: string | null;
  late: boolean;
  /** The last open follow-up of an open inquiry: finishing it asks for the next one (the inquiry is never left without). */
  needsNext?: boolean;
  can: { edit: boolean; done: boolean; delete: boolean };
}

export interface FollowUpList {
  rows: FollowUp[];
  total: number;
  page: number;
  pageSize: number;
  counts: { open: number; done: number; late: number };
  canViewAll: boolean;
}

export interface Today {
  today: string;
  now: string;
  total: number;
  late: number;
  rows: FollowUp[];
}

/** The record a follow-up or note card is on: the id field the API takes, and its id. */
export interface RecordKey {
  key: "inquiryId" | "orderId" | "customerId" | "factoryId";
  id: string;
}
