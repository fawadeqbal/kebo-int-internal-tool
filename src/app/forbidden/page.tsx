import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="max-w-sm text-center">
        <p className="font-mono text-sm text-muted">403</p>
        <h1 className="mt-2 text-xl font-semibold">You don&apos;t have access to this page</h1>
        <p className="mt-2 text-sm text-muted">Ask a manager or administrator if you need access.</p>
        <Link href="/dashboard" className="mt-6 inline-block text-sm font-medium text-brand-700 hover:underline">
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
