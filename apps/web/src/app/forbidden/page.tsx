import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import { buttonClass } from "@kebo/ui";

export default function Forbidden() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2.5 px-4 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-bad-soft text-bad" aria-hidden>
        <Lock className="size-6" />
      </span>
      <h1 className="text-base font-bold text-text">You cannot open this page</h1>
      <p className="text-sm text-muted">
        Your role does not include it. If you need it, ask whoever looks after roles in your company to add it to yours.
      </p>
      <Link href="/dashboard" className={buttonClass("secondary")}>
        <ArrowLeft aria-hidden />
        Back to the dashboard
      </Link>
    </main>
  );
}
