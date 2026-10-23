import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-[60vh] place-items-center p-6">
      <div className="max-w-sm text-center">
        <p className="font-mono text-sm text-muted">404</p>
        <h1 className="mt-2 text-xl font-semibold">We couldn&apos;t find that</h1>
        <p className="mt-2 text-sm text-muted">It may have been removed, or the link is incorrect.</p>
        <Link href="/dashboard" className="mt-6 inline-block text-sm font-medium text-brand-700 hover:underline">
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
