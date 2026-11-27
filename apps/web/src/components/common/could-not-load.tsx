"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button, Notice, cn } from "@kebo/ui";

/**
 * In the place of a part of the page that could not be read (lib/part.ts): it says so and offers to try again;
 * the rest of the page works. `compact`: one line, for a small place (a figure, a filter's choices).
 */
export function CouldNotLoad({ what, compact, className }: { what: string; compact?: boolean; className?: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const again = (
    <Button size="sm" variant="ghost" disabled={busy} onClick={() => start(() => router.refresh())}>
      <RotateCcw aria-hidden />
      {busy ? "Trying…" : "Try again"}
    </Button>
  );
  if (compact)
    return (
      <span role="status" className={cn("inline-flex flex-wrap items-center gap-1 text-sm text-bad", className)}>
        Could not load {what}.{again}
      </span>
    );
  return (
    <Notice tone="bad" title={`Could not load ${what}`} action={again} className={className}>
      Could not reach the server, or something went wrong. The rest of the page works; nothing you saved is lost.
    </Notice>
  );
}
