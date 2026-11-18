import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@kebo/ui";
import { OpenPanelButton } from "@/components/common/panel";
import { MoreMenu, type MenuEntry } from "@/components/common/more-menu";
import { ViewSwitch } from "@/components/common/view-switch";
import { crumbsFor, labelFor } from "@/lib/nav";

/**
 * A list's header (canvas "RFQ Desk — the pieces", board "The top of a list"; design rule 15): its name from the
 * menu, one strong button (New …, opening its window; on a phone the + in the bottom bar does it), List | Board
 * beside it, and ⋯ for the whole list. No icon tile, no help line.
 */
export function ListHeader({
  path,
  create,
  views,
  more,
  moreLabel,
  phoneMore,
}: {
  /** The list's address: its name and path come from the menu ("/inquiries"). */
  path: string;
  /** The one strong button: its words and the window it opens; none when the person cannot add. */
  create?: { label: string; panel: string } | null;
  /** List | Board: the one on screen and each view's link. */
  views?: { current: string; options: { key: string; label: string; icon: ReactNode; href: string }[] };
  more: MenuEntry[];
  moreLabel: string;
  /** ⋯ on a phone only, first (the views fold in there). */
  phoneMore?: MenuEntry[];
}) {
  return (
    <PageHeader
      crumbs={crumbsFor(path)}
      icon={null}
      title={labelFor(path)}
      views={
        views && (
          <span className="max-sm:hidden">
            <ViewSwitch label="View" current={views.current} compact views={views.options} />
          </span>
        )
      }
      more={<MoreMenu label={moreLabel} items={more} phoneItems={phoneMore} />}
      primary={
        create && (
          <span className="max-sm:hidden">
            <OpenPanelButton panel={create.panel} variant="primary" label={create.label}>
              <Plus aria-hidden /> {create.label}
            </OpenPanelButton>
          </span>
        )
      }
    />
  );
}
