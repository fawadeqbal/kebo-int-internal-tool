import Link from "next/link";
import { buttonClass } from "@kebo/ui";

export default function Forbidden() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">Not for your role</h1>
      <p className="text-sm text-muted">You do not have access to this page. Ask a manager if you need it.</p>
      <Link href="/dashboard" className={buttonClass("secondary")}>Back to the dashboard</Link>
    </main>
  );
}
