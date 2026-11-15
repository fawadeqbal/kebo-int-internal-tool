"use client";

import { useState, useTransition } from "react";
import { Check, Copy, RotateCcw } from "lucide-react";
import type { DevError } from "@kebo/shared";
import { Button } from "@kebo/ui";
import { markErrorAction } from "./actions";

/** The error as one block of text to paste to Claude: what, where, how often, and the stack. */
export function CopyForClaude({ error: e }: { error: DevError }) {
  const [done, setDone] = useState(false);
  const text = [
    `Please fix this error in RFQ Desk (${e.source}).`,
    `Where: ${e.source === "web" ? "in the browser, page " : ""}${e.where}${e.path ? ` (${e.path})` : ""}`,
    `Seen ${e.count} times, first ${e.firstAt}${e.afterDeploy ? ` (after deploy ${e.afterDeploy})` : ""}, last ${e.lastAt}.`,
    "",
    e.stack ?? `${e.name}: ${e.message}`,
  ].join("\n");
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      <Copy aria-hidden />
      {done ? "Copied" : "Copy for Claude"}
    </Button>
  );
}

export function MarkError({ id, status }: { id: string; status: "open" | "fixed" }) {
  const [busy, start] = useTransition();
  return (
    <Button size="sm" variant="secondary" disabled={busy} onClick={() => start(() => markErrorAction(id, status))}>
      {status === "fixed" ? <Check aria-hidden /> : <RotateCcw aria-hidden />}
      {status === "fixed" ? "Mark as fixed" : "Open again"}
    </Button>
  );
}
