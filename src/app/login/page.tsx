import type { Metadata } from "next";
import { getSettings } from "@/modules/settings/service";
import { AuthShell } from "./auth-shell";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; ended?: string }> }) {
  const { next, ended } = await searchParams;
  const settings = await getSettings();
  return (
    <AuthShell companyName={settings.companyName}>
      <h1 className="text-lg font-semibold text-text">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Use the account your admin set up for you.</p>
      {ended && (
        <p role="status" className="mt-4 rounded-lg border border-info/25 bg-info-soft px-3 py-2 text-sm text-text">
          Your session ended (signed out, or the password was changed). Please sign in again.
        </p>
      )}
      <LoginForm next={next} />
    </AuthShell>
  );
}
