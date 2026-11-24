"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@kebo/ui";
import { toast } from "@kebo/ui/client";

/** "Last check 02:44" and Check now; the page also reads the status again every minute by itself. */
export function Refresh({ checked }: { checked: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const asked = useRef(false);
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 60_000);
    return () => clearInterval(t);
  }, [router]);
  // Check now says that it checked, and when (review 24 Nov, A-38: nothing seemed to happen).
  useEffect(() => {
    if (busy || !asked.current) return;
    asked.current = false;
    toast({ message: "Checked again", detail: checked });
  }, [busy, checked]);
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-muted">{checked}</span>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          asked.current = true;
          start(() => router.refresh());
        }}
        disabled={busy}
      >
        <RefreshCw aria-hidden className={busy ? "animate-spin" : undefined} />
        Check now
      </Button>
    </span>
  );
}
