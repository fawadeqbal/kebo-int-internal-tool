import Link from "next/link";
import { buttonClass } from "@kebo/ui";

export const metadata = { title: "Not found" };

/** Any address that leads nowhere: say so plainly, one way back. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-5xl font-bold tracking-tight text-primary">404</p>
      <h1 className="text-2xl font-bold tracking-tight">This page does not exist</h1>
      <p className="text-sm text-text-2">It may have been removed, or the link is wrong.</p>
      <Link href="/dashboard" className={buttonClass("secondary")}>
        Back to the dashboard
      </Link>
    </main>
  );
}
