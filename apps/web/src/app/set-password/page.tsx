import Link from "next/link";
import { Notice, linkClass, cn } from "@kebo/ui";
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
          <h1 className="text-2xl leading-8 font-bold tracking-tight sm:text-2xl sm:leading-9">Hello {info.name}</h1>
          <p className="mt-1 text-sm text-muted">
            Choose a password for <span className="font-medium text-text">{info.email}</span> at {info.company}.
          </p>
          <SetPasswordForm token={token} email={info.email} />
        </>
      ) : (
        <>
          <h1 className="text-2xl leading-8 font-bold tracking-tight sm:text-2xl sm:leading-9">This link does not work</h1>
          <Notice tone="todo" className="mt-3">
            It has expired or was already used. Ask your admin (or the person who sent it) for a new one.
          </Notice>
          <Link href="/login" className={cn(linkClass, "mt-4 inline-block text-sm")}>
            Go to sign in
          </Link>
        </>
      )}
    </AuthShell>
  );
}
