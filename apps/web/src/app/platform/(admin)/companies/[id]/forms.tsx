"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { Button, Input } from "@kebo/ui";

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
