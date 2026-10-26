import { AuthShell } from "./auth-shell";
import { LoginForm } from "./forms";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthShell>
      <h1 className="text-lg font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Use the email and password your admin gave you.</p>
      <LoginForm next={next} />
    </AuthShell>
  );
}
