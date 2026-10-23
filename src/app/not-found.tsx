import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-[60vh] place-items-center p-6">
      <div className="max-w-sm text-center">
        <p className="font-mono text-sm text-muted">404</p>
        <h1 className="mt-2 text-lg font-semibold text-text">We couldn&apos;t find that</h1>
        <p className="mt-2 text-sm text-muted">It may have been removed, or the link is incorrect.</p>
        <Link href="/dashboard" className="mt-5 inline-flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-sm font-medium text-text shadow-card hover:bg-surface-2">
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
