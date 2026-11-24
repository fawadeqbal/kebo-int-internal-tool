import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonClass } from "@kebo/ui";

export const metadata = { title: "Not found" };

/** Any address that leads nowhere: say so plainly, one way back. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2.5 px-4 text-center">
      <p className="text-4xl leading-none font-bold text-primary">404</p>
      {/* A record kept from someone reads the same as one that is gone (nothing is told about it): both are said
          (review 24 Nov: a record the role may not open read only "the link is wrong"). */}
      <h1 className="text-base font-bold text-text">This page cannot be opened</h1>
      <p className="text-sm text-muted">It may have been removed, the link may be wrong, or your role may not open it. Ask a manager if you need it.</p>
      <Link href="/dashboard" className={buttonClass("secondary")}>
        <ArrowLeft aria-hidden />
        Back to the dashboard
      </Link>
    </main>
  );
}
