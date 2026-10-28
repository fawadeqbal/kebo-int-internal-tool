import Link from "next/link";
import { Alert } from "@kebo/ui";
import { apiFetch } from "@/lib/api";
import { AuthShell } from "@/app/login/auth-shell";
import { SetPasswordForm } from "./form";

export const metadata = { title: "Set your password" };

/** The link a new tenant admin (or someone whose password was reset) gets by email. */
export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const res = token ? await apiFetch(`/platform/public/set-password?token=${encodeURIComponent(token)}`, { auth: false }) : null;
  const info = res?.ok ? ((await res.json()) as { email: string; name: string; company: string }) : null;
  return (
    <AuthShell subtitle="Set your password">
      {info ? (
        <>
          <h1 className="text-lg font-semibold">Hello {info.name}</h1>
          <p className="mt-1 text-sm text-muted">
            Choose a password for <span className="font-medium text-text">{info.email}</span> at {info.company}.
          </p>
          <SetPasswordForm token={token} email={info.email} />
        </>
      ) : (
        <>
          <h1 className="text-lg font-semibold">This link does not work</h1>
          <Alert tone="warning" className="mt-3">
            It has expired or was already used. Ask your admin (or the person who sent it) for a new one.
          </Alert>
          <Link href="/login" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
            Go to sign in
          </Link>
        </>
      )}
    </AuthShell>
  );
}
