"use client";

import { useState, type ReactNode } from "react";
import { Button, cn } from "@kebo/ui";
import { EditButton } from "@/components/common/edit-button";
import { PanelBody, SidePanel } from "@/components/common/panel";
import type { WindowButton } from "./section-window";

/**
 * A section's window around a form that already exists (the route, the plan,
 * a payment…): the section's button opens it, the form saves and closes it.
 * The same frame as SectionWindow; the form brings its own buttons.
 */
export function FormWindow({
  button,
  title,
  sub,
  size = "md",
  disabled,
  children,
}: {
  button: WindowButton;
  title: string;
  sub?: ReactNode;
  /** sm 460px, md 600px, lg 720px, xl 900px. */
  size?: "sm" | "md" | "lg" | "xl";
  disabled?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const kind = button.kind ?? "edit";
  const close = () => setOpen(false);
  return (
    <>
      {kind === "edit" ? (
        <EditButton label={button.label} disabled={disabled} onClick={() => setOpen(true)} />
      ) : (
        <Button size="sm" disabled={disabled} variant={kind === "main" ? "primary" : kind === "danger" ? "danger" : "secondary"} className="h-8 px-2.5 text-[13px]" onClick={() => setOpen(true)}>
          {button.label}
        </Button>
      )}
      {open && (
        <SidePanel title={title} description={sub} onClose={close} className={cn(size === "sm" && "md:w-[460px]", size === "md" && "md:w-[600px]", size === "xl" && "md:w-[900px]")}>
          <PanelBody className="flex flex-col gap-4">{children(close)}</PanelBody>
        </SidePanel>
      )}
    </>
  );
}
