import { AuthShell } from "@/app/login/auth-shell";
import { SetPasswordForm } from "@/app/set-password/form";

export const metadata = { title: "Set your password" };

/** The link a new platform admin gets from the command line tool. */
export default async function PlatformSetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return (
    <AuthShell subtitle="Platform admin">
      <h1 className="text-lg font-semibold">Choose your password</h1>
      <p className="mt-1 text-sm text-muted">Then sign in and set up two-step sign-in.</p>
      <SetPasswordForm token={token} email="" platform />
    </AuthShell>
  );
}
