import { AuthShell } from "../auth-shell";
import { TwoStepForm } from "../forms";

export const metadata = { title: "Two-step sign-in" };

export default async function TwoStepPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthShell>
      <h1 className="text-lg font-semibold">Enter your code</h1>
      <p className="mt-1 text-sm text-muted">Your account uses two-step sign-in.</p>
      <TwoStepForm next={next} />
    </AuthShell>
  );
}
