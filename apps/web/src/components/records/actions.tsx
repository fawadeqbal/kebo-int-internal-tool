import type { ReactNode } from "react";
import { buttonClass } from "@kebo/ui";
import type { ActionState } from "@/lib/actions";
import { MoreMenu, type MenuEntry } from "@/components/common/more-menu";
import { OpenPanelButton } from "@/components/common/panel";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** What an action does: a link or a download, a window (?panel=), a link to copy, or a yes first then a change. */
type Run =
  | { href: string; newTab?: boolean; download?: boolean }
  | { panel: string; panelId?: string }
  | { copy: string }
  | { confirm: { title: string; body?: string; confirmLabel: string }; action: Action };

/**
 * One thing a record can do (canvas board "Actions: one list per record type"): its words, where it goes — the one
 * strong button, a paper button (beside ⋯; in ⋯ on a phone) or ⋯ — what it does, and when it shows. A button that
 * holds its own window (Send R1, Customer answered) is given as `node`, for the strong button's place.
 */
export type RecordAction = {
  /** Its name in the record's list. */
  id: string;
  place: "primary" | "paper" | "more";
  /** Shown only when true (the states it shows in, and who may); left out, always. */
  when?: boolean;
} & (
  | { node: ReactNode }
  | ({
      label: string;
      /** A paper button's icon (Print, PDF). */
      icon?: ReactNode;
      /** A paper button's words in ⋯ on a phone ("Download PDF"). */
      phoneLabel?: string;
      /** For screen readers, when the words are short ("Download QUO-2026-0008 R1 as PDF"). */
      ariaLabel?: string;
      /** Last in ⋯, after a line, in red; a change asks first. */
      danger?: boolean;
    } & Run)
);

type Plain = Exclude<RecordAction, { node: ReactNode }>;

const entryOf = (a: Plain): MenuEntry => {
  if ("href" in a) return { label: a.label, href: a.href, newTab: a.newTab, download: a.download };
  if ("panel" in a) return { label: a.label, panel: a.panel, id: a.panelId, ...(a.danger ? { danger: true as const } : {}) };
  if ("copy" in a) return { label: a.label, copy: a.copy };
  return { label: a.label, confirm: a.confirm, action: a.action, ...(a.danger ? { danger: true as const } : {}) };
};

/**
 * A record's list of actions laid out the same way on every record: the strong button, the paper buttons, and ⋯
 * with the rest (danger last, after a line; the paper buttons first in it on a phone). Spread into the header.
 */
export function recordActions(menuLabel: string, list: RecordAction[]): { primary?: ReactNode; papers?: ReactNode; more?: ReactNode } {
  const shown = list.filter((a) => a.when !== false);
  const primary = shown.find((a) => a.place === "primary");
  const papers = shown.filter((a): a is Plain => a.place === "paper" && !("node" in a));
  const more = shown.filter((a): a is Plain => a.place === "more" && !("node" in a));
  const safe = more.filter((a) => !a.danger).map(entryOf);
  const danger = more.filter((a) => a.danger).map(entryOf);
  const items: MenuEntry[] = [...safe, ...(safe.length && danger.length ? [{ separator: true } as const] : []), ...danger];
  const phoneItems = papers.map((a) => entryOf({ ...a, label: a.phoneLabel ?? a.label }));

  let strong: ReactNode = undefined;
  if (primary && "node" in primary) strong = primary.node;
  else if (primary && "href" in primary)
    strong = (
      <a href={primary.href} className={buttonClass("primary", "md")} aria-label={primary.ariaLabel}>
        {primary.icon} {primary.label}
      </a>
    );
  else if (primary && "panel" in primary)
    strong = (
      <OpenPanelButton panel={primary.panel} id={primary.panelId} variant="primary" label={primary.ariaLabel}>
        {primary.icon} {primary.label}
      </OpenPanelButton>
    );

  return {
    primary: strong,
    papers: papers.length ? (
      <>
        {papers.map((a) =>
          "href" in a ? (
            <a
              key={a.id}
              href={a.href}
              {...(a.newTab ? { target: "_blank", rel: "noreferrer" } : {})}
              className={buttonClass("secondary", "sm")}
              aria-label={a.ariaLabel}
            >
              {a.icon} {a.label}
            </a>
          ) : null,
        )}
      </>
    ) : undefined,
    more: items.length || phoneItems.length ? <MoreMenu label={menuLabel} items={items} phoneItems={phoneItems} /> : undefined,
  };
}
