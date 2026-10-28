import { Suspense, type ReactNode } from "react";
import { Toast } from "@kebo/ui/client";
import { ClipboardList } from "lucide-react";
import { Card } from "@kebo/ui";

/** The centred card used by sign-in, the two-step code and the public pages (request a demo, sign up). */
export function AuthShell({
  children,
  wide = false,
  title = "RFQ Desk",
  subtitle = "Sign in to your company",
  footer = "Every RFQ from first message to shipped and paid.",
}: {
  children: ReactNode;
  wide?: boolean;
  title?: string;
  subtitle?: string;
  footer?: ReactNode;
}) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[48rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
      <div className={wide ? "relative w-full max-w-xl" : "relative w-full max-w-sm"}>
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-solid text-primary-fg shadow-card">
            <ClipboardList className="size-6" aria-hidden />
          </span>
          <div className="leading-tight">
            <p className="font-semibold text-text">{title}</p>
            <p className="text-xs text-muted">{subtitle}</p>
          </div>
        </div>
        <Card className="p-6">{children}</Card>
        {footer && <p className="mt-6 text-center text-xs text-muted">{footer}</p>}
      </div>
      <Suspense>
        <Toast />
      </Suspense>
    </main>
  );
}
