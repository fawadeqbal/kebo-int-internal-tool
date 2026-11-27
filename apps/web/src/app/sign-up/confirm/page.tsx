import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { buttonClass, Notice, linkClass, cn } from "@kebo/ui";
import { companyOrigin } from "@kebo/shared";
import { apiFetch } from "@/lib/api";
import { bodyOf, ignore } from "@/lib/quiet";
import { AuthShell } from "@/app/login/auth-shell";

export const metadata = { title: "Start your trial" };

/** The link in the sign-up email: confirms the email and makes the trial company. */
export default async function ConfirmSignUpPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const res = token
    ? await apiFetch("/platform/public/sign-up/confirm", { method: "POST", auth: false, body: JSON.stringify({ token }) }).catch(
        ignore("confirming a sign-up (shown as not confirmed yet)"),
      )
    : undefined;
  const body = (res && (await bodyOf<{ email?: string; slug?: string; error?: string }>(res))) ?? {};
  // The server could not be reached or failed: the link is not to blame, so it is not called expired.
  const down = !!token && (!res || res.status >= 500);
  // The new company's own address (once companies have addresses).
  const login = body.slug ? `${companyOrigin(body.slug, process.env.BASE_DOMAIN, "")}/login` : "/login";
  return (
    <AuthShell subtitle="Start your trial">
      {res?.ok ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <CheckCircle2 className="size-10 text-ok" aria-hidden />
          <h1 className="text-2xl leading-8 font-bold tracking-tight sm:text-2xl sm:leading-9">Your workspace is ready</h1>
          <p className="text-sm text-muted">Sign in with {body.email} and the password you chose.</p>
          <a href={login} className={buttonClass("primary", "lg", "w-full")}>
            Sign in
          </a>
        </div>
      ) : (
        <>
          <h1 className="text-2xl leading-8 font-bold tracking-tight sm:text-2xl sm:leading-9">
            {down ? "Your sign-up could not be confirmed just now" : "This link does not work"}
          </h1>
          <Notice tone="todo" className="mt-3">
            {down ? "Open the link in the email again in a few minutes." : (body.error ?? "It has expired. Sign up again.")}
          </Notice>
          {!down && (
            <Link href="/sign-up" className={cn(linkClass, "mt-4 inline-block text-sm")}>
              Sign up again
            </Link>
          )}
        </>
      )}
    </AuthShell>
  );
}
