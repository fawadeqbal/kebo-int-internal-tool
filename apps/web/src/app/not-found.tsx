import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonClass } from "@kebo/ui";

export const metadata = { title: "Not found" };

/** Any address that leads nowhere: say so plainly, one way back. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2.5 px-4 text-center">
      <p className="text-[40px] leading-none font-bold text-primary">404</p>
      <h1 className="text-base font-bold text-text">This page does not exist</h1>
      <p className="text-sm text-muted">It may have been removed, or the link is wrong.</p>
      <Link href="/dashboard" className={buttonClass("secondary")}>
        <ArrowLeft aria-hidden />
        Back to the dashboard
      </Link>
    </main>
  );
}
