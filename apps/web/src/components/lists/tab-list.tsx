import type { ReactNode } from "react";
import { Card, CardHeader, cn } from "@kebo/ui";
import { ViewSwitch } from "@/components/common/view-switch";

/**
 * A list inside a record's tab (canvas "RFQ Desk — the pieces", board "A list inside a record"; design rule 15):
 * a card with the list's name and one line of counts, List | Compare once there is something to compare, and
 * plain buttons (the record's header keeps the one strong button). On a phone the buttons go full width and the
 * switch's halves share the row. Its rows are the card's children.
 *
 * `add` (canvas board "Supplier offers on a phone"): the list's own "+ New …" button, drawn once — on a laptop at
 * the end of the card's header, on a phone the list's last row (quiet, the card's width), so the header has no
 * buttons there.
 */
export function TabList({
  title,
  summary,
  views,
  buttons,
  add,
  children,
}: {
  title: string;
  /** One line of counts ("4 asked · 2 offers in · 1 waiting"). */
  summary?: ReactNode;
  /** List | Compare: the one on screen and each view's link; none until there are two to compare. */
  views?: { label: string; current: string; options: { key: string; label: string; icon: ReactNode; href: string }[] } | null;
  buttons?: ReactNode;
  /** The list's "+ New …" button (one button; its window may come with it). */
  add?: ReactNode;
  children: ReactNode;
}) {
  const actions =
    views || buttons ? (
      // A phone: the row would wrap, so each goes full width (design rules 4); the switch's halves share it.
      <span className="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:flex-col max-sm:items-stretch max-sm:*:w-full max-sm:[&>nav>a]:flex-1 max-sm:[&>nav>a]:justify-center sm:justify-end">
        {views && <ViewSwitch label={views.label} compact="sm" current={views.current} views={views.options} />}
        {buttons}
      </span>
    ) : undefined;
  if (!add)
    return (
      <Card className="overflow-clip">
        <CardHeader title={title} description={summary} actions={actions} />
        {children}
      </Card>
    );
  return (
    <Card className="grid grid-cols-[minmax(0,1fr)] overflow-clip md:grid-cols-[minmax(0,1fr)_auto]">
      <CardHeader title={title} description={summary} actions={actions} className="md:col-start-1 md:row-start-1" />
      <div
        data-tab-add=""
        className={cn(
          "max-md:order-last max-md:border-t max-md:border-line md:col-start-2 md:row-start-1 md:flex md:items-center md:border-b md:border-line md:pr-5",
          // A phone: the last row, its words in the main colour across the card.
          "max-md:[&>button]:h-12 max-md:[&>button]:w-full max-md:[&>button]:rounded-none max-md:[&>button]:border-0 max-md:[&>button]:bg-transparent max-md:[&>button]:text-sm max-md:[&>button]:font-semibold max-md:[&>button]:text-primary max-md:[&>button]:shadow-none",
        )}
      >
        {add}
      </div>
      <div className="min-w-0 md:col-span-2">{children}</div>
    </Card>
  );
}
