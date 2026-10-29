"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { Button, Input, Textarea } from "@kebo/ui";
import { ConfirmSubmit } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { newFormKeyAction } from "./actions";

export function CopyBlock({ text, label, multiline }: { text: string; label: string; multiline?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <div className="mt-1 flex items-start gap-2">
      {multiline ? (
        <Textarea readOnly value={text} rows={12} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label={label} />
      ) : (
        <Input readOnly value={text} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label={label} />
      )}
      <Button size="sm" onClick={() => void navigator.clipboard.writeText(text).then(() => setDone(true))}>
        <Copy aria-hidden /> {done ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** A new key: for when the old one got out. */
export function NewKeyButton() {
  return (
    <ActionForm action={newFormKeyAction}>
      <ConfirmSubmit
        variant="secondary"
        pendingText="Making…"
        message="Make a new key? The form on your website stops working until you paste the new snippet."
      >
        Make a new key
      </ConfirmSubmit>
    </ActionForm>
  );
}
