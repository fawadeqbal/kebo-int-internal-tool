import type { QueryStatus } from "@/lib/db/schema";

/**
 * The query status lifecycle — the single place that decides which status
 * changes are allowed. The UI only offers the moves listed here.
 */
export const TRANSITIONS: Record<QueryStatus, { to: QueryStatus; label: string; reopen?: boolean }[]> = {
  pending: [
    { to: "processing", label: "Start processing" },
    { to: "not_completed", label: "Close as not completed" },
  ],
  processing: [
    { to: "completed", label: "Mark completed" },
    { to: "not_completed", label: "Close as not completed" },
  ],
  completed: [{ to: "processing", label: "Reopen", reopen: true }],
  not_completed: [{ to: "pending", label: "Reopen", reopen: true }],
};

export const OPEN_STATUSES: QueryStatus[] = ["pending", "processing"];
export const CLOSED_STATUSES: QueryStatus[] = ["completed", "not_completed"];

export function canTransition(from: QueryStatus, to: QueryStatus): boolean {
  return TRANSITIONS[from].some((t) => t.to === to);
}

export function isReopen(from: QueryStatus, to: QueryStatus): boolean {
  return TRANSITIONS[from].some((t) => t.to === to && t.reopen);
}

export interface StatusEvent {
  toStatus: QueryStatus;
  changedAt: Date;
}

/**
 * Time spent in each status, computed from the status history.
 * The last (current) status runs until `now`.
 */
export function timeInStatus(history: StatusEvent[], now: Date = new Date()): Partial<Record<QueryStatus, number>> {
  const sorted = [...history].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
  const totals: Partial<Record<QueryStatus, number>> = {};
  sorted.forEach((event, i) => {
    const end = sorted[i + 1]?.changedAt ?? now;
    totals[event.toStatus] = (totals[event.toStatus] ?? 0) + Math.max(0, end.getTime() - event.changedAt.getTime());
  });
  return totals;
}

/** Turnaround: from creation until completed (or until now while still open). */
export function turnaroundMs(createdAt: Date, completedAt: Date | null, now: Date = new Date()): number {
  return (completedAt ?? now).getTime() - createdAt.getTime();
}
