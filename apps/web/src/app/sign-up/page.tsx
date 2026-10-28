import Link from "next/link";
import { LIFECYCLE } from "@kebo/shared";
import { Alert } from "@kebo/ui";
import { apiFetch } from "@/lib/api";
import { AuthShell } from "@/app/login/auth-shell";
import { SignUpForm } from "./form";

export const metadata = { title: "Start a trial" };

/** Public self sign-up: a trial company for the person signing up (once their email is confirmed). */
export default async function SignUpPage() {
  const res = await apiFetch("/platform/public/sign-up", { auth: false }).catch(() => null);
  const open = res?.ok ? ((await res.json()) as { open: boolean }).open : false;
  return (
    <AuthShell
      wide
      subtitle="Start a free trial"
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <h1 className="text-lg font-semibold">Try RFQ Desk for {LIFECYCLE.trialDays} days</h1>
      {open ? (
        <>
          <p className="mt-1 text-sm text-muted">
            Your own workspace for inquiries, quotations, orders and money. Your team joins once you are in.
          </p>
          <SignUpForm trialDays={LIFECYCLE.trialDays} />
        </>
      ) : (
        <>
          <Alert tone="info" className="mt-3">
            Sign-up is not open yet. Request a demo and we will set one up for you.
          </Alert>
          <Link href="/request-a-demo" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
            Request a demo
          </Link>
        </>
      )}
    </AuthShell>
  );
}
