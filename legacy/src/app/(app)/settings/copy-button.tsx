"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { buttonClass } from "@/components/ui";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className={buttonClass("secondary", "xs")}
    >
      {copied ? <Check aria-hidden className="text-ok" /> : <Copy aria-hidden />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
