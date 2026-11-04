"use client";

import type { ReactNode } from "react";
import { Card, cn } from "@kebo/ui";
import { EditButton } from "@/components/common/edit-button";
import { useSidePanel } from "@/components/common/panel";

export interface GroupValue {
  label: string;
  /** null / "": missing — "+ Add" in place when the card can be edited. */
  value: ReactNode;
  wide?: boolean;
  /** Lives elsewhere: shown as it is, with no "+ Add" (e.g. "from their Settings"). */
  readOnly?: boolean;
}

const missing = (v: ReactNode) => v === null || v === undefined || v === "";

/**
 * A group of details in its own card (design system: Settings frame / record
 * Details): title, one line of what it holds, ✎ Edit in the header for its
 * side panel; the values read-only, label above value, a missing one "+ Add"
 * in place. Without `panel` the card is read-only (the values live elsewhere,
 * said in `note`).
 */
export function GroupCard({
  id,
  title,
  description,
  items,
  panel,
  editLabel,
  note,
  flash,
  columns = 3,
}: {
  id: string;
  title: string;
  description: string;
  items: GroupValue[];
  panel?: string;
  editLabel?: string;
  /** Under the values: where read-only values are changed. */
  note?: ReactNode;
  flash?: boolean;
  columns?: 2 | 3;
}) {
  const p = useSidePanel(panel ?? "");
  return (
    <Card id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-20", flash && "animate-flash")}>
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-sm font-semibold text-text">
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-muted">{description}</p>
        </div>
        {panel && (
          <EditButton aria-label={editLabel ?? `Edit ${title.toLowerCase()}`} aria-haspopup="dialog" onClick={() => p.openPanel()} />
        )}
      </div>
      <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3 px-4 py-3.5 sm:grid-cols-2 sm:gap-y-4", columns === 3 && "xl:grid-cols-3")}>
        {items.map((i) => (
          <div
            key={i.label}
            className={cn("flex min-w-0 items-baseline justify-between gap-3 sm:block", i.wide && "sm:col-span-2 xl:col-span-3")}
          >
            <dt className="shrink-0 text-xs text-text-2 sm:mb-0.5">{i.label}</dt>
            <dd className="min-w-0 text-right text-sm font-medium break-words text-text sm:text-left">
              {missing(i.value) ? (
                panel && !i.readOnly ? (
                  <button
                    type="button"
                    onClick={() => p.openPanel()}
                    aria-label={`Add ${i.label.toLowerCase()}`}
                    className="font-semibold text-primary hover:underline"
                  >
                    + Add
                  </button>
                ) : (
                  <span className="text-muted">—</span>
                )
              ) : (
                i.value
              )}
            </dd>
          </div>
        ))}
      </dl>
      {note && <p className="border-t border-line px-4 py-2.5 text-xs text-text-2">{note}</p>}
    </Card>
  );
}
