import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Alert, buttonClass } from "@kebo/ui";
import { companyOrigin } from "@kebo/shared";
import { apiFetch } from "@/lib/api";
import { AuthShell } from "@/app/login/auth-shell";

export const metadata = { title: "Start your trial" };

/** The link in the sign-up email: confirms the email and makes the trial company. */
export default async function ConfirmSignUpPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const res = token
    ? await apiFetch("/platform/public/sign-up/confirm", { method: "POST", auth: false, body: JSON.stringify({ token }) }).catch(() => null)
    : null;
  const body = res ? ((await res.json().catch(() => ({}))) as { email?: string; slug?: string; error?: string }) : {};
  // The new company's own address (once companies have addresses).
  const login = body.slug ? `${companyOrigin(body.slug, process.env.BASE_DOMAIN, "")}/login` : "/login";
  return (
    <AuthShell subtitle="Start your trial">
      {res?.ok ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <CheckCircle2 className="size-10 text-ok" aria-hidden />
          <h1 className="text-lg font-semibold">Your workspace is ready</h1>
          <p className="text-sm text-muted">Sign in with {body.email} and the password you chose.</p>
          <a href={login} className={buttonClass("primary", "lg", "w-full")}>
            Sign in
          </a>
        </div>
      ) : (
        <>
          <h1 className="text-lg font-semibold">This link does not work</h1>
          <Alert tone="warning" className="mt-3">
            {body.error ?? "It has expired. Sign up again."}
          </Alert>
          <Link href="/sign-up" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
            Sign up again
          </Link>
        </>
      )}
    </AuthShell>
  );
}
