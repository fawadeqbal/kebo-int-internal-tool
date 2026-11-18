import type { ReactNode } from "react";
import { Card, CardHeader } from "@kebo/ui";
import { ViewSwitch } from "@/components/common/view-switch";

/**
 * A list inside a record's tab (canvas "RFQ Desk — the pieces", board "A list inside a record"; design rule 15):
 * a card with the list's name and one line of counts, List | Compare once there is something to compare, and
 * plain buttons (the record's header keeps the one strong button). On a phone the buttons go full width and the
 * switch's halves share the row. Its rows are the card's children.
 */
export function TabList({
  title,
  summary,
  views,
  buttons,
  children,
}: {
  title: string;
  /** One line of counts ("4 asked · 2 offers in · 1 waiting"). */
  summary?: ReactNode;
  /** List | Compare: the one on screen and each view's link; none until there are two to compare. */
  views?: { label: string; current: string; options: { key: string; label: string; icon: ReactNode; href: string }[] } | null;
  buttons?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="overflow-clip">
      <CardHeader
        title={title}
        description={summary}
        actions={
          // A phone: the row would wrap, so each goes full width (design rules 4); the switch's halves share it.
          <span className="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:flex-col max-sm:items-stretch max-sm:*:w-full max-sm:[&>nav>a]:flex-1 max-sm:[&>nav>a]:justify-center sm:justify-end">
            {views && <ViewSwitch label={views.label} compact="sm" current={views.current} views={views.options} />}
            {buttons}
          </span>
        }
      />
      {children}
    </Card>
  );
}
