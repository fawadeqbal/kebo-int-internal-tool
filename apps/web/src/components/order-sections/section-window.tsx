"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { OrderSection } from "@kebo/shared";
import { Pencil } from "lucide-react";
import { Button, cn } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PANEL_FORM, PanelBody, PanelFooter, SidePanel, WhatHappens } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";
import { WindowFiles } from "./section-files";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * A section's button look: "edit" (✎ Edit), "main" (the page's orange one), "plain", "link" (quiet words in a table
 * row). `what`: an Edit in a record box's head (the box's quiet ✎ Edit, read out as "Edit <what>").
 */
export type WindowButton = { label: string; kind?: "edit" | "main" | "plain" | "danger" | "link"; what?: string };

/** The address a window was last opened from by a link (so one link opens one window, once). */
let claimed = "";

/**
 * A window a link can open (the order's next step in the header: …/payment?do=record-payment): the first window
 * with that `name` on the page opens once it is drawn, and the address forgets the ask (Back does not open it
 * again). A window without a name is only opened by its button.
 */
export function useOpenFromLink(name: string | undefined, open: () => void) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const want = params.get("do");
  useEffect(() => {
    if (!name || want !== name || claimed === window.location.href) return;
    claimed = window.location.href;
    open();
    const p = new URLSearchParams(params.toString());
    p.delete("do");
    const rest = p.toString();
    router.replace(rest ? `${pathname}?${rest}` : pathname, { scroll: false });
    // Every window on the page has looked by now; the same link can open it again later.
    setTimeout(() => {
      claimed = "";
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the ask arrives
  }, [name, want]);
}

/** The quiet words that open a window from a table row. */
export const ROW_LINK = "text-[13px] font-medium whitespace-nowrap text-primary hover:underline";

const SMALL = "h-8 px-2.5 text-[13px]";

/** The button that opens a window, in its look (WindowButton); the same for every kind of window. */
export function WindowOpener({ button, disabled, onClick }: { button: WindowButton; disabled?: boolean; onClick: () => void }) {
  const kind = button.kind ?? "edit";
  // A box's Edit: the record box's quiet ✎ Edit, the same on every record (read out as "Edit <what>" when said).
  if (kind === "edit")
    return (
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={disabled}
        aria-label={button.what ? `${button.label} ${button.what}` : undefined}
        aria-haspopup="dialog"
        className="text-primary hover:text-primary"
        onClick={onClick}
      >
        <Pencil aria-hidden /> {button.label}
      </Button>
    );
  if (kind === "link")
    return (
      <button type="button" disabled={disabled} className={ROW_LINK} onClick={onClick}>
        {button.label}
      </button>
    );
  // "main" is a box's own act (Record payment, Add): plain like the others — the page's one orange button is the
  // header's next step (canvas row "The order on the same pieces": no orange buttons in boxes).
  return (
    <Button size="sm" disabled={disabled} variant={kind === "danger" ? "danger" : "secondary"} className={SMALL} onClick={onClick}>
      {button.label}
    </Button>
  );
}

function Foot({ submit, danger, note }: { submit: string; danger?: boolean; note?: ReactNode }) {
  return (
    <PanelFooter start={note}>
      <SubmitButton variant={danger ? "danger" : "primary"}>{submit}</SubmitButton>
    </PanelFooter>
  );
}

/**
 * A section's window (the order without checklists): opened by the section's
 * button, it holds only that section's fields, then its files, then Cancel
 * and one button. Saving closes it and the section shows the new values;
 * nothing else opens by itself. Windows that change a state say what happens.
 */
export function SectionWindow({
  button,
  title,
  sub,
  action,
  submit = "Save",
  whats,
  danger,
  note,
  files,
  size = "sm",
  name,
  children,
}: {
  button: WindowButton;
  title: string;
  sub?: ReactNode;
  action: Action;
  submit?: string;
  /** What saving does, for a window that changes a state. */
  whats?: ReactNode[];
  danger?: boolean;
  /** A quiet line or link at the left of the buttons. */
  note?: ReactNode;
  /** The section's files, added and opened inside the window. */
  files?: { orderId: string; section: OrderSection; hint?: string };
  /** sm 460px (a few fields), md 600px (a short table), lg 720px (a wide table). */
  size?: "sm" | "md" | "lg";
  /** A link opens it: ?do=<name> (useOpenFromLink). */
  name?: string;
  children?: ReactNode | ((state: ActionState) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  useOpenFromLink(name, () => setOpen(true));
  return (
    <>
      <WindowOpener button={button} onClick={() => setOpen(true)} />
      {open && (
        <SidePanel title={title} description={sub} onClose={() => setOpen(false)} className={cn(size === "sm" && "md:w-[460px]", size === "md" && "md:w-[600px]")}>
          <PanelBody>
            <ActionForm action={action} onDone={() => setOpen(false)} showSuccess={false} className={PANEL_FORM}>
              {(s) => (
                <>
                  {typeof children === "function" ? children(s) : children}
                  {whats && whats.length > 0 && <WhatHappens lines={whats} />}
                  {files && <WindowFiles {...files} />}
                  <Foot submit={submit} danger={danger} note={note} />
                </>
              )}
            </ActionForm>
          </PanelBody>
        </SidePanel>
      )}
    </>
  );
}

/** Two fields side by side in a window (one column on a phone). */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}
