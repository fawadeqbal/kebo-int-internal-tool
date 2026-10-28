import { AuthShell } from "@/app/login/auth-shell";
import { PlatformLoginForm } from "../forms";

export const metadata = { title: "Platform sign in" };

export default function PlatformLoginPage() {
  return (
    <AuthShell subtitle="Platform admin" footer="Companies, client inquiries, demos and plans.">
      <h1 className="text-lg font-semibold">Sign in to the platform</h1>
      <p className="mt-1 text-sm text-muted">For the people who run RFQ Desk. Company staff sign in on the usual page.</p>
      <PlatformLoginForm />
    </AuthShell>
  );
}
