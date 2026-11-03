"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { Button, cn } from "@kebo/ui";
import { toast } from "@kebo/ui/client";
import type { ActionState } from "@/lib/actions";
import { ConfirmDialog } from "./dialog";
import { FloatingMenu, useIsPhone } from "./floating";
import { useOpenPanel } from "./panel";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * One entry of a ⋯ menu, as plain data (a server page can pass it): a link,
 * a URL side panel to open ("Edit"), a link to copy, or a removal — always
 * last, in red, and only after a confirm.
 */
export type MenuEntry =
  | { label: string; href: string; newTab?: boolean; download?: boolean }
  | { label: string; panel: string; id?: string }
  | { label: string; copy: string }
  | { label: string; danger: true; confirm: { title: string; body?: string; confirmLabel: string }; action: Action }
  | { separator: true };

const itemClass =
  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-text hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none";

/**
 * ⋯ and its menu: everything a page or a row can do other than its one main
 * thing (duplicate, export, copy link…; delete last, in red, with a confirm).
 * `phoneItems` show only on a phone, first: the page header's paper buttons
 * (View / Print, Download PDF) fold in here. `row`: the quiet ⋯ at the end of
 * a list row (lit when the row is hovered or focused).
 */
export function MoreMenu({
  items,
  phoneItems = [],
  label = "More actions",
  row,
  className,
}: {
  items: MenuEntry[];
  phoneItems?: MenuEntry[];
  /** For screen readers and the sheet's title on a phone ("Actions for Lahore Pharma"). */
  label?: string;
  row?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<Extract<MenuEntry, { danger: true }> | null>(null);
  const [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const openPanel = useOpenPanel();
  const phone = useIsPhone();
  const entries = [...(phone ? phoneItems : []), ...(phone && phoneItems.length && items.length ? [{ separator: true } as const] : []), ...items];
  if (!entries.length) return null;

  const run = (e: MenuEntry) => {
    setOpen(false);
    if ("separator" in e) return;
    if ("href" in e) {
      if (e.newTab) window.open(e.href, "_blank", "noopener");
      else router.push(e.href);
    } else if ("panel" in e) openPanel(e.panel, e.id);
    else if ("copy" in e) {
      const text = new URL(e.copy, window.location.href).toString();
      void navigator.clipboard?.writeText(text).then(
        () => toast("Link copied"),
        () => toast("Could not copy the link"),
      );
    } else setAsking(e);
  };

  const confirm = async () => {
    if (!asking) return;
    setBusy(true);
    try {
      const r = await asking.action({}, new FormData());
      if (r && r.ok === false) toast(r.message ?? "Could not do that.");
      else router.refresh();
    } finally {
      setBusy(false);
      setAsking(null);
    }
  };

  return (
    <>
      <Button
        ref={button}
        size={row ? "icon-sm" : "icon"}
        variant="secondary"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          row &&
            "border-transparent bg-transparent text-muted shadow-none group-hover:border-line group-hover:bg-surface group-hover:text-text group-hover:shadow-card group-focus-within:border-line group-focus-within:bg-surface group-focus-within:text-text aria-expanded:border-line aria-expanded:bg-surface",
          className,
        )}
      >
        <MoreHorizontal aria-hidden />
      </Button>
      {open && (
        <FloatingMenu anchor={() => button.current} onClose={() => setOpen(false)} label={label} width={220}>
          {entries.map((e, i) =>
            "separator" in e ? (
              <span key={`sep-${i}`} role="separator" className="my-1 block h-px bg-line" />
            ) : "href" in e && e.download ? (
              <a key={e.label} role="menuitem" href={e.href} download className={itemClass} onClick={() => setOpen(false)}>
                {e.label}
              </a>
            ) : (
              <button
                key={e.label}
                type="button"
                role="menuitem"
                onClick={() => run(e)}
                className={cn(itemClass, "danger" in e && "text-bad hover:bg-bad-soft focus-visible:bg-bad-soft")}
              >
                {e.label}
              </button>
            ),
          )}
        </FloatingMenu>
      )}
      {asking && (
        <ConfirmDialog title={asking.confirm.title} confirmLabel={asking.confirm.confirmLabel} danger busy={busy} onCancel={() => setAsking(null)} onConfirm={() => void confirm()}>
          {asking.confirm.body}
        </ConfirmDialog>
      )}
    </>
  );
}

/** The ⋯ at the end of a list row (MoreMenu, `row`). */
export function RowMenu({ items, label }: { items: MenuEntry[]; label: string }): ReactNode {
  return <MoreMenu items={items} label={label} row />;
}
