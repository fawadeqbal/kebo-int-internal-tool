import Link from "next/link";
import { Lock } from "lucide-react";
import { buttonClass } from "@kebo/ui";

export default function Forbidden() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-bad-soft text-bad" aria-hidden>
        <Lock className="size-6" />
      </span>
      <h1 className="text-2xl font-bold tracking-tight">You cannot open this page</h1>
      <p className="text-sm text-text-2">Your role does not include it. Ask the owner or a manager to give your role access if you need it.</p>
      <Link href="/dashboard" className={buttonClass("secondary")}>
        Back to the dashboard
      </Link>
    </main>
  );
}
