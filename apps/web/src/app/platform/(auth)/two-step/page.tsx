import { AuthShell } from "@/app/login/auth-shell";
import { PlatformTwoStepForm } from "../forms";

export const metadata = { title: "Platform sign in" };

export default function PlatformTwoStepPage() {
  return (
    <AuthShell subtitle="Platform admin">
      <h1 className="text-2xl leading-8 font-bold tracking-tight sm:text-2xl sm:leading-9">Two-step verification</h1>
      <div className="mt-6 text-center">
        <PlatformTwoStepForm />
      </div>
    </AuthShell>
  );
}
