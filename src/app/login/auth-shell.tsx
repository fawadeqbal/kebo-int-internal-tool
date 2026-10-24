import type { ReactNode } from "react";
import { Card } from "@/components/ui";

/** The centred card used by sign-in, the two-step code and two-step setup. */
export function AuthShell({ companyName, wide, children }: { companyName: string; wide?: boolean; children: ReactNode }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[48rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
      <div className={wide ? "relative w-full max-w-md" : "relative w-full max-w-sm"}>
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary-solid text-primary-fg shadow-card" aria-hidden>
            <svg viewBox="0 0 32 32" className="size-5">
              <path d="M8 10h16M8 16h11M8 22h7" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" />
            </svg>
          </span>
          <div className="leading-tight">
            <p className="font-semibold text-text">{companyName}</p>
            <p className="text-xs text-muted">RFQ Desk · staff only</p>
          </div>
        </div>
        <Card className="p-6">{children}</Card>
        <p className="mt-6 text-center text-xs text-muted">Website, WhatsApp, WeChat and email RFQs, from first message to final invoice.</p>
      </div>
    </main>
  );
}
