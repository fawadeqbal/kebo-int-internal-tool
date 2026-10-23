"use client";

import { useState } from "react";

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
      className="rounded-md bg-white/15 px-2.5 py-1 text-xs font-medium text-white hover:bg-white/25"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
