"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@kebo/ui";

/** "Last check 02:44" and Check now; the page also reads the status again every minute by itself. */
export function Refresh({ checked }: { checked: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 60_000);
    return () => clearInterval(t);
  }, [router]);
  return (
    <span className="flex items-center gap-2">
      <span className="hidden text-xs text-muted sm:inline">{checked}</span>
      <Button size="sm" variant="secondary" onClick={() => start(() => router.refresh())} disabled={busy}>
        <RefreshCw aria-hidden className={busy ? "animate-spin" : undefined} />
        Check now
      </Button>
    </span>
  );
}
