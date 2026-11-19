"use client";

import { SegmentedChoice } from "@kebo/ui/client";
import Link from "next/link";
import { useState } from "react";
import { Card, CardHeader, cn } from "@kebo/ui";

export interface PerfFigure {
  label: string;
  value: string;
  sub?: string;
  href?: string;
  /** Bad news (overdue): the sub line in red, with the words. */
  meaning?: "bad";
  /** A figure of today (what is owed), the same whichever span. */
  now?: boolean;
}

/** The Performance card's figures, with the Year · All time switch. */
export function PerformanceView({
  title,
  description,
  year,
  all,
  yearLabel,
}: {
  title: string;
  description: string;
  year: PerfFigure[];
  all: PerfFigure[];
  yearLabel: string;
}) {
  const [scope, setScope] = useState<"year" | "all">("all");
  const list = scope === "year" ? year : all;
  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        actions={
          <SegmentedChoice
            label="Which span"
            value={scope}
            onChange={setScope}
            options={[
              { value: "year", label: `Year ${yearLabel}` },
              { value: "all", label: "All time" },
            ]}
          />
        }
      />
      <ul
        className={cn("grid grid-cols-2 gap-2 p-4", list.length === 5 ? "sm:grid-cols-3 lg:grid-cols-5" : "sm:grid-cols-4")}
        aria-live="polite"
      >
        {list.map((f) => {
          const body = (
            <>
              <span className="block text-xs text-text-2">{f.label}</span>
              <span className="block truncate text-lg leading-6 font-semibold">{f.value}</span>
              {f.sub && (
                <span className={cn("block truncate text-xs", f.meaning === "bad" ? "font-medium text-bad" : "text-muted")}>
                  {f.sub}
                  {f.now ? " · today" : ""}
                </span>
              )}
            </>
          );
          return (
            <li key={f.label} className="min-w-0">
              {f.href ? (
                <Link href={f.href} className="block h-full rounded-lg border border-line px-3 py-2.5 hover:border-line-strong">
                  {body}
                </Link>
              ) : (
                <div className="h-full rounded-lg border border-line px-3 py-2.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
