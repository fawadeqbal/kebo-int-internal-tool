"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { Button, Input } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export function CopyLink({ link }: { link: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-2">
      <Input readOnly value={link} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label="Set-password link" />
      <Button
        size="sm"
        onClick={() => {
          void navigator.clipboard.writeText(link).then(() => setDone(true));
        }}
      >
        <Copy aria-hidden /> {done ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** One button that sends a form (switch on, read-only, off, end…), optionally with a reason. */
export function ActionButton({
  action,
  label,
  variant = "secondary",
  confirm,
  reason,
}: {
  action: Action;
  label: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  confirm?: string;
  reason?: boolean;
}) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-2">
      {reason && <Input name="reason" placeholder="Why (optional)" className="h-8 w-48 text-sm" aria-label="Why" />}
      <SubmitButton
        size="sm"
        variant={variant}
        onClick={(e) => {
          if (confirm && !window.confirm(confirm)) e.preventDefault();
        }}
      >
        {label}
      </SubmitButton>
    </ActionForm>
  );
}
