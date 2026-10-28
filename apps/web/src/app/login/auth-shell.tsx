import type { ReactNode } from "react";
import { Card } from "@kebo/ui";

/** The centred card used by sign-in and the two-step code. */
export function AuthShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[48rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
      <div className={wide ? "relative w-full max-w-xl" : "relative w-full max-w-sm"}>
        <div className="mb-6 flex items-center justify-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- a small static logo */}
          <img src="/brand/kebo-logo-96.png" alt="" width={48} height={48} className="size-12 shrink-0" />
          <div className="leading-tight">
            <p className="font-semibold text-text">Kebo International</p>
            <p className="text-xs text-muted">RFQ desk · staff only</p>
          </div>
        </div>
        <Card className="p-6">{children}</Card>
        <p className="mt-6 text-center text-xs text-muted">Every RFQ from first message to shipped and paid.</p>
      </div>
    </main>
  );
}
