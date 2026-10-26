import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSettings } from "@/modules/settings/service";
import { TWO_STEP_COOKIE, verifyTwoStepToken } from "@/lib/auth/token";
import { verifySecondStepAction } from "@/modules/users/two-step-actions";
import { SecondStepForm } from "@/modules/users/two-step-components";
import { AuthShell } from "../auth-shell";

export const metadata: Metadata = { title: "Two-step sign-in" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  // Only reachable for 5 minutes after a correct password.
  if (!(await verifyTwoStepToken((await cookies()).get(TWO_STEP_COOKIE)?.value))) redirect("/login");
  const [{ next }, settings] = await Promise.all([searchParams, getSettings()]);
  return (
    <AuthShell companyName={settings.companyName}>
      <h1 className="text-lg font-semibold text-text">Two-step sign-in</h1>
      <p className="mt-1 text-sm text-muted">Open your authenticator app and enter the 6-digit code for Kebo RFQ Desk.</p>
      <SecondStepForm action={verifySecondStepAction} next={next} />
      <p className="mt-4 text-center text-xs text-muted">
        <a href="/login" className="hover:text-text hover:underline">
          ← Back to sign in
        </a>
      </p>
    </AuthShell>
  );
}
