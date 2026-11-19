"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@kebo/ui";
import { PanelBody, SidePanel } from "@/components/common/panel";
import { useOpenFromLink, WindowOpener, type WindowButton } from "./section-window";

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
  startOpen = false,
  onClosed,
  name,
  children,
}: {
  button: WindowButton;
  title: string;
  sub?: ReactNode;
  /** sm 460px, md 600px, lg 720px, xl 900px. */
  size?: "sm" | "md" | "lg" | "xl";
  disabled?: boolean;
  /** Open as soon as it is drawn (a list's row that asked for this window). */
  startOpen?: boolean;
  /** After it closes, saved or not. */
  onClosed?: () => void;
  /** A link opens it: ?do=<name> (useOpenFromLink). */
  name?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(startOpen);
  useOpenFromLink(name, () => setOpen(true));
  const close = () => {
    setOpen(false);
    onClosed?.();
  };
  return (
    <>
      <WindowOpener button={button} disabled={disabled} onClick={() => setOpen(true)} />
      {open && (
        <SidePanel title={title} description={sub} onClose={close} className={cn(size === "sm" && "md:w-[460px]", size === "md" && "md:w-[600px]", size === "xl" && "md:w-[900px]")}>
          <PanelBody className="flex flex-col gap-4">{children(close)}</PanelBody>
        </SidePanel>
      )}
    </>
  );
}
