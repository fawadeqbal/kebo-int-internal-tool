import { AuthShell } from "./auth-shell";
import { LoginForm } from "./forms";
import { demoMode } from "@/lib/demo";
import { addressCompany, apiFetch } from "@/lib/api";

const DEMO_LOGINS = [
  { label: "Owner", hint: "Sees everything: money, profit, settings", email: "admin@example.com", password: "Admin@12345" },
  { label: "Manager", hint: "Insights, team and the money pages", email: "manager@example.com", password: "Manager@12345" },
  { label: "Sales person", hint: "Only their own inquiries and orders", email: "bilal@example.com", password: "Demo@12345" },
];

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // At a company's own address: its name over the form.
  const slug = await addressCompany();
  const res = slug ? await apiFetch(`/platform/public/company?slug=${encodeURIComponent(slug)}`, { auth: false }).catch(() => null) : null;
  const company = res?.ok ? ((await res.json()) as { name: string }).name : null;
  return (
    <AuthShell subtitle={company ?? undefined}>
      <h1 className="text-lg font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-muted">
        {demoMode()
          ? "This is a demo with sample data. Pick a person below to look around."
          : "Use the email and password your admin gave you."}
      </p>
      <LoginForm next={next} demo={demoMode() ? DEMO_LOGINS : undefined} />
    </AuthShell>
  );
}
