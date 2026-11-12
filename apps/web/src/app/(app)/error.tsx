"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button, ButtonLink } from "@kebo/ui";

/** Board "Messages after an action": a page that could not load says so, keeps you here, and offers to try again. */
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-line bg-surface px-6 py-12 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-bad-soft text-bad" aria-hidden>
        <TriangleAlert className="size-6" />
      </span>
      <h1 className="text-base font-bold text-text">This page could not load</h1>
      <p className="max-w-[420px] text-sm text-muted">
        Could not reach the server, or something went wrong. Nothing you saved is lost; try again.
      </p>
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        <Button onClick={() => retry()}>
          <RotateCcw aria-hidden />
          Try again
        </Button>
        <ButtonLink href="/dashboard" variant="ghost">
          Back to the dashboard
        </ButtonLink>
      </div>
    </div>
  );
}
