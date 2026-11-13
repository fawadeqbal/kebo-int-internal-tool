"use client";

import { useState, type ReactNode } from "react";
import type { OrderSection } from "@kebo/shared";
import { Button, cn } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { EditButton } from "@/components/common/edit-button";
import { PANEL_FORM, PanelBody, PanelFooter, SidePanel, useClosePanel, WhatHappens } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";
import { WindowFiles } from "./section-files";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** A section's button look: "edit" (✎ Edit), "main" (the page's orange one), "plain", "link" (quiet words in a table row). */
export type WindowButton = { label: string; kind?: "edit" | "main" | "plain" | "danger" | "link" };

/** The quiet words that open a window from a table row. */
export const ROW_LINK = "text-[13px] font-medium whitespace-nowrap text-primary hover:underline";

const SMALL = "h-8 px-2.5 text-[13px]";

function Foot({ submit, danger, note }: { submit: string; danger?: boolean; note?: ReactNode }) {
  const close = useClosePanel();
  return (
    <PanelFooter start={note}>
      <Button type="button" variant="ghost" onClick={() => close()}>
        Cancel
      </Button>
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
  files?: { orderId: string; section: OrderSection; hint: string };
  /** sm 460px (a few fields), md 600px (a short table), lg 720px (a wide table). */
  size?: "sm" | "md" | "lg";
  children?: ReactNode | ((state: ActionState) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const kind = button.kind ?? "edit";
  return (
    <>
      {kind === "edit" ? (
        <EditButton label={button.label} onClick={() => setOpen(true)} />
      ) : kind === "link" ? (
        <button type="button" className={ROW_LINK} onClick={() => setOpen(true)}>
          {button.label}
        </button>
      ) : (
        <Button size="sm" variant={kind === "main" ? "primary" : kind === "danger" ? "danger" : "secondary"} className={SMALL} onClick={() => setOpen(true)}>
          {button.label}
        </Button>
      )}
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
