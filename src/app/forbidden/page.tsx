import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-sm text-center">
        <p className="font-mono text-sm text-muted">403</p>
        <h1 className="mt-2 text-lg font-semibold text-text">You don&apos;t have access to this page</h1>
        <p className="mt-2 text-sm text-muted">Ask a manager or administrator if you need access.</p>
        <Link href="/dashboard" className="mt-5 inline-flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-sm font-medium text-text shadow-card hover:bg-surface-2">
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
