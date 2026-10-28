import { AuthShell } from "@/app/login/auth-shell";
import { PlatformTwoStepForm } from "../forms";

export const metadata = { title: "Platform sign in" };

export default function PlatformTwoStepPage() {
  return (
    <AuthShell subtitle="Platform admin">
      <h1 className="text-lg font-semibold">Enter your code</h1>
      <p className="mt-1 text-sm text-muted">Open your authenticator app and enter the code for RFQ Desk platform.</p>
      <PlatformTwoStepForm />
    </AuthShell>
  );
}
