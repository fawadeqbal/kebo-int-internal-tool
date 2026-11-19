"use client";

import { useState, type ReactNode } from "react";
import type { OrderSection } from "@kebo/shared";
import { cn, RULES } from "@kebo/ui";
import { SidePanel, WhatHappens } from "@/components/common/panel";
import { FieldsForm, type DetailField } from "@/components/orders/step-view";
import type { ActionState } from "@/lib/actions";
import { useOpenFromLink, WindowOpener, type WindowButton } from "./section-window";
import { WindowFiles } from "./section-files";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * A section's window, described by its fields (the order without checklists):
 * only that section's values, then what saving does (when it changes a state),
 * then the section's files, then Save and Cancel. Saving sends only the values
 * that changed; a date out of order asks first and can go ahead with a reason;
 * changing a saved value asks why. Saving closes the window.
 */
export function FieldsWindow({
  button,
  title,
  sub,
  fields,
  action,
  save,
  whats,
  files,
  size = "sm",
  plain,
  disabled,
  name,
}: {
  button: WindowButton;
  title: string;
  sub?: string;
  fields: DetailField[];
  action: Action;
  save?: string;
  whats?: ReactNode[];
  files?: { orderId: string; section: OrderSection; hint?: string };
  size?: "sm" | "md" | "lg";
  /** Never asks why (nothing was saved before). */
  plain?: boolean;
  disabled?: boolean;
  /** A link opens it: ?do=<name> (useOpenFromLink). */
  name?: string;
}) {
  const [open, setOpen] = useState(false);
  useOpenFromLink(name, () => setOpen(true));
  return (
    <>
      <WindowOpener button={button} disabled={disabled} onClick={() => setOpen(true)} />
      {open && (
        <SidePanel title={title} description={sub} onClose={() => setOpen(false)} className={cn(size === "sm" && RULES.window.part, size === "md" && RULES.window.part)}>
          <FieldsForm
            action={action}
            fields={fields}
            save={save}
            plain={plain}
            note=""
            extra={
              (whats?.length || files) && (
                <>
                  {whats && whats.length > 0 && <WhatHappens lines={whats} />}
                  {files && <WindowFiles {...files} />}
                </>
              )
            }
          />
        </SidePanel>
      )}
    </>
  );
}
